/**
 * Exterior ground: asphalt, pavement slabs, fan-pattern cobbles, stone paving, grass,
 * dirt, gravel, water.
 */
import { hash3, mulberry32 } from '../../../../shared/math/rng';
import { css, hex, mix, mul, tone, WHITE, type Generator, type Rgb } from '../painter';
import { drawBlocks, layCourses, randomLengths } from './blocks';

/** Asphalt: dark binder, fine light aggregate, worn patches, cracks and faint tyre marks. */
export function asphalt(): Generator {
  return (p) => {
    const n = p.n;
    const b = p.base;
    p.fill(b);
    p.mod([
      [p.fbm(2, 2, 5, 1), 0.1],
      [p.fbm(14, 14, 4, 2), 0.08],
      [p.fbm(160, 160, 2, 3), 0.1],
      [p.white(1), 0.07],
    ]);
    // Aggregate: light and warm stones showing through the worn binder, dark pits.
    const agg = p.fbm(384, 384, 1, 4);
    p.speck(agg, 0.5, 0.85, mix(b, hex(0xa8a49a), 0.75), 0.7);
    p.speck(agg, -0.55, -0.9, mul(b, 0.55), 0.7);
    p.speck(p.fbm(256, 256, 2, 5), 0.66, 0.85, mix(b, hex(0x9a8468), 0.7), 0.6);
    // Worn / polished lanes and darker repaired areas.
    p.speck(p.fbm(3, 3, 3, 6), 0.25, 0.85, 0.86, 1);
    p.speck(p.fbm(4, 4, 3, 7), -0.35, -0.9, 1.12, 1);

    const c = p.ctx;
    // Tyre marks: two faint dark tracks weaving across the tile (periodic along X).
    const amp = 0.035 * n;
    const drawTrack = (y0: number, width: number, alpha: number, phase: number): void => {
      p.wrap(0, y0 - amp - width, n, y0 + amp + width, (_dx, dy) => {
        c.strokeStyle = `rgba(8,8,10,${alpha})`;
        c.lineWidth = width;
        c.beginPath();
        for (let x = -8; x <= n + 8; x += 8) {
          const y = y0 + dy + amp * Math.sin((x / n) * 2 * Math.PI + phase);
          if (x === -8) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
        c.stroke();
      });
    };
    const tw = 0.2 * p.ppm;
    for (const [y0, ph] of [
      [0.3 * n, 0.4],
      [0.3 * n + 1.5 * p.ppm, 0.55],
    ] as const) {
      drawTrack(y0, tw, 0.1, ph);
      drawTrack(y0, tw * 0.55, 0.08, ph);
    }
    // Hairline cracks, one of them sealed with tar.
    for (let i = 0; i < 4; i++) {
      p.crack(p.rand(0, n), p.rand(0, n), p.rand(0, Math.PI * 2), p.rand(0.15, 0.4) * n, 'rgba(5,5,6,0.55)', Math.max(0.8, 1.1 * p.u), 0.5);
    }
    p.crack(p.rand(0, n), p.rand(0, n), p.rand(0, Math.PI * 2), 0.45 * n, 'rgba(12,12,14,0.5)', 0.022 * p.ppm, 0.35, 0);
    p.normalize();
  };
}

/** Concrete pavement slabs 50 cm with sand joints, stains and a few chipped corners. */
export function sidewalk(): Generator {
  return (p) => {
    const n = p.n;
    const b = p.base;
    const count = Math.round(p.tile / 0.5);
    p.fill(mul(b, 0.5));
    p.mod([
      [p.fbm(24, 24, 3, 1), 0.2],
      [p.white(2), 0.1],
    ]);
    const even = new Array<number>(count).fill(1 / count);
    const blocks = layCourses(p, even, () => even, () => 0);
    drawBlocks(p, blocks, {
      joint: Math.max(1.5, 0.008 * p.ppm),
      radius: 1.5 * p.u,
      color: () => tone(b, 1 + (p.rng() - 0.5) * 0.12, (p.rng() - 0.5) * 0.025),
      bevel: 0.6,
      shadow: 0.5,
    });
    p.mod([
      [p.fbm(3, 3, 4, 3), 0.06],
      [p.fbm(20, 20, 3, 4), 0.05, 1.1, 1, 0.85],
      [p.fbm(128, 128, 2, 5), 0.05],
      [p.white(1), 0.03],
    ]);
    const agg = p.fbm(256, 256, 1, 6);
    p.speck(agg, 0.6, 0.9, mix(b, WHITE, 0.4), 0.5);
    p.speck(agg, -0.6, -0.9, mul(b, 0.68), 0.6);
    p.speck(p.fbm(5, 5, 3, 7), 0.4, 0.85, mul(b, 0.8), 0.4); // stains
    p.speck(p.fbm(48, 48, 2, 8), 0.8, 0.92, hex(0x5a5f52), 0.5); // chewing gum / lichen spots
    for (let i = 0; i < 3; i++) {
      p.crack(p.rand(0, n), p.rand(0, n), p.rand(0, Math.PI * 2), p.rand(0.08, 0.2) * n, 'rgba(20,20,18,0.45)', Math.max(0.7, p.u), 0.6);
    }
    p.normalize();
  };
}

/** Old cobblestones laid in fans (pavés en queue de paon). */
export function cobble(): Generator {
  return (p) => {
    const n = p.n;
    const b = p.base;
    p.fill(mul(b, 0.42));
    p.mod([
      [p.fbm(48, 48, 2, 1), 0.25],
      [p.white(1), 0.15],
    ]);
    const c = p.ctx;
    const cols = 2; // fans per repeat (1 m wide)
    const rowsN = 4; // rows per repeat (0.5 m)
    const W = n / cols;
    const pitch = n / rowsN;
    const R = W * 0.715;
    const stone = 0.092 * p.ppm; // stone size incl. joint
    const joint = Math.max(1.2, 0.012 * p.ppm);
    const rings = Math.floor(R / stone);
    for (let j = -2; j <= rowsN + 1; j++) {
      const cy = (j + 1) * pitch;
      if (cy - R >= n || cy <= 0) continue;
      const jm = ((j % rowsN) + rowsN) % rowsN;
      for (let i = -1; i <= cols; i++) {
        const cx = (i + 0.5 + (jm & 1) * 0.5) * W;
        if (cx + W / 2 <= 0 || cx - W / 2 >= n) continue;
        const im = ((i % cols) + cols) % cols;
        const rng = mulberry32(hash3(p.seed, im, jm));
        c.save();
        c.beginPath();
        c.rect(cx - W / 2, cy - R - 1, W, R + 1);
        c.clip();
        // Joint bed of the fan.
        c.fillStyle = css(mul(b, 0.4 + rng() * 0.08));
        c.beginPath();
        c.moveTo(cx, cy);
        c.arc(cx, cy, R, Math.PI, 2 * Math.PI);
        c.fill();
        for (let k = 0; k < rings; k++) {
          const ro = R - k * stone;
          const ri = ro - stone + joint;
          if (ri < stone * 0.25) break;
          const rm = (ro + ri) / 2;
          const count = Math.max(3, Math.round((Math.PI * rm) / stone));
          const da = Math.PI / count;
          const gapA = joint / rm / 2;
          const jit = (rng() - 0.5) * da;
          for (let s = -1; s <= count; s++) {
            const a0 = Math.PI + s * da + jit + gapA;
            const a1 = Math.PI + (s + 1) * da + jit - gapA;
            const light = 1 + (rng() - 0.5) * 0.36;
            const col = tone(b, light * 1.08, (rng() - 0.5) * 0.07);
            c.fillStyle = css(col);
            c.beginPath();
            c.arc(cx, cy, ro - rng() * joint * 0.5, a0, a1);
            c.arc(cx, cy, ri + rng() * joint * 0.5, a1, a0, true);
            c.closePath();
            c.fill();
            // Worn crown: a lighter core, offset toward the light.
            c.fillStyle = `rgba(255,250,240,${0.1 + rng() * 0.1})`;
            c.beginPath();
            const inset = (ro - ri) * 0.24;
            c.arc(cx - inset * 0.3, cy - inset * 0.3, ro - inset, a0 + gapA * 2, a1 - gapA * 2);
            c.arc(cx - inset * 0.3, cy - inset * 0.3, ri + inset, a1 - gapA * 2, a0 + gapA * 2, true);
            c.closePath();
            c.fill();
          }
        }
        c.restore();
      }
    }
    p.mod([
      [p.fbm(3, 3, 4, 2), 0.07],
      [p.relief(128, 128, 2, 3), 0.07],
      [p.fbm(96, 96, 2, 4), 0.06],
      [p.white(2), 0.03],
    ]);
    p.speck(p.fbm(6, 6, 3, 5), 0.45, 0.9, mul(b, 0.78), 0.4);
    p.normalize();
  };
}

/** Ochre stone paving of the Place Ducale: coursed slabs of random length. */
export function pavingStone(): Generator {
  return (p) => {
    const b = p.base;
    const joint = mix(mul(b, 0.56), hex(0x6a6258), 0.4);
    p.fill(joint);
    p.mod([
      [p.fbm(32, 32, 3, 1), 0.2],
      [p.white(2), 0.1],
    ]);
    const rowsN = Math.round(p.tile / 0.4);
    const heights = new Array<number>(rowsN).fill(1 / rowsN);
    const lens: number[][] = [];
    const offs: number[] = [];
    for (let r = 0; r < rowsN; r++) {
      lens.push(randomLengths(p, 12, [2, 3, 3, 4]));
      offs.push(Math.floor(p.rng() * 12) / 12 + (r % 2 ? 1 / 24 : 0));
    }
    const blocks = layCourses(
      p,
      heights,
      (r) => lens[r]!,
      (r) => offs[r]!,
    );
    const palette: Rgb[] = [b, tone(b, 1.06, 0.03), tone(b, 0.93, -0.02), mix(b, hex(0xb9a38a), 0.6), mix(b, hex(0xd8c79a), 0.6), mix(b, hex(0xa89a84), 0.5)];
    drawBlocks(p, blocks, {
      joint: Math.max(1.5, 0.011 * p.ppm),
      radius: 2 * p.u,
      color: () => tone(palette[Math.floor(p.rng() * palette.length)]!, 1 + (p.rng() - 0.5) * 0.1),
      bevel: 0.7,
      shadow: 0.55,
    });
    p.mod([
      [p.fbm(3, 3, 4, 3), 0.06, 1.1, 1, 0.8],
      [p.fbm(24, 24, 3, 4), 0.06],
      [p.relief(96, 96, 3, 5), 0.04],
      [p.fbm(160, 160, 2, 6), 0.04],
      [p.white(1), 0.02],
    ]);
    p.speck(p.fbm(200, 200, 1, 7), 0.65, 0.92, mul(b, 0.72), 0.55); // pits
    p.speck(p.fbm(7, 7, 3, 8), 0.45, 0.9, mul(b, 0.8), 0.35); // foot traffic grime
    p.speck(p.fbm(40, 40, 2, 9), 0.75, 0.92, mix(b, hex(0x7d7f64), 0.6), 0.5); // lichen
    p.normalize();
  };
}

/** Short lawn: clumps of tone and thin blades in every direction. */
export function grass(): Generator {
  return (p) => {
    const b = p.base;
    p.fill(b);
    p.mod([
      [p.fbm(3, 3, 4, 1), 0.14, 1.5, 1, 0.6],
      [p.fbm(20, 20, 3, 2), 0.14],
      [p.fbm(128, 128, 2, 3), 0.16],
      [p.white(1), 0.08],
    ]);
    // Blades: short strokes leaning four ways, light on dark.
    const light = mix(b, hex(0xa6cc62), 0.75);
    const pale = mix(b, hex(0xcdd98a), 0.7);
    const dark = mul(b, 0.5);
    p.speck(p.fbm(360, 80, 1, 4), 0.5, 0.85, light, 0.75);
    p.speck(p.fbm(80, 360, 1, 5), 0.5, 0.85, light, 0.7);
    p.speck(p.fbm(360, 80, 1, 6), -0.5, -0.85, dark, 0.7);
    p.speck(p.fbm(80, 360, 1, 7), -0.5, -0.85, dark, 0.7);
    p.speck(p.fbm(256, 256, 1, 8), 0.78, 0.95, pale, 0.6);
    // Dry patches and clover.
    p.speck(p.fbm(5, 5, 3, 9), 0.45, 0.95, hex(0x8f8f45), 0.3);
    p.speck(p.fbm(7, 7, 3, 10), 0.5, 0.9, hex(0x2f5f2a), 0.35);
    // Diagonal strokes for the blades that lean the other ways.
    const c = p.ctx;
    const n = p.n;
    const len = 0.022 * p.ppm;
    for (const [col, count] of [
      [css(light, 0.55), 1500],
      [css(dark, 0.5), 1300],
      [css(pale, 0.5), 500],
    ] as const) {
      c.strokeStyle = col;
      c.lineWidth = Math.max(0.7, 0.9 * p.u);
      c.beginPath();
      for (let i = 0; i < count; i++) {
        const x = p.rng() * n;
        const y = p.rng() * n;
        const a = p.rng() * Math.PI * 2;
        const l = len * (0.6 + p.rng());
        const x1 = x + Math.cos(a) * l;
        const y1 = y + Math.sin(a) * l;
        p.wrap(Math.min(x, x1), Math.min(y, y1), Math.max(x, x1) + 0.01, Math.max(y, y1) + 0.01, (dx, dy) => {
          c.moveTo(x + dx, y + dy);
          c.lineTo(x1 + dx, y1 + dy);
        });
      }
      c.stroke();
    }
    p.normalize();
  };
}

/** Packed earth: brown clouds, damp patches, small stones and dry cracks. */
export function dirt(): Generator {
  return (p) => {
    const n = p.n;
    const b = p.base;
    p.fill(b);
    p.mod([
      [p.fbm(2, 2, 5, 1), 0.12, 1.2, 1, 0.7],
      [p.fbm(14, 14, 4, 2), 0.12],
      [p.relief(96, 96, 3, 3), 0.09],
      [p.fbm(160, 160, 2, 4), 0.08],
      [p.white(1), 0.05],
    ]);
    p.speck(p.fbm(4, 4, 3, 5), 0.3, 0.85, mul(b, 0.72), 0.55); // damp
    p.speck(p.fbm(6, 6, 3, 6), -0.4, -0.9, mix(b, hex(0xa08c6c), 0.6), 0.5); // dry dust
    const peb = p.fbm(200, 200, 2, 7);
    p.speck(peb, 0.68, 0.86, mix(b, hex(0xb5ab98), 0.8), 0.8);
    p.speck(peb, -0.7, -0.88, mul(b, 0.5), 0.7);
    p.speck(p.fbm(72, 72, 2, 8), 0.74, 0.86, hex(0x8f8778), 0.75); // bigger stones
    for (let i = 0; i < 5; i++) {
      p.crack(p.rand(0, n), p.rand(0, n), p.rand(0, Math.PI * 2), p.rand(0.06, 0.16) * n, 'rgba(30,20,10,0.4)', Math.max(0.7, p.u), 0.9, 0.6);
    }
    p.normalize();
  };
}

/** Light gravel: tightly packed stones of varied greys with dark gaps. */
export function gravel(): Generator {
  return (p) => {
    const n = p.n;
    const m = n - 1;
    const b = p.base;
    p.fill(b);
    const big = p.cells(64, 1);
    const small = p.cells(104, 2);
    const palette: Rgb[] = [b, tone(b, 1.14, 0.02), tone(b, 0.84, -0.02), mix(b, hex(0xc9b9a0), 0.6), mix(b, hex(0x8a8c90), 0.6), mix(b, hex(0xd9d6cc), 0.6), mix(b, hex(0x9c8672), 0.5)];
    const d = p.data;
    let q = 0;
    const half = n >> 1;
    for (let y = 0; y < n; y++) {
      const row = y * n;
      const row2 = ((y + half) & m) * n;
      for (let x = 0; x < n; x++, q += 4) {
        // Two stone sizes: the bigger stones lie on top of a bed of smaller ones.
        const i1 = row + x;
        const i2 = row2 + ((x + 77) & m);
        const top = big.id[i1]! > 0.42 && big.d[i1]! < 0.42;
        const id = top ? big.id[i1]! : small.id[i2]!;
        const dist = top ? big.d[i1]! / 0.42 : small.d[i2]! / 0.6;
        const edge = top ? Math.min(big.edge[i1]!, 0.42 - big.d[i1]!) : small.edge[i2]!;
        const col = palette[Math.floor(id * 6.999)]!;
        // Dome shading and a dark gap around every stone.
        let k = (top ? 1.06 : 0.9) + 0.2 * (0.5 - dist) + (id * 37 - Math.floor(id * 37) - 0.5) * 0.16;
        const g = edge * (top ? 14 : 9);
        if (g < 1) k *= 0.45 + 0.55 * g;
        d[q] = col[0] * k;
        d[q + 1] = col[1] * k;
        d[q + 2] = col[2] * k;
      }
    }
    p.mod([
      [p.fbm(3, 3, 4, 3), 0.07],
      [p.relief(200, 200, 2, 4), 0.06],
      [p.white(1), 0.035],
    ]);
    p.normalize();
  };
}

/** River water: dark green-blue with slow currents and faint ripple lines. */
export function water(): Generator {
  return (p) => {
    const b = p.base;
    p.fill(b);
    p.mod([
      [p.fbm(3, 5, 4, 1), 0.16, 0.7, 1, 1.2],
      [p.fbm(10, 28, 3, 2), 0.09],
      [p.fbm(40, 96, 2, 3), 0.05],
    ]);
    p.speck(p.fbm(5, 40, 3, 4), 0.5, 0.85, mix(b, hex(0x7fb0b4), 0.6), 0.3);
    p.speck(p.fbm(4, 4, 3, 5), 0.3, 0.9, mul(b, 0.75), 0.5);
    p.normalize();
  };
}
