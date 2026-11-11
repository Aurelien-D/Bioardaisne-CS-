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

function patchMaterial(material: THREE.Material, keepColor = false): void {
  if (material.userData.basModel) return;
  material.userData.basModel = true;
  const std = material as THREE.MeshStandardMaterial;
  // Pure white paint clips under a low sun: keep albedos in a plausible range.
  if (keepColor) {
    /* a clone of an already adjusted material */
  } else if (std.color && !std.map) {
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

interface GltfJson {
  materials?: {
    normalTexture?: unknown;
    occlusionTexture?: unknown;
    pbrMetallicRoughness?: { metallicRoughnessTexture?: unknown; metallicFactor?: number; roughnessFactor?: number };
  }[];
}

/**
 * @param lite colour maps only (no normal / roughness / occlusion maps): a third of the downloads
 *             and of the texture memory, for the lighter presets and phones.
 */
function loadTemplate(asset: string, lite: boolean): Promise<THREE.Object3D | null> {
  const key = `${asset}|${lite ? 'lite' : 'full'}`;
  let p = templates.get(key);
  if (!p) {
    const url = new URL(`media/models/props/${asset}/model.json`, document.baseURI).href;
    p = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<GltfJson>;
      })
      .then((json) => {
        if (lite) {
          for (const m of json.materials ?? []) {
            delete m.normalTexture;
            delete m.occlusionTexture;
            const pbr = m.pbrMetallicRoughness;
            if (pbr?.metallicRoughnessTexture) {
              // Without its map, a metal/roughness pair of 1 / 1 would turn the whole object into chrome.
              delete pbr.metallicRoughnessTexture;
              pbr.metallicFactor = Math.min(pbr.metallicFactor ?? 1, 0.15);
              pbr.roughnessFactor = Math.min(pbr.roughnessFactor ?? 1, 0.7);
            }
          }
        }
        return new GLTFLoader().parseAsync(JSON.stringify(json), url.slice(0, url.lastIndexOf('/') + 1));
      })
      .then((g) => {
        g.scene.updateMatrixWorld(true);
        return g.scene as THREE.Object3D;
      })
      .catch((err) => {
        console.warn(`[models] modèle « ${asset} » indisponible :`, err);
        return null;
      });
    templates.set(key, p);
  }
  return p;
}

export interface MapModels {
  group: THREE.Group;
  /** Resolves when every model has arrived (or failed); models are added to `group` as they come. */
  done: Promise<void>;
  dispose(): void;
}

/**
 * @param interiorEnv reflection probe captured inside the building: models under a roof mirror
 *                    it instead of the sky (chrome chair legs must not shine like outdoors).
 */
export function buildMapModels(
  map: MapData,
  sampleLight: (pos: Vec3, out: THREE.Color) => THREE.Color,
  interiorEnv: THREE.Texture | null = null,
  lite = false,
): MapModels {
  let disposed = false;
  const group = new THREE.Group();
  group.name = 'bas-models';
  const made: THREE.InstancedMesh[] = [];
  const cloned: THREE.Material[] = [];
  // Instances under a roof never reach the sun's shadow map (saves most of the shadow pass):
  // each asset is drawn as one indoor batch (no shadow casting) and one outdoor batch.
  const roofed = (m: NonNullable<MapData['models']>[number]): boolean => {
    for (const s of map.solids) {
      if (s.min.y > m.pos.y + 1.2 && s.min.x <= m.pos.x && s.max.x >= m.pos.x && s.min.z <= m.pos.z && s.max.z >= m.pos.z) return true;
    }
    return false;
  };
  const byAsset = new Map<string, NonNullable<MapData['models']>>();
  for (const m of map.models ?? []) {
    const key = `${m.asset}|${roofed(m) ? 'in' : 'out'}`;
    const list = byAsset.get(key) ?? [];
    list.push(m);
    byAsset.set(key, list);
  }
  const inst = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const mat4 = new THREE.Matrix4();
  const color = new THREE.Color();
  const done = Promise.all(
    [...byAsset].map(async ([key, list]) => {
      const [asset, where] = key.split('|') as [string, string];
      const tpl = await loadTemplate(asset, lite);
      if (!tpl || disposed) return;
      tpl.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        for (const mm of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) patchMaterial(mm);
        let material = mesh.material;
        if (where === 'in' && interiorEnv) {
          const indoor = (src: THREE.Material): THREE.Material => {
            const copy = src.clone() as THREE.MeshStandardMaterial;
            copy.userData = {};
            patchMaterial(copy, true);
            copy.envMap = interiorEnv;
            copy.envMapIntensity = 1;
            cloned.push(copy);
            return copy;
          };
          material = Array.isArray(mesh.material) ? mesh.material.map(indoor) : indoor(mesh.material);
        }
        const im = new THREE.InstancedMesh(mesh.geometry, material, list.length);
        im.castShadow = where === 'out';
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
  ).then(() => undefined);
  return {
    group,
    done,
    dispose() {
      disposed = true;
      group.removeFromParent();
      for (const im of made) im.dispose();
      for (const m of cloned) m.dispose();
    },
  };
}
