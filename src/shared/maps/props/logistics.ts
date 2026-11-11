/**
 * Logistics props: cartons, pallets, pallet jack, transport crates — the back door of the lab.
 * Local space: origin at floor level, centre of the footprint, front facing +Z.
 */
import type { MapBuilder } from '../builder';
import { hash3, mulberry32 } from '../../math/rng';
import { C, bx, carton, cyl, cylX, hull, tilt, type PropInfo } from './kit';

/** Carton: one cardboard box (0.5 × 0.4 × 0.35 m by default). */
export function cartonBox(b: MapBuilder, o: { w?: number; d?: number; h?: number; tint?: number } = {}): void {
  const w = o.w ?? 0.5;
  const d = o.d ?? 0.4;
  const h = o.h ?? 0.35;
  carton(b, 0, 0, 0, w, h, d, o.tint);
  bx(b, w * 0.2, h * 0.25, d / 2 + 0.001, w * 0.3, h * 0.3, 0.002, 'paper_white'); // shipping label
  bx(b, -w * 0.25, h * 0.55, d / 2 + 0.001, w * 0.18, h * 0.22, 0.002, 'plastic_white', C.red); // "fragile" sticker
  for (const s of [-1, 1]) bx(b, 0, h * 0.5, s * (d / 2 + 0.001), Math.min(0.06, w / 4), h * 0.5, 0.002, 'paper_white', 0xe8dcc0); // tape ends
  hull(b, 0, 0, 0, w, h, d, 'cardboard');
}

/** Pile de cartons: stack of delivery boxes, about 1.15 m high (low cover). */
export function cartonStack(b: MapBuilder, o: { seed?: number } = {}): void {
  const rng = mulberry32(hash3(o.seed ?? 0, 907));
  // bottom layer: two big boxes side by side
  carton(b, -0.26, 0, 0, 0.5, 0.42, 0.72);
  carton(b, 0.25, 0, 0.03, 0.48, 0.42, 0.66, 0xe8d9bc);
  bx(b, -0.26, 0.12, 0.361, 0.2, 0.14, 0.002, 'paper_white');
  // second layer
  carton(b, -0.2, 0.42, -0.02 + rng() * 0.04, 0.56, 0.36, 0.6);
  carton(b, 0.3, 0.42, 0.06, 0.36, 0.3, 0.44, 0xf2efe6);
  bx(b, -0.2, 0.52, 0.29 + 0.002, 0.18, 0.12, 0.002, 'paper_white');
  // top box, slightly turned
  tilt(b, -0.12 + rng() * 0.1, 0.78 + 0.17, 0, 0.44, 0.34, 0.4, 0, 'cardboard', 0xe8d9bc, 10 + rng() * 20);
  hull(b, 0, 0, 0, 1.0, 0.78, 0.74, 'cardboard');
  hull(b, -0.1, 0.78, 0, 0.5, 0.34, 0.46, 'cardboard');
}

/** Palette: empty wooden pallet (1.2 × 0.8 × 0.144 m). */
export function pallet(b: MapBuilder, o: { collide?: boolean } = {}): void {
  for (const z of [-0.35, 0, 0.35]) {
    bx(b, 0, 0, z, 1.2, 0.022, 0.1, 'wood_planks');
    for (const x of [-0.53, 0, 0.53]) bx(b, x, 0.022, z, 0.14, 0.078, 0.1, 'wood_planks', 0xe6d6bc);
  }
  for (const x of [-0.53, 0, 0.53]) bx(b, x, 0.1, 0, 0.14, 0.022, 0.8, 'wood_planks');
  for (const z of [-0.34, -0.17, 0, 0.17, 0.34]) bx(b, 0, 0.122, z, 1.2, 0.022, 0.12, 'wood_planks', 0xf2e6d0);
  if (o.collide !== false) hull(b, 0, 0, 0, 1.2, 0.144, 0.8, 'wood');
}

/** Palette de cartons: loaded pallet wrapped in film, 1.3 m high (low cover). */
export function palletLoaded(b: MapBuilder, o: { seed?: number } = {}): void {
  const rng = mulberry32(hash3(o.seed ?? 0, 1213));
  pallet(b, { collide: false });
  for (let layer = 0; layer < 2; layer++) {
    const y = 0.144 + layer * 0.41;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        carton(b, sx * 0.29, y, sz * 0.195, 0.57, 0.4, 0.38, rng() < 0.3 ? 0xe8d9bc : undefined);
      }
    }
  }
  carton(b, -0.25, 0.964, 0.05, 0.6, 0.3, 0.5, 0xf2efe6);
  carton(b, 0.34, 0.964, -0.12, 0.42, 0.22, 0.36);
  // stretch film around the two full layers + delivery note
  bx(b, 0, 0.16, 0, 1.19, 0.79, 0.79, 'glass_frosted');
  bx(b, 0.2, 0.5, 0.398, 0.21, 0.29, 0.002, 'paper_white');
  hull(b, 0, 0, 0, 1.2, 0.96, 0.8, 'cardboard');
  hull(b, -0.05, 0.96, 0, 1.0, 0.3, 0.56, 'cardboard');
}

/** Transpalette: manual pallet jack, forks pointing toward +Z (0.55 × 1.55 × 1.2 m). */
export function palletJack(b: MapBuilder): void {
  const z0 = 0.775; // tip of the forks
  for (const s of [-1, 1]) {
    bx(b, s * 0.19, 0.05, z0 - 0.575, 0.16, 0.045, 1.15, 'metal_red');
    cylX(b, s * 0.19, 0.04, z0 - 0.1, 0.08, 0.1, 'rubber_black', undefined, 8);
  }
  bx(b, 0, 0.05, z0 - 1.2, 0.54, 0.3, 0.16, 'metal_red'); // fork carriage
  bx(b, 0, 0.35, z0 - 1.2, 0.3, 0.1, 0.14, 'metal_red');
  cyl(b, 0, 0.2, z0 - 1.3, 0.1, 0.34, 'metal_dark', undefined, 8); // pump
  for (const s of [-1, 1]) cylX(b, s * 0.07, 0.09, z0 - 1.33, 0.18, 0.06, 'rubber_black', undefined, 10);
  tilt(b, 0, 0.82, z0 - 1.4, 0.045, 0.72, 0.045, -12, 'metal_dark'); // tiller
  bx(b, 0, 1.15, z0 - 1.5, 0.34, 0.035, 0.035, 'metal_dark');
  for (const s of [-1, 1]) bx(b, s * 0.155, 1.05, z0 - 1.5, 0.03, 0.11, 0.035, 'metal_dark');
  bx(b, 0, 1.04, z0 - 1.5, 0.34, 0.03, 0.035, 'metal_dark');
  hull(b, 0, 0, z0 - 1.26, 0.54, 0.55, 0.3, 'metal');
}

/** Bac de transport: blue lidded transport crate (0.6 × 0.4 × 0.33 m). */
export function transportCrate(b: MapBuilder, o: { collide?: boolean; tint?: number } = {}): void {
  bx(b, 0, 0, 0, 0.58, 0.27, 0.38, 'plastic_blue', o.tint);
  bx(b, 0, 0.27, 0, 0.62, 0.03, 0.42, 'plastic_blue', o.tint ?? 0xdde6f0);
  bx(b, 0, 0.3, 0, 0.6, 0.025, 0.4, 'plastic_blue', 0xb8c6d8); // lid
  bx(b, 0, 0.3, 0, 0.03, 0.03, 0.4, 'plastic_blue', 0x8fa2ba); // lid seam
  for (const s of [-1, 1]) bx(b, s * 0.291, 0.18, 0, 0.004, 0.05, 0.16, 'plastic_black'); // handles
  bx(b, -0.08, 0.08, 0.191, 0.22, 0.13, 0.002, 'paper_white');
  bx(b, 0.2, 0.1, 0.191, 0.07, 0.07, 0.002, 'plastic_white', C.red); // seal
  if (o.collide !== false) hull(b, 0, 0, 0, 0.6, 0.325, 0.4, 'plastic');
}

/** Pile de bacs: three stacked transport crates (0.62 × 0.42 × 0.98 m, low cover). */
export function crateStack(b: MapBuilder): void {
  b.at(0, 0, 0, 0, () => transportCrate(b, { collide: false }));
  b.at(0.01, 0.325, -0.005, 0, () => transportCrate(b, { collide: false }));
  b.at(-0.01, 0.65, 0.005, 2, () => transportCrate(b, { collide: false }));
  hull(b, 0, 0, 0, 0.62, 0.975, 0.42, 'plastic');
}

/** Rouleau de papier bulle: standing roll of bubble wrap (0.45 × 0.45 × 1.2 m). */
export function bubbleWrapRoll(b: MapBuilder): void {
  cyl(b, 0, 0, 0, 0.44, 1.18, 'plastic_white', 0xd9e8f2, 14);
  cyl(b, 0, 0, 0, 0.1, 1.22, 'cardboard', undefined, 8);
  tilt(b, 0.225, 0.6, 0.06, 0.006, 1.18, 0.16, 0, 'plastic_white', 0xe6f0f7, 20); // loose end
  cyl(b, 0, 0.25, 0, 0.446, 0.05, 'paper_white', 0xcaa574, 14); // kraft tape bands
  cyl(b, 0, 0.9, 0, 0.446, 0.05, 'paper_white', 0xcaa574, 14);
  hull(b, 0, 0, 0, 0.4, 1.2, 0.4, 'plastic');
}

export const LOGISTICS_PROPS: PropInfo[] = [
  { id: 'carton_box', label: 'Carton', family: 'logistique', footprint: [0.5, 0.4, 0.35], cover: 'none', mount: 'floor', build: (b) => cartonBox(b) },
  { id: 'carton_stack', label: 'Pile de cartons', family: 'logistique', footprint: [1, 0.76, 1.13], cover: 'low', mount: 'floor', build: (b) => cartonStack(b) },
  { id: 'pallet', label: 'Palette', family: 'logistique', footprint: [1.2, 0.8, 0.15], cover: 'none', mount: 'floor', build: (b) => pallet(b) },
  { id: 'pallet_loaded', label: 'Palette de cartons', family: 'logistique', footprint: [1.2, 0.8, 1.27], cover: 'low', mount: 'floor', build: (b) => palletLoaded(b) },
  { id: 'pallet_jack', label: 'Transpalette', family: 'logistique', footprint: [0.55, 1.55, 1.2], cover: 'none', mount: 'floor', build: (b) => palletJack(b) },
  { id: 'transport_crate', label: 'Bac de transport', family: 'logistique', footprint: [0.62, 0.42, 0.33], cover: 'none', mount: 'floor', build: (b) => transportCrate(b) },
  { id: 'crate_stack', label: 'Pile de bacs de transport', family: 'logistique', footprint: [0.64, 0.43, 0.98], cover: 'low', mount: 'floor', build: (b) => crateStack(b) },
  { id: 'bubble_wrap_roll', label: 'Rouleau de papier bulle', family: 'logistique', footprint: [0.47, 0.45, 1.22], cover: 'low', mount: 'floor', build: (b) => bubbleWrapRoll(b) },
];
