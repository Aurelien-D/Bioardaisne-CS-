/**
 * Phase-1 baked lighting: evaluated once per vertex at map load, stored in vertex colours.
 *
 *   light = ambient (sky / ground hemisphere, with a small per-orientation shade so that
 *           faces stay distinguishable where nothing else lights them)
 *         + sun (Lambert, switched off under cover)
 *         + point lights (smooth distance falloff, wrapped Lambert + a little fill)
 *
 * There is no ray casting here. The only occlusion is a cheap "is there an opaque box
 * right overhead?" query on the map boxes, which is enough to tell interiors and
 * covered areas from open sky. It does NOT need the CollisionWorld.
 *
 * All colours are linear RGB; 1.0 means "the texture at its authored brightness".
 * The light-mapping pass replaces `shade()` for box faces (see faces.ts) and can reuse
 * the helpers exported here (hexToLinear, pointFalloff).
 */
import * as THREE from 'three';
import { materialInfo } from '../../../shared/maps/materials';
import type { MapData } from '../../../shared/maps/types';
import type { Vec3 } from '../../../shared/math/vec3';
import { BoxGrid } from './boxgrid';

/** Surface lighting provider used by the geometry emitters (boxes and prims). */
export interface SurfaceShader {
  /** Linear RGB light reaching the surface point (x, y, z) with unit normal (nx, ny, nz). */
  shade(x: number, y: number, z: number, nx: number, ny: number, nz: number, out: Float32Array): void;
}

const scratchColor = new THREE.Color();

/** 0xRRGGBB (sRGB) -> linear RGB triple. */
export function hexToLinear(hex: number, out: Float32Array | number[]): void {
  scratchColor.setHex(hex);
  out[0] = scratchColor.r;
  out[1] = scratchColor.g;
  out[2] = scratchColor.b;
}

const FALLOFF_K = 0.3;

/**
 * Distance attenuation of a LightDef: 1 at 1 m, smooth window reaching exactly 0 at `range`.
 * `d2` is the squared distance.
 */
export function pointFalloff(d2: number, range: number): number {
  const r2 = range * range;
  if (d2 >= r2) return 0;
  const w = 1 - d2 / r2;
  return (w * w * (1 + FALLOFF_K)) / (1 + FALLOFF_K * d2);
}

/** Overall gains, tuned by eye on the dev maps. */
const AMBIENT_GAIN = 1.25;
const SUN_GAIN = 0.95;
const POINT_GAIN = 1.15;
/** Share of the sky ambient that still reaches covered (indoor) surfaces. */
const COVERED_SKY = 0.5;
/** Soft knee: light above this level is compressed so bright spots do not clip flat. */
const KNEE = 0.95;
const LIGHT_CELL = 6;

const softClip = (v: number): number => (v <= KNEE ? v : KNEE + (v - KNEE) / (1 + (v - KNEE) * 1.4));

export class MapLighting implements SurfaceShader {
  /** Direction TO the sun (unit). */
  readonly sunDir = new THREE.Vector3(0.45, 0.8, 0.4).normalize();
  /** Linear sun colour × intensity (zero for interior-only maps). */
  readonly sun = new Float32Array(3);
  readonly sky = new Float32Array(3);
  readonly ground = new Float32Array(3);

  private readonly lightCount: number;
  /** Per light: x, y, z, range, r, g, b (colour × intensity, linear). */
  private readonly lights: Float32Array;
  private readonly lightCells: (number[] | undefined)[];
  private readonly gridMinX: number;
  private readonly gridMinZ: number;
  private readonly gridNx: number;
  private readonly gridNz: number;
  private readonly cover: BoxGrid;

  constructor(map: MapData) {
    const env = map.env;
    this.sunDir.set(env.sunDir.x, env.sunDir.y, env.sunDir.z);
    if (this.sunDir.lengthSq() < 1e-6) this.sunDir.set(0.45, 0.8, 0.4);
    this.sunDir.normalize();
    hexToLinear(env.sunColor, this.sun);
    hexToLinear(env.ambientSky, this.sky);
    hexToLinear(env.ambientGround, this.ground);
    for (let i = 0; i < 3; i++) {
      this.sun[i]! *= env.sunIntensity * SUN_GAIN;
      this.sky[i]! *= env.ambientIntensity * AMBIENT_GAIN;
      this.ground[i]! *= env.ambientIntensity * AMBIENT_GAIN;
    }

    // --- Point lights in a coarse XZ grid ---
    const n = map.lights.length;
    this.lightCount = n;
    this.lights = new Float32Array(n * 7);
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    const rgb = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const l = map.lights[i]!;
      hexToLinear(l.color, rgb);
      const o = i * 7;
      this.lights[o] = l.pos.x;
      this.lights[o + 1] = l.pos.y;
      this.lights[o + 2] = l.pos.z;
      this.lights[o + 3] = l.range;
      this.lights[o + 4] = rgb[0]! * l.intensity * POINT_GAIN;
      this.lights[o + 5] = rgb[1]! * l.intensity * POINT_GAIN;
      this.lights[o + 6] = rgb[2]! * l.intensity * POINT_GAIN;
      minX = Math.min(minX, l.pos.x - l.range);
      maxX = Math.max(maxX, l.pos.x + l.range);
      minZ = Math.min(minZ, l.pos.z - l.range);
      maxZ = Math.max(maxZ, l.pos.z + l.range);
    }
    if (n === 0) {
      minX = minZ = 0;
      maxX = maxZ = 1;
    }
    this.gridMinX = minX;
    this.gridMinZ = minZ;
    this.gridNx = Math.max(1, Math.ceil((maxX - minX) / LIGHT_CELL));
    this.gridNz = Math.max(1, Math.ceil((maxZ - minZ) / LIGHT_CELL));
    this.lightCells = new Array<number[] | undefined>(this.gridNx * this.gridNz);
    for (let i = 0; i < n; i++) {
      const l = map.lights[i]!;
      const x0 = Math.max(0, Math.floor((l.pos.x - l.range - minX) / LIGHT_CELL));
      const x1 = Math.min(this.gridNx - 1, Math.floor((l.pos.x + l.range - minX) / LIGHT_CELL));
      const z0 = Math.max(0, Math.floor((l.pos.z - l.range - minZ) / LIGHT_CELL));
      const z1 = Math.min(this.gridNz - 1, Math.floor((l.pos.z + l.range - minZ) / LIGHT_CELL));
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) (this.lightCells[cz * this.gridNx + cx] ??= []).push(i);
      }
    }

    // --- Opaque boxes, for the overhead-cover query ---
    this.cover = new BoxGrid(map.boxes, (b) => materialInfo(b.mat).transparent !== true);
  }

  private lightsNear(x: number, z: number): readonly number[] | undefined {
    const cx = Math.floor((x - this.gridMinX) / LIGHT_CELL);
    const cz = Math.floor((z - this.gridMinZ) / LIGHT_CELL);
    if (cx < 0 || cz < 0 || cx >= this.gridNx || cz >= this.gridNz) return undefined;
    return this.lightCells[cz * this.gridNx + cx];
  }

  /** True when an opaque box lies directly above the point (ceiling, roof, walkway…). */
  covered(x: number, y: number, z: number): boolean {
    const list = this.cover.query(x, z);
    const boxes = this.cover.boxes;
    for (let i = 0; i < list.length; i++) {
      const b = boxes[list[i]!]!;
      if (b.min.y > y - 0.01 && x > b.min.x + 0.01 && x < b.max.x - 0.01 && z > b.min.z + 0.01 && z < b.max.z - 0.01) {
        return true;
      }
    }
    return false;
  }

  shade(x: number, y: number, z: number, nx: number, ny: number, nz: number, out: Float32Array): void {
    // Cover: probed just off the surface and, for walls, a step further out so that a
    // small ledge or cornice does not put a whole façade in the shade.
    let covered = this.covered(x + nx * 0.05, y + ny * 0.05, z + nz * 0.05);
    if (covered && ny > -0.5 && ny < 0.5) covered = this.covered(x + nx * 0.6, y + ny * 0.6, z + nz * 0.6);

    // Ambient hemisphere with a fixed per-orientation shade (X walls ≠ Z walls).
    const h = 0.5 + 0.5 * ny;
    const skyK = h * (covered ? COVERED_SKY : 1);
    const groundK = 1 - h;
    const shadeK = 1 - 0.16 * nz * nz - 0.05 * (nx < 0 ? nx * nx : 0);
    let r = (this.sky[0]! * skyK + this.ground[0]! * groundK) * shadeK;
    let g = (this.sky[1]! * skyK + this.ground[1]! * groundK) * shadeK;
    let b = (this.sky[2]! * skyK + this.ground[2]! * groundK) * shadeK;

    if (!covered) {
      const ndl = nx * this.sunDir.x + ny * this.sunDir.y + nz * this.sunDir.z;
      if (ndl > 0) {
        r += this.sun[0]! * ndl;
        g += this.sun[1]! * ndl;
        b += this.sun[2]! * ndl;
      }
    }

    const near = this.lightsNear(x, z);
    if (near) {
      const L = this.lights;
      for (let i = 0; i < near.length; i++) {
        const o = near[i]! * 7;
        const dx = L[o]! - x;
        const dy = L[o + 1]! - y;
        const dz = L[o + 2]! - z;
        const d2 = dx * dx + dy * dy + dz * dz;
        const f = pointFalloff(d2, L[o + 3]!);
        if (f <= 0) continue;
        const inv = d2 > 1e-8 ? 1 / Math.sqrt(d2) : 0;
        // Wrapped Lambert (soft terminator) + a constant share standing in for bounced light.
        let lambert = ((nx * dx + ny * dy + nz * dz) * inv + 0.3) / 1.3;
        if (lambert < 0) lambert = 0;
        const k = f * (0.72 * lambert + 0.28);
        r += L[o + 4]! * k;
        g += L[o + 5]! * k;
        b += L[o + 6]! * k;
      }
    }

    out[0] = softClip(r);
    out[1] = softClip(g);
    out[2] = softClip(b);
  }

  /**
   * Omnidirectional light estimate at a position (dynamic objects: avatars, view model).
   * About 1.0 in open daylight or right under a lamp, lower in the shade.
   */
  sample(pos: Vec3, out: THREE.Color): THREE.Color {
    const x = pos.x;
    const y = pos.y + 1;
    const z = pos.z;
    const covered = this.covered(x, y, z);
    const skyK = 0.7 * (covered ? COVERED_SKY : 1);
    let r = this.sky[0]! * skyK + this.ground[0]! * 0.3;
    let g = this.sky[1]! * skyK + this.ground[1]! * 0.3;
    let b = this.sky[2]! * skyK + this.ground[2]! * 0.3;
    if (!covered) {
      r += this.sun[0]! * 0.6;
      g += this.sun[1]! * 0.6;
      b += this.sun[2]! * 0.6;
    }
    const near = this.lightsNear(x, z);
    if (near) {
      const L = this.lights;
      for (let i = 0; i < near.length; i++) {
        const o = near[i]! * 7;
        const dx = L[o]! - x;
        const dy = L[o + 1]! - y;
        const dz = L[o + 2]! - z;
        const f = pointFalloff(dx * dx + dy * dy + dz * dz, L[o + 3]!) * 0.8;
        if (f <= 0) continue;
        r += L[o + 4]! * f;
        g += L[o + 5]! * f;
        b += L[o + 6]! * f;
      }
    }
    // Keep dynamic objects readable in the darkest corners and avoid blow-outs.
    out.r = Math.min(1.35, Math.max(0.2, r));
    out.g = Math.min(1.35, Math.max(0.2, g));
    out.b = Math.min(1.35, Math.max(0.2, b));
    return out;
  }

  /** Number of point lights of the map. */
  get pointLightCount(): number {
    return this.lightCount;
  }
}
