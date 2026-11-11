/**
 * Interior floors: linoleum, ceramic tiles, carpet tiles, herringbone parquet, concrete.
 */
import { css, mix, mul, tone, WHITE, type Generator, type ModLayer, type Rgb } from '../painter';

/** Speckled laboratory linoleum: marbled base, light / dark chips, a welded seam every repeat. */
export function lino(): Generator {
  return (p) => {
    const b = p.base;
    const n = p.n;
    p.fill(b);
    p.mod([
      [p.cloud, 0.03],
      [p.mottle, 0.022],
      [p.bandH, 0.012], // faint mop streaks
    ]);
    // Chips of two sizes, lighter and darker than the base, plus a few warm ones.
    p.speck(p.micro, 0.5, 0.85, mix(b, WHITE, 0.5), 0.6);
    p.speck(p.micro, -0.5, -0.85, mul(b, 0.74), 0.6);
    p.speck(p.fine, 0.5, 0.72, mix(b, WHITE, 0.62), 0.85);
    p.speck(p.fine, -0.5, -0.72, tone(mul(b, 0.66), 1, 0.03), 0.85);
    p.speck(p.coarse, 0.66, 0.82, tone(mul(b, 0.8), 1, 0.07), 0.6);
    // Scuffed, slightly duller lanes.
    p.speck(p.patch, 0.3, 0.95, 0.965, 1);
    p.normalize();
    // Welded seam of the 2 m roll (on the tile border, so it lines up from tile to tile).
    const c = p.ctx;
    const w = Math.max(0.8, 1.1 * p.u);
    c.fillStyle = css(mul(b, 0.72), 0.5);
    c.fillRect(0, 0, w, n);
    c.fillRect(n - w, 0, w, n);
    c.fillStyle = css(mix(b, WHITE, 0.5), 0.3);
    c.fillRect(w, 0, w, n);
  };
}

export interface CeramicOptions {
  /** Tiles per repeat (per axis). */
  count: number;
  /** Joint width in metres. */
  joint: number;
  jointColor: Rgb;
  /** Tile colours; several entries make a checker. */
  colors: readonly Rgb[];
  /** Per-tile brightness variation (fraction). */
  vary: number;
  /** Strength of the glaze reflection (0 = matt stoneware). */
  gloss: number;
  /** Mottling of the tile body (stoneware speckle). */
  mottle: number;
}

/** Ceramic tiles with recessed joints, per-tile tone variation, bevelled edges and glaze. */
export function ceramic(o: CeramicOptions): Generator {
  return (p) => {
    const n = p.n;
    const s = n / o.count;
    const jw = Math.max(1, Math.round(o.joint * p.ppm));
    // Joints first: grout with dirt.
    p.fill(o.jointColor);
    p.mod([
      [p.mottle, 0.14],
      [p.grit, 0.07],
    ]);
    const c = p.ctx;
    const half = jw / 2;
    const r = Math.max(0.6, 1.4 * p.u);
    const e = Math.max(1, 1.5 * p.u);
    for (let j = 0; j < o.count; j++) {
      for (let i = 0; i < o.count; i++) {
        const x0 = Math.round(i * s) + half;
        const y0 = Math.round(j * s) + half;
        const x1 = Math.round((i + 1) * s) - half;
        const y1 = Math.round((j + 1) * s) - half;
        const w = x1 - x0;
        const h = y1 - y0;
        const ref = o.colors[(i + j) % o.colors.length]!;
        const col = tone(ref, 1 + (p.rng() - 0.5) * 2 * o.vary, (p.rng() - 0.5) * 0.02);
        c.fillStyle = css(col);
        c.beginPath();
        c.roundRect(x0, y0, w, h, r);
        c.fill();
        // Glaze: soft diagonal reflection.
        if (o.gloss > 0) {
          const g = c.createLinearGradient(x0, y0, x1, y1);
          g.addColorStop(0, `rgba(255,255,255,${0.5 * o.gloss})`);
          g.addColorStop(0.45, 'rgba(255,255,255,0)');
          g.addColorStop(1, `rgba(0,0,0,${0.3 * o.gloss})`);
          c.fillStyle = g;
          c.fill();
        }
        // Pillow edge: light catches the top / left edges, the others fall into shade.
        c.fillStyle = 'rgba(255,255,255,0.3)';
        c.fillRect(x0 + r, y0, w - 2 * r, e);
        c.fillRect(x0, y0 + r, e, h - 2 * r);
        c.fillStyle = 'rgba(0,0,0,0.13)';
        c.fillRect(x0 + r, y1 - e, w - 2 * r, e);
        c.fillRect(x1 - e, y0 + r, e, h - 2 * r);
      }
    }
    p.mod([
      [p.patch, 0.02],
      [p.coarse, o.mottle],
      [p.grit, 0.008],
    ]);
    if (o.mottle > 0.02) {
      p.speck(p.fine, 0.55, 0.8, 0.86, 0.7);
      p.speck(p.fine, -0.55, -0.8, 1.07, 0.7);
    }
    p.normalize();
  };
}

/** Short-pile carpet laid as 50 cm tiles with quarter-turned pile direction. */
export function carpet(): Generator {
  return (p) => {
    const n = p.n;
    const m = n - 1;
    const b = p.base;
    p.fill(b);
    const pileA = p.dashV; // fibres leaning along Y
    const pileB = p.dashH; // fibres leaning along X
    const grit = p.grit;
    const count = Math.round(p.tile / 0.5);
    const tones: number[] = [];
    for (let i = 0; i < count * count; i++) tones.push((p.rng() - 0.5) * 0.05);
    // Tuft rows: a ripple of 4 reference texels across the pile direction.
    const ripple = new Float32Array(n);
    if (p.u >= 0.5) for (let i = 0; i < n; i++) ripple[i] = (Math.floor(i / p.u) & 3) < 2 ? 0.018 : -0.018;
    const d = p.data;
    let q = 0;
    const o1 = 5 * (n >> 6);
    const o2 = 23 * (n >> 6);
    for (let y = 0; y < n; y++) {
      const ty = Math.floor((y * count) / n);
      const row = y * n;
      const row2 = ((y + o1) & m) * n;
      for (let x = 0; x < n; x++, q += 4) {
        const tx = Math.floor((x * count) / n);
        const flip = (tx + ty) & 1;
        const v = (flip ? pileA : pileB)[row2 + ((x + o2) & m)]!;
        const k = 1 + v * 0.17 + grit[row + x]! * 0.07 + ripple[flip ? x : y]! + tones[ty * count + tx]! + (flip ? 0.022 : -0.022);
        d[q] = d[q]! * k;
        d[q + 1] = d[q + 1]! * k;
        d[q + 2] = d[q + 2]! * k;
      }
    }
    // Lighter stray fibres and wear.
    p.speck(p.fleck, 0.72, 0.95, mix(b, WHITE, 0.4), 0.45);
    p.mod([[p.cloud, 0.04]]);
    p.normalize();
    // Tile seams.
    const c = p.ctx;
    c.fillStyle = 'rgba(0,0,0,0.22)';
    const w = Math.max(1, 1.2 * p.u);
    for (let i = 0; i < count; i++) {
      const t = Math.round((i * n) / count);
      c.fillRect(t - (i === 0 ? 0 : w / 2), 0, i === 0 ? w / 2 : w, n);
      c.fillRect(0, t - (i === 0 ? 0 : w / 2), n, i === 0 ? w / 2 : w);
    }
    c.fillRect(n - w / 2, 0, w / 2, n);
    c.fillRect(0, n - w / 2, n, w / 2);
  };
}

/** Oak herringbone parquet (bâtons rompus) laid at 45°, about 7 × 28 cm blocks. */
export function parquet(): Generator {
  return (p) => {
    const n = p.n;
    const b = p.base;
    p.fill(mul(b, 0.34)); // dark gaps between blocks
    const c = p.ctx;
    // Lattice of the pattern in block-width units: t1 = (1, 1), t2 = (4, -4).
    // Mapped to texels by (x, y) -> k (x + y, y - x): t1 -> (2k, 0), t2 -> (0, -8k).
    const reps = 5; // vertical periods per tile; 4 × reps horizontal ones
    const k = n / (8 * reps);
    const gap = 0.035;
    const drawBlock = (lx: number, ly: number, w: number, h: number, along: 0 | 1): void => {
      // Bounding box in texels of the rotated rectangle.
      const xs = [lx + ly, lx + w + ly, lx + ly + h, lx + w + ly + h];
      const ys = [ly - lx, ly - (lx + w), ly + h - lx, ly + h - (lx + w)];
      const minX = k * Math.min(...xs);
      const maxX = k * Math.max(...xs);
      const minY = k * Math.min(...ys);
      const maxY = k * Math.max(...ys);
      const col = tone(b, 1 + (p.rng() - 0.5) * 0.26, (p.rng() - 0.5) * 0.07);
      const streaks: [number, number, number, number, number][] = [];
      for (let i = 0; i < 7; i++) {
        streaks.push([p.rng(), p.rng() * 0.5, 0.4 + p.rng() * 0.6, p.rng() < 0.6 ? 0 : 1, 0.05 + p.rng() * 0.11]);
      }
      p.wrap(minX, minY, maxX, maxY, (dx, dy) => {
        c.save();
        c.setTransform(k, -k, k, k, dx, dy);
        c.fillStyle = css(col);
        c.fillRect(lx + gap, ly + gap, w - 2 * gap, h - 2 * gap);
        // Grain: thin streaks along the block.
        c.lineWidth = 0.05;
        for (const st of streaks) {
          c.strokeStyle = st[3] ? `rgba(255,236,200,${st[4]})` : `rgba(60,30,8,${st[4] * 1.5})`;
          c.beginPath();
          if (along === 0) {
            const yy = ly + gap + st[0] * (h - 2 * gap);
            c.moveTo(lx + gap + st[1] * w, yy);
            c.lineTo(lx + gap + Math.min(1, st[1] + st[2]) * (w - 2 * gap), yy);
          } else {
            const xx = lx + gap + st[0] * (w - 2 * gap);
            c.moveTo(xx, ly + gap + st[1] * h);
            c.lineTo(xx, ly + gap + Math.min(1, st[1] + st[2]) * (h - 2 * gap));
          }
          c.stroke();
        }
        c.restore();
      });
    };
    // The pattern repeats every (√2 w, 4√2 w) on screen: 4·reps columns × reps rows of
    // lattice cells, each holding one "horizontal" and one "vertical" block.
    for (let j = 0; j < reps; j++) {
      for (let i = 0; i < 4 * reps; i++) {
        const ox = i + 4 * j;
        const oy = i - 4 * j;
        drawBlock(ox, oy, 4, 1, 0);
        drawBlock(ox + 4, oy - 3, 1, 4, 1);
      }
    }
    p.mod([
      [p.cloud, 0.05],
      [p.coarse, 0.03],
      [p.grit, 0.015],
    ]);
    p.normalize();
  };
}

export interface ConcreteOptions {
  /** Mottling strength (0.04 polished … 0.09 raw). */
  rough: number;
  /** Darker stain patches (0..1). */
  stains: number;
  /** Number of hairline cracks. */
  cracks: number;
  /** Formwork panel seams and tie holes (raw wall concrete). */
  formwork?: boolean;
  /** Vertical run-off streaks. */
  streaks?: number;
}

/** Concrete: clouds of tone, pores, stains, hairline cracks, optional formwork marks. */
export function concrete(o: ConcreteOptions): Generator {
  return (p) => {
    const n = p.n;
    const b = p.base;
    p.fill(b);
    const layers: ModLayer[] = [
      [p.cloud, o.rough, 1, 1, 1],
      [p.mottle, o.rough * 0.7, 1.05, 1, 0.9],
      [p.fine, o.rough * 0.5, 1, 1, 1],
      [p.grit, 0.022, 1, 1, 1],
    ];
    if (o.streaks) layers.push([p.bandV, o.streaks, 1, 1, 1]);
    p.mod(layers);
    // Stains: soft dark patches with a slightly warmer tint, pale laitance patches.
    if (o.stains > 0) {
      p.speck(p.patch, 0.3, 0.95, tone(mul(b, 0.82), 1, 0.03), 0.42 * o.stains);
      p.speck(p.cloud, -0.35, -0.95, mix(b, WHITE, 0.25), 0.35 * o.stains);
      p.speck(p.mottle, 0.62, 0.9, mul(b, 0.76), 0.4 * o.stains);
    }
    // Pores and tiny aggregate.
    p.speck(p.micro, 0.7, 0.95, mul(b, 0.6), 0.6);
    p.speck(p.micro, -0.72, -0.95, mix(b, WHITE, 0.35), 0.4);
    p.normalize();

    const c = p.ctx;
    if (o.formwork) {
      // Shuttering panels 2 m × 1 m: seams, slight offset of tone, tie holes.
      const pw = 2 * p.ppm;
      const ph = 1 * p.ppm;
      const cols = Math.round(n / pw);
      const rowsN = Math.round(n / ph);
      for (let j = 0; j < rowsN; j++) {
        for (let i = 0; i < cols; i++) {
          c.fillStyle = p.rng() < 0.5 ? `rgba(0,0,0,${p.rng() * 0.05})` : `rgba(255,255,255,${p.rng() * 0.04})`;
          c.fillRect(i * pw, j * ph, pw, ph);
        }
      }
      const lw = Math.max(1, 1.3 * p.u);
      for (let j = 0; j < rowsN; j++) {
        const y = j * ph;
        p.wrap(0, y - lw, n, y + lw, (_dx, dy) => {
          c.fillStyle = 'rgba(0,0,0,0.3)';
          c.fillRect(0, y + dy - lw / 2, n, lw);
          c.fillStyle = 'rgba(255,255,255,0.14)';
          c.fillRect(0, y + dy + lw / 2, n, lw);
        });
      }
      for (let i = 0; i < cols; i++) {
        const x = i * pw;
        p.wrap(x - lw, 0, x + lw, n, (dx) => {
          c.fillStyle = 'rgba(0,0,0,0.26)';
          c.fillRect(x + dx - lw / 2, 0, lw, n);
          c.fillStyle = 'rgba(255,255,255,0.12)';
          c.fillRect(x + dx + lw / 2, 0, lw, n);
        });
      }
      // Tie holes: two per panel.
      const rr = 0.014 * p.ppm;
      for (let j = 0; j < rowsN; j++) {
        for (let i = 0; i < cols * 2; i++) {
          const x = (i + 0.5) * (pw / 2);
          const y = (j + 0.5) * ph;
          c.fillStyle = 'rgba(0,0,0,0.5)';
          c.beginPath();
          c.arc(x, y, rr, 0, Math.PI * 2);
          c.fill();
          c.strokeStyle = 'rgba(255,255,255,0.22)';
          c.lineWidth = Math.max(0.6, 0.9 * p.u);
          c.beginPath();
          c.arc(x, y + rr * 0.25, rr * 1.15, 0.1 * Math.PI, 0.9 * Math.PI);
          c.stroke();
        }
      }
    }
    for (let i = 0; i < o.cracks; i++) {
      p.crack(p.rand(0, n), p.rand(0, n), p.rand(0, Math.PI * 2), p.rand(0.12, 0.34) * n, 'rgba(20,20,18,0.42)', Math.max(0.7, 1.0 * p.u), 0.55);
    }
  };
}
