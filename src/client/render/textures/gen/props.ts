/**
 * Prop materials: metals, woods, laminates, plastics, rubber, fabrics, cardboard, paper.
 */
import { css, hex, mix, mul, tone, WHITE, type Generator, type ModLayer } from '../painter';

// ------------------------------------------------------------------------------- metals

/** Brushed stainless steel: fine streaks along U and soft reflection bands across them. */
export function brushedSteel(): Generator {
  return (p) => {
    p.fill(p.base);
    p.mod([
      [p.streakH, 0.085],
      [p.dashH, 0.05],
      [p.bandH, 0.03],
      [p.fbm(3, 1, 2), 0.035, 0.8, 1, 1.25], // broad bluish reflection bands
      [p.cloud, 0.015],
    ]);
    p.normalize();
    // A few longer scratches.
    const c = p.ctx;
    c.lineWidth = Math.max(0.6, 0.8 * p.u);
    for (let i = 0; i < 26; i++) {
      const y = p.rand(0, p.n);
      const x = p.rand(0, p.n);
      const l = p.rand(0.08, 0.4) * p.n;
      c.strokeStyle = p.rng() < 0.6 ? `rgba(255,255,255,${p.rand(0.12, 0.3)})` : `rgba(40,45,50,${p.rand(0.1, 0.22)})`;
      p.wrap(x, y - 1, x + l, y + 1, (dx, dy) => {
        c.beginPath();
        c.moveTo(x + dx, y + dy);
        c.lineTo(x + l + dx, y + dy);
        c.stroke();
      });
    }
  };
}

/** White enamelled sheet metal: smooth, with slow cool reflections and a hint of orange peel. */
export function enamel(): Generator {
  return (p) => {
    p.fill(p.base);
    p.mod([
      [p.cloud, 0.016, 1.5, 1, 0.3],
      [p.fbm(1, 3, 2), 0.014, 1.4, 1, 0.4],
      [p.stipple, 0.006],
    ]);
    p.normalize();
  };
}

export interface PaintedMetalOptions {
  /** Orange-peel / casting relief (0.012 smooth paint … 0.05 cast iron). */
  rough: number;
  /** Chips and scratches density 0..1. */
  wear: number;
}

/** Painted metal: even coat with sheen, fine relief, sparse chips and scratches. */
export function paintedMetal(o: PaintedMetalOptions): Generator {
  return (p) => {
    const b = p.base;
    const n = p.n;
    const lum = (b[0] + b[1] + b[2]) / 3;
    const k = lum < 90 ? 1.7 : 1; // dark paints need more relative contrast to read
    const cast = o.rough > 0.03;
    p.fill(b);
    p.mod([
      [p.cloud, 0.022 * k],
      [p.fbm(1, 3, 2), 0.02 * k],
      [cast ? p.bumps : p.stipple, o.rough * k],
      [p.mottle, 0.012 * k],
      [p.grit, 0.008 * k],
    ]);
    if (cast) p.speck(p.fine, 0.5, 0.85, 0.84, 0.8); // pitted skin of cast iron
    if (o.wear > 0) {
      // Chips down to primer / bare metal, mostly tiny; grime in slow patches.
      const chip = lum < 110 ? mix(b, hex(0x9a9c9c), 0.6) : mul(b, 0.62);
      p.speck(p.coarse, 0.8, 0.93, chip, 0.75 * o.wear);
      p.speck(p.patch, 0.1, 1, 0.95, o.wear);
    }
    p.normalize();
    if (o.wear > 0) {
      const c = p.ctx;
      const count = Math.round(14 * o.wear);
      for (let i = 0; i < count; i++) {
        const x = p.rand(0, n);
        const y = p.rand(0, n);
        const a = p.rand(-0.5, 0.5) + (p.rng() < 0.3 ? Math.PI / 2 : 0);
        const l = p.rand(0.03, 0.16) * n;
        c.strokeStyle = lum < 110 ? `rgba(220,225,230,${p.rand(0.12, 0.3)})` : `rgba(20,20,20,${p.rand(0.1, 0.22)})`;
        c.lineWidth = Math.max(0.6, 0.9 * p.u);
        const x1 = x + Math.cos(a) * l;
        const y1 = y + Math.sin(a) * l;
        p.wrap(Math.min(x, x1), Math.min(y, y1) - 1, Math.max(x, x1), Math.max(y, y1) + 1, (dx, dy) => {
          c.beginPath();
          c.moveTo(x + dx, y + dy);
          c.lineTo(x1 + dx, y1 + dy);
          c.stroke();
        });
      }
    }
  };
}

/** Steel grating seen from above: bearing bars, cross rods and the dark void beneath. */
export function grate(): Generator {
  return (p) => {
    const n = p.n;
    const b = p.base;
    const bar = mix(b, WHITE, 0.42);
    const c = p.ctx;
    c.fillStyle = css(mul(b, 0.2));
    c.fillRect(0, 0, n, n);
    const cross = 4; // cross rods per repeat (12.5 cm)
    const bars = 16; // bearing bars per repeat (3.1 cm)
    const ch = n / cross;
    const bw = n / bars;
    // Void between the bars, a touch lighter toward the top of each opening (depth cue).
    for (let j = 0; j < cross; j++) {
      const g = c.createLinearGradient(0, j * ch, 0, (j + 1) * ch);
      g.addColorStop(0, css(mul(b, 0.42)));
      g.addColorStop(0.35, css(mul(b, 0.22)));
      g.addColorStop(1, css(mul(b, 0.14)));
      c.fillStyle = g;
      c.fillRect(0, j * ch, n, ch);
    }
    // Bearing bars (vertical): bright top edge, darker flank.
    const t = Math.max(2, bw * 0.3);
    for (let i = 0; i < bars; i++) {
      const x = Math.round((i + 0.5) * bw - t / 2);
      c.fillStyle = css(mul(bar, 0.62));
      c.fillRect(x + t, 0, Math.max(1, t * 0.45), n); // visible side of the bar
      c.fillStyle = css(bar);
      c.fillRect(x, 0, t, n);
      c.fillStyle = 'rgba(255,255,255,0.4)';
      c.fillRect(x, 0, Math.max(1, t * 0.3), n);
    }
    // Cross rods (horizontal), with a brighter weld bead where they cross a bar.
    const rt = Math.max(2, ch * 0.075);
    for (let j = 0; j < cross; j++) {
      const y = Math.round((j + 0.5) * ch - rt / 2);
      c.fillStyle = 'rgba(0,0,0,0.38)';
      c.fillRect(0, y + rt, n, Math.max(1, rt * 0.7));
      c.fillStyle = css(mul(bar, 0.86));
      c.fillRect(0, y, n, rt);
      c.fillStyle = 'rgba(255,255,255,0.35)';
      c.fillRect(0, y, n, Math.max(1, rt * 0.3));
      for (let i = 0; i < bars; i++) {
        const x = Math.round((i + 0.5) * bw - t / 2);
        c.fillStyle = css(mix(bar, WHITE, 0.25));
        c.fillRect(x - 1, y - 1, t + 2, rt + 2);
      }
    }
    p.mod([
      [p.patch, 0.08],
      [p.coarse, 0.05],
    ]);
    p.normalize();
  };
}

/** Rusty corrugated sheet: vertical corrugations, rust in three tones, run-off streaks. */
export function rustCorrugated(): Generator {
  return (p) => {
    const n = p.n;
    const b = p.base;
    p.fill(b);
    // Rust palette mixing.
    p.speck(p.patch, -0.1, 0.7, hex(0x9a5a2c), 0.75);
    p.speck(p.mottle, 0.15, 0.8, hex(0x4a2a1c), 0.75);
    p.speck(p.coarse, 0.45, 0.8, hex(0xb8743a), 0.6);
    p.speck(p.patch, 0.55, 0.9, hex(0x7d8a8c), 0.55); // last patches of galvanising
    p.mod([
      [p.bandV, 0.14, 1.1, 1, 0.8], // run-off streaks
      [p.fine, 0.09],
      [p.grit, 0.03],
    ]);
    // Corrugation profile: 20 waves per repeat (7.5 cm), lit from the left.
    const waves = Math.round(p.tile / 0.075);
    p.cols((u) => {
      const ph = u * waves * 2 * Math.PI;
      return 0.97 + 0.2 * Math.sin(ph) + 0.07 * Math.sin(2 * ph + 0.6);
    });
    p.normalize();
    // Sheet overlap with a row of fasteners along the tile border.
    const c = p.ctx;
    const lw = Math.max(1.5, 2.5 * p.u);
    p.wrap(0, -lw * 2, n, lw * 2, (_dx, dy) => {
      c.fillStyle = 'rgba(0,0,0,0.45)';
      c.fillRect(0, dy - lw / 2, n, lw);
      c.fillStyle = 'rgba(255,220,180,0.16)';
      c.fillRect(0, dy + lw / 2, n, lw * 0.8);
    });
    const fy = 0.06 * n;
    for (let i = 0; i < 5; i++) {
      const x = ((i + 0.5) / 5) * n;
      const r = 0.011 * n;
      // Rust bleeding below the fastener.
      const g = c.createLinearGradient(0, fy, 0, fy + 0.12 * n);
      g.addColorStop(0, 'rgba(60,24,8,0.45)');
      g.addColorStop(1, 'rgba(60,24,8,0)');
      c.fillStyle = g;
      c.fillRect(x - r * 0.9, fy, r * 1.8, 0.12 * n);
      c.fillStyle = 'rgba(30,14,6,0.6)';
      c.beginPath();
      c.arc(x + r * 0.2, fy + r * 0.3, r * 1.25, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = css(hex(0x8f7a66));
      c.beginPath();
      c.arc(x, fy, r, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(255,240,220,0.5)';
      c.beginPath();
      c.arc(x - r * 0.3, fy - r * 0.3, r * 0.4, 0, Math.PI * 2);
      c.fill();
    }
  };
}

// ------------------------------------------------------------------------------- woods

export interface WoodOptions {
  /** Growth rings per repeat across the grain. */
  rings: number;
  /** Ring contrast. */
  ringAmp: number;
  /** How much the rings wander (in ring widths). */
  warp: number;
  /** Fine streak contrast. */
  streak: number;
  /** Pore / fleck visibility 0..1. */
  flecks: number;
}

/** Furniture wood, grain along U: rings bent by a slow warp, fine streaks and pores. */
export function wood(o: WoodOptions): Generator {
  return (p) => {
    const n = p.n;
    const m = n - 1;
    const b = p.base;
    p.fill(b);
    const warp = p.fbm(5, 2, 2);
    const tint = p.bandH;
    const d = p.data;
    let q = 0;
    const o1 = 9 * (n >> 6);
    for (let y = 0; y < n; y++) {
      const v = (y / n) * o.rings;
      const row = y * n;
      const row2 = ((y + (n >> 2)) & m) * n;
      for (let x = 0; x < n; x++, q += 4) {
        const t = v + warp[row + x]! * o.warp;
        // Asymmetric ring profile: slow rise, sharp dark late-wood line.
        const f = t - Math.floor(t);
        const ring = f < 0.8 ? f / 0.8 : (1 - f) / 0.2;
        const tw = tint[row2 + ((x + o1) & m)]!;
        const k = 1 + o.ringAmp * (0.55 - ring) + 0.05 * tw;
        d[q] = d[q]! * k * (1 + 0.03 * tw);
        d[q + 1] = d[q + 1]! * k;
        d[q + 2] = d[q + 2]! * k * (1 - 0.05 * tw);
      }
    }
    p.mod([
      [p.streakH, o.streak],
      [p.dashH, o.streak * 0.6],
      [p.cloud, 0.025],
    ]);
    if (o.flecks > 0) {
      // Pores: short dark dashes along the grain; rays: short pale dashes.
      p.speck(p.dashH, 0.55, 0.85, tone(mul(b, 0.62), 1, 0.06), 0.55 * o.flecks);
      p.speck(p.dashH, -0.6, -0.9, mix(b, WHITE, 0.3), 0.4 * o.flecks);
    }
    p.normalize();
  };
}

/** Weathered planks along U, 15 cm wide: each board has its own tone, grain, joints and nails. */
export function planks(): Generator {
  return (p) => {
    const n = p.n;
    const m = n - 1;
    const b = p.base;
    const count = Math.round(p.tile / 0.15);
    p.fill(b);
    const grain = p.streakH;
    const grain2 = p.bandH;
    const blotch = p.patch;
    const shift: number[] = [];
    const tones: number[] = [];
    const warm: number[] = [];
    for (let i = 0; i < count; i++) {
      shift.push(Math.floor(p.rng() * 64) * (n >> 6));
      tones.push((p.rng() - 0.5) * 0.3);
      warm.push((p.rng() - 0.5) * 0.1);
    }
    const d = p.data;
    let q = 0;
    for (let y = 0; y < n; y++) {
      const j = Math.min(count - 1, Math.floor((y * count) / n));
      const row = y * n;
      const sh = shift[j]!;
      // Cupping: boards are slightly darker toward their edges.
      const fy = (y * count) / n - j;
      const cup = 1 - 0.1 * Math.pow(Math.abs(fy - 0.5) * 2, 4);
      const kt = (1 + tones[j]!) * cup;
      const w = warm[j]!;
      for (let x = 0; x < n; x++, q += 4) {
        const xs = (x + sh) & m;
        const g = grain[row + xs]! * 0.13 + grain2[row + xs]! * 0.1;
        // Grey weathering in patches.
        const grey = Math.max(0, blotch[row + xs]!) * 0.5;
        const k = kt * (1 + g);
        const r = d[q]! * k * (1 + w);
        const gg = d[q + 1]! * k;
        const bb = d[q + 2]! * k * (1 - w);
        const l = (r + gg + bb) / 3;
        d[q] = r + (l - r) * grey;
        d[q + 1] = gg + (l - gg) * grey;
        d[q + 2] = bb + (l * 1.04 - bb) * grey;
      }
    }
    p.mod([
      [p.dashH, 0.05],
      [p.grit, 0.02],
    ]);
    p.normalize();
    const c = p.ctx;
    const gap = Math.max(1.2, 2.2 * p.u);
    // Gaps between boards.
    for (let j = 0; j < count; j++) {
      const y = (j * n) / count;
      p.wrap(0, y - gap, n, y + gap, (_dx, dy) => {
        c.fillStyle = 'rgba(18,12,6,0.82)';
        c.fillRect(0, y + dy - gap / 2, n, gap);
        c.fillStyle = 'rgba(255,240,215,0.16)';
        c.fillRect(0, y + dy + gap / 2, n, Math.max(1, p.u));
      });
    }
    // Butt joints with nails, splits along the grain.
    const ph = n / count;
    for (let j = 0; j < count; j++) {
      const x = p.rand(0, n);
      const y0 = j * ph + gap / 2;
      c.fillStyle = 'rgba(18,12,6,0.7)';
      c.fillRect(x, y0, Math.max(1, 1.5 * p.u), ph - gap);
      const r = Math.max(1, 1.9 * p.u);
      for (const side of [-1, 1]) {
        for (const fy of [0.25, 0.75]) {
          const nx = x + side * 0.03 * n;
          const ny = y0 + fy * (ph - gap);
          p.wrap(nx - r * 2, ny - r * 2, nx + r * 2, ny + r * 2, (dx, dy) => {
            c.fillStyle = 'rgba(25,20,18,0.85)';
            c.beginPath();
            c.arc(nx + dx, ny + dy, r, 0, Math.PI * 2);
            c.fill();
            c.fillStyle = 'rgba(200,190,180,0.4)';
            c.beginPath();
            c.arc(nx + dx - r * 0.3, ny + dy - r * 0.3, r * 0.4, 0, Math.PI * 2);
            c.fill();
          });
        }
      }
      if (p.rng() < 0.7) {
        const sx = p.rand(0, n);
        const sy = y0 + p.rand(0.2, 0.8) * (ph - gap);
        const sl = p.rand(0.06, 0.2) * n;
        c.strokeStyle = 'rgba(18,12,6,0.5)';
        c.lineWidth = Math.max(0.7, p.u);
        p.wrap(sx, sy - 2, sx + sl, sy + 2, (dx, dy) => {
          c.beginPath();
          c.moveTo(sx + dx, sy + dy);
          c.quadraticCurveTo(sx + dx + sl / 2, sy + dy + 1.5 * p.u, sx + dx + sl, sy + dy);
          c.stroke();
        });
      }
    }
  };
}

/** Laminate bench / desk top: even decor with tiny flecks and a soft sheen. */
export function laminate(linen: boolean): Generator {
  return (p) => {
    const b = p.base;
    p.fill(b);
    const layers: ModLayer[] = [
      [p.cloud, 0.014, 1.3, 1, 0.5],
      [p.grit, 0.008],
    ];
    if (linen) layers.push([p.streakH, 0.03], [p.streakV, 0.024]);
    p.mod(layers);
    p.speck(p.fine, 0.6, 0.85, mul(b, 0.87), 0.6);
    p.speck(p.fine, -0.62, -0.85, mix(b, WHITE, 0.5), 0.5);
    p.speck(p.patch, 0.2, 1, 0.98, 1); // wiping marks
    p.normalize();
    // Fine scratches.
    const c = p.ctx;
    c.lineWidth = Math.max(0.5, 0.7 * p.u);
    for (let i = 0; i < 16; i++) {
      const x = p.rand(0, p.n);
      const y = p.rand(0, p.n);
      const a = p.rand(0, Math.PI);
      const l = p.rand(0.03, 0.12) * p.n;
      c.strokeStyle = `rgba(90,95,100,${p.rand(0.06, 0.14)})`;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      c.stroke();
    }
  };
}

// ------------------------------------------------------------------------------- plastics

/** Moulded plastic: fine pebbled grain (relief) and a slow sheen. `coarse` = rubber. */
export function plastic(coarse = false): Generator {
  return (p) => {
    const b = p.base;
    const lum = (b[0] + b[1] + b[2]) / 3;
    const k = lum < 60 ? 2.6 : lum < 120 ? 1.5 : 1;
    p.fill(b);
    p.mod([
      [coarse ? p.bumps : p.stipple, (coarse ? 0.05 : 0.024) * k],
      [p.cloud, 0.016 * k, 1.1, 1, 0.9],
      [p.fbm(1, 3, 2), 0.014 * k],
      [p.mottle, 0.01 * k],
    ]);
    if (coarse) {
      // Dust caught in the texture of the rubber.
      p.speck(p.coarse, 0.5, 0.9, mix(b, hex(0x6a6862), 0.5), 0.35);
      p.speck(p.patch, 0.2, 0.9, mix(b, hex(0x55534e), 0.35), 0.4);
    } else if (lum < 60) {
      p.speck(p.patch, 0.3, 0.9, mix(b, hex(0x50545a), 0.3), 0.35);
    }
    p.normalize();
  };
}

// ------------------------------------------------------------------------------- fabrics

/**
 * Woven fabric: plain weave of 4-texel threads (at 512), each thread with its own tone
 * (slubs) and a rounded profile. `soft` = fine cotton with gentle folds.
 */
export function fabric(soft = false): Generator {
  return (p) => {
    const n = p.n;
    const b = p.base;
    const lum = (b[0] + b[1] + b[2]) / 3;
    const k = lum > 200 ? 0.5 : 1;
    p.fill(b);
    const period = Math.max(1, Math.round((soft ? 2 : 4) * p.u));
    const threads = n / period;
    const warpTone = new Float32Array(threads);
    const weftTone = new Float32Array(threads);
    for (let i = 0; i < threads; i++) {
      warpTone[i] = (p.rng() - 0.5) * 0.16 * k + (p.rng() < 0.04 ? 0.12 * k : 0);
      weftTone[i] = (p.rng() - 0.5) * 0.16 * k + (p.rng() < 0.04 ? -0.12 * k : 0);
    }
    // Rounded thread profile across its width.
    const prof = new Float32Array(period);
    for (let i = 0; i < period; i++) {
      const t = period > 1 ? (i + 0.5) / period : 0.5;
      prof[i] = Math.sin(Math.PI * t) - 0.64;
    }
    const d = p.data;
    let q = 0;
    const depth = (soft ? 0.1 : 0.2) * k * (period > 1 ? 1 : 0);
    for (let y = 0; y < n; y++) {
      const ty = Math.floor(y / period);
      const py = y - ty * period;
      for (let x = 0; x < n; x++, q += 4) {
        const tx = Math.floor(x / period);
        const px = x - tx * period;
        const over = (tx + ty) & 1; // 1: the warp (vertical) thread is on top
        const kk = over ? 1 + warpTone[tx]! + depth * prof[px]! + 0.03 * k : 1 + weftTone[ty]! + depth * prof[py]! - 0.03 * k;
        d[q] = d[q]! * kk;
        d[q + 1] = d[q + 1]! * kk;
        d[q + 2] = d[q + 2]! * kk;
      }
    }
    const layers: ModLayer[] = [
      [p.grit, 0.035 * k],
      [p.cloud, 0.03 * k],
    ];
    if (soft) layers.push([p.fbm(7, 1, 2), 0.03, 1.2, 1, 0.6]); // gentle vertical folds
    p.mod(layers);
    // Fuzz: stray lighter fibres.
    p.speck(p.fleck, 0.75, 0.95, mix(b, WHITE, 0.35), 0.35 * k);
    p.normalize();
  };
}

// ------------------------------------------------------------------------------- cardboard, paper

/**
 * Corrugated cardboard: one repeat reads as one carton face — kraft liner with the flutes
 * showing through, a taped centre seam, handling marks and a printed label.
 */
export function cardboard(): Generator {
  return (p) => {
    const n = p.n;
    const b = p.base;
    p.fill(b);
    // Flutes: 7 mm pitch, soft horizontal ribs.
    const pitch = Math.max(2, Math.round(0.0078 * p.ppm));
    const flute = pitch >= 3 ? 0.03 : 0.012;
    p.rows((v) => 1 + flute * Math.sin(((v * n) / pitch) * 2 * Math.PI));
    p.mod([
      [p.cloud, 0.05, 1.1, 1, 0.8],
      [p.dashV, 0.035],
      [p.grit, 0.022],
    ]);
    // Kraft fibres and scuffs.
    p.speck(p.dashV, 0.62, 0.9, mul(b, 0.78), 0.4);
    p.speck(p.dashV, -0.62, -0.9, mix(b, WHITE, 0.3), 0.35);
    p.speck(p.patch, 0.35, 0.9, 0.93, 1);
    p.normalize();

    const c = p.ctx;
    const u = n / 512;
    // Carton edges on the tile border: crease shadow.
    const e = 5 * u;
    let g = c.createLinearGradient(0, 0, e, 0);
    g.addColorStop(0, 'rgba(40,24,8,0.4)');
    g.addColorStop(1, 'rgba(40,24,8,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, e, n);
    g = c.createLinearGradient(n, 0, n - e, 0);
    g.addColorStop(0, 'rgba(40,24,8,0.4)');
    g.addColorStop(1, 'rgba(40,24,8,0)');
    c.fillStyle = g;
    c.fillRect(n - e, 0, e, n);
    g = c.createLinearGradient(0, 0, 0, e);
    g.addColorStop(0, 'rgba(40,24,8,0.45)');
    g.addColorStop(1, 'rgba(40,24,8,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, n, e);
    g = c.createLinearGradient(0, n, 0, n - e);
    g.addColorStop(0, 'rgba(40,24,8,0.45)');
    g.addColorStop(1, 'rgba(40,24,8,0)');
    c.fillStyle = g;
    c.fillRect(0, n - e, n, e);

    // Flap seam under a strip of brown packing tape.
    const ty = 0.36 * n;
    const th = 0.052 * n;
    c.fillStyle = 'rgba(30,18,6,0.55)';
    c.fillRect(0, ty + th * 0.5 - u * 0.7, n, u * 1.4);
    g = c.createLinearGradient(0, ty, 0, ty + th);
    g.addColorStop(0, 'rgba(196,150,84,0.82)');
    g.addColorStop(0.25, 'rgba(214,172,104,0.8)');
    g.addColorStop(0.6, 'rgba(184,138,74,0.82)');
    g.addColorStop(1, 'rgba(170,124,62,0.84)');
    c.fillStyle = g;
    c.fillRect(0, ty, n, th);
    c.fillStyle = 'rgba(255,240,205,0.35)';
    c.fillRect(0, ty + th * 0.16, n, u * 1.6);
    c.fillStyle = 'rgba(60,36,10,0.35)';
    c.fillRect(0, ty + th, n, u * 1.2);
    c.fillRect(0, ty - u, n, u);

    // Printed handling marks (flexo print, dark brown).
    const ink = 'rgba(52,34,18,0.8)';
    c.strokeStyle = ink;
    c.fillStyle = ink;
    c.lineWidth = 3 * u;
    c.lineJoin = 'round';
    // "This way up" arrows.
    for (const ax of [0.1, 0.19]) {
      const x = ax * n;
      const y0 = 0.86 * n;
      const y1 = 0.68 * n;
      c.beginPath();
      c.moveTo(x, y0);
      c.lineTo(x, y1 + 8 * u);
      c.stroke();
      c.beginPath();
      c.moveTo(x - 15 * u, y1 + 20 * u);
      c.lineTo(x, y1);
      c.lineTo(x + 15 * u, y1 + 20 * u);
      c.closePath();
      c.fill();
    }
    c.fillRect(0.06 * n, 0.875 * n, 0.17 * n, 3 * u);
    c.font = `bold ${Math.round(17 * u)}px Arial, "Liberation Sans", sans-serif`;
    c.textBaseline = 'alphabetic';
    c.textAlign = 'left';
    c.fillText('HAUT', 0.07 * n, 0.93 * n);
    c.font = `bold ${Math.round(26 * u)}px Arial, "Liberation Sans", sans-serif`;
    c.fillText('FRAGILE', 0.3 * n, 0.9 * n);
    c.font = `${Math.round(13 * u)}px Arial, "Liberation Sans", sans-serif`;
    c.fillText('Conserver entre 2 °C et 8 °C', 0.3 * n, 0.945 * n);

    // Shipping label.
    const lx = 0.55 * n;
    const ly = 0.08 * n;
    const lw = 0.38 * n;
    const lh = 0.23 * n;
    c.fillStyle = 'rgba(30,18,6,0.3)';
    c.fillRect(lx + 2 * u, ly + 2 * u, lw, lh);
    c.fillStyle = '#f2efe6';
    c.fillRect(lx, ly, lw, lh);
    c.fillStyle = '#003f71';
    c.fillRect(lx, ly, lw, lh * 0.24);
    c.fillStyle = '#ffffff';
    c.font = `bold ${Math.round(15 * u)}px Arial, "Liberation Sans", sans-serif`;
    c.fillText("BioArd'Aisne", lx + 8 * u, ly + lh * 0.17);
    c.fillStyle = '#e7343f';
    c.fillRect(lx + lw - 30 * u, ly + lh * 0.06, 20 * u, lh * 0.12);
    c.fillStyle = '#2a2d31';
    c.font = `${Math.round(12 * u)}px Arial, "Liberation Sans", sans-serif`;
    c.fillText('Réactifs — Lot 25-0427', lx + 8 * u, ly + lh * 0.42);
    c.fillText('Plateau technique', lx + 8 * u, ly + lh * 0.56);
    // Barcode.
    let bx = lx + 8 * u;
    const by = ly + lh * 0.66;
    while (bx < lx + lw - 12 * u) {
      const w = (1 + Math.floor(p.rng() * 3)) * u;
      c.fillRect(bx, by, w, lh * 0.26);
      bx += w + (1 + Math.floor(p.rng() * 3)) * u;
    }
  };
}

/** White paper: fibre mottling and faint sheet lines (reads as a ream from the side). */
export function paper(): Generator {
  return (p) => {
    const n = p.n;
    p.fill(p.base);
    p.mod([
      [p.cloud, 0.012, 1.4, 1, 0.3],
      [p.fine, 0.008],
      [p.streakH, 0.02],
    ]);
    p.normalize();
    const c = p.ctx;
    // A few sheets sticking out of the stack.
    c.fillStyle = 'rgba(120,125,130,0.2)';
    for (let i = 0; i < 9; i++) {
      c.fillRect(0, Math.round(p.rand(0, n)), n, Math.max(1, p.u));
    }
  };
}
