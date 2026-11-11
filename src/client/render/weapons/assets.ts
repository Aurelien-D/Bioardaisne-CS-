/**
 * Realistic weapon models (freely licensed, see public/media/credits-weapons.md).
 *
 * Every model lives in public/media/models/weapons/<weaponId>/model.json: a glTF 2.0 file
 * whose geometry is embedded (base64) and whose textures are .jpg / .png files next to it
 * (only .json / .jpg / .png / .webp are served where the game is published).
 *
 * Each model is delivered in the WEAPON FRAME:
 *   - metres, real-world size;
 *   - barrel toward -Z, top toward +Y, right-hand side of the weapon toward +X;
 *   - origin at the pistol grip, where the firing hand holds: the junction of the trigger guard
 *     and the front of the grip. The bore axis sits 4 to 6 cm above the origin (2 cm on the
 *     sub-machine gun, whose barrel is in line with the hand), the trigger just in front of it.
 *
 * The geometry is already baked in that frame in the files (this is done once, offline, when a
 * model is converted), so the loader only wraps the glTF scene in a group and, if a model ever
 * needs it, applies the optional `adjust` placement of its manifest entry.
 *
 * Movable parts are separate objects with an identity transform, named as below; move them
 * directly in metres along the weapon axes, e.g. scene.getObjectByName('slide')!.position.z = 0.03.
 *   knife     body, blade
 *   pistol    body, slide, magazine, trigger
 *   deagle    body, slide, magazine, trigger, hammer
 *   smg       body, magazine, trigger
 *   rifle_ak  body, magazine
 *   rifle_m4  body, magazine, bolt, trigger, optic
 *   shotgun   body, pump (fore-end and action bars), bolt, trigger
 *   sniper    body, bolt, trigger, scope
 * A part with several materials is a THREE.Group of meshes, the others are a THREE.Mesh.
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
  muzzle: Vec3;
  sight: Vec3;
  gripLeft: Vec3;
  credit: string;
  /**
   * Optional correction of the placement baked in the file:
   * weapon = position + Rotation(XYZ Euler, degrees) * (scale * model). Leave it out normally.
   */
  adjust?: { rotation?: Vec3; scale?: number; position?: Vec3 };
}

/**
 * Anchors (weapon frame, metres) and credits. Sources and licences are listed in
 * public/media/credits-weapons.md; the anchors were measured on the review page.
 */
const SPECS: Partial<Record<WeaponId, AssetSpec>> = {
  knife: {
    // Scalpel, enlarged to 24 cm so that it reads in first person (a real one is about 16 cm).
    // "muzzle" is the tip of the blade; there is no sight line and no support hand.
    muzzle: [0, -0.002, -0.135],
    sight: [0, 0.03, 0],
    gripLeft: [0, 0, 0.09],
    credit: '« Surgical Knife » par GulzarMrRobotics (sketchfab.com/GulzarAhmed), CC BY 4.0 — maillage simplifié',
  },
  pistol: {
    muzzle: [0, 0.0455, -0.1027],
    sight: [0, 0.06, 0.06],
    gripLeft: [0, -0.045, 0.02],
    credit: '« 9mm Pistol » par Urpo (sketchfab.com/Urpo), CC BY 4.0',
  },
  deagle: {
    muzzle: [0, 0.0475, -0.1687],
    sight: [0, 0.066, 0.046],
    gripLeft: [0, -0.05, 0.025],
    credit: '« Desert Eagle » par ELIZION (sketchfab.com/ELIZION), CC BY 4.0',
  },
  smg: {
    muzzle: [0, 0.0178, -0.3227],
    sight: [0, 0.096, 0.005],
    gripLeft: [0, -0.041, -0.231],
    credit: '« KRSV VECTOR » par h1ggs (sketchfab.com/h1ggs), CC BY 4.0',
  },
  rifle_ak: {
    muzzle: [0, 0.0397, -0.579],
    sight: [0, 0.09, -0.178],
    gripLeft: [0, 0.021, -0.303],
    credit: '« AKMN » par Kihan_lee (sketchfab.com/dlrlgks1013), CC BY 4.0',
  },
  rifle_m4: {
    muzzle: [0, 0.0559, -0.4628],
    sight: [0, 0.125, 0.044],
    gripLeft: [0, 0.025, -0.26],
    credit: '« AR-15 style rifle » par Mateusz Woliński (sketchfab.com/jeandiz), CC BY 4.0 — textures éclaircies',
  },
  shotgun: {
    muzzle: [0, 0.048, -0.6436],
    sight: [0, 0.063, -0.05],
    gripLeft: [0, 0, -0.37],
    credit: '« Remington 870 Police Magnum 12 Gauge Shotgun » par 8sianDude (sketchfab.com/haoliu95), CC BY 4.0',
  },
  sniper: {
    muzzle: [0, 0.0461, -0.9059],
    sight: [0, 0.0825, -0.045],
    gripLeft: [0, 0.005, -0.24],
    credit: '« Bolt Action Rifle 7.62 » par Mateusz Sadek (polyhaven.com), CC0',
  },
};

const DEG = Math.PI / 180;
const assets = new Map<WeaponId, WeaponAsset>();
let pending: Promise<void> | null = null;

/** URL of a weapon model, relative to the page (the game is not always served from the site root). */
function assetUrl(id: WeaponId): string {
  return new URL(`media/models/weapons/${id}/model.json`, document.baseURI).href;
}

function build(id: WeaponId, spec: AssetSpec, source: THREE.Object3D): WeaponAsset {
  // The glTF scene (its children are the named parts) is wrapped in the delivered group.
  source.name = `${id}:model`;
  const adjust = spec.adjust;
  if (adjust?.rotation) source.rotation.set(adjust.rotation[0] * DEG, adjust.rotation[1] * DEG, adjust.rotation[2] * DEG, 'XYZ');
  if (adjust?.scale !== undefined) source.scale.setScalar(adjust.scale);
  if (adjust?.position) source.position.set(adjust.position[0], adjust.position[1], adjust.position[2]);

  const scene = new THREE.Group();
  scene.name = `weapon:${id}`;
  scene.add(source);
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
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
