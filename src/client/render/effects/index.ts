/** Visual effects: tracers, impacts, bullet holes, blood, flashes, objective markers. All pooled. */
import * as THREE from 'three';
import type { SurfaceType } from '../../../shared/maps/materials';
import type { Vec3 } from '../../../shared/math/vec3';
import { WEAPONS, type WeaponId } from '../../../shared/weapons/defs';
import type { IEffects, IEngine } from '../../core/contracts';
import { flashClass, MuzzleFlash } from './flash';

const MAX_TRACERS = 64;
/** Muzzle flashes of the other players visible at the same time. */
const MAX_FLASHES = 8;
const MAX_DECALS = 256;
const MAX_PARTICLES = 700;

function softDot(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 1, 32, 32, 31);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function holeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(8,8,8,0.95)');
  gr.addColorStop(0.3, 'rgba(20,18,16,0.85)');
  gr.addColorStop(0.55, 'rgba(60,55,50,0.4)');
  gr.addColorStop(1, 'rgba(90,85,80,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(15,15,15,0.5)';
  g.lineWidth = 1.5;
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9 + 0.3;
    g.beginPath();
    g.moveTo(32 + Math.cos(a) * 8, 32 + Math.sin(a) * 8);
    g.lineTo(32 + Math.cos(a + 0.2) * (16 + (i % 3) * 5), 32 + Math.sin(a + 0.2) * (16 + (i % 3) * 5));
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** One particle pool rendered as THREE.Points. */
class Particles {
  readonly points: THREE.Points;
  private pos = new Float32Array(MAX_PARTICLES * 3);
  private col = new Float32Array(MAX_PARTICLES * 4);
  private vel = new Float32Array(MAX_PARTICLES * 3);
  private life = new Float32Array(MAX_PARTICLES);
  private max = new Float32Array(MAX_PARTICLES);
  private grav = new Float32Array(MAX_PARTICLES);
  private alpha = new Float32Array(MAX_PARTICLES);
  private next = 0;
  private geo = new THREE.BufferGeometry();

  constructor(tex: THREE.Texture, additive: boolean, size: number) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    const mat = new THREE.PointsMaterial({
      size,
      map: tex,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  emit(p: Vec3, vx: number, vy: number, vz: number, r: number, g: number, b: number, a: number, life: number, gravity: number): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX_PARTICLES;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.col[i * 4] = r;
    this.col[i * 4 + 1] = g;
    this.col[i * 4 + 2] = b;
    this.alpha[i] = a;
    this.life[i] = this.max[i] = life;
    this.grav[i] = gravity;
  }

  update(dt: number): void {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i]! <= 0) {
        this.col[i * 4 + 3] = 0;
        continue;
      }
      this.life[i]! -= dt;
      this.vel[i * 3 + 1]! -= this.grav[i]! * dt;
      const d = Math.exp(-dt * 2.5);
      this.vel[i * 3]! *= d;
      this.vel[i * 3 + 2]! *= d;
      this.pos[i * 3]! += this.vel[i * 3]! * dt;
      this.pos[i * 3 + 1]! += this.vel[i * 3 + 1]! * dt;
      this.pos[i * 3 + 2]! += this.vel[i * 3 + 2]! * dt;
      this.col[i * 4 + 3] = Math.max(0, this.life[i]! / this.max[i]!) * this.alpha[i]!;
    }
    this.geo.attributes.position!.needsUpdate = true;
    this.geo.attributes.color!.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
  }

  dispose(): void {
    this.geo.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

const SURF_COLOR: Record<string, [number, number, number]> = {
  concrete: [0.72, 0.71, 0.68],
  plaster: [0.9, 0.9, 0.88],
  tile: [0.9, 0.92, 0.93],
  lino: [0.7, 0.72, 0.73],
  carpet: [0.3, 0.4, 0.55],
  wood: [0.62, 0.47, 0.3],
  metal: [1, 0.85, 0.5],
  glass: [0.85, 0.95, 1],
  plastic: [0.85, 0.85, 0.85],
  fabric: [0.5, 0.52, 0.56],
  cardboard: [0.66, 0.52, 0.34],
  dirt: [0.4, 0.33, 0.25],
  grass: [0.33, 0.45, 0.22],
  gravel: [0.65, 0.63, 0.58],
  water: [0.75, 0.88, 0.95],
  foliage: [0.3, 0.5, 0.22],
};

class Effects implements IEffects {
  private root = new THREE.Group();
  private tracers: THREE.InstancedMesh;
  private tA = new Float32Array(MAX_TRACERS * 3);
  private tB = new Float32Array(MAX_TRACERS * 3);
  private tLife = new Float32Array(MAX_TRACERS);
  private tMax = new Float32Array(MAX_TRACERS);
  private tW = new Float32Array(MAX_TRACERS);
  private tNext = 0;
  private decals: THREE.InstancedMesh;
  private dLife = new Float32Array(MAX_DECALS);
  private dNext = 0;
  private dust: Particles;
  private sparks: Particles;
  private markers: { group: THREE.Group; ring: THREE.Mesh }[] = [];
  private time = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private col = new THREE.Color();
  private dot: THREE.Texture;
  private flashes: MuzzleFlash[] = [];
  private fNext = 0;
  private fLive = false;

  constructor(private engine: IEngine) {
    this.root.name = 'bas-effects';
    engine.scene.add(this.root);
    this.dot = softDot();
    const tg = new THREE.BoxGeometry(1, 1, 1);
    this.tracers = new THREE.InstancedMesh(tg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), MAX_TRACERS);
    this.tracers.frustumCulled = false;
    this.tracers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.m4.makeScale(0, 0, 0);
    for (let i = 0; i < MAX_TRACERS; i++) {
      this.tracers.setMatrixAt(i, this.m4);
      this.tracers.setColorAt(i, this.col.setRGB(0, 0, 0));
    }
    this.tracers.renderOrder = 6;
    const dg = new THREE.PlaneGeometry(1, 1);
    this.decals = new THREE.InstancedMesh(
      dg,
      new THREE.MeshBasicMaterial({ map: holeTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
      MAX_DECALS,
    );
    this.decals.frustumCulled = false;
    for (let i = 0; i < MAX_DECALS; i++) this.decals.setMatrixAt(i, this.m4);
    this.decals.renderOrder = 2;
    this.dust = new Particles(this.dot, false, 0.16);
    this.sparks = new Particles(this.dot, true, 0.09);
    this.root.add(this.decals, this.tracers, this.dust.points, this.sparks.points);
    // Same flash sprites as the first-person weapon (textures and geometry are shared).
    for (let i = 0; i < MAX_FLASHES; i++) {
      const f = new MuzzleFlash(false);
      this.flashes.push(f);
      this.root.add(f.group);
    }
  }

  tracer(from: Vec3, to: Vec3, weapon: WeaponId): void {
    const def = WEAPONS[weapon];
    if (def.kind === 'melee') return;
    const i = this.tNext;
    this.tNext = (this.tNext + 1) % MAX_TRACERS;
    this.tA[i * 3] = from.x;
    this.tA[i * 3 + 1] = from.y;
    this.tA[i * 3 + 2] = from.z;
    this.tB[i * 3] = to.x;
    this.tB[i * 3 + 1] = to.y;
    this.tB[i * 3 + 2] = to.z;
    const heavy = def.category === 'sniper' || def.category === 'rifle';
    this.tLife[i] = this.tMax[i] = def.pellets > 1 ? 0.06 : heavy ? 0.11 : 0.08;
    this.tW[i] = def.pellets > 1 ? 0.008 : def.category === 'sniper' ? 0.022 : 0.013;
  }

  impact(point: Vec3, normal: Vec3, surf: SurfaceType): void {
    const c = SURF_COLOR[surf] ?? SURF_COLOR.concrete!;
    const metal = surf === 'metal';
    const n = metal ? 7 : 6;
    for (let k = 0; k < n; k++) {
      const s = metal ? 3.5 : 1.3;
      const vx = normal.x * s + (Math.random() - 0.5) * s * 1.2;
      const vy = normal.y * s + (Math.random() - 0.3) * s * 1.2;
      const vz = normal.z * s + (Math.random() - 0.5) * s * 1.2;
      if (metal || surf === 'glass') this.sparks.emit(point, vx, vy, vz, c[0], c[1], c[2], 1, 0.18 + Math.random() * 0.2, 9);
      else this.dust.emit(point, vx, vy, vz, c[0], c[1], c[2], 0.6, 0.35 + Math.random() * 0.35, 2.5);
    }
    if (surf === 'water') return;
    // Bullet hole.
    const i = this.dNext;
    this.dNext = (this.dNext + 1) % MAX_DECALS;
    this.v1.set(normal.x, normal.y, normal.z);
    this.q.setFromUnitVectors(this.v2.set(0, 0, 1), this.v1);
    this.q.multiply(new THREE.Quaternion().setFromAxisAngle(this.v2.set(0, 0, 1), Math.random() * Math.PI * 2));
    const size = surf === 'glass' ? 0.16 : 0.07 + Math.random() * 0.03;
    this.m4.compose(this.v3.set(point.x + normal.x * 0.004, point.y + normal.y * 0.004, point.z + normal.z * 0.004), this.q, this.v2.set(size, size, size));
    this.decals.setMatrixAt(i, this.m4);
    this.decals.instanceMatrix.needsUpdate = true;
    this.dLife[i] = 30;
  }

  blood(point: Vec3, dir: Vec3): void {
    for (let k = 0; k < 7; k++) {
      this.dust.emit(point, dir.x * 1.5 + (Math.random() - 0.5) * 1.6, dir.y + Math.random() * 1.2, dir.z * 1.5 + (Math.random() - 0.5) * 1.6, 0.62, 0.04, 0.05, 0.85, 0.3 + Math.random() * 0.25, 6);
    }
  }

  muzzleFlash(pos: Vec3, dir: Vec3, weapon: WeaponId): void {
    const def = WEAPONS[weapon];
    if (def.kind === 'melee') return;
    // Textured flash at the muzzle, along the barrel.
    const f = this.flashes[this.fNext]!;
    this.fNext = (this.fNext + 1) % MAX_FLASHES;
    f.group.position.set(pos.x, pos.y, pos.z);
    this.v1.set(dir.x, dir.y, dir.z);
    if (this.v1.lengthSq() < 1e-8) this.v1.set(0, 0, -1);
    f.group.quaternion.setFromUnitVectors(this.v2.set(0, 0, -1), this.v1.normalize());
    f.fire(flashClass(def.category), 1.2);
    this.fLive = true;
    // A few hot sparks and a puff of grey smoke drifting up.
    for (let k = 0; k < 2; k++) {
      const s = 2.5 + k * 2.5;
      this.sparks.emit(pos, dir.x * s + (Math.random() - 0.5), dir.y * s + (Math.random() - 0.5), dir.z * s + (Math.random() - 0.5), 1, 0.8, 0.45, 1, 0.06 + Math.random() * 0.05, 0);
    }
    const heavy = def.category === 'shotgun' || def.category === 'sniper';
    const g = 0.5 + Math.random() * 0.12;
    this.dust.emit(pos, dir.x * 1.6, dir.y * 1.6 + 0.3, dir.z * 1.6, g, g, g * 1.03, heavy ? 0.3 : 0.16, 0.45 + Math.random() * 0.3, -0.5);
  }

  explosion(pos: Vec3): void {
    for (let k = 0; k < 60; k++) {
      const a = Math.random() * Math.PI * 2;
      const u = Math.random();
      const s = 3 + Math.random() * 7;
      this.sparks.emit(pos, Math.cos(a) * s * (1 - u * 0.5), 2 + u * 7, Math.sin(a) * s * (1 - u * 0.5), 1, 0.75, 0.35, 1, 0.4 + Math.random() * 0.5, 6);
    }
    // Flying audit paperwork.
    for (let k = 0; k < 90; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 5;
      this.dust.emit(pos, Math.cos(a) * s, 3 + Math.random() * 6, Math.sin(a) * s, 0.97, 0.97, 0.93, 1, 2 + Math.random() * 2.5, 2.2);
    }
  }

  marker(kind: 'bomb' | 'sample' | 'site' | 'extract', pos: Vec3, color: number): { set(pos: Vec3): void; remove(): void } {
    const group = new THREE.Group();
    const ringG = new THREE.RingGeometry(0.45, 0.6, 28);
    ringG.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringG, mat);
    ring.position.y = 0.04;
    const h = kind === 'site' || kind === 'extract' ? 5 : 3;
    const colG = new THREE.CylinderGeometry(0.12, 0.3, h, 12, 1, true);
    const col = new THREE.Mesh(colG, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    col.position.y = h / 2;
    group.add(ring, col);
    group.position.set(pos.x, pos.y, pos.z);
    this.root.add(group);
    const entry = { group, ring };
    this.markers.push(entry);
    return {
      set: (p) => group.position.set(p.x, p.y, p.z),
      remove: () => {
        this.root.remove(group);
        ringG.dispose();
        colG.dispose();
        const i = this.markers.indexOf(entry);
        if (i >= 0) this.markers.splice(i, 1);
      },
    };
  }

  update(dt: number): void {
    this.time += dt;
    const cam = this.engine.camera.position;
    let dirty = false;
    for (let i = 0; i < MAX_TRACERS; i++) {
      if (this.tLife[i]! <= 0) continue;
      dirty = true;
      this.tLife[i]! -= dt;
      if (this.tLife[i]! <= 0) {
        this.m4.makeScale(0, 0, 0);
        this.tracers.setMatrixAt(i, this.m4);
        continue;
      }
      // A streak travelling from A to B.
      const k = 1 - this.tLife[i]! / this.tMax[i]!;
      const ax = this.tA[i * 3]!;
      const ay = this.tA[i * 3 + 1]!;
      const az = this.tA[i * 3 + 2]!;
      const dx = this.tB[i * 3]! - ax;
      const dy = this.tB[i * 3 + 1]! - ay;
      const dz = this.tB[i * 3 + 2]! - az;
      const len = Math.hypot(dx, dy, dz) || 1;
      const head = Math.min(1, k * 1.6 + 0.25);
      const tail = Math.max(0, head - Math.min(0.6, 12 / len));
      const mx = ax + dx * (head + tail) * 0.5;
      const my = ay + dy * (head + tail) * 0.5;
      const mz = az + dz * (head + tail) * 0.5;
      const dist = Math.hypot(mx - cam.x, my - cam.y, mz - cam.z);
      const w = this.tW[i]! * (1 + dist * 0.035);
      this.q.setFromUnitVectors(this.v2.set(0, 0, 1), this.v1.set(dx / len, dy / len, dz / len));
      this.m4.compose(this.v3.set(mx, my, mz), this.q, this.v2.set(w, w, len * (head - tail)));
      this.tracers.setMatrixAt(i, this.m4);
      const f = 1 - k * 0.7;
      this.tracers.setColorAt(i, this.col.setRGB(1 * f, 0.86 * f, 0.55 * f));
    }
    if (dirty) {
      this.tracers.instanceMatrix.needsUpdate = true;
      if (this.tracers.instanceColor) this.tracers.instanceColor.needsUpdate = true;
    }
    let dd = false;
    for (let i = 0; i < MAX_DECALS; i++) {
      if (this.dLife[i]! <= 0) continue;
      this.dLife[i]! -= dt;
      if (this.dLife[i]! <= 0) {
        this.m4.makeScale(0, 0, 0);
        this.decals.setMatrixAt(i, this.m4);
        dd = true;
      }
    }
    if (dd) this.decals.instanceMatrix.needsUpdate = true;
    this.dust.update(dt);
    this.sparks.update(dt);
    if (this.fLive) {
      // Keep going until every flash has ended, whatever the frame rate.
      let alive = false;
      for (let i = 0; i < MAX_FLASHES; i++) alive = this.flashes[i]!.update(dt) || alive;
      this.fLive = alive;
    }
    for (const m of this.markers) {
      const s = 1 + Math.sin(this.time * 4) * 0.18;
      m.ring.scale.set(s, 1, s);
    }
  }

  clear(): void {
    this.m4.makeScale(0, 0, 0);
    for (let i = 0; i < MAX_TRACERS; i++) this.tracers.setMatrixAt(i, this.m4);
    for (let i = 0; i < MAX_DECALS; i++) this.decals.setMatrixAt(i, this.m4);
    this.tLife.fill(0);
    this.dLife.fill(0);
    this.tracers.instanceMatrix.needsUpdate = true;
    this.decals.instanceMatrix.needsUpdate = true;
    this.dust.clear();
    this.sparks.clear();
    for (const f of this.flashes) {
      f.update(1);
      f.update(1);
    }
    this.fLive = false;
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const f of this.flashes) f.dispose();
    this.dust.dispose();
    this.sparks.dispose();
    this.tracers.geometry.dispose();
    this.decals.geometry.dispose();
    this.dot.dispose();
  }
}

export function createEffects(engine: IEngine): IEffects {
  return new Effects(engine);
}
