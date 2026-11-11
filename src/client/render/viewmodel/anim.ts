/**
 * Small animation toolkit of the first-person weapon: damped springs (recoil, sway, follow-through)
 * and keyframed tracks (inspection, draw). Nothing here allocates once the data is authored.
 */

export const clampN = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const seg = (p: number, a: number, b: number): number => clampN((p - a) / (b - a), 0, 1);
export const smooth = (t: number): number => {
  const c = clampN(t, 0, 1);
  return c * c * (3 - 2 * c);
};
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** True on the frame where a timeline goes past `at`. */
export const hit = (prev: number, now: number, at: number): boolean => prev < at && now >= at;

/** Damped spring toward zero (or a target), driven by impulses. */
export class Spring {
  x = 0;
  v = 0;
  private k: number;
  private c: number;
  constructor(w: number, z: number) {
    this.k = w * w;
    this.c = 2 * z * w;
  }
  /** Natural frequency (rad/s) and damping ratio. */
  tune(w: number, z: number): void {
    this.k = w * w;
    this.c = 2 * z * w;
  }
  step(dt: number, target = 0): number {
    // Sub-steps keep the integration stable and frame-rate independent enough.
    const n = dt > 0.008 ? Math.ceil(dt / 0.008) : 1;
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += ((target - this.x) * this.k - this.v * this.c) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
  reset(x = 0): void {
    this.x = x;
    this.v = 0;
  }
}

/** Velocity that makes a spring (w, z) peak at `peak`. */
export function impulse(peak: number, w: number, z: number): number {
  const s = Math.sqrt(Math.max(1e-4, 1 - z * z));
  return (peak * w) / Math.exp((-z * Math.atan2(s, z)) / s);
}

// --- Keyframed tracks ---------------------------------------------------------------------
//
// A track is a list of rows [time, v1 … vn, ease?], sorted by time. The optional last number
// says how the segment that ENDS on the row is travelled.

/** Ease in and out: the default, a move that starts and stops softly. */
export const SMOOTH = 0;
/** Fast start, soft landing (a part released, a hand arriving). */
export const OUT = 1;
/** Soft start, hard stop (a part slammed home, a magazine seated). */
export const IN = 2;
/** Overshoots the key a little and comes back: follow-through. */
export const BACK = 3;
export const LINEAR = 4;
/** Long, lazy ease in and out (slow drifts while a pose is held). */
export const SOFT = 5;

export function ease(kind: number, t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  switch (kind) {
    case OUT: {
      const i = 1 - c;
      return 1 - i * i * i;
    }
    case IN:
      return c * c * c;
    case BACK: {
      const i = c - 1;
      return 1 + 2.2 * i * i * i + 1.2 * i * i;
    }
    case LINEAR:
      return c;
    case SOFT:
      return c * c * c * (c * (c * 6 - 15) + 10);
    default:
      return c * c * (3 - 2 * c);
  }
}

export type Track = readonly (readonly number[])[];

/** Segment of `rows` that contains `t` (index of its first row). */
export function segment(rows: readonly (readonly unknown[])[], t: number): number {
  const last = rows.length - 2;
  let i = 0;
  while (i < last && (rows[i + 1]![0] as number) <= t) i++;
  return i;
}

/** Sample the `n` values of a track at time `t` into `out`. */
export function sample(rows: Track, t: number, n: number, out: Float32Array): void {
  const count = rows.length;
  if (count === 0) {
    for (let k = 0; k < n; k++) out[k] = 0;
    return;
  }
  const first = rows[0]!;
  const end = rows[count - 1]!;
  if (count === 1 || t <= first[0]!) {
    for (let k = 0; k < n; k++) out[k] = first[k + 1]!;
    return;
  }
  if (t >= end[0]!) {
    for (let k = 0; k < n; k++) out[k] = end[k + 1]!;
    return;
  }
  const i = segment(rows, t);
  const a = rows[i]!;
  const b = rows[i + 1]!;
  const u = ease(b[n + 1] ?? SMOOTH, (t - a[0]!) / (b[0]! - a[0]!));
  for (let k = 0; k < n; k++) out[k] = a[k + 1]! + (b[k + 1]! - a[k + 1]!) * u;
}

const one = new Float32Array(1);
/** Sample a one-value track. */
export function sample1(rows: Track | undefined, t: number): number {
  if (!rows) return 0;
  sample(rows, t, 1, one);
  return one[0]!;
}
