/**
 * Realistic weapon models (freely licensed, see public/media/credits-weapons.md).
 *
 * Every model lives in public/media/models/weapons/<weaponId>/model.json: a glTF 2.0 file
 * whose geometry is embedded (base64) and whose textures are .jpg / .png files next to it
 * (only .json / .jpg / .png / .webp are served where the game is published).
 *
 * The loader delivers each model in the WEAPON FRAME, whatever the source file looks like:
 *   - metres, real-world size;
 *   - barrel toward -Z, top toward +Y, right-hand side of the weapon toward +X;
 *   - origin at the top of the pistol grip (where the firing hand holds): the bore axis sits
 *     a few centimetres above the origin, the trigger just in front of it.
 *
 * Usage:
 *   await preloadWeaponAssets();              // once, never rejects
 *   const asset = getWeaponAsset('rifle_ak'); // null when the model is missing
 *   if (asset) holder.add(asset.scene.clone());
 *
 * Review page: /dev/weapons.html (axes, grid and anchors for every weapon).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { WeaponId } from '../../../shared/weapons/defs';

export interface WeaponAsset {
  /** Ready-to-use model in the game's weapon frame (see above). Clone it before use. */
  scene: THREE.Group;
  /** Local positions (metres) in the weapon frame. */
  muzzle: [number, number, number];
  /** A point on the sight line near the shooter's eye (rear sight / optic window centre). */
  sight: [number, number, number];
  /** Where the support hand holds (fore-end; for pistols under the grip). */
  gripLeft: [number, number, number];
  credit: string;
}

type Vec3 = [number, number, number];

interface AssetSpec {
  /**
   * Placement of the glTF scene inside the delivered group:
   * weapon = position + Rotation(XYZ Euler, degrees) * (scale * source).
   */
  rotation: Vec3;
  /** Metres per source unit. */
  scale: number;
  position: Vec3;
  muzzle: Vec3;
  sight: Vec3;
  gripLeft: Vec3;
  credit: string;
}

/** Per-model placement and anchors (weapon frame, metres). Generated with the review page. */
const SPECS: Partial<Record<WeaponId, AssetSpec>> = {};

const DEG = Math.PI / 180;
const assets = new Map<WeaponId, WeaponAsset>();
let pending: Promise<void> | null = null;

/** URL of a weapon model, relative to the page (the game is not always served from the site root). */
function assetUrl(id: WeaponId): string {
  return new URL(`media/models/weapons/${id}/model.json`, document.baseURI).href;
}

function build(id: WeaponId, spec: AssetSpec, source: THREE.Object3D): WeaponAsset {
  const inner = new THREE.Group();
  inner.name = `${id}:model`;
  inner.add(source);
  inner.rotation.set(spec.rotation[0] * DEG, spec.rotation[1] * DEG, spec.rotation[2] * DEG, 'XYZ');
  inner.scale.setScalar(spec.scale);
  inner.position.set(spec.position[0], spec.position[1], spec.position[2]);

  const scene = new THREE.Group();
  scene.name = `weapon:${id}`;
  scene.add(inner);
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    // The models are small and always near the camera: culling them per mesh buys nothing and
    // their bounding spheres do not follow the view-model animation of sub-parts.
    mesh.frustumCulled = false;
  });
  scene.updateMatrixWorld(true);
  return {
    scene,
    muzzle: [...spec.muzzle],
    sight: [...spec.sight],
    gripLeft: [...spec.gripLeft],
    credit: spec.credit,
  };
}

/** Loads every model of the manifest once. Never rejects: a missing model simply stays null. */
export function preloadWeaponAssets(): Promise<void> {
  if (pending) return pending;
  const loader = new GLTFLoader();
  const jobs = (Object.entries(SPECS) as [WeaponId, AssetSpec][]).map(async ([id, spec]) => {
    try {
      const gltf = await loader.loadAsync(assetUrl(id));
      assets.set(id, build(id, spec, gltf.scene));
    } catch (err) {
      console.warn(`[weapons] modèle « ${id} » indisponible, repli sur le modèle procédural`, err);
    }
  });
  pending = Promise.all(jobs).then(
    () => undefined,
    () => undefined,
  );
  return pending;
}

/** The loaded asset, or null until preloadWeaponAssets() has resolved / when the model is missing. */
export function getWeaponAsset(id: WeaponId): WeaponAsset | null {
  return assets.get(id) ?? null;
}
