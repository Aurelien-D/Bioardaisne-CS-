/**
 * Shelf packer for the lightmap atlas. Pure TypeScript (no DOM, no THREE).
 *
 * Rectangles are sorted by decreasing height and laid out left to right on horizontal
 * shelves. The sizes handed in already include the gutter, so the packer only guarantees
 * that rectangles never overlap and stay inside the atlas.
 */

export interface PackedAtlas {
  width: number;
  height: number;
  /** x, y of the top-left corner of every rectangle, in input order (2 numbers each). */
  pos: Int32Array;
}

const nextPow2 = (v: number): number => {
  let p = 1;
  while (p < v) p *= 2;
  return p;
};

/**
 * Pack `count` rectangles of size (w[i], h[i]) into an atlas no larger than
 * `maxSize` × `maxSize`. The width is a power of two chosen from the total area; the
 * height is the used height rounded up to a multiple of 4. Returns null when the
 * rectangles do not fit (the caller lowers the texel density and tries again).
 */
export function packRects(w: ArrayLike<number>, h: ArrayLike<number>, count: number, maxSize: number): PackedAtlas | null {
  let area = 0;
  let widest = 1;
  for (let i = 0; i < count; i++) {
    area += w[i]! * h[i]!;
    if (w[i]! > widest) widest = w[i]!;
    if (w[i]! > maxSize || h[i]! > maxSize) return null;
  }
  const order = new Int32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  // Tallest first; ties broken by width then index so the layout is deterministic.
  const sorted = Array.from(order).sort((a, b) => h[b]! - h[a]! || w[b]! - w[a]! || a - b);

  let width = Math.max(32, nextPow2(Math.max(widest, Math.ceil(Math.sqrt(area * 1.08)))));
  for (; width <= maxSize; width *= 2) {
    const pos = new Int32Array(count * 2);
    let x = 0;
    let y = 0;
    let shelf = 0;
    for (let k = 0; k < count; k++) {
      const i = sorted[k]!;
      const rw = w[i]!;
      const rh = h[i]!;
      if (x + rw > width) {
        y += shelf;
        x = 0;
        shelf = 0;
      }
      pos[i * 2] = x;
      pos[i * 2 + 1] = y;
      x += rw;
      if (rh > shelf) shelf = rh;
    }
    const used = y + shelf;
    if (used <= maxSize) return { width, height: Math.max(4, Math.ceil(used / 4) * 4), pos };
  }
  return null;
}
