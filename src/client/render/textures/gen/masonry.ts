/**
 * Exterior walls and roofs: brick, ashlar stone, rendered façades, cladding panels,
 * slate and clay tile roofs.
 */
import { css, hex, mix, mul, tone, WHITE, type Generator, type Rgb } from '../painter';
import { drawBlocks, layCourses, randomLengths } from './blocks';

export interface BrickOptions {
  mortar: Rgb;
  /** Per-brick brightness variation. */
  vary: number;
  /** Share of dark over-fired bricks. */
  burnt: number;
}

/** Brick wall in running bond: 9 bricks × 32 courses per 2 m (about 21 × 5.3 cm faces). */
export function brick(o: BrickOptions): Generator {
  return (p) => {
    const b = p.base;
    const perRow = Math.round(p.tile / 0.2222);
    const rowsN = Math.round(p.tile / 0.0625 / 2) * 2;
    // Mortar bed: sandy, uneven.
    p.fill(o.mortar);
    p.mod([
      [p.fbm(10, 10, 3, 1), 0.1],
      [p.fbm(128, 128, 2, 2), 0.1],
      [p.white(2), 0.09],
    ]);
    const heights = new Array<number>(rowsN).fill(1 / rowsN);
    const even = new Array<number>(perRow).fill(1 / perRow);
    const blocks = layCourses(
      p,
      heights,
      () => even,
      (r) => (r % 2 ? 0.5 / perRow : 0),
    );
    const orange = tone(b, 1.12, 0.07);
    const dark = tone(b, 0.66, -0.05);
    drawBlocks(p, blocks, {
      joint: Math.max(1.2, 0.0105 * p.ppm),
      radius: 0.5 * p.u,
      color: () => {
        const r = p.rng();
        const base = r < o.burnt ? dark : r > 0.9 ? orange : b;
        return tone(base, 1 + (p.rng() - 0.5) * 2 * o.vary, (p.rng() - 0.5) * 0.06);
      },
      bevel: 0.55,
      shadow: 0.8,
      edge: Math.max(1, p.u),
    });
    // Brick skin: sanded faces, pits, weathering in large patches, run-off.
    p.mod([
      [p.fbm(3, 3, 4, 3), 0.07],
      [p.fbm(160, 60, 2, 4), 0.07],
      [p.fbm(48, 3, 3, 5), 0.035],
      [p.white(1), 0.045],
    ]);
    p.speck(p.fbm(256, 256, 1, 6), 0.68, 0.95, 0.74, 0.8);
    p.speck(p.fbm(5, 5, 3, 7), 0.5, 0.95, mix(b, hex(0xd8d2c8), 0.5), 0.16); // efflorescence
    p.speck(p.fbm(4, 6, 3, 8), 0.4, 0.9, mul(b, 0.7), 0.3); // soot
    p.normalize();
  };
}

export interface AshlarOptions {
  /** Course heights in metres (repeated to fill the tile). */
  courses: readonly number[];
  /** Block lengths in units of `unit` metres. */
  unit: number;
  lengths: readonly number[];
  /** Joint width in metres. */
  joint: number;
  jointColor: Rgb;
  /** Tone variation between blocks. */
  vary: number;
  /** Surface roughness (relief strength). */
  rough: number;
  /** Extra block colours mixed into the palette. */
  accents: readonly Rgb[];
}

/** Dressed stone blocks in regular courses with fine joints and weathering. */
export function ashlar(o: AshlarOptions): Generator {
  return (p) => {
    const b = p.base;
    p.fill(o.jointColor);
    p.mod([
      [p.fbm(24, 24, 3, 1), 0.14],
      [p.white(2), 0.08],
    ]);
    // Course heights: cycle through the given list until the tile is full.
    const heights: number[] = [];
    let total = 0;
    for (let i = 0; total < p.tile - 1e-6; i++) {
      const h = o.courses[i % o.courses.length]!;
      heights.push(h / p.tile);
      total += h;
    }
    const units = Math.round(p.tile / o.unit);
    const lens: number[][] = [];
    const offs: number[] = [];
    for (let r = 0; r < heights.length; r++) {
      lens.push(randomLengths(p, units, o.lengths));
      offs.push((Math.floor(p.rng() * units) + (r % 2 ? 0.5 : 0)) / units);
    }
    const blocks = layCourses(
      p,
      heights,
      (r) => lens[r]!,
      (r) => offs[r]!,
    );
    const palette: Rgb[] = [b, b, tone(b, 1.05, 0.02), tone(b, 0.94, -0.015), ...o.accents];
    drawBlocks(p, blocks, {
      joint: Math.max(1.3, o.joint * p.ppm),
      radius: 1.5 * p.u,
      color: () => tone(palette[Math.floor(p.rng() * palette.length)]!, 1 + (p.rng() - 0.5) * 2 * o.vary, (p.rng() - 0.5) * 0.03),
      bevel: 0.75,
      shadow: 0.7,
    });
    p.mod([
      [p.fbm(3, 3, 4, 3), 0.06, 1.15, 1, 0.8],
      [p.fbm(20, 8, 3, 4), 0.05], // bedding of the stone
      [p.relief(96, 96, 3, 5), o.rough],
      [p.fbm(160, 160, 2, 6), 0.035],
      [p.fbm(32, 2, 3, 7), 0.03], // rain streaks
      [p.white(1), 0.018],
    ]);
    p.speck(p.fbm(220, 220, 1, 8), 0.68, 0.94, mul(b, 0.72), 0.6); // pits
    p.speck(p.fbm(5, 5, 3, 9), 0.4, 0.9, mul(b, 0.78), 0.35); // grime
    p.speck(p.fbm(30, 30, 2, 10), 0.76, 0.92, mix(b, hex(0x84886a), 0.55), 0.45); // lichen
    p.normalize();
  };
}

/** Rendered façade (crépi): rough projected render with weathering streaks. */
export function render(): Generator {
  return (p) => {
    const b = p.base;
    p.fill(b);
    p.mod([
      [p.relief(200, 200, 2, 1), 0.07],
      [p.relief(72, 72, 2, 2), 0.04],
      [p.fbm(3, 3, 4, 3), 0.045, 1.2, 1, 0.75],
      [p.fbm(36, 2, 3, 4), 0.04], // run-off streaks
      [p.fbm(14, 5, 3, 5), 0.025],
      [p.white(1), 0.015],
    ]);
    // Dark weathering under imaginary ledges, pale patches where the render was redone.
    p.speck(p.fbm(22, 2, 3, 6), 0.45, 0.95, mul(b, 0.84), 0.6);
    p.speck(p.fbm(4, 4, 3, 7), 0.5, 0.95, mix(b, WHITE, 0.3), 0.3);
    p.speck(p.fbm(256, 256, 1, 8), 0.72, 0.95, 0.86, 0.7); // pits
    // A couple of hairline cracks.
    const n = p.n;
    for (let i = 0; i < 2; i++) {
      p.crack(p.rand(0, n), p.rand(0, n), Math.PI / 2 + p.rand(-0.5, 0.5), p.rand(0.12, 0.28) * n, css(mul(b, 0.45), 0.4), Math.max(0.7, p.u), 0.5, 0.3);
    }
    p.normalize();
  };
}

/** Modern composite cladding: 1.2 × 0.6 m cassettes with shadow reveals. */
export function cladding(): Generator {
  return (p) => {
    const n = p.n;
    const b = p.base;
    p.fill(mul(b, 0.22));
    const cols = Math.round(p.tile / 1.2);
    const rowsN = Math.round(p.tile / 0.6);
    const c = p.ctx;
    const pw = n / cols;
    const ph = n / rowsN;
    const j = Math.max(2, 0.012 * p.ppm);
    for (let r = 0; r < rowsN; r++) {
      for (let i = 0; i < cols; i++) {
        const x = Math.round(i * pw) + j / 2;
        const y = Math.round(r * ph) + j / 2;
        const w = pw - j;
        const h = ph - j;
        const g = c.createLinearGradient(0, y, 0, y + h);
        const k = 1 + (p.rng() - 0.5) * 0.07;
        g.addColorStop(0, css(mix(mul(b, k), WHITE, 0.12)));
        g.addColorStop(0.25, css(mul(b, k)));
        g.addColorStop(1, css(mul(b, k * 0.93)));
        c.fillStyle = g;
        c.fillRect(x, y, w, h);
        // Folded edges of the cassette.
        c.fillStyle = 'rgba(255,255,255,0.35)';
        c.fillRect(x, y, w, Math.max(1, 1.3 * p.u));
        c.fillRect(x, y, Math.max(1, 1.3 * p.u), h);
        c.fillStyle = 'rgba(0,0,0,0.25)';
        c.fillRect(x, y + h - Math.max(1, 1.3 * p.u), w, Math.max(1, 1.3 * p.u));
        c.fillRect(x + w - Math.max(1, 1.3 * p.u), y, Math.max(1, 1.3 * p.u), h);
      }
    }
    p.mod([
      [p.fbm(2, 2, 3, 1), 0.04, 0.8, 1, 1.1],
      [p.fbm(3, 24, 2, 2), 0.02],
      [p.relief(200, 200, 1, 3), 0.008],
    ]);
    p.speck(p.fbm(40, 3, 3, 4), 0.55, 0.95, 0.93, 1); // dust streaks
    p.normalize();
  };
}

/** Ardennes slate roof: overlapping rectangular slates, 20 cm wide, 12.5 cm showing. */
export function slateRoof(): Generator {
  return (p) => {
    const n = p.n;
    const b = p.base;
    const perRow = Math.round(p.tile / 0.2);
    const rowsN = Math.round(p.tile / 0.125 / 2) * 2;
    p.fill(mul(b, 0.3));
    const c = p.ctx;
    const sw = n / perRow;
    const sh = n / rowsN;
    const gap = Math.max(1, 1.3 * p.u);
    const palette: Rgb[] = [b, b, tone(b, 1.12, -0.03), tone(b, 0.86, 0), mix(b, hex(0x545a66), 0.6), mix(b, hex(0x39424a), 0.7), mix(b, hex(0x4a4658), 0.5)];
    for (let r = 0; r < rowsN; r++) {
      const y = Math.round(r * sh);
      const y1 = Math.round((r + 1) * sh);
      const h = y1 - y;
      for (let i = 0; i < perRow; i++) {
        const x = Math.round((i + (r % 2 ? 0.5 : 0)) * sw);
        const w = Math.round((i + 1 + (r % 2 ? 0.5 : 0)) * sw) - x;
        const col = tone(palette[Math.floor(p.rng() * palette.length)]!, 1 + (p.rng() - 0.5) * 0.16);
        const lift = p.rng() * 0.18; // some slates sit a little proud: stronger edge light
        const chip = p.rng() < 0.1 ? (p.rng() < 0.5 ? 1 : 2) : 0;
        p.wrap(x, y, x + w, y + h, (dx) => {
          const xx = x + dx;
          c.fillStyle = css(col);
          c.beginPath();
          c.moveTo(xx + gap / 2, y);
          c.lineTo(xx + w - gap / 2, y);
          if (chip === 2) {
            c.lineTo(xx + w - gap / 2, y + h - gap - 0.3 * h);
            c.lineTo(xx + w - gap / 2 - 0.16 * w, y + h - gap);
          } else {
            c.lineTo(xx + w - gap / 2, y + h - gap);
          }
          if (chip === 1) {
            c.lineTo(xx + gap / 2 + 0.16 * w, y + h - gap);
            c.lineTo(xx + gap / 2, y + h - gap - 0.3 * h);
          } else {
            c.lineTo(xx + gap / 2, y + h - gap);
          }
          c.closePath();
          c.fill();
          // Shadow of the course above, falling on the top of this slate.
          const g = c.createLinearGradient(0, y, 0, y + h * 0.45);
          g.addColorStop(0, 'rgba(0,0,0,0.5)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          c.fillStyle = g;
          c.fillRect(xx, y, w, h * 0.45);
          // Lit lower edge.
          c.fillStyle = `rgba(190,205,225,${0.2 + lift})`;
          c.fillRect(xx + gap, y + h - gap - Math.max(1, 1.2 * p.u), w - 2 * gap, Math.max(1, 1.2 * p.u));
        });
      }
    }
    p.mod([
      [p.fbm(3, 3, 4, 1), 0.08],
      [p.fbm(12, 160, 2, 2), 0.07], // cleavage of the slate
      [p.fbm(96, 96, 2, 3), 0.05],
      [p.white(1), 0.03],
    ]);
    p.speck(p.fbm(56, 56, 2, 4), 0.74, 0.9, mix(b, hex(0x8f9a86), 0.6), 0.5); // lichen
    p.speck(p.fbm(6, 6, 3, 5), 0.5, 0.9, mix(b, hex(0x4f5a48), 0.4), 0.4); // moss film
    p.normalize();
  };
}

/** Red clay interlocking roof tiles: 22 cm columns with a raised roll, 33 cm courses. */
export function clayTiles(): Generator {
  return (p) => {
    const n = p.n;
    const b = p.base;
    const cols = Math.round(p.tile / 0.2222);
    const rowsN = Math.round(p.tile / 0.3333);
    p.fill(b);
    const c = p.ctx;
    const tw = n / cols;
    const th = n / rowsN;
    // Per-tile tone.
    for (let r = 0; r < rowsN; r++) {
      for (let i = 0; i < cols; i++) {
        const t = (p.rng() - 0.5) * 0.3;
        const warm = p.rng();
        c.fillStyle = t < 0 ? `rgba(40,10,0,${-t})` : warm < 0.5 ? `rgba(255,170,110,${t * 0.8})` : `rgba(255,210,170,${t * 0.7})`;
        c.fillRect(Math.round(i * tw), Math.round(r * th), Math.ceil(tw), Math.ceil(th));
      }
    }
    p.mod([
      [p.fbm(3, 3, 4, 1), 0.08],
      [p.fbm(64, 64, 3, 2), 0.07],
      [p.fbm(40, 3, 3, 3), 0.05], // run-off
      [p.white(1), 0.035],
    ]);
    p.speck(p.fbm(6, 6, 3, 4), 0.4, 0.9, mul(b, 0.62), 0.45); // soot / moss
    p.speck(p.fbm(64, 64, 2, 5), 0.76, 0.92, mix(b, hex(0xb0b39a), 0.6), 0.5); // lichen
    // Cross profile of a tile: flat pan, raised roll on the right, dark side lap.
    p.cols((u) => {
      const f = (u * cols) % 1;
      if (f < 0.06) return 0.62; // lap shadow
      if (f < 0.62) return 0.96 + 0.1 * Math.sin(((f - 0.06) / 0.56) * Math.PI); // pan
      const t = (f - 0.62) / 0.38; // roll: lit on the left flank, shaded on the right
      return 1.02 + 0.26 * Math.cos(t * Math.PI) * Math.sin(t * Math.PI) + 0.1 * Math.sin(t * Math.PI);
    });
    // Courses: the lower edge of each tile, its shadow on the tile below.
    const cc = p.ctx;
    for (let r = 0; r < rowsN; r++) {
      const y = Math.round(r * th);
      p.wrap(0, y - th * 0.1, n, y + th * 0.25, (_dx, dy) => {
        const yy = y + dy;
        const g = cc.createLinearGradient(0, yy, 0, yy + th * 0.22);
        g.addColorStop(0, 'rgba(20,5,0,0.62)');
        g.addColorStop(0.25, 'rgba(20,5,0,0.3)');
        g.addColorStop(1, 'rgba(20,5,0,0)');
        cc.fillStyle = g;
        cc.fillRect(0, yy, n, th * 0.22);
        cc.fillStyle = 'rgba(255,215,180,0.3)';
        cc.fillRect(0, yy - Math.max(1.5, 2.5 * p.u), n, Math.max(1.5, 2.5 * p.u));
      });
    }
    p.normalize();
  };
}
