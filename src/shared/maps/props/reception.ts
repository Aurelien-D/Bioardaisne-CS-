/**
 * Reception and waiting-room props: counters, ticket kiosk, linked chairs, plants…
 * Local space: origin at floor level, centre of the footprint, front (public side) facing +Z.
 */
import type { MapBuilder } from '../builder';
import type { MaterialId } from '../materials';
import { hash3, mulberry32 } from '../../math/rng';
import { C, ball, bx, cyl, hull, keyboard, monitor, tilt, type PropInfo } from './kit';

/**
 * One straight run of reception counter, centred on x = 0, public side toward +Z:
 * low staff worktop behind a high transaction ledge, optional glass screen.
 */
function counterRun(b: MapBuilder, w: number, glass: boolean, equipped: boolean): void {
  // public fascia with the brand band
  bx(b, 0, 0, 0.3, w, 1.1, 0.06, 'laminate_white');
  bx(b, 0, 0, 0.336, w, 0.1, 0.012, 'metal_dark');
  bx(b, 0, 0.32, 0.336, w, 0.46, 0.012, 'plastic_white', C.blue);
  bx(b, 0, 0.8, 0.336, w, 0.03, 0.012, 'plastic_white', C.red);
  // ledge, staff worktop, end panels
  bx(b, 0, 1.1, 0.25, w + 0.04, 0.04, 0.34, 'wood_light');
  bx(b, 0, 0.71, -0.07, w - 0.08, 0.03, 0.68, 'laminate_grey');
  for (const s of [-1, 1]) {
    bx(b, s * (w / 2 - 0.02), 0, -0.07, 0.04, 0.71, 0.68, 'laminate_white');
    bx(b, s * (w / 2 - 0.02), 0.71, 0.15, 0.04, 0.39, 0.24, 'laminate_white');
  }
  if (glass) {
    for (const s of [-1, 1]) bx(b, s * (w / 2 - 0.14), 1.14, 0.3, 0.03, 0.74, 0.03, 'metal_brushed');
    bx(b, 0, 1.2, 0.3, w - 0.28, 0.66, 0.014, 'glass');
    bx(b, 0, 1.86, 0.3, w - 0.22, 0.025, 0.035, 'metal_brushed');
    hull(b, 0, 1.14, 0.3, w - 0.24, 0.74, 0.04, 'glass');
  }
  if (equipped) {
    b.at(-w / 4, 0.74, -0.12, 2, () => {
      monitor(b, 0, 0, -0.1);
      keyboard(b, -0.05, 0, 0.12);
    });
    bx(b, w / 4, 1.14, 0.25, 0.09, 0.03, 0.14, 'plastic_black'); // card reader
    bx(b, w / 4, 1.17, 0.25, 0.06, 0.012, 0.07, 'screen_on');
    bx(b, w / 4 + 0.3, 1.14, 0.22, 0.2, 0.012, 0.14, 'paper_white'); // forms
    tilt(b, w / 4 - 0.4, 1.23, 0.2, 0.16, 0.2, 0.02, -12, 'plastic_white', C.light); // leaflet holder
    tilt(b, w / 4 - 0.4, 1.235, 0.214, 0.13, 0.17, 0.004, -12, 'paper_white', 0xcfe6ff);
  }
  hull(b, 0, 0, 0.01, w, 1.14, 0.82, 'wood');
}

/** Banque d'accueil droite: straight reception counter with a glass screen (2.4 × 0.85 × 1.9 m). */
export function receptionDesk(b: MapBuilder, o: { width?: number; glass?: boolean } = {}): void {
  b.at(0, 0, -0.01, 0, () => counterRun(b, o.width ?? 2.4, o.glass !== false, true));
}

/** Banque d'accueil en L: main counter with a glass screen + a return wing on the +X end going back. */
export function receptionDeskL(b: MapBuilder, o: { width?: number; wing?: number } = {}): void {
  const w = o.width ?? 2.6;
  const wing = o.wing ?? 1.2;
  const depth = 0.82 + wing;
  b.at(0, 0, depth / 2 - 0.42, 0, () => {
    counterRun(b, w, true, true);
    b.at(w / 2 - 0.42, 0, -0.4 - wing / 2, 1, () => counterRun(b, wing, false, false));
  });
}

/** Borne de tickets: queue-ticket kiosk with a touch screen (0.5 × 0.4 × 1.45 m). */
export function ticketKiosk(b: MapBuilder, o: { sign?: boolean } = {}): void {
  bx(b, 0, 0, 0, 0.5, 0.03, 0.4, 'metal_dark');
  bx(b, 0, 0.03, -0.03, 0.4, 1.02, 0.22, 'metal_white');
  bx(b, 0, 0.2, 0.082, 0.4, 0.3, 0.006, 'plastic_white', C.blue);
  // tilted head with the touch screen
  tilt(b, 0, 1.22, 0.0, 0.44, 0.4, 0.07, -22, 'metal_white');
  tilt(b, 0, 1.22 + 0.375 * 0.039, 0.927 * 0.039, 0.38, 0.32, 0.006, -22, 'screen_on');
  // ticket slot and a ticket waiting to be taken
  bx(b, 0, 0.86, 0.082, 0.16, 0.025, 0.008, 'plastic_black');
  bx(b, 0, 0.868, 0.1, 0.06, 0.002, 0.05, 'paper_white');
  bx(b, 0.12, 0.93, 0.082, 0.03, 0.03, 0.008, 'led_green');
  if (o.sign !== false) {
    b.sign({ x: 0, y: 0.68, z: 0.086, facing: 0, w: 0.34, h: 0.12, text: 'Prenez un ticket', style: 'plaque', color: 0xffffff, bg: C.navy });
  }
  hull(b, 0, 0, -0.02, 0.44, 1.4, 0.3, 'metal');
}

/** Rangée de chaises d'attente: 3 or 4 linked seats on a beam (0.55 m per seat). */
export function waitingChairs(b: MapBuilder, o: { seats?: number; mat?: MaterialId; tint?: number } = {}): void {
  const n = o.seats ?? 3;
  const mat = o.mat ?? 'plastic_blue';
  const w = n * 0.55;
  bx(b, 0, 0.36, -0.03, w - 0.12, 0.05, 0.08, 'metal_dark');
  for (const s of [-1, 1]) {
    const x = s * (w / 2 - 0.3);
    bx(b, x, 0.03, -0.03, 0.05, 0.33, 0.05, 'metal_dark');
    bx(b, x, 0, 0, 0.06, 0.03, 0.5, 'metal_dark');
    // end armrests
    bx(b, s * (w / 2 - 0.015), 0.41, 0.2, 0.03, 0.2, 0.03, 'metal_dark');
    bx(b, s * (w / 2 - 0.015), 0.6, 0.03, 0.04, 0.03, 0.38, 'metal_dark');
  }
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (i + 0.5) * 0.55;
    bx(b, x, 0.41, 0.04, 0.48, 0.05, 0.46, mat, o.tint);
    tilt(b, x, 0.67, -0.235, 0.48, 0.4, 0.04, -10, mat, o.tint);
  }
  hull(b, 0, 0, 0.03, w, 0.46, 0.5, 'plastic');
  hull(b, 0, 0.46, -0.24, w, 0.4, 0.12, 'plastic');
}

/** Table basse with a few magazines (1.0 × 0.6 × 0.43 m). */
export function coffeeTable(b: MapBuilder, o: { seed?: number } = {}): void {
  bx(b, 0, 0.38, 0, 1.0, 0.04, 0.6, 'wood_light');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(b, sx * 0.44, 0, sz * 0.24, 0.05, 0.38, 0.05, 'metal_dark');
  bx(b, 0, 0.14, 0, 0.86, 0.02, 0.46, 'wood_light');
  const rng = mulberry32(hash3(o.seed ?? 0, 41));
  const tints = [0xcfe6ff, 0xffe9a8, 0xf7c6c6, 0xffffff, 0xcdeccf];
  for (let i = 0; i < 4; i++) {
    const x = -0.3 + i * 0.2 + (rng() - 0.5) * 0.06;
    const z = (rng() - 0.5) * 0.2;
    tilt(b, x, 0.423 + i * 0.006, z, 0.21, 0.006, 0.29, 0, 'paper_white', tints[i % tints.length]!, (rng() - 0.5) * 70);
  }
  tilt(b, 0.2, 0.163, 0.02, 0.21, 0.02, 0.29, 0, 'paper_white', 0xffe9a8, 12);
  hull(b, 0, 0, 0, 1.0, 0.42, 0.6, 'wood');
}

/** Fontaine à eau: bottle-fed water dispenser with its cup tube (0.42 × 0.36 × 1.4 m). */
export function waterDispenser(b: MapBuilder): void {
  bx(b, 0, 0, 0, 0.34, 0.95, 0.34, 'plastic_white');
  bx(b, 0, 0.5, 0.171, 0.26, 0.34, 0.004, 'plastic_grey');
  bx(b, -0.05, 0.74, 0.185, 0.035, 0.05, 0.03, 'plastic_blue');
  bx(b, 0.05, 0.74, 0.185, 0.035, 0.05, 0.03, 'plastic_red');
  bx(b, 0, 0.5, 0.2, 0.24, 0.02, 0.08, 'plastic_grey', 0x7c8288);
  cyl(b, 0, 0.52, 0.2, 0.06, 0.08, 'plastic_white', undefined, 8); // a forgotten cup
  cyl(b, 0.2, 0.45, 0, 0.08, 0.42, 'plastic_white', C.light, 8); // cup tube
  cyl(b, 0, 0.95, 0, 0.1, 0.05, 'plastic_white', C.blue, 10);
  cyl(b, 0, 1.0, 0, 0.27, 0.32, 'glass', 0x8cc4ff, 12);
  ball(b, 0, 1.32, 0, 0.27, 0.14, 0.27, 'glass', 0x8cc4ff, 12);
  hull(b, 0, 0, 0, 0.34, 1.36, 0.34, 'plastic');
}

/** Porte-revues: free-standing leaflet / magazine display (0.5 × 0.3 × 1.35 m). */
export function magazineRack(b: MapBuilder, o: { seed?: number } = {}): void {
  bx(b, 0, 0, 0, 0.5, 0.03, 0.3, 'metal_dark');
  bx(b, 0, 0.03, -0.11, 0.5, 1.3, 0.03, 'metal_white');
  const rng = mulberry32(hash3(o.seed ?? 0, 67));
  const tints = [0xcfe6ff, 0xffe9a8, 0xf7c6c6, 0xffffff, 0xcdeccf, C.blue];
  for (let k = 0; k < 4; k++) {
    const y = 0.12 + k * 0.3;
    bx(b, 0, y, -0.04, 0.48, 0.015, 0.12, 'metal_white');
    bx(b, 0, y, 0.02, 0.48, 0.06, 0.012, 'metal_white');
    for (let i = 0; i < 3; i++) {
      if (rng() < 0.15) continue;
      tilt(b, -0.16 + i * 0.16, y + 0.135, -0.045, 0.14, 0.24, 0.012, -14, 'paper_white', tints[Math.floor(rng() * tints.length)]!);
    }
  }
  hull(b, 0, 0, -0.04, 0.5, 1.33, 0.22, 'metal');
}

/** Plante verte (petite): potted plant, 0.85 m. */
export function plantSmall(b: MapBuilder): void {
  cyl(b, 0, 0, 0, 0.3, 0.28, 'plastic_white', undefined, 10);
  cyl(b, 0, 0.27, 0, 0.26, 0.02, 'dirt', undefined, 10);
  ball(b, 0, 0.5, 0, 0.44, 0.4, 0.44, 'foliage', undefined, 8);
  ball(b, 0.1, 0.68, 0.05, 0.3, 0.32, 0.3, 'foliage', 0xd8f0c8, 8);
  ball(b, -0.11, 0.63, -0.06, 0.28, 0.3, 0.28, 'foliage', 0xb8d8a8, 8);
  ball(b, 0.02, 0.6, 0.14, 0.24, 0.24, 0.24, 'foliage', 0xb8d8a8, 8);
  cyl(b, 0, 0.26, 0, 0.32, 0.025, 'plastic_white', 0xd8dde2, 10); // rim
  cyl(b, 0, 0, 0, 0.34, 0.015, 'plastic_grey', undefined, 10); // saucer
  hull(b, 0, 0, 0, 0.3, 0.55, 0.3, 'plastic');
}

/** Plante verte (grande): indoor tree in a square planter, 1.95 m. */
export function plantLarge(b: MapBuilder): void {
  bx(b, 0, 0, 0, 0.46, 0.46, 0.46, 'plastic_grey', 0x5a5f66);
  bx(b, 0, 0.44, 0, 0.4, 0.025, 0.4, 'dirt');
  cyl(b, 0, 0.46, 0, 0.06, 0.85, 'bark', undefined, 6);
  tilt(b, 0.1, 1.2, 0.03, 0.035, 0.45, 0.035, 0, 'bark', undefined, 0, -28);
  tilt(b, -0.09, 1.15, -0.04, 0.035, 0.4, 0.035, 0, 'bark', undefined, 0, 30);
  ball(b, 0, 1.55, 0, 0.7, 0.6, 0.7, 'foliage', undefined, 8);
  ball(b, 0.26, 1.35, 0.1, 0.46, 0.42, 0.46, 'foliage', 0xd8f0c8, 8);
  ball(b, -0.26, 1.3, -0.08, 0.44, 0.42, 0.44, 'foliage', 0xb8d8a8, 8);
  ball(b, 0.05, 1.8, -0.1, 0.42, 0.34, 0.42, 'foliage', 0xd8f0c8, 8);
  ball(b, -0.08, 1.2, 0.22, 0.34, 0.3, 0.34, 'foliage', undefined, 8);
  hull(b, 0, 0, 0, 0.46, 1.25, 0.46, 'plastic');
}

/** Paravent: three-panel medical screen on feet. Hides but does not stop bullets. */
export function privacyScreen(b: MapBuilder): void {
  const pw = 0.53;
  for (let i = 0; i < 3; i++) {
    const x = -pw + i * pw;
    for (const s of [-1, 1]) bx(b, x + s * (pw / 2 - 0.012), 0.06, 0, 0.024, 1.69, 0.024, 'metal_brushed');
    bx(b, x, 1.72, 0, pw, 0.024, 0.024, 'metal_brushed');
    bx(b, x, 0.3, 0, pw, 0.024, 0.024, 'metal_brushed');
    bx(b, x, 0.36, 0, pw - 0.06, 1.33, 0.008, 'fabric_white', i === 1 ? 0xb9d2ec : 0xcfe0f2);
  }
  for (const s of [-1, 1]) {
    bx(b, s * (pw * 1.5 - 0.02), 0.03, 0, 0.04, 0.03, 0.42, 'metal_brushed');
    for (const sz of [-1, 1]) ball(b, s * (pw * 1.5 - 0.02), 0.03, sz * 0.2, 0.06, 0.06, 0.06, 'rubber_black', undefined, 6);
  }
  hull(b, 0, 0, 0, 1.6, 1.75, 0.08, 'fabric', true);
}

/** Claustra: wooden slat divider (1.5 × 0.12 × 2.0 m). Hides but does not stop bullets. */
export function slatDivider(b: MapBuilder, o: { width?: number } = {}): void {
  const w = o.width ?? 1.5;
  bx(b, 0, 0, 0, w, 0.08, 0.12, 'wood_light');
  bx(b, 0, 1.94, 0, w, 0.06, 0.12, 'wood_light');
  const n = Math.max(3, Math.round(w / 0.125));
  for (let i = 0; i < n; i++) bx(b, -w / 2 + ((i + 0.5) * w) / n, 0.08, 0, 0.045, 1.86, 0.09, 'wood_light', i % 2 ? 0xf2e2c8 : undefined);
  hull(b, 0, 0, 0, w, 2.0, 0.1, 'wood', true);
}

/** Écran d'appel: wall screen showing the number being called (mounted at 1.75–2.4 m). */
export function callScreen(b: MapBuilder, o: { text?: string; sub?: string } = {}): void {
  bx(b, 0, 1.95, -0.03, 0.3, 0.25, 0.02, 'metal_dark');
  bx(b, 0, 1.75, 0, 1.1, 0.66, 0.04, 'plastic_black');
  bx(b, 0, 1.78, 0.022, 1.04, 0.6, 0.004, 'screen_on');
  bx(b, 0, 1.7, -0.005, 0.7, 0.05, 0.03, 'plastic_grey', 0x5e646b); // sound bar
  bx(b, 0.5, 1.765, 0.021, 0.02, 0.012, 0.004, 'led_green');
  bx(b, 0, 1.2, -0.03, 0.05, 0.5, 0.02, 'plastic_white'); // cable cover
  bx(b, -0.42, 1.765, 0.021, 0.12, 0.012, 0.004, 'plastic_white', C.blue);
  b.sign({
    x: 0,
    y: 2.08,
    z: 0.027,
    facing: 0,
    w: 1.0,
    h: 0.56,
    text: o.text ?? 'Numéro appelé',
    sub: o.sub ?? 'A 047 — Box 2',
    style: 'screen',
    lit: true,
  });
}

export const RECEPTION_PROPS: PropInfo[] = [
  { id: 'reception_desk', label: "Banque d'accueil", family: 'accueil', footprint: [2.44, 0.85, 1.9], cover: 'low', mount: 'floor', build: (b) => receptionDesk(b) },
  { id: 'reception_desk_l', label: "Banque d'accueil en L", family: 'accueil', footprint: [2.64, 2.02, 1.9], cover: 'low', mount: 'floor', build: (b) => receptionDeskL(b) },
  { id: 'ticket_kiosk', label: 'Borne de tickets', family: 'accueil', footprint: [0.5, 0.4, 1.45], cover: 'low', mount: 'floor', build: (b) => ticketKiosk(b) },
  { id: 'waiting_chairs_3', label: "Chaises d'attente (3 places)", family: 'accueil', footprint: [1.65, 0.6, 0.88], cover: 'none', mount: 'floor', build: (b) => waitingChairs(b) },
  { id: 'waiting_chairs_4', label: "Chaises d'attente (4 places)", family: 'accueil', footprint: [2.2, 0.6, 0.88], cover: 'none', mount: 'floor', build: (b) => waitingChairs(b, { seats: 4, mat: 'fabric_grey' }) },
  { id: 'coffee_table', label: 'Table basse et magazines', family: 'accueil', footprint: [1, 0.6, 0.45], cover: 'none', mount: 'floor', build: (b) => coffeeTable(b) },
  { id: 'water_dispenser', label: 'Fontaine à eau', family: 'accueil', footprint: [0.48, 0.36, 1.4], cover: 'low', mount: 'floor', build: (b) => waterDispenser(b) },
  { id: 'magazine_rack', label: 'Porte-revues', family: 'accueil', footprint: [0.5, 0.3, 1.35], cover: 'low', mount: 'floor', build: (b) => magazineRack(b) },
  { id: 'plant_small', label: 'Plante verte (petite)', family: 'accueil', footprint: [0.5, 0.5, 0.85], cover: 'none', mount: 'floor', build: (b) => plantSmall(b) },
  { id: 'plant_large', label: 'Plante verte (grande)', family: 'accueil', footprint: [0.95, 0.95, 1.97], cover: 'none', mount: 'floor', build: (b) => plantLarge(b) },
  { id: 'privacy_screen', label: 'Paravent', family: 'accueil', footprint: [1.6, 0.42, 1.75], cover: 'none', mount: 'floor', build: (b) => privacyScreen(b) },
  { id: 'slat_divider', label: 'Claustra', family: 'accueil', footprint: [1.5, 0.12, 2], cover: 'none', mount: 'floor', build: (b) => slatDivider(b) },
  { id: 'call_screen', label: "Écran d'appel", family: 'accueil', footprint: [1.1, 0.08, 2.41], cover: 'none', mount: 'wall', build: (b) => callScreen(b) },
];
