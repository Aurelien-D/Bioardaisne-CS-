/** Deterministic PRNG utilities (identical results on client and server). */

/** 32-bit integer hash of up to three integers. */
export function hash3(a: number, b = 0, c = 0): number {
  let h = (a | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h ^= (b | 0) + 0x7f4a7c15;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= (c | 0) + 0x165667b1;
  h = Math.imul(h ^ (h >>> 16), 0x27d4eb2f);
  return (h ^ (h >>> 15)) >>> 0;
}

/** mulberry32: returns a function producing floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;
