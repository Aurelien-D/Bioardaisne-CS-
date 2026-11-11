/**
 * Real 3D models placed in a map (MapData.models): glTF files loaded once per asset
 * and drawn with instancing. Each instance is lit by the baked light sampled at its position.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { MapData } from '../../../shared/maps/types';
import type { Vec3 } from '../../../shared/math/vec3';

const templates = new Map<string, Promise<THREE.Object3D | null>>();

/**
 * Model shaders: like the world, the ambient light comes from the bake — here through the
 * instance colour (baked light sampled at the instance) instead of a lightmap. No hemisphere
 * and no diffuse sky light (they would make indoor models glow); the sun stays dynamic and
 * reflections fade where the baked light is dark.
 */
const MODEL_LIGHTS_BEGIN = THREE.ShaderChunk.lights_fragment_begin.replace(
  'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );',
  '',
);
const MODEL_LIGHTS_MAPS = THREE.ShaderChunk.lights_fragment_maps
  .replace(
    'iblIrradiance += getIBLIrradiance( geometryNormal );',
    '',
  )
  .replace(
    'radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );',
    `radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#ifdef USE_COLOR
		radiance *= clamp( dot( vColor.rgb, vec3( 0.3333 ) ) * 1.3, 0.04, 1.0 );
	#endif`,
  );
const MODEL_BAKED = `
	#if defined( RE_IndirectDiffuse ) && defined( USE_COLOR )
		// Baked ambient, a little stronger on faces turned up (most of it comes from the ceiling or the sky).
		irradiance += vColor.rgb * PI * ( 0.82 + 0.18 * inverseTransformDirection( geometryNormal, viewMatrix ).y );
	#endif
`;

function patchMaterial(material: THREE.Material): void {
  if (material.userData.basModel) return;
  material.userData.basModel = true;
  const std = material as THREE.MeshStandardMaterial;
  // Pure white paint clips under a low sun: keep albedos in a plausible range.
  if (std.color && !std.map) {
    const peak = Math.max(std.color.r, std.color.g, std.color.b);
    if (peak > 0.8) std.color.multiplyScalar(0.8 / peak);
  } else if (std.color) {
    std.color.multiplyScalar(0.88);
  }
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', '') // the instance colour is light, not paint
      .replace('#include <lights_fragment_begin>', MODEL_LIGHTS_BEGIN)
      .replace('#include <lights_fragment_maps>', MODEL_BAKED + MODEL_LIGHTS_MAPS);
  };
  material.customProgramCacheKey = () => 'bas-model';
}

function loadTemplate(asset: string): Promise<THREE.Object3D | null> {
  let p = templates.get(asset);
  if (!p) {
    p = new GLTFLoader()
      .loadAsync(new URL(`media/models/props/${asset}/model.json`, document.baseURI).href)
      .then((g) => {
        g.scene.updateMatrixWorld(true);
        return g.scene as THREE.Object3D;
      })
      .catch((err) => {
        console.warn(`[models] modèle « ${asset} » indisponible :`, err);
        return null;
      });
    templates.set(asset, p);
  }
  return p;
}

export interface MapModels {
  group: THREE.Group;
  dispose(): void;
}

export async function buildMapModels(map: MapData, sampleLight: (pos: Vec3, out: THREE.Color) => THREE.Color): Promise<MapModels> {
  const group = new THREE.Group();
  group.name = 'bas-models';
  const made: THREE.InstancedMesh[] = [];
  const byAsset = new Map<string, NonNullable<MapData['models']>>();
  for (const m of map.models ?? []) {
    const list = byAsset.get(m.asset) ?? [];
    list.push(m);
    byAsset.set(m.asset, list);
  }
  const inst = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const mat4 = new THREE.Matrix4();
  const color = new THREE.Color();
  await Promise.all(
    [...byAsset].map(async ([asset, list]) => {
      const tpl = await loadTemplate(asset);
      if (!tpl) return;
      tpl.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        for (const mm of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) patchMaterial(mm);
        const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
        im.castShadow = true;
        im.receiveShadow = true;
        for (let i = 0; i < list.length; i++) {
          const m = list[i]!;
          const s = m.scale ?? 1;
          inst.compose(pos.set(m.pos.x, m.pos.y, m.pos.z), q.setFromAxisAngle(up, m.rotY), scl.set(s, s, s));
          im.setMatrixAt(i, mat4.multiplyMatrices(inst, mesh.matrixWorld));
          // Baked light at the instance (slightly above the floor): the ambient term of the shader.
          sampleLight({ x: m.pos.x, y: m.pos.y + 0.8, z: m.pos.z }, color);
          const peak = Math.max(color.r, color.g, color.b);
          if (peak > 1.2) color.multiplyScalar(1.2 / peak);
          if (peak < 0.12) color.addScalar(0.12 - peak); // never pitch black (sample inside a wall)
          im.setColorAt(i, color);
        }
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.computeBoundingSphere();
        group.add(im);
        made.push(im);
      });
    }),
  );
  return {
    group,
    dispose() {
      group.removeFromParent();
      for (const im of made) im.dispose();
    },
  };
}
