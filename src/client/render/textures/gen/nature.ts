/**
 * Vegetation: hedge, tree foliage, bark.
 */
import { css, hex, mix, mul, tone, type Generator, type Rgb } from '../painter';

export interface LeavesOptions {
  /** Leaf length in metres. */
  leaf: number;
  /** Leaves per layer (at any resolution). */
  count: number;
  /** Depth contrast between the shadowed inside and the lit outer leaves. */
  depth: number;
}

/** Dense foliage: a dark interior with layers of small leaves, lightest on top. */
export function leaves(o: LeavesOptions): Generator {
  return (p) => {
    const n = p.n;
    const b = p.base;
    // Shadowed interior.
    p.fill(mul(b, 0.42));
    p.mod([
      [p.fbm(5, 5, 4, 1), 0.3],
      [p.fbm(40, 40, 3, 2), 0.3],
      [p.fbm(128, 128, 2, 3), 0.2],
    ]);
    const c = p.ctx;
    const len = o.leaf * p.ppm;
    const layers: [Rgb, number, number][] = [
      [tone(b, 0.62, -0.03), 1.1, 0.95],
      [tone(b, 0.86, 0), 1, 0.95],
      [tone(b, 1.1, 0.02), 0.85, 0.95],
      [mix(tone(b, 1.38, 0.05), hex(0xc8e07a), 0.25), 0.4, 0.9],
    ];
    for (const [col, share, alpha] of layers) {
      const count = Math.round(o.count * share);
      // Three slightly different greens per layer, each drawn as one path.
      for (let v = 0; v < 3; v++) {
        c.fillStyle = css(tone(col, 0.9 + v * 0.1, (v - 1) * 0.035), alpha);
        c.beginPath();
        for (let i = 0; i < count / 3; i++) {
          const x = p.rng() * n;
          const y = p.rng() * n;
          const a = len * (0.35 + p.rng() * 0.3);
          const w = a * (0.38 + p.rng() * 0.2);
          const rot = p.rng() * Math.PI;
          p.wrap(x - a, y - a, x + a, y + a, (dx, dy) => {
            c.moveTo(x + dx + Math.cos(rot) * a, y + dy + Math.sin(rot) * a);
            c.ellipse(x + dx, y + dy, a, w, rot, 0, Math.PI * 2);
          });
        }
        c.fill();
      }
    }
    p.mod([
      [p.fbm(4, 4, 4, 4), o.depth, 1.15, 1, 0.7],
      [p.fbm(24, 24, 3, 5), o.depth * 0.6],
      [p.relief(160, 160, 2, 6), 0.06],
      [p.white(1), 0.03],
    ]);
    // Deep holes between the branches.
    p.speck(p.fbm(18, 18, 3, 7), 0.5, 0.9, mul(b, 0.25), 0.55);
    p.normalize();
  };
}

/** Tree bark: vertical plates separated by deep furrows, with lichen. */
export function bark(): Generator {
  return (p) => {
    const n = p.n;
    const m = n - 1;
    const b = p.base;
    p.fill(b);
    const ridge = p.fbm(14, 3, 3, 1);
    const ridge2 = p.fbm(40, 6, 2, 2);
    const cross = p.fbm(5, 22, 2, 3);
    const d = p.data;
    let q = 0;
    const q4 = n >> 2;
    for (let y = 0; y < n; y++) {
      const row = y * n;
      const row2 = ((y + q4) & m) * n;
      for (let x = 0; x < n; x++, q += 4) {
        const v = ridge[row + x]!;
        const a = Math.abs(v);
        const a2 = Math.abs(ridge2[row2 + ((x + 51) & m)]!);
        const a3 = Math.abs(cross[row2 + x]!);
        // Furrows where the fields cross zero; plates in between, rounded.
        const f1 = a < 0.16 ? 1 - a / 0.16 : 0;
        const f2 = a2 < 0.1 ? 1 - a2 / 0.1 : 0;
        const f3 = a3 < 0.06 ? 1 - a3 / 0.06 : 0;
        const furrow = Math.min(1, f1 + 0.55 * f2 + 0.45 * f3);
        const plate = Math.min(1, a * 2.2);
        const k = (0.78 + 0.5 * plate + 0.16 * v) * (1 - 0.7 * furrow);
        d[q] = d[q]! * k;
        d[q + 1] = d[q + 1]! * k;
        d[q + 2] = d[q + 2]! * k;
      }
    }
    p.mod([
      [p.fbm(128, 24, 2, 4), 0.14],
      [p.relief(96, 96, 2, 5), 0.07],
      [p.fbm(3, 3, 3, 6), 0.08, 1.2, 1, 0.7],
      [p.white(1), 0.04],
    ]);
    p.speck(p.fbm(20, 20, 3, 7), 0.6, 0.85, hex(0x7f8a6c), 0.4); // lichen
    p.speck(p.fbm(10, 30, 3, 8), 0.65, 0.9, hex(0x9a9484), 0.3);
    p.normalize();
  };
}
