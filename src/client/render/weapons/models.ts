/**
 * Procedural weapon models (original designs, realistic proportions and materials).
 * The weapon points down -Z, the pistol grip sits near the origin, units are metres.
 * Static parts are merged per material; movable parts (slide, bolt, magazine, pump)
 * are separate groups so the view model can animate them.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WeaponId } from '../../../shared/weapons/defs';

export interface WeaponModel {
  root: THREE.Group;
  /** Empty object at the barrel tip. */
  muzzle: THREE.Object3D;
  /** Point of the sight line near the shooter's eye (aim-down-sights alignment). */
  sight: THREE.Object3D;
  /** Movable pieces (slide / bolt / magazine / pump). */
  parts: Record<string, THREE.Object3D>;
  /** Hand anchors. */
  gripRight: THREE.Object3D;
  gripLeft: THREE.Object3D;
  dispose(): void;
}

type Mat = 'gunmetal' | 'steel' | 'polymer' | 'polymerDark' | 'wood' | 'woodDark' | 'rubber' | 'blue' | 'bakelite' | 'glass' | 'brass' | 'tan';

const MATS: Record<Mat, THREE.MeshStandardMaterial> = {
  gunmetal: new THREE.MeshStandardMaterial({ color: 0x41454b, metalness: 0.8, roughness: 0.42 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 1, roughness: 0.28 }),
  polymer: new THREE.MeshStandardMaterial({ color: 0x34373b, metalness: 0.05, roughness: 0.68 }),
  polymerDark: new THREE.MeshStandardMaterial({ color: 0x1c1d1f, metalness: 0.05, roughness: 0.85 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x7a4a26, metalness: 0, roughness: 0.55 }),
  woodDark: new THREE.MeshStandardMaterial({ color: 0x4a2c16, metalness: 0, roughness: 0.6 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x0c0c0d, metalness: 0, roughness: 0.95 }),
  blue: new THREE.MeshStandardMaterial({ color: 0x2f6fb5, metalness: 0.1, roughness: 0.5 }),
  bakelite: new THREE.MeshStandardMaterial({ color: 0x8a3d14, metalness: 0.1, roughness: 0.4 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x9fc4d8, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.22 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xc9a23a, metalness: 1, roughness: 0.3 }),
  tan: new THREE.MeshStandardMaterial({ color: 0x8c7a5c, metalness: 0.05, roughness: 0.75 }),
};

let reticleTex: THREE.Texture | null = null;
function reticleTexture(): THREE.Texture {
  if (reticleTex) return reticleTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(255,40,30,0.95)';
  g.fillStyle = 'rgba(255,40,30,1)';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(64, 64, 34, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(64, 64, 5, 0, Math.PI * 2);
  g.fill();
  for (const [x, y] of [[64, 18], [64, 110], [18, 64], [110, 64]] as const) g.fillRect(x - 2.5, y - 8, 5, 16);
  reticleTex = new THREE.CanvasTexture(c);
  reticleTex.colorSpace = THREE.SRGBColorSpace;
  return reticleTex;
}

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
  /** Holographic sight sitting on a rail at height y, centred on z. Returns the reticle mesh. */
  holo(y: number, z: number): THREE.Mesh {
    this.box(0.034, 0.014, 0.07, 0, y + 0.007, z, 'polymer');
    this.box(0.004, 0.04, 0.05, -0.02, y + 0.034, z - 0.006, 'gunmetal');
    this.box(0.004, 0.04, 0.05, 0.02, y + 0.034, z - 0.006, 'gunmetal');
    this.box(0.044, 0.004, 0.05, 0, y + 0.056, z - 0.006, 'gunmetal');
    this.box(0.034, 0.02, 0.016, 0, y + 0.02, z + 0.028, 'polymer');
    this.box(0.036, 0.036, 0.0015, 0, y + 0.036, z - 0.025, 'glass');
    const ret = new THREE.Mesh(
      new THREE.PlaneGeometry(0.02, 0.02),
      new THREE.MeshBasicMaterial({ map: reticleTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    ret.position.set(0, y + 0.036, z - 0.024);
    ret.renderOrder = 5;
    this.root.add(ret);
    this.made.push(ret.geometry);
    return ret;
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

export function createWeaponModel(id: WeaponId, _lod: 'view' | 'world' = 'view'): WeaponModel {
  const b = new Builder();
  let muzzle: [number, number, number] = [0, 0.05, -0.2];
  let sight: [number, number, number] = [0, 0.08, 0];
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
      sight = [0, 0.0665, 0.03];
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
      sight = [0, 0.0745, 0.035];
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
      b.holo(0.076, -0.06);
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
      sight = [0, 0.112, 0.0];
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
      sight = [0, 0.1, -0.2];
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
      b.holo(0.082, -0.07);
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
      sight = [0, 0.118, 0.0];
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
      sight = [0, 0.068, 0.02];
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
    parts: b.parts,
    gripRight: b.anchor(0, -0.05, 0.03),
    gripLeft: b.anchor(...left),
    dispose: () => {
      for (const g of made) g.dispose();
    },
  };
}
