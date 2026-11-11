/**
 * Small lighting helpers shared by every lighting path (phase-1 vertex lighting, the
 * light-map baker, the geometry emitters). Pure TypeScript: no DOM, no THREE, so the
 * baker can run under Node (unit tests) as well as in the browser.
 *
 * All light values are linear RGB; 1.0 means "the texture at its authored brightness".
 */

/** Surface lighting provider used by the geometry emitters (boxes, prims and signs). */
export interface SurfaceShader {
  /** Linear RGB light reaching the surface point (x, y, z) with unit normal (nx, ny, nz). */
  shade(x: number, y: number, z: number, nx: number, ny: number, nz: number, out: Float32Array): void;
}

/** sRGB-encoded channel (0..1) -> linear. */
export const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** Linear channel (0..1) -> sRGB-encoded. */
export const linearToSrgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** 0xRRGGBB (sRGB) -> linear RGB triple. */
export function hexToLinear(hex: number, out: Float32Array | number[]): void {
  out[0] = srgbToLinear(((hex >> 16) & 255) / 255);
  out[1] = srgbToLinear(((hex >> 8) & 255) / 255);
  out[2] = srgbToLinear((hex & 255) / 255);
}

const FALLOFF_K = 0.22;

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
