/**
 * Muzzle flash: a burst of textured, additive planes at the muzzle — a star seen along the
 * barrel, two crossed plumes seen from the side and a soft glow. The textures are painted
 * once on a canvas (four variants each); every shot picks a variant, a roll and a size, and
 * the flash lives for two or three frames. Colours are HDR (well above 1) so the bloom pass
 * of the filmic pipeline picks them up.
 *
 * Shared by the first-person weapon (one instance, in the overlay scene) and by the other
 * players' weapons (a small pool in the world, see effects/index.ts).
 */
import * as THREE from 'three';

export type FlashClass = 'pistol' | 'smg' | 'rifle' | 'shotgun' | 'sniper';

interface FlashStyle {
  /** Diameter of the star (m), length and width of the plumes (m), brightness. */
  star: number;
  length: number;
  width: number;
  gain: number;
  /** Lifetime (s). */
  life: number;
}

const STYLES: Record<FlashClass, FlashStyle> = {
  pistol: { star: 0.13, length: 0.16, width: 0.1, gain: 4, life: 0.042 },
  smg: { star: 0.15, length: 0.2, width: 0.11, gain: 4, life: 0.04 },
  rifle: { star: 0.22, length: 0.34, width: 0.15, gain: 4.6, life: 0.046 },
  shotgun: { star: 0.34, length: 0.42, width: 0.26, gain: 5, life: 0.06 },
  sniper: { star: 0.36, length: 0.55, width: 0.22, gain: 5.2, life: 0.06 },
};

export function flashClass(category: string): FlashClass {
  return category === 'pistol' || category === 'smg' || category === 'shotgun' || category === 'sniper' ? category : 'rifle';
}

// --- Textures ----------------------------------------------------------------------

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

const CELL = 256;

/** A tapered tongue of flame from (0,0) along +X, in the current transform. */
function tongue(g: CanvasRenderingContext2D, len: number, width: number, hot: number): void {
  const grad = g.createLinearGradient(0, 0, len, 0);
  grad.addColorStop(0, `rgba(255,250,225,${hot})`);
  grad.addColorStop(0.25, `rgba(255,214,130,${hot * 0.85})`);
  grad.addColorStop(0.6, `rgba(255,140,48,${hot * 0.5})`);
  grad.addColorStop(1, 'rgba(255,80,10,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(0, -width * 0.5);
  g.quadraticCurveTo(len * 0.45, -width * 0.62, len, 0);
  g.quadraticCurveTo(len * 0.45, width * 0.62, 0, width * 0.5);
  g.closePath();
  g.fill();
}

function blob(g: CanvasRenderingContext2D, x: number, y: number, r: number, stops: [number, string][]): void {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  for (const [o, c] of stops) grad.addColorStop(o, c);
  g.fillStyle = grad;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

/** Flash seen along the barrel: hot core, uneven spikes, orange haze. */
function paintStar(g: CanvasRenderingContext2D, ox: number, oy: number, rnd: () => number): void {
  const c = CELL / 2;
  const R = c * 0.94;
  g.save();
  g.beginPath();
  g.rect(ox, oy, CELL, CELL);
  g.clip();
  g.translate(ox + c, oy + c);
  blob(g, 0, 0, R, [
    [0, 'rgba(255,170,70,0.5)'],
    [0.45, 'rgba(255,110,30,0.22)'],
    [1, 'rgba(255,70,10,0)'],
  ]);
  const spikes = 5 + Math.floor(rnd() * 3);
  const phase = rnd() * Math.PI * 2;
  for (let i = 0; i < spikes; i++) {
    const a = phase + ((i + (rnd() - 0.5) * 0.5) / spikes) * Math.PI * 2;
    const len = R * (0.55 + rnd() * 0.45);
    g.save();
    g.rotate(a);
    tongue(g, len, R * (0.2 + rnd() * 0.16), 0.95);
    g.restore();
    // A thinner, shorter tongue beside it breaks the symmetry.
    g.save();
    g.rotate(a + (rnd() - 0.5) * 0.7);
    tongue(g, len * (0.45 + rnd() * 0.3), R * 0.1, 0.7);
    g.restore();
  }
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2;
    const d = R * (0.35 + rnd() * 0.6);
    blob(g, Math.cos(a) * d, Math.sin(a) * d, 1.5 + rnd() * 3, [
      [0, 'rgba(255,230,170,0.9)'],
      [1, 'rgba(255,150,40,0)'],
    ]);
  }
  blob(g, 0, 0, R * 0.42, [
    [0, 'rgba(255,255,244,1)'],
    [0.4, 'rgba(255,236,170,0.85)'],
    [1, 'rgba(255,170,60,0)'],
  ]);
  g.restore();
}

/** Flash seen from the side: the muzzle is on the left edge, the flame runs to the right. */
function paintPlume(g: CanvasRenderingContext2D, ox: number, oy: number, rnd: () => number): void {
  g.save();
  g.beginPath();
  g.rect(ox, oy, CELL, CELL);
  g.clip();
  g.translate(ox + CELL * 0.04, oy + CELL / 2);
  const L = CELL * 0.94;
  // Orange body of the flame.
  g.save();
  g.scale(1, 0.42);
  blob(g, L * 0.34, 0, L * 0.4, [
    [0, 'rgba(255,190,90,0.75)'],
    [0.5, 'rgba(255,120,36,0.35)'],
    [1, 'rgba(255,70,10,0)'],
  ]);
  g.restore();
  const n = 6 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    g.save();
    g.rotate((rnd() - 0.5) * 0.62);
    tongue(g, L * (0.45 + rnd() * 0.55), CELL * (0.07 + rnd() * 0.09), 0.8);
    g.restore();
  }
  for (let i = 0; i < 10; i++) {
    const a = (rnd() - 0.5) * 0.7;
    const d = L * (0.4 + rnd() * 0.55);
    blob(g, Math.cos(a) * d, Math.sin(a) * d, 1.5 + rnd() * 2.5, [
      [0, 'rgba(255,230,170,0.9)'],
      [1, 'rgba(255,150,40,0)'],
    ]);
  }
  // White-hot gas right at the muzzle.
  g.save();
  g.scale(1, 0.6);
  blob(g, L * 0.1, 0, L * 0.26, [
    [0, 'rgba(255,255,244,1)'],
    [0.45, 'rgba(255,236,170,0.8)'],
    [1, 'rgba(255,170,60,0)'],
  ]);
  g.restore();
  g.restore();
}

function atlas(paint: (g: CanvasRenderingContext2D, ox: number, oy: number, rnd: () => number) => void, seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = CELL * 2;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'lighter';
  const rnd = prng(seed);
  for (let i = 0; i < 4; i++) paint(g, (i % 2) * CELL, Math.floor(i / 2) * CELL, rnd);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(0.5, 0.5);
  return t;
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 128);
  blob(g, 64, 64, 64, [
    [0, 'rgba(255,205,140,0.85)'],
    [0.3, 'rgba(255,150,70,0.35)'],
    [0.65, 'rgba(255,110,40,0.09)'],
    [1, 'rgba(255,90,20,0)'],
  ]);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let textures: { star: THREE.CanvasTexture; plume: THREE.CanvasTexture; glow: THREE.CanvasTexture } | null = null;
let geometry: { star: THREE.PlaneGeometry; plume: THREE.PlaneGeometry } | null = null;

function shared(): { tex: NonNullable<typeof textures>; geo: NonNullable<typeof geometry> } {
  textures ??= { star: atlas(paintStar, 0x51a5), plume: atlas(paintPlume, 0x9e37), glow: glowTexture() };
  if (!geometry) {
    const star = new THREE.PlaneGeometry(1, 1);
    // Plume: from the muzzle (z = 0) to z = -1, 1 wide, lying in the XZ plane.
    const plume = new THREE.PlaneGeometry(1, 1);
    plume.translate(0.5, 0, 0);
    plume.rotateY(Math.PI / 2);
    geometry = { star, plume };
  }
  return { tex: textures, geo: geometry };
}

// --- Flash -------------------------------------------------------------------------

const BASE = new THREE.Color(1, 0.74, 0.42);

/**
 * One muzzle flash. `group` has its origin at the muzzle and its -Z axis along the barrel;
 * add it to the weapon (first person) or place / orient it in the world (other players).
 */
export class MuzzleFlash {
  readonly group = new THREE.Group();
  /** 1 right after the shot, 0 when the flash is over (drives the light pulse). */
  level = 0;
  private star: THREE.Mesh;
  private plumes = new THREE.Group();
  private glow: THREE.Mesh;
  private mats: THREE.MeshBasicMaterial[] = [];
  private maps: THREE.Texture[] = [];
  private t = 0;
  private life = 0.045;
  private gain = 6;
  private size = 0.2;
  private len = 0.3;
  private wid = 0.15;
  private halo = 1;
  private fresh = false;

  /** `overlay`: first-person flash — its glow veils the whole weapon (no depth test). */
  constructor(overlay: boolean) {
    const { tex, geo } = shared();
    const mat = (map: THREE.Texture, depthTest: boolean): THREE.MeshBasicMaterial => {
      const m = new THREE.MeshBasicMaterial({
        map,
        color: 0xffffff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest,
        side: THREE.DoubleSide,
        fog: false,
      });
      this.mats.push(m);
      return m;
    };
    const own = (t: THREE.Texture): THREE.Texture => {
      const c = t.clone();
      this.maps.push(c);
      return c;
    };
    this.star = new THREE.Mesh(geo.star, mat(own(tex.star), true));
    const p1 = new THREE.Mesh(geo.plume, mat(own(tex.plume), true));
    const p2 = new THREE.Mesh(geo.plume, mat(own(tex.plume), true));
    p2.rotation.z = Math.PI / 2;
    this.plumes.add(p1, p2);
    this.glow = new THREE.Mesh(geo.star, mat(tex.glow, !overlay));
    this.star.renderOrder = this.glow.renderOrder = p1.renderOrder = p2.renderOrder = 12;
    this.glow.renderOrder = 13;
    this.group.add(this.plumes, this.star, this.glow);
    this.group.visible = false;
    for (const o of [this.star, p1, p2, this.glow]) o.frustumCulled = false;
  }

  /**
   * Start a flash: random variant, roll and size. `scale` multiplies the size of the class,
   * `glow` the strength of the soft halo.
   */
  fire(kind: FlashClass, scale = 1, glow = 1): void {
    this.halo = glow;
    const s = STYLES[kind];
    this.life = s.life;
    this.t = s.life;
    this.gain = s.gain * (0.8 + Math.random() * 0.4);
    this.size = s.star * scale * (0.8 + Math.random() * 0.45);
    this.len = s.length * scale * (0.7 + Math.random() * 0.6);
    this.wid = s.width * scale * (0.8 + Math.random() * 0.4);
    for (const map of this.maps) map.offset.set(Math.random() < 0.5 ? 0 : 0.5, Math.random() < 0.5 ? 0 : 0.5);
    this.star.rotation.z = Math.random() * Math.PI * 2;
    this.star.position.z = -this.len * 0.12;
    this.plumes.rotation.z = Math.random() * Math.PI;
    this.glow.position.z = -this.len * 0.2;
    this.group.visible = true;
    this.fresh = true;
    this.level = 1;
    this.apply(1);
  }

  private apply(k: number): void {
    // Full for the first half of its life, then it swells and fades.
    const fade = k > 0.5 ? 1 : k / 0.5;
    const grow = 1 + (1 - k) * 0.45;
    this.star.scale.setScalar(this.size * grow);
    this.plumes.scale.set(this.wid * grow, this.wid * grow, this.len * grow);
    this.glow.scale.setScalar(this.size * 3.4);
    const g = this.gain * fade;
    for (let i = 0; i < 3; i++) this.mats[i]!.color.setRGB(BASE.r * g, BASE.g * g, BASE.b * g);
    const h = g * 0.16 * this.halo;
    this.mats[3]!.color.setRGB(BASE.r * h, BASE.g * h, BASE.b * h);
    this.level = fade;
  }

  /** Advance; returns false once the flash is over. */
  update(dt: number): boolean {
    if (this.t <= 0) return false;
    // Whatever the frame rate, a flash is drawn at least once.
    if (this.fresh) {
      this.fresh = false;
      return true;
    }
    this.t -= dt;
    if (this.t <= 0) {
      this.group.visible = false;
      this.level = 0;
      return false;
    }
    this.apply(this.t / this.life);
    return true;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const m of this.mats) m.dispose();
    for (const t of this.maps) t.dispose();
  }
}
