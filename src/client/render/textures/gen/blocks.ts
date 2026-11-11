/**
 * Coursed masonry layout shared by bricks, ashlar, paving slabs and pavement:
 * rows of rectangular blocks separated by recessed joints.
 */
import { css, type Painter, type Rgb } from '../painter';

/** One block, in texels. `x` may run past the tile width: it wraps around. */
export interface Block {
  x: number;
  y: number;
  w: number;
  h: number;
  row: number;
  col: number;
}

/**
 * Lay out courses. `heights` are the course heights and `lengths(row)` the block lengths
 * of a course, both as fractions of the tile that sum to 1; `offset(row)` shifts a course
 * sideways (fraction of the tile). Edges are snapped to whole texels so joints stay crisp.
 */
export function layCourses(p: Painter, heights: readonly number[], lengths: (row: number) => readonly number[], offset: (row: number) => number): Block[] {
  const n = p.n;
  const blocks: Block[] = [];
  let y = 0;
  for (let row = 0; row < heights.length; row++) {
    const y0 = Math.round(y * n);
    y += heights[row]!;
    const y1 = row === heights.length - 1 ? n : Math.round(y * n);
    const ls = lengths(row);
    const off = offset(row);
    let x = 0;
    for (let col = 0; col < ls.length; col++) {
      const x0 = Math.round((off + x) * n);
      x += ls[col]!;
      const x1 = Math.round((off + x) * n);
      blocks.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, row, col });
    }
  }
  return blocks;
}

export interface BlockStyle {
  /** Joint width in texels. */
  joint: number;
  /** Corner radius in texels. */
  radius: number;
  color: (b: Block) => Rgb;
  /** Strength (0..1) of the lit top / left edges and shaded bottom / right edges. */
  bevel: number;
  /** Strength (0..1) of the shadow the block casts into the joint below / right of it. */
  shadow: number;
  /** Width of the bevel lines in texels. */
  edge?: number;
}

/** Draw the blocks over the (already painted) joint colour. */
export function drawBlocks(p: Painter, blocks: readonly Block[], s: BlockStyle): void {
  const c = p.ctx;
  const half = s.joint / 2;
  const e = s.edge ?? Math.max(1, 1.2 * p.u);
  for (const b of blocks) {
    const w = b.w - s.joint;
    const h = b.h - s.joint;
    if (w <= 0 || h <= 0) continue;
    const col = css(s.color(b));
    p.wrap(b.x, b.y, b.x + b.w, b.y + b.h, (dx, dy) => {
      const x = b.x + half + dx;
      const y = b.y + half + dy;
      if (s.shadow > 0) {
        c.fillStyle = `rgba(0,0,0,${0.42 * s.shadow})`;
        c.fillRect(x + half * 0.6, y + half * 0.8, w, h);
      }
      c.fillStyle = col;
      if (s.radius >= 0.75) {
        c.beginPath();
        c.roundRect(x, y, w, h, s.radius);
        c.fill();
      } else {
        c.fillRect(x, y, w, h);
      }
      if (s.bevel > 0) {
        const r = s.radius;
        c.fillStyle = `rgba(255,255,255,${0.3 * s.bevel})`;
        c.fillRect(x + r, y, w - 2 * r, e);
        c.fillRect(x, y + r, e, h - 2 * r);
        c.fillStyle = `rgba(0,0,0,${0.26 * s.bevel})`;
        c.fillRect(x + r, y + h - e, w - 2 * r, e);
        c.fillRect(x + w - e, y + r, e, h - 2 * r);
      }
    });
  }
}

/** Split 1 into random lengths taken from `units` (multiples of 1 / total). */
export function randomLengths(p: Painter, total: number, units: readonly number[]): number[] {
  const out: number[] = [];
  let left = total;
  const min = Math.min(...units);
  while (left > 0) {
    const fit = units.filter((u) => u === left || left - u >= min);
    const u = fit.length ? fit[Math.floor(p.rng() * fit.length)]! : left;
    out.push(u / total);
    left -= u;
  }
  return out;
}
