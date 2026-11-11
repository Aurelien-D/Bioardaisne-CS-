/**
 * Procedural weapon models (original designs, realistic proportions and materials).
 * The weapon points down -Z, the pistol grip sits near the origin, units are metres.
 * Static parts are merged per material; movable parts (slide, bolt, magazine, pump)
 * are separate groups so the view model can animate them.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WeaponId } from '../../../shared/weapons/defs';
import { getWeaponAsset, type LensSpec, type WeaponViewSpec } from './assets';
import { createHoloSight, createLens, createLensMask, lensHandle, type HoloSight, type Lens } from './optics';

export interface WeaponModel {
  root: THREE.Group;
  /** Empty object at the barrel tip. */
  muzzle: THREE.Object3D;
  /**
   * Point of the sight line near the shooter's eye (aim-down-sights alignment): centre of the
   * eyepiece / window of an optic, top of the rear notch of iron sights.
   */
  sight: THREE.Object3D;
  /** Iron sights: tip of the front sight. The line sight → sightFront is the line of aim. */
  sightFront: THREE.Object3D | null;
  /** Movable pieces (slide / bolt / magazine / pump), each at its rest position. */
  parts: Record<string, THREE.Object3D>;
  /** Hand anchors. */
  gripRight: THREE.Object3D;
  gripLeft: THREE.Object3D;
  /** First-person presentation data (aiming distance, ejection port, magazine). */
  view: WeaponViewSpec;
  /**
   * 'view' models own their materials (the view model follows the light around the player);
   * 'world' models share those of the asset and leave this list empty.
   */
  materials: THREE.MeshStandardMaterial[];
  /** Lens glass of the optics (the view model drives their light level). */
  lenses: Lens[];
  /** Built from a loaded 3D asset (false: procedural fallback). */
  detailed: boolean;
  dispose(): void;
}

type Mat = 'gunmetal' | 'steel' | 'polymer' | 'polymerDark' | 'wood' | 'woodDark' | 'rubber' | 'blue' | 'bakelite' | 'brass' | 'tan';

const MATS: Record<Mat, THREE.MeshStandardMaterial> = {
  gunmetal: new THREE.MeshStandardMaterial({ color: 0x2c2f34, metalness: 0.75, roughness: 0.5 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 1, roughness: 0.28 }),
  polymer: new THREE.MeshStandardMaterial({ color: 0x26282b, metalness: 0.05, roughness: 0.72 }),
  polymerDark: new THREE.MeshStandardMaterial({ color: 0x1c1d1f, metalness: 0.05, roughness: 0.85 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x7a4a26, metalness: 0, roughness: 0.55 }),
  woodDark: new THREE.MeshStandardMaterial({ color: 0x4a2c16, metalness: 0, roughness: 0.6 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x0c0c0d, metalness: 0, roughness: 0.95 }),
  blue: new THREE.MeshStandardMaterial({ color: 0x2f6fb5, metalness: 0.1, roughness: 0.5 }),
  bakelite: new THREE.MeshStandardMaterial({ color: 0x8a3d14, metalness: 0.1, roughness: 0.4 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xc9a23a, metalness: 1, roughness: 0.3 }),
  tan: new THREE.MeshStandardMaterial({ color: 0x8c7a5c, metalness: 0.05, roughness: 0.75 }),
};

/** Named parts of the 3D assets (see assets.ts) that the view model animates. */
const PART_NAMES = ['slide', 'magazine', 'bolt', 'pump'];

/** First-person data of the procedural models. */
const PROC_VIEW: Record<WeaponId, WeaponViewSpec> = {
  knife: { adsDist: 0.2, eject: null, mag: null },
  pistol: { adsDist: 0.23, eject: [0.016, 0.05, -0.04], mag: [0, -0.1, 0.055] },
  deagle: { adsDist: 0.24, eject: [0.02, 0.055, -0.04], mag: [0, -0.11, 0.06] },
  smg: { adsDist: 0.11, eject: [0.028, 0.05, -0.1], mag: [0, -0.13, -0.13] },
  rifle_ak: { adsDist: 0.17, eject: [0.026, 0.045, -0.13], mag: [0, -0.15, -0.16] },
  rifle_m4: { adsDist: 0.11, eject: [0.024, 0.05, -0.1], mag: [0, -0.15, -0.135] },
  shotgun: { adsDist: 0.15, eject: [0.022, 0.035, -0.08], mag: [0, 0, -0.12] },
  sniper: { adsDist: 0.07, eject: [0.03, 0.055, -0.03], mag: [0, 0.07, -0.1] },
};

class Builder {
  root = new THREE.Group();
  private lists = new Map<THREE.Object3D, Map<Mat, THREE.BufferGeometry[]>>();
  private cur: THREE.Object3D = this.root;
  private m4 = new THREE.Matrix4();
  private e = new THREE.Euler();
  private q = new THREE.Quaternion();
  private made: THREE.BufferGeometry[] = [];
  parts: Record<string, THREE.Object3D> = {};

  private push(g: THREE.BufferGeometry, x: number, y: number, z: number, mat: Mat, rx = 0, ry = 0, rz = 0): void {
    this.q.setFromEuler(this.e.set(rx, ry, rz));
    g.applyMatrix4(this.m4.compose(new THREE.Vector3(x, y, z), this.q, new THREE.Vector3(1, 1, 1)));
    let byMat = this.lists.get(this.cur);
    if (!byMat) this.lists.set(this.cur, (byMat = new Map()));
    const list = byMat.get(mat) ?? [];
    list.push(g.index ? g.toNonIndexed() : g);
    byMat.set(mat, list);
  }
  box(w: number, h: number, d: number, x: number, y: number, z: number, mat: Mat, rx = 0, ry = 0, rz = 0): void {
    this.push(new THREE.BoxGeometry(w, h, d), x, y, z, mat, rx, ry, rz);
  }
  /** Cylinder along Z. */
  tube(r: number, len: number, x: number, y: number, z: number, mat: Mat, seg = 12, r2 = r): void {
    const g = new THREE.CylinderGeometry(r2, r, len, seg);
    g.rotateX(Math.PI / 2);
    this.push(g, x, y, z, mat);
  }
  /** Cylinder along X (drums, knobs). */
  drum(r: number, len: number, x: number, y: number, z: number, mat: Mat, seg = 14): void {
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    g.rotateZ(Math.PI / 2);
    this.push(g, x, y, z, mat);
  }
  /** Picatinny rail along Z from z0 to z1 (z1 < z0), top at y. */
  rail(y: number, z0: number, z1: number, mat: Mat = 'gunmetal', x = 0, width = 0.021): void {
    const len = z0 - z1;
    this.box(width * 0.75, 0.006, len, x, y - 0.006, (z0 + z1) / 2, mat);
    const n = Math.floor(len / 0.01);
    for (let i = 0; i < n; i += 1) this.box(width, 0.005, 0.0052, x, y - 0.0015, z0 - 0.005 - i * 0.01, mat);
  }
  lenses: Lens[] = [];
  private holos: HoloSight[] = [];
  /**
   * Holographic sight sitting on a rail whose top is at height y, centred on z; its glass
   * carries the ring-and-dot reticle (first person only). Returns the centre of the window.
   */
  holo(y: number, z: number, reticle: boolean): [number, number, number] {
    const h = createHoloSight(reticle);
    h.group.position.set(0, y, z);
    this.root.add(h.group);
    this.holos.push(h);
    this.lenses.push(h.lens);
    return [h.window[0], y + h.window[1], z + h.window[2]];
  }
  disposeExtras(): void {
    for (const h of this.holos) h.dispose();
  }
  group(name: string, x = 0, y = 0, z = 0): void {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    this.root.add(g);
    this.parts[name] = g;
    this.cur = g;
  }
  end(): void {
    this.cur = this.root;
  }
  anchor(x: number, y: number, z: number): THREE.Object3D {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    this.root.add(o);
    return o;
  }
  finish(): THREE.BufferGeometry[] {
    for (const [parent, byMat] of this.lists) {
      for (const [mat, list] of byMat) {
        const merged = mergeGeometries(list, false);
        for (const g of list) g.dispose();
        if (!merged) continue;
        this.made.push(merged);
        parent.add(new THREE.Mesh(merged, MATS[mat]));
      }
    }
    return this.made;
  }
}

/** Pistol grip leaning back, trigger guard and trigger. */
function gripAndTrigger(b: Builder, mat: Mat, h = 0.1, z = 0.03): void {
  b.box(0.03, h, 0.042, 0, -h / 2 + 0.002, z + 0.012, mat, 0.3);
  b.box(0.012, 0.004, 0.06, 0, -0.038, z - 0.045, 'gunmetal');
  b.box(0.012, 0.03, 0.004, 0, -0.024, z - 0.075, 'gunmetal');
  b.box(0.006, 0.022, 0.006, 0, -0.018, z - 0.04, 'steel', -0.35);
}

export function createWeaponModel(id: WeaponId, lod: 'view' | 'world' = 'view'): WeaponModel {
  // A real 3D model when one is loaded (see assets.ts); the procedural model otherwise.
  const asset = getWeaponAsset(id);
  if (asset) {
    const root = new THREE.Group();
    const scene = asset.scene.clone(true);
    root.add(scene);
    const anchor = (p: [number, number, number]): THREE.Object3D => {
      const o = new THREE.Object3D();
      o.position.set(p[0], p[1], p[2]);
      root.add(o);
      return o;
    };
    const parts: Record<string, THREE.Object3D> = {};
    for (const name of PART_NAMES) {
      const part = scene.getObjectByName(name);
      if (part) parts[name] = part;
    }
    const materials: THREE.MeshStandardMaterial[] = [];
    const lenses: Lens[] = [];
    const owned: { dispose(): void }[] = [];
    if (lod === 'view') {
      // Own material instances (textures stay shared): the view model follows the local light.
      const copies = new Map<THREE.Material, THREE.Material>();
      const eyeLenses: THREE.Mesh[] = [];
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || Array.isArray(mesh.material)) return;
        if (mesh.userData.lens && (mesh.userData.lens as LensSpec).eye) {
          eyeLenses.push(mesh);
          return;
        }
        let copy = copies.get(mesh.material);
        if (!copy) {
          copy = mesh.material.clone();
          copies.set(mesh.material, copy);
          owned.push(copy);
          if ((copy as THREE.MeshStandardMaterial).isMeshStandardMaterial) materials.push(copy as THREE.MeshStandardMaterial);
          else if ((copy as THREE.ShaderMaterial).isShaderMaterial) lenses.push(lensHandle(mesh, copy as THREE.ShaderMaterial));
        }
        mesh.material = copy;
      });
      // The lens the shooter looks through becomes a see-through sight with its reticle.
      for (const mesh of eyeLenses) {
        const spec = mesh.userData.lens as LensSpec;
        const parent = mesh.parent ?? scene;
        parent.remove(mesh);
        const lens = createLens({ ...spec, open: true });
        parent.add(lens.mesh);
        if (spec.aperture) parent.add(createLensMask(lens.mesh));
        lenses.push(lens);
        owned.push(lens.mesh.geometry, lens.material);
      }
    }
    return {
      root,
      muzzle: anchor(asset.muzzle),
      sight: anchor(asset.sight),
      sightFront: asset.sightFront ? anchor(asset.sightFront) : null,
      parts,
      gripRight: anchor([0, -0.05, 0.03]),
      gripLeft: anchor(asset.gripLeft),
      view: asset.view,
      materials,
      lenses,
      detailed: true,
      dispose: () => {
        // Geometry and textures belong to the shared asset; only the view copies are ours.
        for (const o of owned) o.dispose();
      },
    };
  }
  const b = new Builder();
  const view = lod === 'view';
  let muzzle: [number, number, number] = [0, 0.05, -0.2];
  let sight: [number, number, number] = [0, 0.08, 0];
  let front: [number, number, number] | null = null;
  let left: [number, number, number] = [0, -0.02, -0.12];

  switch (id) {
    case 'knife': {
      // Bistouri: oversized scalpel — steel blade, knurled handle.
      b.box(0.014, 0.022, 0.13, 0, 0, 0.03, 'steel');
      for (let i = 0; i < 9; i++) b.box(0.016, 0.024, 0.005, 0, 0, -0.02 + i * 0.012, 'gunmetal');
      b.box(0.008, 0.016, 0.05, 0, 0.002, -0.06, 'steel');
      b.box(0.003, 0.04, 0.13, 0, 0.006, -0.14, 'steel', -0.1);
      b.box(0.0025, 0.028, 0.06, 0, -0.006, -0.215, 'steel', -0.42);
      muzzle = [0, 0, -0.24];
      sight = [0, 0.05, 0];
      break;
    }
    case 'pistol': {
      // Pipette P9: striker-fired polymer pistol.
      b.box(0.028, 0.022, 0.165, 0, 0.022, -0.05, 'polymer');
      b.box(0.02, 0.012, 0.05, 0, 0.008, -0.11, 'polymer');
      gripAndTrigger(b, 'polymer', 0.105, 0.025);
      b.rail(0.011, -0.085, -0.13, 'polymer', 0, 0.018);
      b.group('slide', 0, 0.047, -0.052);
      b.box(0.027, 0.028, 0.178, 0, 0, 0, 'gunmetal');
      for (let i = 0; i < 6; i++) b.box(0.0285, 0.022, 0.003, 0, -0.001, 0.045 + i * 0.007, 'polymerDark');
      b.box(0.006, 0.006, 0.006, 0, 0.017, -0.08, 'steel');
      b.box(0.005, 0.007, 0.006, -0.008, 0.0165, 0.08, 'polymerDark');
      b.box(0.005, 0.007, 0.006, 0.008, 0.0165, 0.08, 'polymerDark');
      b.box(0.0275, 0.012, 0.03, 0.001, 0.004, -0.01, 'steel');
      b.end();
      b.tube(0.0065, 0.02, 0, 0.049, -0.148, 'steel');
      b.group('magazine', 0, -0.058, 0.04);
      b.box(0.022, 0.1, 0.03, 0, 0, 0, 'gunmetal', 0.3);
      b.box(0.026, 0.008, 0.036, 0, -0.05, 0.016, 'polymerDark', 0.3);
      b.end();
      muzzle = [0, 0.049, -0.16];
      sight = [0, 0.067, 0.028];
      front = [0, 0.067, -0.132];
      left = [0, -0.05, 0.03];
      break;
    }
    case 'deagle': {
      // Lancette .50: heavy gas-operated steel pistol.
      b.box(0.034, 0.03, 0.2, 0, 0.022, -0.07, 'steel');
      gripAndTrigger(b, 'rubber', 0.12, 0.03);
      b.group('slide', 0, 0.052, -0.03);
      b.box(0.036, 0.03, 0.15, 0, 0, 0, 'steel');
      for (let i = 0; i < 7; i++) b.box(0.0375, 0.024, 0.003, 0, 0, 0.03 + i * 0.007, 'gunmetal');
      b.box(0.005, 0.007, 0.006, -0.01, 0.018, 0.068, 'gunmetal');
      b.box(0.005, 0.007, 0.006, 0.01, 0.018, 0.068, 'gunmetal');
      b.end();
      b.box(0.03, 0.03, 0.115, 0, 0.052, -0.165, 'steel');
      b.box(0.024, 0.012, 0.11, 0, 0.073, -0.165, 'steel', 0, 0, Math.PI / 4);
      b.box(0.006, 0.008, 0.008, 0, 0.082, -0.215, 'gunmetal');
      b.tube(0.008, 0.012, 0, 0.052, -0.226, 'gunmetal');
      b.group('magazine', 0, -0.065, 0.045);
      b.box(0.024, 0.11, 0.034, 0, 0, 0, 'gunmetal', 0.3);
      b.end();
      muzzle = [0, 0.052, -0.235];
      sight = [0, 0.0735, 0.038];
      front = [0, 0.086, -0.215];
      left = [0, -0.055, 0.03];
      break;
    }
    case 'smg': {
      // Centri-9: compact 9 mm submachine gun.
      b.tube(0.024, 0.3, 0, 0.045, -0.09, 'gunmetal', 14);
      b.box(0.04, 0.05, 0.2, 0, 0.012, -0.07, 'polymer');
      gripAndTrigger(b, 'polymer', 0.095, 0.03);
      b.tube(0.027, 0.17, 0, 0.04, -0.31, 'polymer', 10);
      for (let i = 0; i < 4; i++) b.box(0.057, 0.008, 0.02, 0, 0.04, -0.25 - i * 0.035, 'polymerDark');
      b.tube(0.0085, 0.1, 0, 0.045, -0.43, 'gunmetal');
      b.tube(0.012, 0.03, 0, 0.045, -0.475, 'gunmetal', 10);
      b.rail(0.076, 0.03, -0.2);
      sight = b.holo(0.076, -0.07, view);
      b.box(0.012, 0.03, 0.012, 0, 0.08, -0.38, 'gunmetal');
      b.box(0.022, 0.028, 0.2, 0, 0.04, 0.16, 'gunmetal');
      b.box(0.03, 0.09, 0.03, 0, 0.02, 0.27, 'rubber');
      b.group('magazine', 0, -0.06, -0.12);
      b.box(0.02, 0.1, 0.032, 0, 0, 0, 'gunmetal', -0.12);
      b.box(0.02, 0.09, 0.032, 0, -0.085, -0.02, 'gunmetal', -0.3);
      b.end();
      b.group('bolt', 0.026, 0.05, -0.1);
      b.box(0.012, 0.01, 0.03, 0, 0, 0, 'steel');
      b.end();
      muzzle = [0, 0.045, -0.49];
      left = [0, 0.0, -0.3];
      break;
    }
    case 'rifle_ak': {
      // AK-Tube 47: stamped steel receiver, wooden furniture, curved magazine.
      b.box(0.038, 0.05, 0.27, 0, 0.022, -0.09, 'gunmetal');
      b.tube(0.02, 0.26, 0, 0.05, -0.09, 'gunmetal', 10); // dust cover
      gripAndTrigger(b, 'wood', 0.1, 0.035);
      b.box(0.042, 0.04, 0.2, 0, 0.022, -0.335, 'wood'); // lower hand guard
      b.tube(0.019, 0.17, 0, 0.058, -0.32, 'woodDark', 10); // upper hand guard
      b.tube(0.0095, 0.36, 0, 0.038, -0.6, 'gunmetal');
      b.tube(0.007, 0.16, 0, 0.062, -0.5, 'gunmetal'); // gas tube
      b.box(0.02, 0.03, 0.03, 0, 0.05, -0.59, 'gunmetal'); // gas block
      b.box(0.01, 0.05, 0.016, 0, 0.066, -0.74, 'gunmetal'); // front sight tower
      b.box(0.024, 0.012, 0.012, 0, 0.094, -0.74, 'gunmetal');
      b.tube(0.012, 0.045, 0, 0.038, -0.8, 'gunmetal', 10, 0.0095); // slant brake
      b.box(0.02, 0.012, 0.06, 0, 0.078, -0.21, 'gunmetal'); // rear sight leaf
      b.box(0.022, 0.012, 0.008, 0, 0.088, -0.235, 'gunmetal');
      b.box(0.034, 0.06, 0.26, 0, 0.012, 0.19, 'wood', -0.1); // stock
      b.box(0.036, 0.085, 0.02, 0, 0.0, 0.325, 'gunmetal', -0.1);
      b.group('magazine', 0, -0.045, -0.13);
      for (let i = 0; i < 5; i++) b.box(0.024, 0.048, 0.062, 0, -i * 0.04, -i * i * 0.0065, 'bakelite', -i * 0.12);
      b.end();
      b.group('bolt', 0.024, 0.045, -0.13);
      b.box(0.014, 0.012, 0.024, 0, 0, 0, 'steel');
      b.tube(0.005, 0.02, 0.012, 0, 0.002, 'steel');
      b.end();
      muzzle = [0, 0.038, -0.83];
      sight = [0, 0.0945, -0.235];
      front = [0, 0.1, -0.74];
      left = [0, 0.0, -0.33];
      break;
    }
    case 'rifle_m4': {
      // M4 Sérum: modern carbine with a free-float hand guard and a holographic sight.
      b.box(0.04, 0.045, 0.2, 0, 0.05, -0.08, 'gunmetal'); // upper receiver
      b.box(0.038, 0.05, 0.16, 0, 0.008, -0.055, 'gunmetal'); // lower receiver
      b.box(0.036, 0.06, 0.06, 0, -0.012, -0.13, 'gunmetal'); // magazine well
      b.box(0.004, 0.02, 0.07, 0.021, 0.05, -0.1, 'polymerDark'); // ejection port
      b.tube(0.007, 0.02, 0.024, 0.045, 0.0, 'gunmetal', 8); // forward assist
      b.box(0.03, 0.006, 0.02, 0, 0.076, 0.03, 'gunmetal'); // charging handle
      gripAndTrigger(b, 'polymer', 0.105, 0.035);
      b.tube(0.0265, 0.31, 0, 0.05, -0.335, 'gunmetal', 8); // hand guard
      for (let i = 0; i < 6; i++) {
        b.box(0.056, 0.01, 0.03, 0, 0.05, -0.215 - i * 0.045, 'polymerDark');
        b.box(0.01, 0.056, 0.03, 0, 0.05, -0.215 - i * 0.045, 'polymerDark');
      }
      b.rail(0.082, 0.01, -0.49);
      b.tube(0.0085, 0.2, 0, 0.05, -0.58, 'gunmetal');
      b.box(0.02, 0.026, 0.03, 0, 0.056, -0.52, 'gunmetal'); // gas block
      b.tube(0.011, 0.045, 0, 0.05, -0.7, 'gunmetal', 10); // flash hider
      b.tube(0.012, 0.006, 0, 0.05, -0.676, 'steel', 10);
      sight = b.holo(0.082, -0.075, view);
      b.box(0.014, 0.022, 0.012, 0, 0.093, -0.455, 'gunmetal'); // folded front sight
      b.box(0.02, 0.012, 0.03, 0, 0.088, -0.005, 'gunmetal'); // folded rear sight
      b.tube(0.014, 0.19, 0, 0.045, 0.115, 'gunmetal', 10); // buffer tube
      b.box(0.036, 0.062, 0.15, 0, 0.03, 0.17, 'polymer'); // stock
      b.box(0.036, 0.1, 0.03, 0, 0.012, 0.25, 'polymer');
      b.box(0.038, 0.105, 0.01, 0, 0.012, 0.268, 'rubber');
      b.box(0.012, 0.012, 0.03, -0.022, 0.05, 0.12, 'blue'); // lab-blue marker band
      b.group('magazine', 0, -0.07, -0.125);
      b.box(0.023, 0.11, 0.058, 0, 0, 0, 'polymer', -0.08);
      b.box(0.023, 0.07, 0.058, 0, -0.085, -0.014, 'polymer', -0.26);
      b.box(0.026, 0.01, 0.062, 0, -0.122, -0.026, 'polymerDark', -0.26);
      b.end();
      b.group('bolt', 0.0215, 0.05, -0.1);
      b.box(0.004, 0.016, 0.06, 0, 0, 0, 'steel');
      b.end();
      muzzle = [0, 0.05, -0.73];
      left = [0, 0.005, -0.33];
      break;
    }
    case 'shotgun': {
      // Agitateur 12: pump-action shotgun.
      b.box(0.04, 0.055, 0.24, 0, 0.03, -0.06, 'gunmetal');
      gripAndTrigger(b, 'polymer', 0.02, 0.05);
      b.tube(0.012, 0.52, 0, 0.048, -0.44, 'gunmetal');
      b.tube(0.012, 0.4, 0, 0.02, -0.38, 'gunmetal');
      b.box(0.02, 0.012, 0.012, 0, 0.034, -0.56, 'gunmetal');
      b.tube(0.003, 0.008, 0, 0.064, -0.69, 'brass', 8);
      b.box(0.036, 0.07, 0.3, 0, -0.005, 0.2, 'woodDark', -0.14);
      b.box(0.038, 0.11, 0.02, 0, -0.025, 0.35, 'rubber', -0.14);
      b.group('pump', 0, 0.02, -0.36);
      b.tube(0.024, 0.15, 0, 0, 0, 'woodDark', 10);
      for (let i = 0; i < 6; i++) b.tube(0.0255, 0.006, 0, 0, -0.055 + i * 0.022, 'wood', 10);
      b.end();
      muzzle = [0, 0.048, -0.7];
      sight = [0, 0.0665, -0.03];
      front = [0, 0.0672, -0.69];
      left = [0, 0.0, -0.36];
      break;
    }
    case 'sniper': {
      // Le Microscope: bolt-action precision rifle with a large scope.
      b.box(0.042, 0.05, 0.36, 0, 0.03, -0.08, 'tan');
      b.tube(0.019, 0.3, 0, 0.055, -0.1, 'gunmetal', 12);
      gripAndTrigger(b, 'tan', 0.1, 0.04);
      b.box(0.046, 0.04, 0.26, 0, 0.022, -0.38, 'tan');
      b.tube(0.011, 0.56, 0, 0.055, -0.6, 'gunmetal');
      b.tube(0.017, 0.07, 0, 0.055, -0.9, 'gunmetal', 10);
      b.box(0.04, 0.07, 0.3, 0, 0.012, 0.22, 'tan', -0.06);
      b.box(0.034, 0.03, 0.12, 0, 0.066, 0.2, 'polymer');
      b.box(0.042, 0.11, 0.02, 0, 0.0, 0.375, 'rubber');
      // Scope
      b.tube(0.016, 0.2, 0, 0.115, -0.09, 'gunmetal', 14);
      b.tube(0.027, 0.09, 0, 0.115, -0.23, 'gunmetal', 16, 0.018);
      b.tube(0.022, 0.07, 0, 0.115, 0.045, 'gunmetal', 16, 0.016);
      b.drum(0.012, 0.05, 0, 0.115, -0.09, 'gunmetal', 10);
      b.tube(0.011, 0.02, 0, 0.14, -0.09, 'gunmetal', 10);
      b.box(0.014, 0.04, 0.02, 0, 0.085, -0.02, 'gunmetal');
      b.box(0.014, 0.04, 0.02, 0, 0.085, -0.16, 'gunmetal');
      b.box(0.004, 0.06, 0.008, 0.02, 0.0, -0.44, 'gunmetal', 0, 0, -0.3);
      b.box(0.004, 0.06, 0.008, -0.02, 0.0, -0.44, 'gunmetal', 0, 0, 0.3);
      b.group('bolt', 0.03, 0.055, 0.03);
      b.tube(0.006, 0.05, 0, 0, 0, 'steel', 8);
      b.box(0.03, 0.008, 0.008, 0.012, -0.008, 0.02, 'steel', 0, 0, -0.6);
      b.tube(0.009, 0.016, 0.026, -0.018, 0.02, 'polymerDark', 10);
      b.end();
      b.group('magazine', 0, -0.02, -0.11);
      b.box(0.03, 0.05, 0.08, 0, 0, 0, 'gunmetal');
      b.end();
      muzzle = [0, 0.055, -0.94];
      sight = [0, 0.115, 0.1];
      left = [0, 0.0, -0.36];
      break;
    }
  }
  const made = b.finish();
  return {
    root: b.root,
    muzzle: b.anchor(...muzzle),
    sight: b.anchor(...sight),
    sightFront: front ? b.anchor(...front) : null,
    parts: b.parts,
    gripRight: b.anchor(0, -0.05, 0.03),
    gripLeft: b.anchor(...left),
    view: PROC_VIEW[id],
    materials: [],
    lenses: b.lenses,
    detailed: false,
    dispose: () => {
      for (const g of made) g.dispose();
      b.disposeExtras();
    },
  };
}
