/**
 * Tileable noise fields shared by every texture generator.
 *
 * A field is a Float32Array of n × n values (row-major) that wraps around on both axes.
 * Fields are cached per (size, parameters): generators share a small palette of them and
 * read them at different offsets, so the cost of building a field is paid once per size.
 *
 * All fields are deterministic (seeded) and look the same at every resolution: the lattice
 * of octave k only depends on the seed, never on the texture size.
 */
import { hash3, mulberry32, type Rng } from '../../../shared/math/rng';

const cache = new Map<string, Float32Array>();
const cellCache = new Map<string, CellField>();

/** Drop every cached field (they are rebuilt on demand). */
export function clearNoiseCache(): void {
  cache.clear();
  cellCache.clear();
}

/** One octave of smooth value noise on a cx × cy lattice, added to `out`. */
function addOctave(out: Float32Array, n: number, cx: number, cy: number, amp: number, rng: Rng): void {
  const lat = new Float32Array(cx * cy);
  for (let i = 0; i < lat.length; i++) lat[i] = rng() * 2 - 1;

  const x0 = new Int32Array(n);
  const x1 = new Int32Array(n);
  const wx = new Float32Array(n);
  for (let x = 0; x < n; x++) {
    const t = (x * cx) / n;
    const i = Math.floor(t);
    const f = t - i;
    x0[x] = i % cx;
    x1[x] = (i + 1) % cx;
    wx[x] = f * f * (3 - 2 * f);
  }
  const row = new Float32Array(cx);
  let p = 0;
  for (let y = 0; y < n; y++) {
    const t = (y * cy) / n;
    const j = Math.floor(t);
    const f = t - j;
    const wy = f * f * (3 - 2 * f);
    const j0 = (j % cy) * cx;
    const j1 = ((j + 1) % cy) * cx;
    for (let i = 0; i < cx; i++) {
      const a = lat[j0 + i]!;
      row[i] = a + (lat[j1 + i]! - a) * wy;
    }
    for (let x = 0; x < n; x++) {
      const a = row[x0[x]!]!;
      out[p++] += amp * (a + (row[x1[x]!]! - a) * wx[x]!);
    }
  }
}

/** Centre the field and scale it so that 2.5 standard deviations = 1, clamped to [-1, 1]. */
function normalise(f: Float32Array): void {
  let sum = 0;
  let sum2 = 0;
  for (let i = 0; i < f.length; i++) {
    const v = f[i]!;
    sum += v;
    sum2 += v * v;
  }
  const mean = sum / f.length;
  const sd = Math.sqrt(Math.max(1e-12, sum2 / f.length - mean * mean));
  const k = 1 / (2.5 * sd);
  for (let i = 0; i < f.length; i++) {
    const v = (f[i]! - mean) * k;
    f[i] = v < -1 ? -1 : v > 1 ? 1 : v;
  }
}

/** Bilinear 2× enlargement of a wrapping field of size h × h. */
function upsample2(src: Float32Array, h: number): Float32Array {
  const n = h * 2;
  const out = new Float32Array(n * n);
  const m = h - 1;
  let p = 0;
  for (let y = 0; y < n; y++) {
    // Destination texel centre in source coordinates: (y + 0.5) / 2 - 0.5.
    const sy = (y - 1) >> 1;
    const wy = y & 1 ? 0.25 : 0.75;
    const r0 = (sy & m) * h;
    const r1 = ((sy + 1) & m) * h;
    for (let x = 0; x < n; x++) {
      const sx = (x - 1) >> 1;
      const wx = x & 1 ? 0.25 : 0.75;
      const xa = sx & m;
      const xb = (sx + 1) & m;
      const a = src[r0 + xa]! + (src[r0 + xb]! - src[r0 + xa]!) * wx;
      const b = src[r1 + xa]! + (src[r1 + xb]! - src[r1 + xa]!) * wx;
      out[p++] = a + (b - a) * wy;
    }
  }
  return out;
}

/**
 * Fractal value noise: `octaves` layers starting from a cx × cy lattice over the tile,
 * each octave twice as fine and `gain` times as strong. Different cx / cy give stretched
 * (anisotropic) noise: streaks, grain, brushed metal. Values in [-1, 1], zero mean.
 */
export function fbm(n: number, cx: number, cy: number, octaves: number, seed = 0, gain = 0.5): Float32Array {
  const key = `f|${n}|${cx}|${cy}|${octaves}|${seed}|${gain}`;
  let f = cache.get(key);
  if (f) return f;
  // Large textures: a field whose finest octave is still coarse is enlarged from the
  // half-size one (four times cheaper, visually identical).
  const finest = Math.max(cx, cy) * 2 ** (octaves - 1);
  if (n > 512 && finest * 4 <= n) {
    f = upsample2(fbm(n >> 1, cx, cy, octaves, seed, gain), n >> 1);
    cache.set(key, f);
    return f;
  }
  f = new Float32Array(n * n);
  let amp = 1;
  let fx = cx;
  let fy = cy;
  for (let o = 0; o < octaves; o++) {
    const rng = mulberry32(hash3(seed, o, cx * 4099 + cy));
    addOctave(f, n, Math.min(fx, n), Math.min(fy, n), amp, rng);
    if (fx >= n && fy >= n) break; // finer octaves would be the same white noise
    amp *= gain;
    fx *= 2;
    fy *= 2;
  }
  normalise(f);
  cache.set(key, f);
  return f;
}

/** Uniform white noise in [-1, 1], one value per texel. */
export function white(n: number, seed = 0): Float32Array {
  const key = `w|${n}|${seed}`;
  let f = cache.get(key);
  if (f) return f;
  f = new Float32Array(n * n);
  // Inlined xorshift32: this is the one field that needs a value per texel.
  let s = hash3(seed, n, 0x51ed) | 1;
  for (let i = 0; i < f.length; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    f[i] = (s >>> 8) * (2 / 16777216) - 1;
  }
  cache.set(key, f);
  return f;
}

/**
 * Relief shading of a height field lit from the top-left: bright on slopes facing the
 * light, dark on the others. `d` is the sampling distance in texels. Values in [-1, 1].
 */
export function emboss(n: number, height: Float32Array, key: string, d = 1): Float32Array {
  const k = `e|${n}|${key}|${d}`;
  let f = cache.get(k);
  if (f) return f;
  f = new Float32Array(n * n);
  const m = n - 1;
  let p = 0;
  for (let y = 0; y < n; y++) {
    const ra = ((y - d) & m) * n;
    const rb = ((y + d) & m) * n;
    for (let x = 0; x < n; x++) {
      f[p++] = height[rb + ((x + d) & m)]! - height[ra + ((x - d) & m)]!;
    }
  }
  normalise(f);
  cache.set(k, f);
  return f;
}

/** Cellular (Worley) noise: packed stones, clods. */
export interface CellField {
  /** Distance to the nearest feature point, in cell sizes (0 at the point, ~0.7 at corners). */
  d: Float32Array;
  /** Half the gap between the two nearest feature points, in cell sizes (0 on a border). */
  edge: Float32Array;
  /** Random value 0..1 of the cell the texel belongs to. */
  id: Float32Array;
}

export function cells(n: number, count: number, seed = 0, jitter = 0.85): CellField {
  const key = `${n}|${count}|${seed}|${jitter}`;
  let c = cellCache.get(key);
  if (c) return c;
  const rng = mulberry32(hash3(seed, count, 0xce11));
  const px = new Float32Array(count * count);
  const py = new Float32Array(count * count);
  const pid = new Float32Array(count * count);
  for (let i = 0; i < px.length; i++) {
    px[i] = 0.5 + (rng() - 0.5) * jitter;
    py[i] = 0.5 + (rng() - 0.5) * jitter;
    pid[i] = rng();
  }
  const d = new Float32Array(n * n);
  const edge = new Float32Array(n * n);
  const id = new Float32Array(n * n);
  const inv = count / n;
  // Candidate points of the 3 × 3 neighbourhood, gathered once per cell.
  const candX = new Float32Array(9);
  const candY = new Float32Array(9);
  const candId = new Float32Array(9);
  for (let cy = 0; cy < count; cy++) {
    const y0 = Math.ceil(cy / inv - 0.5);
    const y1 = Math.min(n, Math.ceil((cy + 1) / inv - 0.5));
    for (let cx = 0; cx < count; cx++) {
      let k = 0;
      for (let j = -1; j <= 1; j++) {
        const row = ((cy + j + count) % count) * count;
        for (let i = -1; i <= 1; i++) {
          const q = row + ((cx + i + count) % count);
          candX[k] = cx + i + px[q]!;
          candY[k] = cy + j + py[q]!;
          candId[k] = pid[q]!;
          k++;
        }
      }
      const x0 = Math.ceil(cx / inv - 0.5);
      const x1 = Math.min(n, Math.ceil((cx + 1) / inv - 0.5));
      for (let y = Math.max(0, y0); y < y1; y++) {
        const gy = (y + 0.5) * inv;
        let p = y * n + Math.max(0, x0);
        for (let x = Math.max(0, x0); x < x1; x++, p++) {
          const gx = (x + 0.5) * inv;
          let d1 = 1e9;
          let d2 = 1e9;
          let best = 0;
          for (let q = 0; q < 9; q++) {
            const dx = candX[q]! - gx;
            const dy = candY[q]! - gy;
            const dd = dx * dx + dy * dy;
            if (dd < d1) {
              d2 = d1;
              d1 = dd;
              best = q;
            } else if (dd < d2) {
              d2 = dd;
            }
          }
          const a = Math.sqrt(d1);
          d[p] = a;
          edge[p] = (Math.sqrt(d2) - a) * 0.5;
          id[p] = candId[best]!;
        }
      }
    }
  }
  c = { d, edge, id };
  cellCache.set(key, c);
  return c;
}
