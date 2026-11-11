/**
 * Real 3D models placed in a map (MapData.models): glTF files loaded once per asset
 * and drawn with instancing. Each instance is tinted by the baked light at its position.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { MapData } from '../../../shared/maps/types';
import type { Vec3 } from '../../../shared/math/vec3';

const templates = new Map<string, Promise<THREE.Object3D | null>>();

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
        const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
        im.castShadow = true;
        im.receiveShadow = true;
        for (let i = 0; i < list.length; i++) {
          const m = list[i]!;
          const s = m.scale ?? 1;
          inst.compose(pos.set(m.pos.x, m.pos.y, m.pos.z), q.setFromAxisAngle(up, m.rotY), scl.set(s, s, s));
          im.setMatrixAt(i, mat4.multiplyMatrices(inst, mesh.matrixWorld));
          // Baked light at the instance (slightly above the floor) darkens models in dim rooms.
          sampleLight({ x: m.pos.x, y: m.pos.y + 0.8, z: m.pos.z }, color);
          const l = 0.45 + 0.55 * Math.min(1.25, (color.r + color.g + color.b) / 3);
          im.setColorAt(i, color.setScalar(l));
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
