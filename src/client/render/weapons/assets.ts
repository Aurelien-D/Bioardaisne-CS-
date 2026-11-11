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
 * createWeaponModel() exposes them as WeaponModel.parts; the view model animates the slide,
 * the bolt, the pump and the magazine.
 *
 * Optics: the opaque lens discs of the source models are replaced at load time by glass
 * discs (see optics.ts and the `optic` entry of a spec). Each asset also carries what the
 * first-person view needs: the sight line (`sight`, `sightFront`) and `view` (aiming
 * distance, ejection port, magazine).
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
import { createLens, createLensMaterial, type LensOptions } from './optics';

type Vec3 = [number, number, number];

/** First-person presentation data of a weapon (weapon frame, metres). */
export interface WeaponViewSpec {
  /** Aiming down the sights: distance from the eye to the `sight` anchor (view space). */
  adsDist: number;
  /** Ejection port, null when nothing is ejected. */
  eject: Vec3 | null;
  /** Where the support hand takes the magazine (or feeds the rounds) during a reload. */
  mag: Vec3 | null;
}

export interface WeaponAsset {
  /** Ready-to-use model in the game's weapon frame (see above). Clone it before use. */
  scene: THREE.Group;
  /** Local positions (metres) in the weapon frame. */
  muzzle: Vec3;
  /**
   * A point on the sight line near the shooter's eye: centre of the eyepiece of an optic,
   * top of the rear notch of iron sights.
   */
  sight: Vec3;
  /** Iron sights: tip of the front sight (with `sight` it gives the sight line), else null. */
  sightFront: Vec3 | null;
  /** Where the support hand holds (fore-end; for pistols under the grip). */
  gripLeft: Vec3;
  view: WeaponViewSpec;
  credit: string;
}

/** A lens of an optic. `eye` = the lens the shooter looks through (see-through in first person). */
export type LensSpec = LensOptions & { eye?: boolean };

interface OpticSpec {
  /** Named part that carries the optic. */
  part: string;
  /**
   * Triangles to remove from that part — the opaque lens discs (and inner reticle plate) of
   * the source model — selected by the centre of their UVs (u, v, radius) and their z range.
   */
  cut?: { uv: Vec3; z: [number, number] }[];
  /** Name of a material of the part that already is the lens glass: it gets the lens shader. */
  glass?: string;
  /** Lens discs to add (weapon frame). */
  lenses?: LensSpec[];
}

interface AssetSpec {
  muzzle: Vec3;
  sight: Vec3;
  sightFront?: Vec3;
  gripLeft: Vec3;
  view: WeaponViewSpec;
  optic?: OpticSpec;
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
    view: { adsDist: 0.2, eject: null, mag: null },
    credit: '« Surgical Knife » par GulzarMrRobotics (sketchfab.com/GulzarAhmed), CC BY 4.0 — maillage simplifié',
  },
  pistol: {
    muzzle: [0, 0.0455, -0.1027],
    // Rear notch and front post, measured on the mesh (the slide is 0.3 mm off centre).
    sight: [0.0003, 0.0609, 0.058],
    sightFront: [0.0003, 0.0619, -0.09],
    gripLeft: [0, -0.045, 0.02],
    view: { adsDist: 0.23, eject: [0.013, 0.052, -0.022], mag: [0, -0.078, 0.05] },
    credit: '« 9mm Pistol » par Urpo (sketchfab.com/Urpo), CC BY 4.0',
  },
  deagle: {
    muzzle: [0, 0.0475, -0.1687],
    sight: [0, 0.0678, 0.047],
    sightFront: [0, 0.068, -0.162],
    gripLeft: [0, -0.05, 0.025],
    view: { adsDist: 0.24, eject: [0.016, 0.06, -0.035], mag: [0, -0.08, 0.045] },
    credit: '« Desert Eagle » par ELIZION (sketchfab.com/ELIZION), CC BY 4.0',
  },
  smg: {
    muzzle: [0, 0.0178, -0.3227],
    // Folding sights: the rear one is a 1 mm peep hole, unusable on a screen. The eye sits just
    // in front of it and aims with the front post between its two ears, along the top rail.
    sight: [0, 0.1012, -0.03],
    sightFront: [0, 0.1009, -0.265],
    gripLeft: [0, -0.041, -0.231],
    view: { adsDist: 0.012, eject: [0.024, 0.034, -0.075], mag: [0, -0.15, -0.118] },
    credit: '« KRSV VECTOR » par h1ggs (sketchfab.com/h1ggs), CC BY 4.0',
  },
  rifle_ak: {
    muzzle: [0, 0.0397, -0.579],
    // The receiver of this model is 2 mm off centre: both sights sit at x = 0.002. The notch of
    // the rear leaf (top at y = 0.0949) is barely modelled: the eye looks just over the leaf
    // so that the front post stands on it.
    sight: [0.002, 0.0962, -0.176],
    sightFront: [0.002, 0.091, -0.545],
    gripLeft: [0, 0.021, -0.303],
    view: { adsDist: 0.17, eject: [0.021, 0.056, -0.11], mag: [0.002, -0.105, -0.17] },
    credit: '« AKMN » par Kihan_lee (sketchfab.com/dlrlgks1013), CC BY 4.0',
  },
  rifle_m4: {
    muzzle: [0, 0.0559, -0.4628],
    // Centre of the eyepiece of the 4x combat optic (its axis is 1.7 mm left of the bore).
    sight: [-0.0017, 0.1274, 0.0428],
    gripLeft: [0, 0.025, -0.26],
    view: { adsDist: 0.078, eject: [0.019, 0.061, -0.1], mag: [0, -0.115, -0.112] },
    optic: {
      part: 'optic',
      cut: [
        { uv: [0.063, 0.679, 0.062], z: [-0.083, -0.076] }, // objective lens
        { uv: [0.171, 0.884, 0.047], z: [0.041, 0.046] }, // eyepiece lens
        { uv: [0.096, 0.939, 0.03], z: [-0.021, -0.018] }, // inner reticle plate
      ],
      lenses: [
        { center: [-0.0017, 0.1274, 0.0428], radius: 0.0125, facing: 1, eye: true, reticle: 'chevron', aperture: [0.124, 0.0312], coat: 0x58c878, tint: 0xb8e6d2 },
        { center: [-0.0017, 0.1257, -0.0806], radius: 0.0188, facing: -1, coat: 0xff5630 },
      ],
    },
    credit: '« AR-15 style rifle » par Mateusz Woliński (sketchfab.com/jeandiz), CC BY 4.0 — textures éclaircies',
  },
  shotgun: {
    muzzle: [0, 0.048, -0.6436],
    // Bead sight: the eye looks along the top of the receiver (y = 0.0629) to the bead.
    sight: [0, 0.0688, -0.045],
    sightFront: [0, 0.0652, -0.624],
    gripLeft: [0, 0, -0.37],
    view: { adsDist: 0.15, eject: [0.017, 0.047, -0.135], mag: [0, -0.012, -0.13] },
    credit: '« Remington 870 Police Magnum 12 Gauge Shotgun » par 8sianDude (sketchfab.com/haoliu95), CC BY 4.0',
  },
  sniper: {
    muzzle: [0, 0.0461, -0.9059],
    // Centre of the eyepiece of the scope.
    sight: [-0.0005, 0.0809, -0.0535],
    gripLeft: [0, 0.005, -0.24],
    view: { adsDist: 0.07, eject: [0.014, 0.054, -0.085], mag: [0, 0.062, -0.08] },
    optic: { part: 'scope', glass: 'bolt_action_rifle_7_62_accesories_glass' },
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
  if (spec.optic) buildOptic(scene, spec.optic);
  scene.updateMatrixWorld(true);
  return {
    scene,
    muzzle: [...spec.muzzle],
    sight: [...spec.sight],
    sightFront: spec.sightFront ? [...spec.sightFront] : null,
    gripLeft: [...spec.gripLeft],
    view: { adsDist: spec.view.adsDist, eject: spec.view.eject ? [...spec.view.eject] : null, mag: spec.view.mag ? [...spec.view.mag] : null },
    credit: spec.credit,
  };
}

/**
 * Lenses of an optic: the opaque discs of the source model are cut out of the mesh and replaced
 * by glass discs (lens shader, see optics.ts). The lenses are delivered opaque — dark coated
 * glass, right for a weapon seen from outside; createWeaponModel(id, 'view') turns the one
 * marked `userData.lens.eye` into a see-through sight with its reticle.
 */
function buildOptic(scene: THREE.Object3D, optic: OpticSpec): void {
  const part = scene.getObjectByName(optic.part);
  if (!part) return;
  part.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (optic.cut) cutTriangles(mesh.geometry, optic.cut);
    const mat = mesh.material as THREE.Material;
    if (optic.glass && mat.name === optic.glass) {
      mesh.material = createLensMaterial({ center: [0, 0, 0], radius: 1, coat: 0x7460e0 }, false);
      mesh.castShadow = false;
    }
  });
  for (const spec of optic.lenses ?? []) {
    const lens = createLens({ ...spec, open: false });
    lens.mesh.userData.lens = spec;
    part.add(lens.mesh);
  }
}

/** Remove the triangles selected by `cuts` from an indexed geometry (the vertices stay). */
function cutTriangles(geometry: THREE.BufferGeometry, cuts: { uv: Vec3; z: [number, number] }[]): void {
  const index = geometry.getIndex();
  const pos = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  if (!index || !pos || !uv) return;
  const keep: number[] = [];
  for (let t = 0; t + 2 < index.count; t += 3) {
    const a = index.getX(t);
    const b = index.getX(t + 1);
    const c = index.getX(t + 2);
    const u = (uv.getX(a) + uv.getX(b) + uv.getX(c)) / 3;
    const v = (uv.getY(a) + uv.getY(b) + uv.getY(c)) / 3;
    const z = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    let cut = false;
    for (const s of cuts) {
      if (z >= s.z[0] && z <= s.z[1] && Math.hypot(u - s.uv[0], v - s.uv[1]) <= s.uv[2]) {
        cut = true;
        break;
      }
    }
    if (!cut) keep.push(a, b, c);
  }
  if (keep.length !== index.count) geometry.setIndex(keep);
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
