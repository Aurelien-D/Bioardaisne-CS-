/**
 * Painter: the drawing surface handed to every texture generator.
 *
 * It wraps one square canvas and offers two ways of drawing that can be mixed freely:
 *  - vector drawing through `ctx` (canvas 2D: rectangles, paths, gradients, text), with
 *    `wrap()` to repeat a shape across the tile borders so that the result is seamless;
 *  - per-texel passes fed by the tileable noise fields of noise.ts: `mod()`, `speck()`,
 *    `rows()`, `cols()`, `normalize()`, or direct access to the pixel buffer (`data`).
 *
 * The per-texel passes are queued and run together, row by row, the next time the canvas
 * or the pixel buffer is needed: reading and writing the 8-bit buffer is the expensive
 * part, so five queued passes cost little more than one.
 * ALWAYS go through `p.ctx` / `p.data` again after queuing passes instead of keeping an
 * old reference: the getters are what flushes the queue.
 *
 * Units: `n` texels per repeat, `tile` metres per repeat, `ppm` texels per metre and
 * `u` = n / 512 ("reference texel": sizes written for a 512 texture are multiplied by u).
 * Everything random comes from `rng` (seeded by the material id): never Math.random.
 */
import { MATERIALS, type MaterialId } from '../../../shared/maps/materials';
import { hash3, mulberry32, type Rng } from '../../../shared/math/rng';
import { cells, emboss, fbm, white, type CellField } from './noise';

/** Colour as [r, g, b], each 0..255 (floats allowed). */
export type Rgb = readonly [number, number, number];

export const hex = (h: number): Rgb => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

/** Linear blend from a (t = 0) to b (t = 1). */
export const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Brightness scale. */
export const mul = (a: Rgb, k: number): Rgb => [a[0] * k, a[1] * k, a[2] * k];

/** Brightness scale plus a warm (+) / cool (-) shift. */
export const tone = (a: Rgb, k: number, warm = 0): Rgb => [a[0] * k * (1 + warm), a[1] * k, a[2] * k * (1 - warm)];

export const WHITE: Rgb = [255, 255, 255];

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** CSS colour string. */
export const css = (c: Rgb, alpha = 1): string =>
  alpha >= 1 ? `rgb(${clamp255(c[0])},${clamp255(c[1])},${clamp255(c[2])})` : `rgba(${clamp255(c[0])},${clamp255(c[1])},${clamp255(c[2])},${alpha})`;

export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** sRGB byte -> linear 0..1. */
const TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Brightness layer of `mod()`: [field, amplitude] or [field, amplitude, wr, wg, wb] where
 * the weights scale the amplitude per channel (colour shift, e.g. warm stains).
 */
export type ModLayer = readonly [Float32Array, number] | readonly [Float32Array, number, number, number, number];

const enum OpKind {
  Mod,
  Speck,
  Rows,
  Cols,
  Norm,
  Gain,
}

interface ModOp {
  kind: OpKind.Mod;
  mono: boolean;
  fields: Float32Array[];
  ox: Int32Array;
  oy: Int32Array;
  ar: Float64Array;
  ag: Float64Array;
  ab: Float64Array;
}
interface SpeckOp {
  kind: OpKind.Speck;
  field: Float32Array;
  ox: number;
  oy: number;
  lo: number;
  inv: number;
  alpha: number;
  isMul: boolean;
  cr: number;
  cg: number;
  cb: number;
  km: number;
}
interface LineOp {
  kind: OpKind.Rows | OpKind.Cols;
  gain: Float32Array;
}
interface NormOp {
  kind: OpKind.Norm;
  target: Rgb;
  limit: number;
}
interface GainOp {
  kind: OpKind.Gain;
  gr: number;
  gg: number;
  gb: number;
}
type Op = ModOp | SpeckOp | LineOp | NormOp | GainOp;

export class Painter {
  readonly id: MaterialId;
  /** Texture size in texels. */
  readonly n: number;
  /** Metres covered by one repeat. */
  readonly tile: number;
  /** Texels per metre. */
  readonly ppm: number;
  /** n / 512. */
  readonly u: number;
  /** Reference colour of the material. */
  readonly base: Rgb;
  readonly seed: number;
  readonly rng: Rng;
  readonly canvas: HTMLCanvasElement;

  private readonly c2d: CanvasRenderingContext2D;
  private img: ImageData | null = null;
  /** Colour of the whole canvas while nothing but fill() has touched it. */
  private flat: Rgb | null = null;
  private readonly ops: Op[] = [];
  private layer = 0;
  // Row buffers of the pass runner.
  private readonly R: Float64Array;
  private readonly G: Float64Array;
  private readonly B: Float64Array;
  private readonly K: Float64Array;
  private readonly K2: Float64Array;
  private readonly K3: Float64Array;

  constructor(id: MaterialId, n: number) {
    this.id = id;
    this.n = n;
    this.tile = MATERIALS[id].tile ?? 1;
    this.ppm = n / this.tile;
    this.u = n / 512;
    this.base = hex(MATERIALS[id].color);
    this.seed = hashString(id);
    this.rng = mulberry32(this.seed);
    this.canvas = document.createElement('canvas');
    this.canvas.width = n;
    this.canvas.height = n;
    const c = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!c) throw new Error('Canvas 2D indisponible');
    this.c2d = c;
    this.R = new Float64Array(n);
    this.G = new Float64Array(n);
    this.B = new Float64Array(n);
    this.K = new Float64Array(n);
    this.K2 = new Float64Array(n);
    this.K3 = new Float64Array(n);
  }

  // ------------------------------------------------------------------ surfaces

  /** Canvas 2D context (runs the queued passes and writes the pixel buffer back first). */
  get ctx(): CanvasRenderingContext2D {
    this.flush();
    this.flat = null;
    return this.c2d;
  }

  /** RGBA pixel buffer of the whole texture, with every queued pass applied. */
  get data(): Uint8ClampedArray {
    this.run();
    return this.load().data;
  }

  /** Run the queued passes and write the pixel buffer back to the canvas. */
  flush(): void {
    this.run();
    if (this.img) {
      this.c2d.putImageData(this.img, 0, 0);
      this.img = null;
    }
  }

  private load(): ImageData {
    if (!this.img) {
      this.img = this.c2d.getImageData(0, 0, this.n, this.n);
      this.flat = null;
    }
    return this.img;
  }

  // ------------------------------------------------------------------ random helpers

  /** Random float in [a, b). */
  rand(a = 0, b = 1): number {
    return a + this.rng() * (b - a);
  }

  /** Next field offset: a multiple of n / 64 so that every resolution reads the same place. */
  private nextOffset(): number {
    const h = hash3(this.seed, this.layer++, 0x0ff5);
    return (h & 63) * (this.n >> 6);
  }

  // ------------------------------------------------------------------ noise fields
  //
  // A small shared palette: every generator reads the same few fields at its own offsets.
  // Sizes are in lattice cells per repeat; "H" fields are streaks running along X
  // (horizontal lines), "V" fields run along Y.

  /** Large soft blotches (3 per repeat). */
  get cloud(): Float32Array {
    return fbm(this.n, 3, 3, 4);
  }
  /** Patches (7 per repeat). */
  get patch(): Float32Array {
    return fbm(this.n, 7, 7, 3);
  }
  /** Mottling (20 per repeat). */
  get mottle(): Float32Array {
    return fbm(this.n, 20, 20, 3);
  }
  /** Coarse grain (56 per repeat). */
  get coarse(): Float32Array {
    return fbm(this.n, 56, 56, 2);
  }
  /** Fine grain (128 per repeat). */
  get fine(): Float32Array {
    return fbm(this.n, 128, 128, 2);
  }
  /** Flecks about two reference texels wide (256 per repeat). */
  get fleck(): Float32Array {
    return fbm(this.n, 256, 256, 1);
  }
  /** Smallest dots (384 per repeat). */
  get micro(): Float32Array {
    return fbm(this.n, 384, 384, 1);
  }
  /** White noise, one value per texel. */
  get grit(): Float32Array {
    return white(this.n);
  }
  /** Relief (lit from the top-left) of the coarse grain: lumps. */
  get lumps(): Float32Array {
    return emboss(this.n, this.coarse, 'coarse');
  }
  /** Relief of the fine grain: bumps. */
  get bumps(): Float32Array {
    return emboss(this.n, this.fine, 'fine');
  }
  /** Relief of the flecks: stipple, orange peel. */
  get stipple(): Float32Array {
    return emboss(this.n, this.fleck, 'fleck');
  }
  /** Long thin horizontal lines (brushing, grain). */
  get streakH(): Float32Array {
    return fbm(this.n, 3, 200, 2);
  }
  /** Broad horizontal bands. */
  get bandH(): Float32Array {
    return fbm(this.n, 3, 24, 3);
  }
  /** Short horizontal dashes. */
  get dashH(): Float32Array {
    return fbm(this.n, 56, 256, 1);
  }
  /** Long thin vertical lines. */
  get streakV(): Float32Array {
    return fbm(this.n, 200, 3, 2);
  }
  /** Vertical run-off streaks. */
  get bandV(): Float32Array {
    return fbm(this.n, 28, 3, 3);
  }
  /** Short vertical dashes. */
  get dashV(): Float32Array {
    return fbm(this.n, 256, 56, 1);
  }

  /** Any other fractal noise field (cached and shared like the palette above). */
  fbm(cx: number, cy = cx, octaves = 3, _variant = 0): Float32Array {
    return fbm(this.n, cx, cy, octaves);
  }

  /** White noise field (one value per texel). */
  white(_variant = 0): Float32Array {
    return white(this.n);
  }

  /** Relief (embossed, lit from the top-left) of a fractal noise field. */
  relief(cx: number, cy = cx, octaves = 2, _variant = 0): Float32Array {
    return emboss(this.n, fbm(this.n, cx, cy, octaves), `r${cx}_${cy}_${octaves}`);
  }

  cells(count: number, seed = 0, jitter = 0.85): CellField {
    return cells(this.n, count, seed, jitter);
  }

  // ------------------------------------------------------------------ vector helpers

  /** Fill the whole texture with a colour. */
  fill(c: Rgb): this {
    const ctx = this.ctx;
    ctx.fillStyle = css(c);
    ctx.fillRect(0, 0, this.n, this.n);
    this.flat = [clamp255(c[0]), clamp255(c[1]), clamp255(c[2])];
    return this;
  }

  /**
   * Seamless drawing: calls `draw(dx, dy)` for every periodic copy of the bounding box
   * [x0, x1] × [y0, y1] (texels) that touches the tile. The callback must offset what it
   * draws by (dx, dy).
   */
  wrap(x0: number, y0: number, x1: number, y1: number, draw: (dx: number, dy: number) => void): void {
    const n = this.n;
    // Bring the box origin into the tile, then walk back over the copies that still touch it.
    const sx = -Math.floor(x0 / n) * n;
    const sy = -Math.floor(y0 / n) * n;
    for (let dy = sy; y1 + dy > 0; dy -= n) {
      for (let dx = sx; x1 + dx > 0; dx -= n) draw(dx, dy);
    }
  }

  /** Same as wrap(), translating the context instead of passing the offset. */
  wrapCtx(x0: number, y0: number, x1: number, y1: number, draw: (c: CanvasRenderingContext2D) => void): void {
    const c = this.ctx;
    this.wrap(x0, y0, x1, y1, (dx, dy) => {
      if (dx === 0 && dy === 0) {
        draw(c);
      } else {
        c.save();
        c.translate(dx, dy);
        draw(c);
        c.restore();
      }
    });
  }

  /**
   * Hairline crack: a wandering polyline starting at (x, y) texels. `len` and `width` in
   * texels, `wander` in radians per step, `branch` = chance of a side crack.
   */
  crack(x: number, y: number, angle: number, len: number, color: string, width: number, wander = 0.5, branch = 0.25): void {
    const pts: number[] = [x, y];
    const step = Math.max(2, 5 * this.u);
    let a = angle;
    let cx = x;
    let cy = y;
    let minX = x;
    let maxX = x;
    let minY = y;
    let maxY = y;
    const steps = Math.max(2, Math.round(len / step));
    const forks: [number, number, number, number][] = [];
    for (let i = 0; i < steps; i++) {
      a += (this.rng() - 0.5) * wander;
      cx += Math.cos(a) * step;
      cy += Math.sin(a) * step;
      pts.push(cx, cy);
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;
      if (branch > 0 && this.rng() < branch / steps) forks.push([cx, cy, a + (this.rng() < 0.5 ? 0.7 : -0.7), len * 0.35]);
    }
    this.wrapCtx(minX - 2, minY - 2, maxX + 2, maxY + 2, (c) => {
      c.strokeStyle = color;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      // Three overlapping strokes of decreasing length: the crack thins out toward its end.
      for (let k = 0; k < 3; k++) {
        const count = Math.max(2, Math.round(((3 - k) / 3) * (pts.length / 2)));
        c.lineWidth = width * (0.55 + 0.3 * k);
        c.beginPath();
        c.moveTo(pts[0]!, pts[1]!);
        for (let i = 1; i < count; i++) c.lineTo(pts[i * 2]!, pts[i * 2 + 1]!);
        c.stroke();
      }
    });
    for (const f of forks) this.crack(f[0], f[1], f[2], f[3], color, width * 0.7, wander, 0);
  }

  // ------------------------------------------------------------------ per-texel passes (queued)

  /**
   * Brightness modulation: every texel is multiplied by 1 + Σ amplitude × field.
   * Each layer reads its field at its own pseudo-random offset.
   */
  mod(layers: readonly ModLayer[]): this {
    const L = layers.length;
    const op: ModOp = {
      kind: OpKind.Mod,
      mono: true,
      fields: [],
      ox: new Int32Array(L),
      oy: new Int32Array(L),
      ar: new Float64Array(L),
      ag: new Float64Array(L),
      ab: new Float64Array(L),
    };
    for (let l = 0; l < L; l++) {
      const layer = layers[l]!;
      op.fields.push(layer[0]);
      const a = layer[1];
      const wr = layer.length > 2 ? (layer[2] as number) : 1;
      const wg = layer.length > 2 ? (layer[3] as number) : 1;
      const wb = layer.length > 2 ? (layer[4] as number) : 1;
      op.ar[l] = a * wr;
      op.ag[l] = a * wg;
      op.ab[l] = a * wb;
      if (wr !== 1 || wg !== 1 || wb !== 1) op.mono = false;
      op.ox[l] = this.nextOffset();
      op.oy[l] = this.nextOffset();
    }
    this.ops.push(op);
    return this;
  }

  /**
   * Threshold blend: where the field goes from `lo` to `hi` the texel fades toward
   * `color` (Rgb) or is multiplied by it (number), up to `alpha`. `lo` > `hi` selects the
   * low side of the field. Used for flecks, pores, stains, lichen…
   */
  speck(field: Float32Array, lo: number, hi: number, color: Rgb | number, alpha = 1): this {
    const isMul = typeof color === 'number';
    this.ops.push({
      kind: OpKind.Speck,
      field,
      ox: this.nextOffset(),
      oy: this.nextOffset(),
      lo,
      inv: 1 / (hi - lo),
      alpha,
      isMul,
      cr: isMul ? 0 : (color as Rgb)[0],
      cg: isMul ? 0 : (color as Rgb)[1],
      cb: isMul ? 0 : (color as Rgb)[2],
      km: isMul ? (color as number) - 1 : 0,
    });
    return this;
  }

  /** Multiply every row by gain(v), v = 0 at the top of the texture and 1 at the bottom. */
  rows(gain: (v: number) => number): this {
    const g = new Float32Array(this.n);
    for (let y = 0; y < this.n; y++) g[y] = gain(y / this.n);
    this.ops.push({ kind: OpKind.Rows, gain: g });
    return this;
  }

  /** Multiply every column by gain(u), u = 0 at the left of the texture and 1 at the right. */
  cols(gain: (u: number) => number): this {
    const g = new Float32Array(this.n);
    for (let x = 0; x < this.n; x++) g[x] = gain(x / this.n);
    this.ops.push({ kind: OpKind.Cols, gain: g });
    return this;
  }

  /**
   * Rescale the channels so that the mean colour (in linear light) matches `target`
   * (default: the reference colour of the material). The correction is limited to
   * `limit` (1.5 = at most +50 % / -33 % on the encoded values) so that it cannot hide a
   * broken generator.
   */
  normalize(target: Rgb = this.base, limit = 1.5): this {
    this.ops.push({ kind: OpKind.Norm, target, limit });
    return this;
  }

  // ------------------------------------------------------------------ pass runner

  /** Execute the queued passes over the pixel buffer. */
  private run(): void {
    const ops = this.ops;
    if (ops.length === 0) return;
    const n = this.n;
    const flat = this.flat;
    let d: Uint8ClampedArray;
    if (flat && !this.img) {
      // Nothing but a flat fill so far: no need to read the canvas back.
      this.img = this.c2d.createImageData(n, n);
      d = this.img.data;
      new Uint32Array(d.buffer).fill(0xff000000);
    } else {
      d = this.load().data;
    }
    const R = this.R;
    const G = this.G;
    const B = this.B;

    // Resolve normalisations: measure the mean of what precedes them on a subset of rows.
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]!;
      if (op.kind !== OpKind.Norm) continue;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let count = 0;
      const stride = n >= 512 ? 7 : 3; // odd: walks through every phase of regular patterns
      for (let y = (stride >> 1) % n; y < n; y += stride) {
        this.runRow(d, y, ops, i, flat);
        for (let x = 0; x < n; x += 2) {
          sr += TO_LINEAR[clamp255(R[x]!)]!;
          sg += TO_LINEAR[clamp255(G[x]!)]!;
          sb += TO_LINEAR[clamp255(B[x]!)]!;
          count++;
        }
      }
      const means = [sr / count, sg / count, sb / count];
      const gains: number[] = [];
      for (let ch = 0; ch < 3; ch++) {
        const want = Math.max(1e-4, TO_LINEAR[clamp255(op.target[ch]!)]!);
        // Gain on sRGB-encoded values that produces the wanted gain in linear light.
        let g = Math.pow(want / Math.max(1e-4, means[ch]!), 1 / 2.2);
        if (g > op.limit) g = op.limit;
        if (g < 1 / op.limit) g = 1 / op.limit;
        gains.push(g);
      }
      ops[i] = { kind: OpKind.Gain, gr: gains[0]!, gg: gains[1]!, gb: gains[2]! };
    }

    let p = 0;
    for (let y = 0; y < n; y++) {
      this.runRow(d, y, ops, ops.length, flat);
      for (let x = 0; x < n; x++, p += 4) {
        d[p] = R[x]!;
        d[p + 1] = G[x]!;
        d[p + 2] = B[x]!;
      }
    }
    ops.length = 0;
    this.flat = null;
  }

  /** Load row y into the R / G / B buffers and apply the first `count` passes to it. */
  private runRow(d: Uint8ClampedArray, y: number, ops: readonly Op[], count: number, flat: Rgb | null): void {
    const n = this.n;
    const m = n - 1;
    const R = this.R;
    const G = this.G;
    const B = this.B;
    if (flat) {
      R.fill(flat[0]);
      G.fill(flat[1]);
      B.fill(flat[2]);
    } else {
      let p = y * n * 4;
      for (let x = 0; x < n; x++, p += 4) {
        R[x] = d[p]!;
        G[x] = d[p + 1]!;
        B[x] = d[p + 2]!;
      }
    }
    for (let i = 0; i < count; i++) {
      const op = ops[i]!;
      switch (op.kind) {
        case OpKind.Mod: {
          const K = this.K;
          const L = op.fields.length;
          if (op.mono) {
            K.fill(1);
            for (let l = 0; l < L; l++) {
              const f = op.fields[l]!;
              const a = op.ar[l]!;
              const row = ((y + op.oy[l]!) & m) * n;
              const o = op.ox[l]!;
              for (let x = 0; x < n; x++) K[x]! += f[row + ((x + o) & m)]! * a;
            }
            for (let x = 0; x < n; x++) {
              const k = K[x]!;
              R[x]! *= k;
              G[x]! *= k;
              B[x]! *= k;
            }
          } else {
            const K2 = this.K2;
            const K3 = this.K3;
            K.fill(1);
            K2.fill(1);
            K3.fill(1);
            for (let l = 0; l < L; l++) {
              const f = op.fields[l]!;
              const ar = op.ar[l]!;
              const ag = op.ag[l]!;
              const ab = op.ab[l]!;
              const row = ((y + op.oy[l]!) & m) * n;
              const o = op.ox[l]!;
              for (let x = 0; x < n; x++) {
                const v = f[row + ((x + o) & m)]!;
                K[x]! += v * ar;
                K2[x]! += v * ag;
                K3[x]! += v * ab;
              }
            }
            for (let x = 0; x < n; x++) {
              R[x]! *= K[x]!;
              G[x]! *= K2[x]!;
              B[x]! *= K3[x]!;
            }
          }
          break;
        }
        case OpKind.Speck: {
          const f = op.field;
          const row = ((y + op.oy) & m) * n;
          const o = op.ox;
          const lo = op.lo;
          const inv = op.inv;
          const alpha = op.alpha;
          if (op.isMul) {
            const km = op.km;
            for (let x = 0; x < n; x++) {
              let t = (f[row + ((x + o) & m)]! - lo) * inv;
              if (t <= 0) continue;
              if (t > 1) t = 1;
              const k = 1 + km * t * t * (3 - 2 * t) * alpha;
              R[x]! *= k;
              G[x]! *= k;
              B[x]! *= k;
            }
          } else {
            const cr = op.cr;
            const cg = op.cg;
            const cb = op.cb;
            for (let x = 0; x < n; x++) {
              let t = (f[row + ((x + o) & m)]! - lo) * inv;
              if (t <= 0) continue;
              if (t > 1) t = 1;
              t = t * t * (3 - 2 * t) * alpha;
              R[x]! += (cr - R[x]!) * t;
              G[x]! += (cg - G[x]!) * t;
              B[x]! += (cb - B[x]!) * t;
            }
          }
          break;
        }
        case OpKind.Rows: {
          const k = op.gain[y]!;
          for (let x = 0; x < n; x++) {
            R[x]! *= k;
            G[x]! *= k;
            B[x]! *= k;
          }
          break;
        }
        case OpKind.Cols: {
          const g = op.gain;
          for (let x = 0; x < n; x++) {
            const k = g[x]!;
            R[x]! *= k;
            G[x]! *= k;
            B[x]! *= k;
          }
          break;
        }
        case OpKind.Gain: {
          const gr = op.gr;
          const gg = op.gg;
          const gb = op.gb;
          for (let x = 0; x < n; x++) {
            R[x]! *= gr;
            G[x]! *= gg;
            B[x]! *= gb;
          }
          break;
        }
        case OpKind.Norm:
          break; // resolved into a Gain before the rows are written
      }
    }
  }
}

/** A texture generator draws one material on a painter. */
export type Generator = (p: Painter) => void;
