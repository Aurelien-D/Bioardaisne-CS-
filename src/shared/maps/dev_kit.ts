/**
 * dev_kit — showroom of the level-design kit (hidden from the game menu like every dev_ map).
 *
 *  - Exhibition hall (x 0..36): three aisles; every prop of PROP_CATALOG stands in a row
 *    against a wall, under a sign giving its French label, its id and its size.
 *  - The wall at x = 36 displays the door and window props in real openings.
 *  - Demonstration area (x 36..50, double height) built only with helpers.ts: two rooms
 *    with doors and windows, a mezzanine with railings, two staircases (solid and open),
 *    pillars, skylights and wall lamps.
 *
 * Plan: npx tsx tools/map-plan.ts dev_kit          Check: npx tsx tools/map-check.ts dev_kit
 */
import { MapBuilder } from './builder';
import { ceiling, ceilingLights, doorLeaf, floor, pillar, platform, room, skylight, stairs, wall, wallLamp, type Opening } from './helpers';
import { PROP_CATALOG, PROP_FAMILIES, placeProp, type PropFamily, type PropInfo } from './props';
import {
  blind,
  doubleDoor,
  glazedDoor,
  noticeBoard,
  phlebotomyChair,
  plantLarge,
  plantSmall,
  samplingTrolley,
  singleDoor,
  sofa,
  stool,
  wallCabinet,
  washBasin,
  whiteboard,
  windowProp,
  workstation,
} from './props';
import type { MapData, MapMeta } from './types';

export const meta: MapMeta = {
  id: 'dev_kit',
  name: 'Salon du matériel',
  description: "Hall d'exposition du kit de construction : tout le mobilier du labo, rayon par rayon.",
  modes: ['tdm'],
  players: [2, 8],
};

// --- Dimensions ----------------------------------------------------------------------
const HALL_X1 = 36; // the exhibition hall spans x 0..36
const X1 = 50; // the demonstration area spans x 36..50
const Z1 = 24;
const HALL_H = 3.4;
const DEMO_H = 6.4;
const T = 0.3; // outer wall thickness
const PART_X0 = 3.5; // partitions between the aisles
const PART_X1 = 32.5;
const LABEL_Y = 2.74;

/** Number formatted the French way (decimal comma). */
const fr = (n: number): string => String(Math.round(n * 100) / 100).replace('.', ',');

interface Row {
  /** Face of the wall the row leans against. */
  z: number;
  /** 0: props face +Z, 2: props face −Z. */
  q: 0 | 2;
  x0: number;
  x1: number;
}

/** One exhibition slot: the prop against the wall (on a plinth for bench-top props) and its label. */
function exhibit(b: MapBuilder, info: PropInfo, cx: number, signW: number): void {
  const [w, d, h] = info.footprint;
  if (info.mount === 'bench') {
    const pw = Math.max(w + 0.3, 0.8);
    const pd = Math.max(d + 0.2, 0.6);
    b.box(cx - pw / 2 + 0.03, 0, 0.08, cx + pw / 2 - 0.03, 0.08, 0.02 + pd, 'metal_dark', { solid: false, detail: true });
    b.box(cx - pw / 2, 0.08, 0.05, cx + pw / 2, 0.9, 0.05 + pd, 'metal_blue', { faces: { py: 'laminate_white' } });
    b.at(cx, 0.9, 0.05 + pd / 2, 0, () => info.build(b));
  } else if (info.mount === 'wall') {
    b.at(cx, 0, d / 2, 0, () => info.build(b));
  } else {
    b.at(cx, 0, 0.06 + d / 2, 0, () => info.build(b));
  }
  b.sign({
    x: cx,
    y: Math.max(LABEL_Y, h + 0.3),
    z: 0.012,
    facing: 0,
    w: signW,
    h: 0.34,
    text: info.label,
    sub: `${info.id} — ${fr(w)} × ${fr(d)} × ${fr(h)} m`,
    style: 'plaque',
  });
}

export function build(): MapData {
  const b = new MapBuilder(meta, {
    // Interior map: a little daylight comes through the skylights only.
    sunIntensity: 0.6,
    ambientIntensity: 0.5,
    fogFar: 0,
  });

  // ===================================================================================
  // Shell: floors, outer walls, ceilings
  // ===================================================================================
  const ft = 0.3;
  floor(b, { x0: -T, z0: -T, x1: PART_X0, z1: Z1 + T, mat: 'tile_white', thickness: ft });
  floor(b, { x0: PART_X0, z0: -T, x1: PART_X1, z1: 8, mat: 'lino_grey', thickness: ft });
  floor(b, { x0: PART_X0, z0: 8, x1: PART_X1, z1: 16, mat: 'lino_blue', thickness: ft });
  floor(b, { x0: PART_X0, z0: 16, x1: PART_X1, z1: Z1 + T, mat: 'lino_green', thickness: ft });
  floor(b, { x0: PART_X1, z0: -T, x1: HALL_X1, z1: Z1 + T, mat: 'tile_white', thickness: ft });
  floor(b, { x0: HALL_X1, z0: -T, x1: X1 + T, z1: Z1 + T, mat: 'tile_beige', thickness: ft });

  const half = T / 2;
  const sk = { mat: 'plastic_grey' as const, side: 'both' as const };
  const skPos = { mat: 'plastic_grey' as const, side: 'pos' as const };
  const skNeg = { mat: 'plastic_grey' as const, side: 'neg' as const };
  // Hall (low) walls: north, south, west.
  wall(b, { x0: -T, z0: -half, x1: HALL_X1 - half, z1: -half, height: HALL_H, thickness: T, mat: 'plaster_white', matPos: 'plaster_grey', skirting: skPos });
  wall(b, { x0: -T, z0: Z1 + half, x1: HALL_X1 - half, z1: Z1 + half, height: HALL_H, thickness: T, mat: 'plaster_white', matNeg: 'plaster_green', skirting: skNeg });
  wall(b, { x0: -half, z0: 0, x1: -half, z1: Z1, height: HALL_H, thickness: T, mat: 'plaster_white', matPos: 'plaster_blue', skirting: skPos });
  // Demonstration area (tall) walls: north, south, east.
  wall(b, { x0: HALL_X1 + half, z0: -half, x1: X1 + T, z1: -half, height: DEMO_H, thickness: T, mat: 'plaster_white', skirting: skPos });
  wall(b, { x0: HALL_X1 + half, z0: Z1 + half, x1: X1 + T, z1: Z1 + half, height: DEMO_H, thickness: T, mat: 'plaster_white', skirting: skNeg });
  wall(b, { x0: X1 + half, z0: 0, x1: X1 + half, z1: Z1, height: DEMO_H, thickness: T, mat: 'plaster_white', matNeg: 'plaster_cream', skirting: skNeg });

  // The wall between the hall and the demonstration area shows the door and window props.
  const doorWall: { at: number; op: Opening; label: string; id: string; dress: () => void }[] = [
    { at: 3.0, op: { at: 3.0, width: 1.2, height: 2.1 }, label: 'Porte simple', id: 'single_door', dress: () => singleDoor(b, { wallThickness: T }) },
    { at: 6.2, op: { at: 6.2, width: 1.6, height: 1.3, sill: 0.9 }, label: 'Fenêtre', id: 'window', dress: () => windowProp(b, { wallThickness: T }) },
    { at: 10.4, op: { at: 10.4, width: 2.0, height: 2.1 }, label: 'Porte double', id: 'double_door', dress: () => doubleDoor(b, { wallThickness: T, mat: 'door_metal' }) },
    { at: 13.8, op: { at: 13.8, width: 1.2, height: 2.1 }, label: 'Porte vitrée', id: 'glazed_door', dress: () => glazedDoor(b, { wallThickness: T, hinge: 'right' }) },
    { at: 17.8, op: { at: 17.8, width: 1.6, height: 1.3, sill: 0.9 }, label: 'Fenêtre avec store', id: 'window_blind', dress: () => { windowProp(b, { wallThickness: T }); blind(b, { wallThickness: T }); } },
    { at: 21.0, op: { at: 21.0, width: 1.2, height: 2.1 }, label: 'Porte simple en bois', id: 'single_door_wood', dress: () => singleDoor(b, { wallThickness: T, mat: 'door_wood', hinge: 'right' }) },
  ];
  wall(b, {
    x0: HALL_X1,
    z0: -T,
    x1: HALL_X1,
    z1: Z1 + T,
    height: DEMO_H,
    thickness: T,
    mat: 'plaster_white',
    matNeg: 'plaster_blue',
    openings: doorWall.map((d) => ({ ...d.op, at: d.at + T })),
    skirting: sk,
  });
  for (const d of doorWall) {
    // Door props are authored for a wall along X with the room on +Z: here the "room" is the hall (−X).
    b.at(HALL_X1, 0, d.at, 3, () => {
      d.dress();
      b.sign({ x: 0, y: LABEL_Y, z: half + 0.012, facing: 0, w: 1.5, h: 0.34, text: d.label, sub: d.id, style: 'plaque' });
    });
  }

  // Ceilings.
  ceiling(b, { x0: -T, z0: -T, x1: HALL_X1 - half, z1: Z1 + T, y: HALL_H, mat: 'ceiling_tile', otherMat: 'concrete' });
  const skyA = { x0: 39.5, z0: 9, x1: 46.5, z1: 12 };
  const skyB = { x0: 40.5, z0: 19, x1: 47.5, z1: 22 };
  ceiling(b, { x0: HALL_X1 + half, z0: -T, x1: X1 + T, z1: Z1 + T, y: DEMO_H, mat: 'plaster_white', otherMat: 'concrete', holes: [skyA, skyB] });
  skylight(b, { ...skyA, y: DEMO_H });
  skylight(b, { ...skyB, y: DEMO_H });

  // Partitions between the three aisles; each aisle has its own wall colour.
  wall(b, { x0: PART_X0, z0: 8, x1: PART_X1, z1: 8, height: HALL_H, thickness: 0.2, mat: 'plaster_white', matNeg: 'plaster_grey', matPos: 'plaster_cream', skirting: sk });
  wall(b, { x0: PART_X0, z0: 16, x1: PART_X1, z1: 16, height: HALL_H, thickness: 0.2, mat: 'plaster_white', matNeg: 'plaster_cream', matPos: 'plaster_green', skirting: sk });

  // ===================================================================================
  // Exhibition: every prop of the catalogue, row by row
  // ===================================================================================
  const rows: Row[] = [
    { z: 0, q: 0, x0: 3.3, x1: 34.6 },
    { z: 7.9, q: 2, x0: PART_X0 + 0.2, x1: PART_X1 - 0.2 },
    { z: 8.1, q: 0, x0: PART_X0 + 0.2, x1: PART_X1 - 0.2 },
    { z: 15.9, q: 2, x0: PART_X0 + 0.2, x1: PART_X1 - 0.2 },
    { z: 16.1, q: 0, x0: PART_X0 + 0.2, x1: PART_X1 - 0.2 },
    { z: Z1, q: 2, x0: 3.3, x1: 34.6 },
  ];
  // Pass 1: fill the rows, family by family (each main family starts a new row).
  interface Slot {
    info: PropInfo;
    signW: number;
    width: number;
    banner?: string;
  }
  const slots: Slot[][] = rows.map(() => []);
  const familyOrder: PropFamily[] = ['labo', 'accueil', 'prelevement', 'logistique', 'bureau'];
  let rowIndex = 0;
  let used = 0;
  for (const family of familyOrder) {
    if (family !== 'logistique' && used > 0 && rowIndex + 1 < rows.length) {
      rowIndex++;
      used = 0;
    }
    const items = PROP_CATALOG.filter((p) => p.family === family && p.mount !== 'opening'); // doors and windows: wall at x = 36
    items.forEach((info, i) => {
      const signW = Math.min(1.9, Math.max(1.15, 0.3 + info.label.length * 0.047));
      const propW = info.mount === 'bench' ? Math.max(info.footprint[0] + 0.3, 0.8) : info.footprint[0];
      const width = Math.max(propW, signW) + 0.45;
      if (used + width > rows[rowIndex]!.x1 - rows[rowIndex]!.x0 && rowIndex + 1 < rows.length) {
        rowIndex++;
        used = 0;
      }
      const slot: Slot = { info, signW, width };
      if (i === 0) {
        const fam = PROP_FAMILIES.find((f) => f.id === family);
        slot.banner = fam?.label ?? family;
      }
      slots[rowIndex]!.push(slot);
      used += width;
    });
  }
  // Pass 2: spread the props evenly along each row and build them.
  rows.forEach((row, ri) => {
    const list = slots[ri]!;
    if (!list.length) return;
    const length = row.x1 - row.x0;
    const total = list.reduce((a, sl) => a + sl.width, 0);
    const extra = Math.max(0, Math.min(0.9, (length - total) / list.length));
    // Local frame of the row: origin on the wall face, x along the wall, +Z toward the aisle.
    b.at(row.q === 0 ? row.x0 : row.x1, 0, row.z, row.q, () => {
      let cursor = 0;
      for (const sl of list) {
        const w = sl.width + extra;
        exhibit(b, sl.info, cursor + w / 2, sl.signW);
        if (sl.banner) {
          b.sign({ x: cursor + 1.7, y: 3.17, z: 0.012, facing: 0, w: 3.2, h: 0.34, text: sl.banner, style: 'banner', color: 0xffffff, bg: 0x2b6cb0 });
        }
        cursor += w;
      }
      // Unused end of the row: a teaser for the next deliveries.
      if (length - cursor > 5) {
        b.sign({
          x: (cursor + length) / 2,
          y: 1.7,
          z: 0.012,
          facing: 0,
          w: 3.6,
          h: 1.5,
          text: 'Ici, bientôt : votre prochain meuble',
          sub: 'Suggestions à déposer dans la boîte à idées (qui reste à modéliser)',
          style: 'poster',
        });
      }
    });
  });

  // Welcome signs.
  b.sign({ x: 0.012, y: 2.3, z: 12, facing: 1, w: 5.2, h: 1.0, text: 'Salon du matériel', sub: "Tout le kit de construction BioArd'Aisne, rayon par rayon", style: 'banner', icon: 'logo', color: 0xffffff, bg: 0x003f71 });
  b.sign({ x: 0.012, y: 1.45, z: 12, facing: 1, w: 3.4, h: 0.4, text: 'Entrée libre — audit non compris', style: 'plaque' });
  b.sign({ x: 1.75, y: 0.012, z: 4, facing: 4, w: 2.2, h: 0.7, text: 'Allée 1 — Laboratoire', style: 'floor', icon: 'arrow_right' });
  b.sign({ x: 1.75, y: 0.012, z: 12, facing: 4, w: 2.2, h: 0.7, text: 'Allée 2 — Accueil', style: 'floor', icon: 'arrow_right' });
  b.sign({ x: 1.75, y: 0.012, z: 20, facing: 4, w: 2.2, h: 0.7, text: 'Allée 3 — Bureaux', style: 'floor', icon: 'arrow_right' });
  b.sign({ x: HALL_X1 - half - 0.012, y: 3.17, z: 12, facing: 3, w: 4.2, h: 0.34, text: 'Portes et fenêtres', style: 'banner', color: 0xffffff, bg: 0x2b6cb0 });
  placeProp(b, 'plant_large', 1.0, 0, 8.2, 1);
  placeProp(b, 'plant_large', 1.0, 0, 15.8, 1);

  // Hall lighting: a regular grid of ceiling panels.
  ceilingLights(b, { x0: 0, z0: 0, x1: HALL_X1 - half, z1: Z1 }, 4, HALL_H);

  // ===================================================================================
  // Demonstration area: built with helpers only
  // ===================================================================================
  // Two rooms sharing a wall: an office and a sampling room.
  const office = room(b, {
    x0: 38.4,
    z0: 1.6,
    x1: 43.6,
    z1: 6.6,
    wallMat: 'plaster_white',
    outerMat: 'plaster_grey',
    floorMat: null,
    ceilingMat: 'ceiling_tile',
    roofMat: 'concrete',
    skirting: 'wood_light',
    walls: {
      pz: {
        openings: [
          { at: 1.3, width: 1.2, height: 2.1, frame: 'door_wood' },
          { at: 3.6, width: 1.8, height: 1.3, sill: 0.9, fill: 'glass', frame: 'metal_white' },
        ],
      },
      nx: { openings: [{ at: 2.5, width: 1.6, height: 1.3, sill: 0.9, fill: 'glass', frame: 'metal_white' }] },
      px: { openings: [{ at: 3.6, width: 1.2, height: 2.1, frame: 'metal_white' }], mat: 'plaster_blue' },
    },
  });
  const sampling = room(b, {
    x0: 43.6,
    z0: 1.6,
    x1: 48.4,
    z1: 6.6,
    wallMat: 'wall_lab_panel',
    outerMat: 'plaster_grey',
    floorMat: null,
    ceilingMat: 'ceiling_tile',
    roofMat: 'concrete',
    skirting: 'plastic_grey',
    walls: {
      nx: false, // shared with the office
      pz: { openings: [{ at: 2.4, width: 1.2, height: 2.1, frame: 'metal_white' }] },
      px: { openings: [{ at: 2.5, width: 2.0, height: 1.3, sill: 0.9, fill: 'frosted', frame: 'metal_white' }] },
    },
  });
  // Floors of the two rooms are thin overlays on the hall floor.
  b.box(office.inner.x0, 0, office.inner.z0, office.inner.x1, 0.012, office.inner.z1, 'carpet_blue', { solid: false });
  b.box(sampling.inner.x0, 0, sampling.inner.z0, sampling.inner.x1, 0.012, sampling.inner.z1, 'lino_green', { solid: false });
  ceilingLights(b, office.inner, 2.5, office.ceilingY, { panel: [0.6, 0.6] });
  ceilingLights(b, sampling.inner, 2.5, sampling.ceilingY, { panel: [0.6, 0.6] });
  // Door leaves: open at 90°, folded at 180°, and one left ajar between the two rooms.
  doorLeaf(b, { x: office.openings.pz[0]!.x, z: office.openings.pz[0]!.z, axis: 'x', width: 1.2, hinge: 'high', swing: 'neg', open: 90, mat: 'door_wood' });
  doorLeaf(b, { x: sampling.openings.pz[0]!.x, z: sampling.openings.pz[0]!.z, axis: 'x', width: 1.2, hinge: 'high', swing: 'pos', open: 180, mat: 'door_white' });
  doorLeaf(b, { x: office.openings.px[0]!.x, z: office.openings.px[0]!.z, axis: 'z', width: 1.2, hinge: 'high', swing: 'pos', open: 115, mat: 'door_white', glazed: false });
  // The stand-alone blind of the catalogue hangs inside the office, on its glazed front.
  b.at(office.openings.pz[1]!.x, 0, office.openings.pz[1]!.z, 2, () => {
    blind(b, { width: 1.8, lowered: 0.4 });
    b.sign({ x: 0, y: 2.5, z: 0.112, facing: 0, w: 1.3, h: 0.3, text: 'Store vénitien', sub: 'blind', style: 'plaque' });
  });
  // Furniture.
  b.at(40.3, 0, 2.55, 0, () => workstation(b));
  b.at(42.2, 0, office.inner.z0 + 0.04, 0, () => whiteboard(b, { width: 1.5, text: 'Planning des gardes' }));
  b.at(office.inner.x1 - 0.03, 0, 2.6, 3, () => noticeBoard(b));
  b.at(38.95, 0, 6.0, 0, () => plantSmall(b));
  b.at(46.6, 0, 3.4, 3, () => phlebotomyChair(b));
  b.at(45.5, 0, 4.4, 1, () => stool(b));
  b.at(45.0, 0, 2.3, 0, () => samplingTrolley(b));
  b.at(47.3, 0, sampling.inner.z0 + 0.24, 0, () => washBasin(b));
  b.at(45.0, 0, sampling.inner.z0 + 0.175, 0, () => wallCabinet(b, { glass: true }));
  b.sign({ x: office.openings.pz[0]!.x, y: 2.4, z: 6.6 + 0.112, facing: 0, w: 1.3, h: 0.3, text: 'Bureau qualité', sub: 'Frapper avant de déranger', style: 'door' });
  b.sign({ x: sampling.openings.pz[0]!.x, y: 2.4, z: 6.6 + 0.112, facing: 0, w: 1.3, h: 0.3, text: 'Prélèvements — Box 1', sub: 'À jeun de préférence', style: 'door', icon: 'drop' });

  // Mezzanine with railings, a solid staircase and an open one.
  const MEZ = 3.2;
  const mez = { x0: 38, z0: 17, x1: X1, z1: Z1 };
  platform(b, {
    ...mez,
    y: MEZ,
    mat: 'concrete',
    underMat: 'plaster_white',
    pillars: 'concrete',
    rails: { nz: [[0, 1.2], [2.8, 10.2], [11.6, 12]], nx: true },
  });
  b.box(mez.x0, MEZ, mez.z0, mez.x1, MEZ + 0.012, mez.z1, 'parquet', { solid: false });
  const solidStairs = stairs(b, { x: 40, z: 17 - 3.9, dir: 0, width: 1.6, rise: MEZ, mat: 'concrete', treadMat: 'lino_blue', left: 'rail', right: 'rail' });
  stairs(b, { x: 48.9, z: 17 - 3.9, dir: 0, width: 1.4, rise: MEZ, mat: 'metal_grey', open: true, left: 'wall', right: 'rail' });
  b.at(44, MEZ, Z1 - 0.5, 2, () => sofa(b));
  b.at(47.5, MEZ, Z1 - 0.7, 2, () => plantLarge(b));
  placeProp(b, 'coffee_table', 44, MEZ, 21.6, 0);
  placeProp(b, 'storage_shelf', 39.5, 0, Z1, 2, 'back');
  placeProp(b, 'pallet_loaded', 43, 0, 22.6, 2);
  placeProp(b, 'pallet_jack', 45.2, 0, 21.4, 1);
  placeProp(b, 'crate_stack', 47, 0, Z1 - 0.3, 2);
  ceilingLights(b, { x0: mez.x0, z0: mez.z0, x1: mez.x1, z1: mez.z1 }, 4, MEZ - 0.2, { panel: [0.6, 0.6], intensity: 0.8 });
  b.sign({ x: 44, y: MEZ + 2.0, z: Z1 - 0.012, facing: 2, w: 3.6, h: 0.5, text: 'Mezzanine', sub: 'Accès réservé au technicien de garde (et à sa couette)', style: 'banner', color: 0xffffff, bg: 0x003f71 });
  b.sign({ x: solidStairs.top.x, y: 0.012, z: 12.2, facing: 4, w: 1.6, h: 0.5, text: 'Mezzanine', style: 'floor', icon: 'arrow_up' });

  // Columns in front of the double door, wall lamps, extra light for the tall space.
  pillar(b, { x: 37.3, z: 8.6, height: DEMO_H, size: 0.5, mat: 'stone_white', round: true, trim: true });
  pillar(b, { x: 37.3, z: 12.2, height: DEMO_H, size: 0.5, mat: 'stone_white', round: true, trim: true });
  for (const z of [3, 8, 13, 18.5, 22.5]) wallLamp(b, X1, 4.6, z, 3);
  for (const x of [38.5, 43, 47.5]) wallLamp(b, x, 4.6, 0, 0);
  b.light(43, 5.2, 4, 0xfff4e0, 1.1, 12);
  b.light(41, 4.6, 14, 0xfff4e0, 1.2, 13);
  b.light(46.5, 4.6, 14, 0xfff4e0, 1.2, 13);
  b.light(37.6, 2.8, 20.5, 0xfff4e0, 0.8, 8);
  b.sign({ x: 43.4, y: 2.52, z: 6.6 + 0.112, facing: 0, w: 3.4, h: 0.44, text: 'Zone témoin', sub: 'Construite avec helpers.ts — ne pas nourrir les auditeurs', style: 'banner', color: 0xffffff, bg: 0xe7343f });

  // ===================================================================================
  // Gameplay
  // ===================================================================================
  for (let i = 0; i < 8; i++) b.spawn(0, 1.75, 0, 2 + i * 2.85, -90);
  for (let i = 0; i < 4; i++) {
    b.spawn(1, 48.6, 0, 7.6 + i * 1.5, 90);
    b.spawn(1, 46.8, 0, 7.6 + i * 1.5, 90);
  }
  b.point('poi', 'allee_labo', 18, 0, 4, 'Allée Laboratoire');
  b.point('poi', 'allee_accueil', 18, 0, 12, 'Allée Accueil');
  b.point('poi', 'allee_bureaux', 18, 0, 20, 'Allée Bureaux');
  b.point('poi', 'zone_temoin', 43, 0, 10.5, 'Zone témoin');
  b.point('poi', 'mezzanine', 44, MEZ, 20, 'Mezzanine');
  b.point('poi', 'bureau_qualite', 41, 0, 4.6, 'Bureau qualité');

  return b.build();
}
