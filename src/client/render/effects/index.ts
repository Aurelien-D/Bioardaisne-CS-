/**
 * Visual effects: tracers, bullet impacts (particles + decals per surface), hits on players,
 * third-person muzzle flashes, objective markers.
 *
 * Everything is pooled and nothing is allocated while playing: tracers and decals are
 * instanced meshes used as ring buffers, particles live in three fixed pools drawn as
 * points (soft dust that swells and fades, hard chips that fall, additive sparks).
 *
 * What a bullet does to a wall depends on the wall (see STYLES): plaster and concrete
 * blow a puff of dust and leave a chipped crater, metal throws sparks and keeps a bright
 * dent (and now and then sends the bullet whining away), glass stars and sheds glittering
 * shards, wood splinters along its grain, tiles chip and crack, fabric and carpet only
 * show a small frayed hole. Decals and dust take the light of the place they are in.
 */
import * as THREE from 'three';
import type { SurfaceType } from '../../../shared/maps/materials';
import type { Vec3 } from '../../../shared/math/vec3';
import { WEAPONS, type WeaponId } from '../../../shared/weapons/defs';
import type { IEffects, IEngine } from '../../core/contracts';
import { flashClass, MuzzleFlash } from './flash';

const MAX_TRACERS = 64;
/** Muzzle flashes of the other players visible at the same time. */
const MAX_FLASHES = 8;
/** Bullet holes kept in the world; the oldest is reused when the pool is full. */
const MAX_DECALS = 256;
/** Seconds a bullet hole stays, the last DECAL_FADE of them fading out. */
const DECAL_LIFE = 45;
const DECAL_FADE = 5;
const MAX_DUST = 256;
const MAX_CHIPS = 384;
const MAX_SPARKS = 320;

// --- Textures -----------------------------------------------------------------------

/** Small deterministic generator: the textures are the same on every run. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dotTexture(hard: boolean): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 1, 32, 32, 31);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  if (hard) {
    gr.addColorStop(0.55, 'rgba(255,255,255,0.95)');
    gr.addColorStop(0.8, 'rgba(255,255,255,0.25)');
  } else {
    gr.addColorStop(0.35, 'rgba(255,255,255,0.6)');
    gr.addColorStop(0.7, 'rgba(255,255,255,0.18)');
  }
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// Decal atlas: 4 × 4 cells, each a bullet mark drawn around the centre of its cell.
const ATLAS_CELLS = 4;
const CELL = 128;

type Painter = (g: CanvasRenderingContext2D, rnd: () => number) => void;

/** Closed, slightly irregular outline around the origin. */
function blobPath(g: CanvasRenderingContext2D, rnd: () => number, radius: number, rough: number, points = 12, squash = 1): void {
  g.beginPath();
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2 + (rnd() - 0.5) * 0.3;
    const r = radius * (1 - rough * 0.5 + rnd() * rough);
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r * squash;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
}

/** A crack running outwards from `r0` to `r1`, jagged, thinning out. */
function crack(g: CanvasRenderingContext2D, rnd: () => number, angle: number, r0: number, r1: number, width: number): void {
  const steps = 3 + Math.floor(rnd() * 2);
  let a = angle;
  let x = Math.cos(a) * r0;
  let y = Math.sin(a) * r0;
  for (let i = 0; i < steps; i++) {
    const r = r0 + ((r1 - r0) * (i + 1)) / steps;
    a += (rnd() - 0.5) * 0.28;
    const nx = Math.cos(a) * r;
    const ny = Math.sin(a) * r;
    g.lineWidth = width * (1 - (i / steps) * 0.7);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(nx, ny);
    g.stroke();
    x = nx;
    y = ny;
  }
}

function radial(g: CanvasRenderingContext2D, x: number, y: number, r: number, stops: [number, string][]): void {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

/** The hole itself: near-black, a little off-round, with a darker lower lip for depth. */
function hole(g: CanvasRenderingContext2D, rnd: () => number, r: number): void {
  g.fillStyle = 'rgba(6,6,6,0.96)';
  blobPath(g, rnd, r, 0.3, 9);
  g.fill();
  radial(g, 0, 0, r * 1.7, [
    [0, 'rgba(0,0,0,0.55)'],
    [0.6, 'rgba(0,0,0,0.3)'],
    [1, 'rgba(0,0,0,0)'],
  ]);
}

/** Plaster, concrete, stone: a chipped crater showing the paler material underneath. */
const paintChip: Painter = (g, rnd) => {
  radial(g, 0, 0, 40, [
    [0, 'rgba(60,56,50,0.4)'],
    [0.55, 'rgba(70,66,60,0.16)'],
    [1, 'rgba(80,76,70,0)'],
  ]);
  const r = 17 + rnd() * 8;
  // Shadowed lower edge of the crater, then the exposed material.
  g.save();
  g.translate(1.5, 2);
  g.fillStyle = 'rgba(20,18,16,0.5)';
  blobPath(g, prng(Math.floor(rnd() * 1e6)), r, 0.5, 11);
  g.fill();
  g.restore();
  const gr = g.createRadialGradient(-2, -2, 2, 0, 0, r);
  gr.addColorStop(0, 'rgba(150,144,134,0.95)');
  gr.addColorStop(0.6, 'rgba(196,190,180,0.9)');
  gr.addColorStop(1, 'rgba(214,208,198,0.75)');
  g.fillStyle = gr;
  blobPath(g, rnd, r, 0.5, 11);
  g.fill();
  g.strokeStyle = 'rgba(30,28,25,0.45)';
  const n = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) crack(g, rnd, rnd() * Math.PI * 2, r * 0.8, r + 10 + rnd() * 18, 1.3);
  g.fillStyle = 'rgba(40,36,32,0.4)';
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2;
    const d = r + 4 + rnd() * 18;
    g.beginPath();
    g.arc(Math.cos(a) * d, Math.sin(a) * d, 0.7 + rnd() * 1.3, 0, Math.PI * 2);
    g.fill();
  }
  hole(g, rnd, 6 + rnd() * 2);
};

/** Sheet metal: a punched dent ringed with bare, bright steel and a scorched halo. */
const paintMetal: Painter = (g, rnd) => {
  radial(g, 0, 0, 34, [
    [0, 'rgba(14,12,10,0.7)'],
    [0.5, 'rgba(20,18,16,0.35)'],
    [1, 'rgba(24,22,20,0)'],
  ]);
  g.strokeStyle = 'rgba(226,230,236,0.55)';
  const n = 6 + Math.floor(rnd() * 5);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    g.lineWidth = 0.8 + rnd() * 0.8;
    g.beginPath();
    g.moveTo(Math.cos(a) * 11, Math.sin(a) * 11);
    const r = 16 + rnd() * 16;
    g.lineTo(Math.cos(a + 0.05) * r, Math.sin(a + 0.05) * r);
    g.stroke();
  }
  // Bare metal lip.
  const lip = g.createLinearGradient(-13, -13, 13, 13);
  lip.addColorStop(0, 'rgba(250,252,255,0.98)');
  lip.addColorStop(0.5, 'rgba(176,182,190,0.95)');
  lip.addColorStop(1, 'rgba(92,96,104,0.95)');
  g.fillStyle = lip;
  blobPath(g, rnd, 12.5, 0.22, 14);
  g.fill();
  hole(g, rnd, 6.5 + rnd() * 1.5);
  // Glint on the upper edge of the lip.
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 1.4;
  g.beginPath();
  g.arc(0, 0, 10.5, Math.PI * 1.05, Math.PI * 1.55);
  g.stroke();
};

/** Glass: a small crushed hole, a star of long cracks and a ring or two between them. */
const paintGlass: Painter = (g, rnd) => {
  radial(g, 0, 0, 34, [
    [0, 'rgba(255,255,255,0.3)'],
    [0.6, 'rgba(255,255,255,0.08)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  const n = 9 + Math.floor(rnd() * 5);
  const angles: number[] = [];
  for (let i = 0; i < n; i++) angles.push(((i + (rnd() - 0.5) * 0.7) / n) * Math.PI * 2);
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(248,252,255,0.92)';
  for (const a of angles) {
    const r1 = 30 + rnd() * 30;
    crack(g, rnd, a, 5, r1, 1.5);
    if (rnd() < 0.45) crack(g, rnd, a + (rnd() < 0.5 ? -0.4 : 0.4), r1 * 0.45, r1 * 0.85, 1);
  }
  // Rings: short chords between neighbouring cracks.
  g.strokeStyle = 'rgba(240,248,255,0.7)';
  g.lineWidth = 1;
  for (const ring of [15 + rnd() * 5, 30 + rnd() * 8]) {
    for (let i = 0; i < n; i++) {
      if (rnd() < 0.3) continue;
      const a0 = angles[i]!;
      const a1 = angles[(i + 1) % n]! + (i === n - 1 ? Math.PI * 2 : 0);
      const r = ring * (0.92 + rnd() * 0.16);
      g.beginPath();
      g.moveTo(Math.cos(a0) * r, Math.sin(a0) * r);
      g.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
      g.stroke();
    }
  }
  // Crushed, frosted glass around the hole.
  g.fillStyle = 'rgba(250,253,255,0.92)';
  blobPath(g, rnd, 9, 0.5, 11);
  g.fill();
  g.fillStyle = 'rgba(16,22,28,0.85)';
  blobPath(g, rnd, 4.2, 0.35, 8);
  g.fill();
};

/** Wood: a ragged hole torn along the grain, pale splinters standing proud. */
const paintWood: Painter = (g, rnd) => {
  g.save();
  g.scale(1, 0.5);
  radial(g, 0, 0, 38, [
    [0, 'rgba(226,200,156,0.8)'],
    [0.6, 'rgba(214,186,140,0.4)'],
    [1, 'rgba(200,170,124,0)'],
  ]);
  g.restore();
  const n = 12 + Math.floor(rnd() * 7);
  for (let i = 0; i < n; i++) {
    const dir = rnd() < 0.5 ? 0 : Math.PI;
    const a = dir + (rnd() - 0.5) * 0.75;
    const len = 12 + rnd() * 32;
    const w = 1.2 + rnd() * 2.6;
    const pale = rnd() < 0.65;
    g.fillStyle = pale ? `rgba(${232 + Math.floor(rnd() * 16)},${204 + Math.floor(rnd() * 16)},${160 + Math.floor(rnd() * 16)},0.92)` : 'rgba(96,66,38,0.75)';
    g.save();
    g.rotate(a);
    g.beginPath();
    g.moveTo(3, -w);
    g.lineTo(len, 0);
    g.lineTo(3, w);
    g.closePath();
    g.fill();
    g.restore();
  }
  g.fillStyle = 'rgba(24,14,8,0.95)';
  blobPath(g, rnd, 9, 0.45, 10, 0.62);
  g.fill();
  g.strokeStyle = 'rgba(60,38,20,0.6)';
  g.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const y = (rnd() - 0.5) * 8;
    g.beginPath();
    g.moveTo(-10 - rnd() * 34, y);
    g.lineTo(10 + rnd() * 34, y + (rnd() - 0.5) * 3);
    g.stroke();
  }
};

/** Ceramic tile: a sharp-edged shell-shaped chip and long cracks running to the joints. */
const paintTile: Painter = (g, rnd) => {
  g.strokeStyle = 'rgba(34,34,36,0.75)';
  g.lineCap = 'round';
  const n = 2 + Math.floor(rnd() * 3);
  const base = rnd() * Math.PI * 2;
  for (let i = 0; i < n; i++) crack(g, rnd, base + (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.8, 10, 38 + rnd() * 22, 1.5);
  const sides = 6 + Math.floor(rnd() * 3);
  const pts: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
    const r = 13 + rnd() * 11;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  // Facets of the chip: each catches the light differently.
  for (let i = 0; i < sides; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[(i + 1) % sides]!;
    const v = 176 + Math.floor(rnd() * 64);
    g.fillStyle = `rgba(${v},${v},${v - 6},0.94)`;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(x0, y0);
    g.lineTo(x1, y1);
    g.closePath();
    g.fill();
  }
  g.strokeStyle = 'rgba(40,40,42,0.55)';
  g.lineWidth = 1;
  g.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
  g.closePath();
  g.stroke();
  hole(g, rnd, 5 + rnd() * 1.5);
};

/** Fabric, carpet, cardboard, lino: a small dark hole with a frayed edge. */
const paintSoft: Painter = (g, rnd) => {
  radial(g, 0, 0, 20, [
    [0, 'rgba(0,0,0,0.5)'],
    [0.5, 'rgba(0,0,0,0.22)'],
    [1, 'rgba(0,0,0,0)'],
  ]);
  g.strokeStyle = 'rgba(12,12,12,0.6)';
  g.lineWidth = 1.1;
  for (let i = 0; i < 16; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 8 + rnd() * 6;
    g.beginPath();
    g.moveTo(Math.cos(a) * 4, Math.sin(a) * 4);
    g.lineTo(Math.cos(a + (rnd() - 0.5) * 0.5) * r, Math.sin(a + (rnd() - 0.5) * 0.5) * r);
    g.stroke();
  }
  g.fillStyle = 'rgba(8,8,8,0.94)';
  blobPath(g, rnd, 6, 0.4, 9);
  g.fill();
};

/** Earth, grass, gravel: a dark scuffed crater. */
const paintScorch: Painter = (g, rnd) => {
  for (let i = 0; i < 7; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * 12;
    radial(g, Math.cos(a) * d, Math.sin(a) * d, 12 + rnd() * 12, [
      [0, 'rgba(30,22,16,0.6)'],
      [0.6, 'rgba(40,30,22,0.28)'],
      [1, 'rgba(46,36,26,0)'],
    ]);
  }
  g.fillStyle = 'rgba(20,14,10,0.5)';
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2;
    const d = 8 + rnd() * 28;
    g.beginPath();
    g.arc(Math.cos(a) * d, Math.sin(a) * d, 0.8 + rnd() * 1.8, 0, Math.PI * 2);
    g.fill();
  }
  radial(g, 0, 0, 9, [
    [0, 'rgba(8,6,4,0.9)'],
    [0.7, 'rgba(12,9,6,0.6)'],
    [1, 'rgba(16,12,8,0)'],
  ]);
};

/** Hard plastic: a clean hole inside a ring of stress whitening. */
const paintPlastic: Painter = (g, rnd) => {
  radial(g, 0, 0, 18, [
    [0, 'rgba(250,250,250,0.75)'],
    [0.55, 'rgba(246,246,246,0.45)'],
    [1, 'rgba(240,240,240,0)'],
  ]);
  g.strokeStyle = 'rgba(250,250,250,0.7)';
  for (let i = 0; i < 4; i++) crack(g, rnd, rnd() * Math.PI * 2, 7, 15 + rnd() * 11, 1.1);
  hole(g, rnd, 5.5 + rnd() * 1.5);
};

/** Atlas layout: [first cell, number of variants] per kind of mark. */
const MARK = {
  chip: [0, 3],
  metal: [3, 2],
  glass: [5, 2],
  wood: [7, 2],
  tile: [9, 2],
  soft: [11, 2],
  scorch: [13, 2],
  plastic: [15, 1],
} as const;

type MarkKind = keyof typeof MARK;

const PAINTERS: Record<MarkKind, Painter> = {
  chip: paintChip,
  metal: paintMetal,
  glass: paintGlass,
  wood: paintWood,
  tile: paintTile,
  soft: paintSoft,
  scorch: paintScorch,
  plastic: paintPlastic,
};

function decalAtlas(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = CELL * ATLAS_CELLS;
  const g = c.getContext('2d')!;
  const rnd = prng(0xb011e7);
  for (const kind of Object.keys(MARK) as MarkKind[]) {
    const [first, count] = MARK[kind];
    for (let v = 0; v < count; v++) {
      const cell = first + v;
      g.save();
      g.beginPath();
      g.rect((cell % ATLAS_CELLS) * CELL, Math.floor(cell / ATLAS_CELLS) * CELL, CELL, CELL);
      g.clip();
      g.translate((cell % ATLAS_CELLS) * CELL + CELL / 2, Math.floor(cell / ATLAS_CELLS) * CELL + CELL / 2);
      PAINTERS[kind](g, rnd);
      g.restore();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// --- Particles ----------------------------------------------------------------------

/**
 * One particle pool rendered as THREE.Points. Each particle has its own size (metres) that
 * goes from `size0` to `size1` over its life, its own gravity, and fades out linearly.
 */
class Particles {
  readonly points: THREE.Points;
  private readonly n: number;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private grav: Float32Array;
  private alpha: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private next = 0;
  /** Something is alive (or has just died and must still be hidden once). */
  private active = false;
  private geo = new THREE.BufferGeometry();

  constructor(
    count: number,
    tex: THREE.Texture,
    additive: boolean,
    /** Air drag (1/s): dust stops dead, chips fly. */
    private readonly drag: number,
  ) {
    this.n = count;
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 4);
    this.size = new Float32Array(count);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.max = new Float32Array(count);
    this.grav = new Float32Array(count);
    this.alpha = new Float32Array(count);
    this.s0 = new Float32Array(count);
    this.s1 = new Float32Array(count);
    for (const [name, array, items] of [
      ['position', this.pos, 3],
      ['color', this.col, 4],
      ['aSize', this.size, 1],
    ] as const) {
      const attr = new THREE.BufferAttribute(array, items);
      attr.setUsage(THREE.DynamicDrawUsage);
      this.geo.setAttribute(name, attr);
    }
    const mat = new THREE.PointsMaterial({
      size: 1,
      map: tex,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    // Per-particle size on top of the stock points shader (fog, tone mapping and colour space stay its own).
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace('uniform float size;', 'uniform float size;\nattribute float aSize;').replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;');
    };
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
    this.points.visible = false;
  }

  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    r: number,
    g: number,
    b: number,
    a: number,
    life: number,
    gravity: number,
    size0: number,
    size1: number,
  ): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.col[i * 4] = r;
    this.col[i * 4 + 1] = g;
    this.col[i * 4 + 2] = b;
    this.col[i * 4 + 3] = a;
    this.alpha[i] = a;
    this.life[i] = this.max[i] = life;
    this.grav[i] = gravity;
    this.s0[i] = size0;
    this.s1[i] = size1;
    this.size[i] = size0;
    this.active = true;
    this.points.visible = true;
  }

  update(dt: number): void {
    if (!this.active) return;
    const { pos, vel, col, life, max, size } = this;
    const d = Math.exp(-dt * this.drag);
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      const l = life[i]!;
      if (l <= 0) continue;
      const left = l - dt;
      life[i] = left;
      if (left <= 0) {
        col[i * 4 + 3] = 0;
        size[i] = 0;
        continue;
      }
      alive++;
      const vy = (vel[i * 3 + 1]! - this.grav[i]! * dt) * d;
      const vx = vel[i * 3]! * d;
      const vz = vel[i * 3 + 2]! * d;
      vel[i * 3] = vx;
      vel[i * 3 + 1] = vy;
      vel[i * 3 + 2] = vz;
      pos[i * 3] = pos[i * 3]! + vx * dt;
      pos[i * 3 + 1] = pos[i * 3 + 1]! + vy * dt;
      pos[i * 3 + 2] = pos[i * 3 + 2]! + vz * dt;
      const k = left / max[i]!;
      col[i * 4 + 3] = k * this.alpha[i]!;
      // Fast at first, then it settles.
      size[i] = this.s0[i]! + (this.s1[i]! - this.s0[i]!) * Math.sqrt(1 - k);
    }
    this.geo.attributes.position!.needsUpdate = true;
    this.geo.attributes.color!.needsUpdate = true;
    this.geo.attributes.aSize!.needsUpdate = true;
    if (alive === 0) {
      this.active = false;
      this.points.visible = false;
    }
  }

  clear(): void {
    this.life.fill(0);
    this.size.fill(0);
    for (let i = 0; i < this.n; i++) this.col[i * 4 + 3] = 0;
    this.geo.attributes.color!.needsUpdate = true;
    this.geo.attributes.aSize!.needsUpdate = true;
    this.active = false;
    this.points.visible = false;
  }

  dispose(): void {
    this.geo.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

// --- What each surface does when hit ----------------------------------------------------

type RGB = readonly [number, number, number];

interface ImpactStyle {
  /** Bullet mark left behind (null = none: water, leaves). */
  mark: MarkKind | null;
  /** Size range of the mark (m). */
  size: readonly [number, number];
  /** Dust: number of puffs, colour, opacity, how big they get (m), how long they hang (s). */
  dust: number;
  dustColor: RGB;
  dustAlpha: number;
  dustSize: number;
  dustLife: number;
  /** Solid debris: count, colour, speed (m/s), gravity (m/s²: low = fibres and paper floating down). */
  chips: number;
  chipColor: RGB;
  chipSpeed: number;
  chipGravity: number;
  /** Additive sparks or glints: count, colour (HDR), speed. */
  sparks: number;
  sparkColor: RGB;
  sparkSpeed: number;
  /** Chance that the bullet glances off, leaving a long bright streak of sparks. */
  ricochet: number;
}

const NONE: RGB = [0, 0, 0];
const HOT: RGB = [3.2, 2.1, 0.8];
const GLINT: RGB = [1.7, 1.9, 2.1];

const style = (s: Partial<ImpactStyle> & Pick<ImpactStyle, 'mark' | 'size'>): ImpactStyle => ({
  dust: 0,
  dustColor: NONE,
  dustAlpha: 0.5,
  dustSize: 0.4,
  dustLife: 0.6,
  chips: 0,
  chipColor: NONE,
  chipSpeed: 2.6,
  chipGravity: 9,
  sparks: 0,
  sparkColor: HOT,
  sparkSpeed: 5,
  ricochet: 0,
  ...s,
});

const STYLES: Record<SurfaceType, ImpactStyle> = {
  // Mineral walls and floors: dust and a chipped crater. Concrete is also the asphalt and the stone outdoors.
  concrete: style({ mark: 'chip', size: [0.1, 0.14], dust: 4, dustColor: [0.66, 0.65, 0.62], dustAlpha: 0.5, dustSize: 0.5, dustLife: 0.75, chips: 6, chipColor: [0.5, 0.49, 0.46], chipSpeed: 3, sparks: 1, sparkSpeed: 4, ricochet: 0.06 }),
  plaster: style({ mark: 'chip', size: [0.11, 0.16], dust: 5, dustColor: [0.9, 0.89, 0.86], dustAlpha: 0.55, dustSize: 0.62, dustLife: 0.9, chips: 6, chipColor: [0.88, 0.87, 0.83], chipSpeed: 2.4 }),
  tile: style({ mark: 'tile', size: [0.12, 0.17], dust: 2, dustColor: [0.9, 0.91, 0.92], dustAlpha: 0.4, dustSize: 0.36, dustLife: 0.5, chips: 8, chipColor: [0.93, 0.94, 0.95], chipSpeed: 3.6 }),
  // Glass: a star, a little frost, shards glinting as they fall.
  glass: style({ mark: 'glass', size: [0.17, 0.25], dust: 1, dustColor: [0.9, 0.95, 1], dustAlpha: 0.25, dustSize: 0.3, dustLife: 0.4, sparks: 9, sparkColor: GLINT, sparkSpeed: 2.6 }),
  // Metal: sparks, a bright dent, sometimes a ricochet.
  metal: style({ mark: 'metal', size: [0.065, 0.09], dust: 1, dustColor: [0.3, 0.3, 0.3], dustAlpha: 0.3, dustSize: 0.3, dustLife: 0.5, sparks: 9, sparkColor: HOT, sparkSpeed: 6.5, ricochet: 0.3 }),
  wood: style({ mark: 'wood', size: [0.11, 0.16], dust: 2, dustColor: [0.7, 0.58, 0.42], dustAlpha: 0.4, dustSize: 0.38, dustLife: 0.6, chips: 8, chipColor: [0.78, 0.63, 0.42], chipSpeed: 3.2, chipGravity: 7 }),
  plastic: style({ mark: 'plastic', size: [0.06, 0.08], dust: 1, dustColor: [0.85, 0.85, 0.85], dustAlpha: 0.3, dustSize: 0.26, dustLife: 0.4, chips: 5, chipColor: [0.9, 0.9, 0.9], chipSpeed: 3.4 }),
  // Soft floors and furnishings: fibres floating down, a small frayed hole.
  lino: style({ mark: 'soft', size: [0.05, 0.07], dust: 2, dustColor: [0.68, 0.7, 0.71], dustAlpha: 0.38, dustSize: 0.32, dustLife: 0.5, chips: 3, chipColor: [0.6, 0.62, 0.64], chipSpeed: 2.4 }),
  carpet: style({ mark: 'soft', size: [0.045, 0.06], dust: 3, dustColor: [0.46, 0.5, 0.58], dustAlpha: 0.4, dustSize: 0.34, dustLife: 0.8, chips: 5, chipColor: [0.34, 0.42, 0.56], chipSpeed: 1.6, chipGravity: 2.5 }),
  fabric: style({ mark: 'soft', size: [0.04, 0.055], dust: 3, dustColor: [0.72, 0.73, 0.76], dustAlpha: 0.4, dustSize: 0.34, dustLife: 0.85, chips: 4, chipColor: [0.8, 0.81, 0.84], chipSpeed: 1.4, chipGravity: 1.8 }),
  cardboard: style({ mark: 'soft', size: [0.05, 0.065], dust: 2, dustColor: [0.62, 0.5, 0.34], dustAlpha: 0.4, dustSize: 0.34, dustLife: 0.6, chips: 5, chipColor: [0.66, 0.52, 0.34], chipSpeed: 1.8, chipGravity: 3 }),
  // Loose ground: it flies up and leaves a scuff.
  dirt: style({ mark: 'scorch', size: [0.12, 0.17], dust: 5, dustColor: [0.44, 0.36, 0.27], dustAlpha: 0.55, dustSize: 0.6, dustLife: 0.9, chips: 7, chipColor: [0.3, 0.24, 0.17], chipSpeed: 3.4 }),
  grass: style({ mark: 'scorch', size: [0.09, 0.13], dust: 3, dustColor: [0.42, 0.38, 0.27], dustAlpha: 0.45, dustSize: 0.45, dustLife: 0.7, chips: 6, chipColor: [0.3, 0.44, 0.2], chipSpeed: 2.8, chipGravity: 6 }),
  gravel: style({ mark: 'scorch', size: [0.1, 0.14], dust: 3, dustColor: [0.64, 0.62, 0.57], dustAlpha: 0.45, dustSize: 0.45, dustLife: 0.7, chips: 9, chipColor: [0.6, 0.58, 0.54], chipSpeed: 4, sparks: 1, sparkSpeed: 4 }),
  water: style({ mark: null, size: [0, 0], dust: 3, dustColor: [0.8, 0.9, 0.96], dustAlpha: 0.4, dustSize: 0.5, dustLife: 0.5, chips: 8, chipColor: [0.82, 0.92, 0.98], chipSpeed: 3.6 }),
  foliage: style({ mark: null, size: [0, 0], dust: 1, dustColor: [0.4, 0.5, 0.3], dustAlpha: 0.3, dustSize: 0.3, dustLife: 0.5, chips: 7, chipColor: [0.3, 0.5, 0.22], chipSpeed: 1.8, chipGravity: 2.4 }),
};

const Z_AXIS = new THREE.Vector3(0, 0, 1);

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
  /** Per decal: atlas offset (u, v) and opacity. */
  private dData = new Float32Array(MAX_DECALS * 3);
  private dAttr: THREE.InstancedBufferAttribute;
  private dLife = new Float32Array(MAX_DECALS);
  private dNext = 0;
  private dLive = 0;
  private dust: Particles;
  private chips: Particles;
  private sparks: Particles;
  private markers: { group: THREE.Group; ring: THREE.Mesh }[] = [];
  private time = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private col = new THREE.Color();
  private light = new THREE.Color();
  private textures: THREE.Texture[] = [];
  private flashes: MuzzleFlash[] = [];
  private fNext = 0;
  private fLive = false;

  constructor(private engine: IEngine) {
    this.root.name = 'bas-effects';
    engine.scene.add(this.root);
    const soft = dotTexture(false);
    const hard = dotTexture(true);
    const atlas = decalAtlas();
    this.textures.push(soft, hard, atlas);

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

    // Bullet holes: one instanced quad, each instance picks its cell of the atlas and its opacity.
    const dg = new THREE.PlaneGeometry(1, 1);
    this.dAttr = new THREE.InstancedBufferAttribute(this.dData, 3);
    this.dAttr.setUsage(THREE.DynamicDrawUsage);
    dg.setAttribute('aDecal', this.dAttr);
    const dm = new THREE.MeshBasicMaterial({ map: atlas, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    dm.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aDecal;\nvarying float vDecalAlpha;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>\n\tvMapUv = vMapUv * ${(1 / ATLAS_CELLS).toFixed(4)} + aDecal.xy;\n\tvDecalAlpha = aDecal.z;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vDecalAlpha;')
        .replace('#include <color_fragment>', '#include <color_fragment>\n\tdiffuseColor.a *= vDecalAlpha;');
    };
    this.decals = new THREE.InstancedMesh(dg, dm, MAX_DECALS);
    this.decals.frustumCulled = false;
    for (let i = 0; i < MAX_DECALS; i++) {
      this.decals.setMatrixAt(i, this.m4);
      this.decals.setColorAt(i, this.col.setRGB(1, 1, 1));
    }
    this.decals.renderOrder = 2;
    this.decals.visible = false;

    this.dust = new Particles(MAX_DUST, soft, false, 5);
    this.chips = new Particles(MAX_CHIPS, hard, false, 1.4);
    this.sparks = new Particles(MAX_SPARKS, soft, true, 1.8);
    this.root.add(this.decals, this.tracers, this.dust.points, this.chips.points, this.sparks.points);
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

  /** Light at a point, kept within what an unlit sprite can show. */
  private lightAt(p: Vec3): THREE.Color {
    const l = this.engine.sampleLight(p, this.light);
    l.r = Math.min(1.15, Math.max(0.16, l.r));
    l.g = Math.min(1.15, Math.max(0.16, l.g));
    l.b = Math.min(1.15, Math.max(0.16, l.b));
    return l;
  }

  impact(point: Vec3, normal: Vec3, surf: SurfaceType): void {
    const s = STYLES[surf] ?? STYLES.concrete;
    const nx = normal.x;
    const ny = normal.y;
    const nz = normal.z;
    // Start a hair off the wall so the sprites do not cut into it.
    const px = point.x + nx * 0.03;
    const py = point.y + ny * 0.03;
    const pz = point.z + nz * 0.03;
    const l = this.lightAt(point);

    // Dust: a puff pushed out along the normal that swells, drifts up a little and thins out.
    for (let k = 0; k < s.dust; k++) {
      const out = 0.5 + Math.random() * 1.6;
      const shade = 0.88 + Math.random() * 0.24;
      this.dust.emit(
        px,
        py,
        pz,
        nx * out + (Math.random() - 0.5) * 0.9,
        ny * out + (Math.random() - 0.5) * 0.9 + 0.25,
        nz * out + (Math.random() - 0.5) * 0.9,
        s.dustColor[0] * l.r * shade,
        s.dustColor[1] * l.g * shade,
        s.dustColor[2] * l.b * shade,
        s.dustAlpha * (0.7 + Math.random() * 0.3),
        s.dustLife * (0.6 + Math.random() * 0.6),
        -0.25,
        0.07,
        s.dustSize * (0.6 + Math.random() * 0.6),
      );
    }
    // Chips: thrown out in a cone around the normal, then gravity takes them.
    for (let k = 0; k < s.chips; k++) {
      const v = s.chipSpeed * (0.45 + Math.random() * 0.8);
      const shade = 0.75 + Math.random() * 0.4;
      this.chips.emit(
        px,
        py,
        pz,
        nx * v + (Math.random() - 0.5) * v * 1.3,
        ny * v + (Math.random() - 0.35) * v * 1.3,
        nz * v + (Math.random() - 0.5) * v * 1.3,
        s.chipColor[0] * l.r * shade,
        s.chipColor[1] * l.g * shade,
        s.chipColor[2] * l.b * shade,
        1,
        0.35 + Math.random() * 0.45,
        s.chipGravity,
        0.014 + Math.random() * 0.02,
        0.008,
      );
    }
    // Sparks and glints.
    const sparks = s.sparks >= 2 ? s.sparks : Math.random() < 0.3 ? s.sparks : 0;
    for (let k = 0; k < sparks; k++) {
      const v = s.sparkSpeed * (0.4 + Math.random() * 0.9);
      this.sparks.emit(
        px,
        py,
        pz,
        nx * v + (Math.random() - 0.5) * v * 1.5,
        ny * v + (Math.random() - 0.3) * v * 1.5,
        nz * v + (Math.random() - 0.5) * v * 1.5,
        s.sparkColor[0],
        s.sparkColor[1],
        s.sparkColor[2],
        1,
        0.12 + Math.random() * (s.mark === 'glass' ? 0.5 : 0.22),
        9,
        0.035 + Math.random() * 0.03,
        0.012,
      );
    }
    if (s.ricochet > 0 && Math.random() < s.ricochet) {
      // The bullet glances off: a tight streak of sparks leaving at a shallow angle.
      const a = Math.random() * Math.PI * 2;
      const tx = Math.cos(a);
      const tz = Math.sin(a);
      const rx = nx * 0.45 + tx * (1 - Math.abs(nx));
      const ry = ny * 0.45 + 0.35;
      const rz = nz * 0.45 + tz * (1 - Math.abs(nz));
      for (let k = 0; k < 6; k++) {
        const v = 9 + k * 2.2;
        this.sparks.emit(px, py, pz, rx * v, ry * v, rz * v, HOT[0], HOT[1], HOT[2], 1, 0.16 + k * 0.012, 4, 0.045, 0.014);
      }
    }

    if (!s.mark) return;
    // Bullet mark: a quad lying on the surface, rolled at random, lit like the wall around it.
    const i = this.dNext;
    this.dNext = (this.dNext + 1) % MAX_DECALS;
    const [first, count] = MARK[s.mark];
    const cell = first + Math.floor(Math.random() * count);
    this.dData[i * 3] = (cell % ATLAS_CELLS) / ATLAS_CELLS;
    this.dData[i * 3 + 1] = (ATLAS_CELLS - 1 - Math.floor(cell / ATLAS_CELLS)) / ATLAS_CELLS;
    this.dData[i * 3 + 2] = 1;
    this.dAttr.needsUpdate = true;
    this.q.setFromUnitVectors(Z_AXIS, this.v1.set(nx, ny, nz));
    this.q.multiply(this.q2.setFromAxisAngle(Z_AXIS, Math.random() * Math.PI * 2));
    const size = s.size[0] + Math.random() * (s.size[1] - s.size[0]);
    // Marks landing on top of each other sit at slightly different depths (no flicker).
    const lift = 0.004 + (i % 8) * 0.0004;
    this.m4.compose(this.v3.set(point.x + nx * lift, point.y + ny * lift, point.z + nz * lift), this.q, this.v2.set(size, size, size));
    this.decals.setMatrixAt(i, this.m4);
    this.decals.instanceMatrix.needsUpdate = true;
    this.decals.setColorAt(i, this.col.setRGB(l.r, l.g, l.b));
    if (this.decals.instanceColor) this.decals.instanceColor.needsUpdate = true;
    if (this.dLife[i]! <= 0) this.dLive++;
    this.dLife[i] = DECAL_LIFE;
    this.decals.visible = true;
  }

  /** Hit on a player: a brief, small puff where the bullet lands — the hit reads, nothing more. */
  blood(point: Vec3, dir: Vec3): void {
    const l = this.lightAt(point);
    for (let k = 0; k < 4; k++) {
      const shade = 0.8 + Math.random() * 0.3;
      this.dust.emit(
        point.x,
        point.y,
        point.z,
        dir.x * 0.9 + (Math.random() - 0.5) * 0.9,
        dir.y * 0.5 + Math.random() * 0.5,
        dir.z * 0.9 + (Math.random() - 0.5) * 0.9,
        0.5 * l.r * shade,
        0.2 * l.g * shade,
        0.19 * l.b * shade,
        0.5,
        0.16 + Math.random() * 0.14,
        0.6,
        0.05,
        0.2 + Math.random() * 0.08,
      );
    }
    // Threads of the lab coat.
    for (let k = 0; k < 3; k++) {
      this.chips.emit(
        point.x,
        point.y,
        point.z,
        dir.x * 1.2 + (Math.random() - 0.5) * 1.4,
        0.4 + Math.random() * 0.9,
        dir.z * 1.2 + (Math.random() - 0.5) * 1.4,
        0.82 * l.r,
        0.82 * l.g,
        0.84 * l.b,
        0.9,
        0.25 + Math.random() * 0.2,
        4,
        0.012 + Math.random() * 0.01,
        0.006,
      );
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
      this.sparks.emit(pos.x, pos.y, pos.z, dir.x * s + (Math.random() - 0.5), dir.y * s + (Math.random() - 0.5), dir.z * s + (Math.random() - 0.5), 2.4, 1.8, 0.9, 1, 0.06 + Math.random() * 0.05, 0, 0.05, 0.02);
    }
    const heavy = def.category === 'shotgun' || def.category === 'sniper';
    const g = 0.5 + Math.random() * 0.12;
    this.dust.emit(pos.x, pos.y, pos.z, dir.x * 1.6, dir.y * 1.6 + 0.3, dir.z * 1.6, g, g, g * 1.03, heavy ? 0.3 : 0.16, 0.45 + Math.random() * 0.3, -0.5, 0.08, heavy ? 0.5 : 0.32);
  }

  explosion(pos: Vec3): void {
    for (let k = 0; k < 60; k++) {
      const a = Math.random() * Math.PI * 2;
      const u = Math.random();
      const s = 3 + Math.random() * 7;
      this.sparks.emit(pos.x, pos.y, pos.z, Math.cos(a) * s * (1 - u * 0.5), 2 + u * 7, Math.sin(a) * s * (1 - u * 0.5), 3, 2, 0.9, 1, 0.4 + Math.random() * 0.5, 6, 0.09, 0.03);
    }
    // Flying audit paperwork.
    for (let k = 0; k < 90; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 5;
      this.chips.emit(pos.x, pos.y, pos.z, Math.cos(a) * s, 3 + Math.random() * 6, Math.sin(a) * s, 0.97, 0.97, 0.93, 1, 2 + Math.random() * 2.5, 2.2, 0.07, 0.05);
    }
    // Smoke of the blast.
    for (let k = 0; k < 14; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * 2.5;
      const g = 0.35 + Math.random() * 0.2;
      this.dust.emit(pos.x, pos.y + 0.3, pos.z, Math.cos(a) * s, 0.6 + Math.random() * 1.6, Math.sin(a) * s, g, g, g, 0.5, 1 + Math.random() * 1.2, -0.4, 0.4, 1.6 + Math.random());
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
      this.q.setFromUnitVectors(Z_AXIS, this.v1.set(dx / len, dy / len, dz / len));
      this.m4.compose(this.v3.set(mx, my, mz), this.q, this.v2.set(w, w, len * (head - tail)));
      this.tracers.setMatrixAt(i, this.m4);
      const f = 1 - k * 0.7;
      this.tracers.setColorAt(i, this.col.setRGB(1 * f, 0.86 * f, 0.55 * f));
    }
    if (dirty) {
      this.tracers.instanceMatrix.needsUpdate = true;
      if (this.tracers.instanceColor) this.tracers.instanceColor.needsUpdate = true;
    }
    if (this.dLive > 0) {
      // Bullet holes age; the last seconds of their life they fade away.
      let moved = false;
      let faded = false;
      for (let i = 0; i < MAX_DECALS; i++) {
        const life = this.dLife[i]!;
        if (life <= 0) continue;
        const left = life - dt;
        this.dLife[i] = left;
        if (left <= 0) {
          this.m4.makeScale(0, 0, 0);
          this.decals.setMatrixAt(i, this.m4);
          this.dData[i * 3 + 2] = 0;
          this.dLive--;
          moved = true;
          faded = true;
        } else if (left < DECAL_FADE) {
          this.dData[i * 3 + 2] = left / DECAL_FADE;
          faded = true;
        }
      }
      if (moved) this.decals.instanceMatrix.needsUpdate = true;
      if (faded) this.dAttr.needsUpdate = true;
      if (this.dLive <= 0) {
        this.dLive = 0;
        this.decals.visible = false;
      }
    }
    this.dust.update(dt);
    this.chips.update(dt);
    this.sparks.update(dt);
    if (this.fLive) {
      // Keep going until every flash has ended, whatever the frame rate.
      let alive = false;
      for (let i = 0; i < MAX_FLASHES; i++) alive = this.flashes[i]!.update(dt) || alive;
      this.fLive = alive;
    }
    if (this.markers.length) {
      const s = 1 + Math.sin(this.time * 4) * 0.18;
      for (let i = 0; i < this.markers.length; i++) this.markers[i]!.ring.scale.set(s, 1, s);
    }
  }

  clear(): void {
    this.m4.makeScale(0, 0, 0);
    for (let i = 0; i < MAX_TRACERS; i++) this.tracers.setMatrixAt(i, this.m4);
    for (let i = 0; i < MAX_DECALS; i++) this.decals.setMatrixAt(i, this.m4);
    this.tLife.fill(0);
    this.dLife.fill(0);
    this.dLive = 0;
    this.decals.visible = false;
    this.tracers.instanceMatrix.needsUpdate = true;
    this.decals.instanceMatrix.needsUpdate = true;
    this.dust.clear();
    this.chips.clear();
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
    this.chips.dispose();
    this.sparks.dispose();
    this.tracers.geometry.dispose();
    (this.tracers.material as THREE.Material).dispose();
    this.decals.geometry.dispose();
    (this.decals.material as THREE.Material).dispose();
    for (const t of this.textures) t.dispose();
  }
}

export function createEffects(engine: IEngine): IEffects {
  return new Effects(engine);
}
