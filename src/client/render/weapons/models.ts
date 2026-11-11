/**
 * Procedural weapon models (original designs built from primitives).
 * The weapon points down -Z, the pistol grip sits near the origin, units are metres.
 */
import * as THREE from 'three';
import type { WeaponId } from '../../../shared/weapons/defs';

export interface WeaponModel {
  root: THREE.Group;
  /** Empty object at the barrel tip. */
  muzzle: THREE.Object3D;
  /** Movable pieces (slide / bolt / magazine / pump). */
  parts: Record<string, THREE.Object3D>;
  /** Hand anchors. */
  gripRight: THREE.Object3D;
  gripLeft: THREE.Object3D;
  dispose(): void;
}

const mats = new Map<number, THREE.MeshStandardMaterial>();
function mat(color: number, metal = 0.2, rough = 0.6): THREE.MeshStandardMaterial {
  const key = color * 100 + Math.round(metal * 9) * 10 + Math.round(rough * 9);
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough });
    mats.set(key, m);
  }
  return m;
}

const C = {
  steel: 0x8f969c,
  dark: 0x444a52,
  black: 0x2b2f35,
  wood: 0x8a5a33,
  white: 0xe9ecee,
  blue: 0x3182ce,
  red: 0xe7343f,
  brass: 0xc9a23a,
  purple: 0x8a4fb5,
  green: 0x3fa35b,
};

class Builder {
  root = new THREE.Group();
  cur: THREE.Object3D = this.root;
  geos: THREE.BufferGeometry[] = [];
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: number, metal = 0.2, rough = 0.6): THREE.Mesh {
    const g = new THREE.BoxGeometry(w, h, d);
    this.geos.push(g);
    const m = new THREE.Mesh(g, mat(color, metal, rough));
    m.position.set(x, y, z);
    this.cur.add(m);
    return m;
  }
  /** Cylinder along Z. */
  tube(r: number, len: number, x: number, y: number, z: number, color: number, metal = 0.6, rough = 0.4, seg = 10): THREE.Mesh {
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    g.rotateX(Math.PI / 2);
    this.geos.push(g);
    const m = new THREE.Mesh(g, mat(color, metal, rough));
    m.position.set(x, y, z);
    this.cur.add(m);
    return m;
  }
  group(name: string, parts: Record<string, THREE.Object3D>, x = 0, y = 0, z = 0): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    this.root.add(g);
    parts[name] = g;
    return g;
  }
  anchor(x: number, y: number, z: number): THREE.Object3D {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    this.root.add(o);
    return o;
  }
}

export function createWeaponModel(id: WeaponId, _lod: 'view' | 'world' = 'view'): WeaponModel {
  const b = new Builder();
  const parts: Record<string, THREE.Object3D> = {};
  let muzzleZ = -0.2;
  let muzzleY = 0.05;
  let left: [number, number, number] = [0, -0.02, -0.12];

  const grip = (h = 0.11, color = C.dark): void => {
    const g = b.box(0.032, h, 0.045, 0, -h / 2 - 0.005, 0.02, color, 0.1, 0.8);
    g.rotation.x = 0.22;
  };

  switch (id) {
    case 'knife': {
      // Bistouri: big scalpel, steel blade, blue polymer handle.
      b.box(0.022, 0.03, 0.13, 0, 0, 0.03, C.blue, 0.1, 0.5);
      b.box(0.012, 0.018, 0.05, 0, 0, -0.06, C.steel, 0.8, 0.3);
      const blade = b.box(0.004, 0.045, 0.14, 0, 0.004, -0.15, 0xdfe4e8, 0.9, 0.2);
      blade.rotation.x = -0.08;
      muzzleZ = -0.22;
      muzzleY = 0;
      break;
    }
    case 'pistol': {
      // Pipette P9: compact polymer pistol, ribbed slide.
      b.box(0.03, 0.035, 0.17, 0, 0.03, -0.055, C.dark, 0.3, 0.6);
      grip(0.11, C.black);
      b.cur = b.group('slide', parts, 0, 0.062, -0.055);
      b.box(0.032, 0.03, 0.175, 0, 0, 0, C.white, 0.5, 0.35);
      for (let i = 0; i < 4; i++) b.box(0.034, 0.024, 0.006, 0, 0, 0.05 + i * 0.012, C.blue, 0.3, 0.5);
      b.cur = b.root;
      b.tube(0.007, 0.03, 0, 0.062, -0.155, C.steel);
      b.cur = b.group('magazine', parts, 0, -0.06, 0.03);
      b.box(0.024, 0.1, 0.034, 0, 0, 0, C.black, 0.2, 0.7);
      b.cur = b.root;
      muzzleZ = -0.17;
      muzzleY = 0.062;
      left = [0, -0.05, 0.03];
      break;
    }
    case 'deagle': {
      // Lancette .50: big heavy steel pistol.
      b.box(0.036, 0.04, 0.2, 0, 0.03, -0.07, C.steel, 0.8, 0.3);
      grip(0.125, C.black);
      b.cur = b.group('slide', parts, 0, 0.068, -0.05);
      b.box(0.038, 0.036, 0.19, 0, 0, 0, 0xb5bbc1, 0.9, 0.25);
      b.cur = b.root;
      b.box(0.03, 0.03, 0.09, 0, 0.066, -0.19, C.steel, 0.9, 0.25);
      b.box(0.008, 0.012, 0.012, 0, 0.09, -0.22, C.red, 0.2, 0.5);
      b.cur = b.group('magazine', parts, 0, -0.065, 0.03);
      b.box(0.026, 0.11, 0.036, 0, 0, 0, C.dark, 0.5, 0.5);
      b.cur = b.root;
      muzzleZ = -0.24;
      muzzleY = 0.066;
      left = [0, -0.055, 0.03];
      break;
    }
    case 'smg': {
      // Centri-9: compact SMG with a rotor drum.
      b.box(0.045, 0.07, 0.3, 0, 0.035, -0.1, C.dark, 0.4, 0.5);
      grip(0.1);
      b.tube(0.012, 0.16, 0, 0.045, -0.32, C.black, 0.7, 0.4);
      b.tube(0.02, 0.07, 0, 0.045, -0.39, C.steel, 0.7, 0.35);
      const drum = b.tube(0.045, 0.05, 0, -0.03, -0.12, C.white, 0.4, 0.4, 14);
      drum.rotation.y = Math.PI / 2;
      b.box(0.006, 0.006, 0.09, 0.03, -0.03, -0.12, C.blue);
      b.box(0.02, 0.03, 0.2, 0, 0.03, 0.16, C.black, 0.3, 0.7); // stock
      b.box(0.03, 0.02, 0.05, 0, 0.085, -0.05, C.black); // sight
      b.cur = b.group('magazine', parts, 0, -0.08, -0.03);
      b.box(0.022, 0.14, 0.03, 0, 0, 0, C.black, 0.3, 0.6);
      b.cur = b.root;
      b.cur = b.group('bolt', parts, 0.027, 0.05, -0.08);
      b.box(0.01, 0.012, 0.03, 0, 0, 0, C.steel, 0.8, 0.3);
      b.cur = b.root;
      muzzleZ = -0.43;
      muzzleY = 0.045;
      left = [0, -0.01, -0.24];
      break;
    }
    case 'rifle_ak': {
      // AK-Tube 47: wood and steel, curved "tube rack" magazine with coloured caps.
      b.box(0.045, 0.065, 0.36, 0, 0.035, -0.1, C.dark, 0.6, 0.45);
      grip(0.1, C.wood);
      b.box(0.04, 0.045, 0.22, 0, 0.03, -0.38, C.wood, 0.05, 0.7); // hand guard
      b.tube(0.011, 0.36, 0, 0.045, -0.62, C.black, 0.8, 0.35);
      b.tube(0.008, 0.2, 0, 0.072, -0.42, C.black, 0.8, 0.35); // gas tube
      b.box(0.012, 0.035, 0.012, 0, 0.075, -0.74, C.black); // front sight
      const stock = b.box(0.035, 0.07, 0.26, 0, 0.01, 0.2, C.wood, 0.05, 0.7);
      stock.rotation.x = -0.1;
      b.cur = b.group('magazine', parts, 0, -0.07, -0.13);
      for (let i = 0; i < 4; i++) {
        const seg = b.box(0.026, 0.045, 0.05, 0, -i * 0.04, -i * i * 0.006, 0xc85a1c, 0.3, 0.5);
        seg.rotation.x = -i * 0.13;
        const cap = b.box(0.03, 0.008, 0.052, 0, -i * 0.04 + 0.022, -i * i * 0.006, [C.purple, C.red, C.green, C.blue][i]!, 0.1, 0.5);
        cap.rotation.x = -i * 0.13;
      }
      b.cur = b.root;
      b.cur = b.group('bolt', parts, 0.027, 0.05, -0.12);
      b.box(0.014, 0.012, 0.03, 0, 0, 0, C.steel, 0.8, 0.3);
      b.cur = b.root;
      muzzleZ = -0.8;
      muzzleY = 0.045;
      left = [0, -0.01, -0.38];
      break;
    }
    case 'rifle_m4': {
      // M4 Sérum: modern modular rifle, white / blue polymer furniture.
      b.box(0.045, 0.07, 0.3, 0, 0.035, -0.08, C.dark, 0.5, 0.45);
      grip(0.1, C.black);
      b.box(0.048, 0.05, 0.26, 0, 0.04, -0.36, C.white, 0.2, 0.5); // hand guard
      b.box(0.05, 0.012, 0.2, 0, 0.012, -0.36, C.blue, 0.2, 0.5);
      b.tube(0.01, 0.22, 0, 0.045, -0.6, C.black, 0.8, 0.35);
      b.tube(0.016, 0.05, 0, 0.045, -0.71, C.black, 0.7, 0.4);
      b.box(0.02, 0.03, 0.14, 0, 0.1, -0.1, C.black); // carry handle / optic
      b.box(0.012, 0.025, 0.012, 0, 0.085, -0.03, C.black);
      b.box(0.012, 0.025, 0.012, 0, 0.085, -0.17, C.black);
      b.tube(0.014, 0.2, 0, 0.04, 0.17, C.black, 0.4, 0.5); // buffer tube
      b.box(0.035, 0.085, 0.1, 0, 0.02, 0.24, C.white, 0.2, 0.5); // stock
      b.cur = b.group('magazine', parts, 0, -0.085, -0.1);
      const mg = b.box(0.024, 0.15, 0.05, 0, 0, 0, C.blue, 0.2, 0.5);
      mg.rotation.x = -0.12;
      b.cur = b.root;
      b.cur = b.group('bolt', parts, 0.027, 0.05, -0.08);
      b.box(0.012, 0.012, 0.03, 0, 0, 0, C.steel, 0.8, 0.3);
      b.cur = b.root;
      muzzleZ = -0.74;
      muzzleY = 0.045;
      left = [0, -0.01, -0.36];
      break;
    }
    case 'shotgun': {
      // Agitateur 12: pump-action, ribbed fore-end.
      b.box(0.045, 0.06, 0.3, 0, 0.03, -0.05, C.dark, 0.6, 0.45);
      grip(0.1, C.black);
      b.tube(0.014, 0.5, 0, 0.05, -0.45, C.black, 0.8, 0.35);
      b.tube(0.013, 0.42, 0, 0.018, -0.4, C.steel, 0.7, 0.4); // magazine tube
      const stock = b.box(0.035, 0.075, 0.26, 0, 0.005, 0.23, C.black, 0.2, 0.7);
      stock.rotation.x = -0.1;
      b.cur = b.group('pump', parts, 0, 0.018, -0.36);
      b.box(0.045, 0.045, 0.14, 0, 0, 0, C.blue, 0.15, 0.6);
      for (let i = 0; i < 5; i++) b.box(0.048, 0.048, 0.008, 0, 0, -0.05 + i * 0.025, C.white, 0.15, 0.6);
      b.cur = b.root;
      muzzleZ = -0.7;
      muzzleY = 0.05;
      left = [0, -0.01, -0.36];
      break;
    }
    case 'sniper': {
      // Le Microscope: long bolt-action rifle, scope shaped like a microscope tube.
      b.box(0.045, 0.06, 0.4, 0, 0.03, -0.08, C.white, 0.3, 0.45);
      grip(0.1, C.black);
      b.tube(0.012, 0.6, 0, 0.045, -0.56, C.black, 0.8, 0.3);
      b.tube(0.02, 0.07, 0, 0.045, -0.88, C.steel, 0.7, 0.35);
      const stock = b.box(0.04, 0.09, 0.3, 0, 0.0, 0.25, C.white, 0.2, 0.5);
      stock.rotation.x = -0.08;
      b.box(0.03, 0.02, 0.1, 0, 0.065, 0.24, C.blue); // cheek rest
      // Scope
      b.tube(0.022, 0.26, 0, 0.115, -0.1, C.black, 0.6, 0.35, 12);
      b.tube(0.032, 0.07, 0, 0.115, -0.26, C.black, 0.6, 0.35, 12);
      b.tube(0.028, 0.05, 0, 0.115, 0.05, C.steel, 0.8, 0.3, 12);
      const ring = b.tube(0.03, 0.03, 0, 0.115, -0.1, C.blue, 0.3, 0.5, 14); // knurled focus ring
      ring.scale.set(1, 1, 1);
      b.box(0.012, 0.035, 0.02, 0, 0.08, -0.03, C.black);
      b.box(0.012, 0.035, 0.02, 0, 0.08, -0.17, C.black);
      b.cur = b.group('bolt', parts, 0.03, 0.055, 0.02);
      b.box(0.012, 0.012, 0.05, 0, 0, 0, C.steel, 0.8, 0.3);
      b.tube(0.009, 0.03, 0.02, -0.01, 0.0, C.black);
      b.cur = b.root;
      b.cur = b.group('magazine', parts, 0, -0.03, -0.1);
      b.box(0.03, 0.05, 0.08, 0, 0, 0, C.black, 0.3, 0.6);
      b.cur = b.root;
      // Bipod stubs
      b.box(0.008, 0.06, 0.008, 0.02, -0.01, -0.4, C.black);
      b.box(0.008, 0.06, 0.008, -0.02, -0.01, -0.4, C.black);
      muzzleZ = -0.92;
      muzzleY = 0.045;
      left = [0, -0.01, -0.34];
      break;
    }
  }
  const muzzle = b.anchor(0, muzzleY, muzzleZ);
  const gripRight = b.anchor(0, -0.05, 0.02);
  const gripLeft = b.anchor(left[0], left[1], left[2]);
  return {
    root: b.root,
    muzzle,
    parts,
    gripRight,
    gripLeft,
    dispose: () => {
      for (const g of b.geos) g.dispose();
    },
  };
}
