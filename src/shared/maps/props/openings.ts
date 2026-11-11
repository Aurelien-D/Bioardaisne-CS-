/**
 * Doors, windows and blinds as props.
 *
 * Local space: the WALL runs along X through the origin (centre of its thickness),
 * the origin is on the floor in the middle of the opening, the room side is +Z.
 * These props only dress an opening: cut the opening itself with `wall()` (helpers.ts),
 * e.g. `{ at, width: 1.2, height: 2.1 }` for a single door or
 * `{ at, width: 1.6, height: 1.3, sill: 0.9 }` for the default window.
 */
import type { MapBuilder } from '../builder';
import type { MaterialId } from '../materials';
import { doorFrame, doorLeaf, windowUnit } from '../helpers';
import { C, bx, type PropInfo } from './kit';

export interface DoorOpts {
  /** Clear width of the doorway (default 1.2 single, 2.0 double). */
  width?: number;
  /** Clear height of the doorway (default 2.1). */
  height?: number;
  /** Thickness of the wall (default 0.2). */
  wallThickness?: number;
  /** Leaf material: 'door_white' (default), 'door_wood' or 'door_metal'. */
  mat?: MaterialId;
  /** Frame material (default: 'metal_white' for white / metal doors, 'door_wood' for wooden ones). */
  frame?: MaterialId;
  /** Hinge side seen from the room (+Z side): 'left' (default) or 'right'. Single doors only. */
  hinge?: 'left' | 'right';
  /** The leaf opens into the room (+Z, default) or away from it. */
  swing?: 'in' | 'out';
  /** 90 (default, thin collider), 180 (flat against the wall, no collider) or 0 (closed, solid). */
  open?: number;
  /** Glazed upper panel. */
  glazed?: boolean;
}

/** Porte simple: frame + one leaf, open at 90° by default so the doorway stays free. */
export function singleDoor(b: MapBuilder, o: DoorOpts = {}): void {
  const w = o.width ?? 1.2;
  const h = o.height ?? 2.1;
  const mat = o.mat ?? 'door_white';
  const t = o.wallThickness ?? 0.2;
  doorFrame(b, { x: 0, z: 0, axis: 'x', width: w, height: h, wallThickness: t, mat: o.frame ?? (mat === 'door_wood' ? 'door_wood' : 'metal_white') });
  // Seen from the room (+Z side) looking at the wall, the viewer's left is −X (the 'low' jamb).
  doorLeaf(b, {
    x: 0,
    z: 0,
    axis: 'x',
    width: w,
    height: h - 0.04,
    wallThickness: t,
    hinge: (o.hinge ?? 'left') === 'left' ? 'low' : 'high',
    swing: (o.swing ?? 'in') === 'in' ? 'pos' : 'neg',
    open: o.open ?? 90,
    mat,
    glazed: o.glazed ?? false,
  });
}

/** Porte double: frame + two leaves, both open at 90° by default (doorway 2.0 m). */
export function doubleDoor(b: MapBuilder, o: DoorOpts = {}): void {
  const w = o.width ?? 2.0;
  const h = o.height ?? 2.1;
  const mat = o.mat ?? 'door_white';
  const t = o.wallThickness ?? 0.2;
  const open = o.open ?? 90;
  doorFrame(b, { x: 0, z: 0, axis: 'x', width: w, height: h, wallThickness: t, mat: o.frame ?? (mat === 'door_wood' ? 'door_wood' : 'metal_white') });
  const swing = (o.swing ?? 'in') === 'in' ? 'pos' : 'neg';
  for (const hinge of ['low', 'high'] as const) {
    // Each leaf is half the doorway wide and hinged on its own jamb.
    const cx = hinge === 'low' ? -w / 4 : w / 4;
    doorLeaf(b, { x: cx, z: 0, axis: 'x', width: w / 2, height: h - 0.04, wallThickness: t, hinge, swing, open, mat, glazed: o.glazed ?? false });
  }
}

/** Porte vitrée: glazed door in a metal frame, open at 90°. */
export function glazedDoor(b: MapBuilder, o: DoorOpts = {}): void {
  singleDoor(b, { mat: 'metal_white', ...o, glazed: true });
}

export interface WindowOpts {
  width?: number;
  height?: number;
  /** Height of the sill above the floor (default 0.9). */
  sill?: number;
  wallThickness?: number;
  frame?: MaterialId;
  fill?: 'glass' | 'frosted';
}

/** Fenêtre: frame + glass pane (with a collider) + inner window board. Default 1.6 × 1.3 m, sill at 0.9 m. */
export function windowProp(b: MapBuilder, o: WindowOpts = {}): void {
  const w = o.width ?? 1.6;
  const h = o.height ?? 1.3;
  const sill = o.sill ?? 0.9;
  const t = o.wallThickness ?? 0.2;
  windowUnit(b, { x: 0, z: 0, y: sill, axis: 'x', width: w, height: h, wallThickness: t, frame: o.frame ?? 'metal_white', fill: o.fill ?? 'glass' });
  bx(b, 0, sill - 0.03, t / 2 + 0.06, w + 0.1, 0.03, 0.16, 'laminate_white'); // window board on the room side
}

/** Store: venetian blind hanging on the room side (+Z) of a window, partly lowered. */
export function blind(b: MapBuilder, o: WindowOpts & { lowered?: number } = {}): void {
  const w = o.width ?? 1.6;
  const h = o.height ?? 1.3;
  const sill = o.sill ?? 0.9;
  const z = (o.wallThickness ?? 0.2) / 2 + 0.05;
  const top = sill + h;
  const lowered = Math.min(1, Math.max(0.1, o.lowered ?? 0.65));
  bx(b, 0, top - 0.01, z, w + 0.04, 0.05, 0.05, 'metal_white');
  const drop = h * lowered;
  const n = Math.min(24, Math.max(3, Math.round(drop / 0.055)));
  for (let i = 0; i < n; i++) {
    bx(b, 0, top - 0.02 - ((i + 1) * drop) / n, z, w, 0.006, 0.04, 'plastic_white', i % 2 ? C.light : 0xdfe8ee);
  }
  bx(b, 0, top - 0.05 - drop, z, w, 0.02, 0.045, 'metal_white'); // bottom rail
  for (const s of [-1, 1]) bx(b, s * (w / 2 - 0.15), top - 0.03 - drop, z, 0.004, drop, 0.004, 'plastic_white'); // ladder cords
  bx(b, w / 2 - 0.04, top - 0.75, z + 0.03, 0.006, 0.72, 0.006, 'plastic_white'); // pull cord
  bx(b, w / 2 - 0.04, top - 0.8, z + 0.03, 0.02, 0.05, 0.02, 'plastic_white');
}

/** Fenêtre avec store: window + blind. */
export function windowWithBlind(b: MapBuilder, o: WindowOpts & { lowered?: number } = {}): void {
  windowProp(b, o);
  blind(b, o);
}

export const OPENING_PROPS: PropInfo[] = [
  { id: 'single_door', label: 'Porte simple', family: 'ouvertures', footprint: [1.3, 1.5, 2.15], cover: 'none', mount: 'opening', build: (b) => singleDoor(b) },
  { id: 'single_door_wood', label: 'Porte simple en bois', family: 'ouvertures', footprint: [1.3, 1.5, 2.15], cover: 'none', mount: 'opening', build: (b) => singleDoor(b, { mat: 'door_wood', hinge: 'right' }) },
  { id: 'double_door', label: 'Porte double', family: 'ouvertures', footprint: [2.1, 1.3, 2.15], cover: 'none', mount: 'opening', build: (b) => doubleDoor(b, { mat: 'door_metal' }) },
  { id: 'glazed_door', label: 'Porte vitrée', family: 'ouvertures', footprint: [1.3, 1.5, 2.15], cover: 'none', mount: 'opening', build: (b) => glazedDoor(b) },
  { id: 'window', label: 'Fenêtre', family: 'ouvertures', footprint: [1.7, 0.4, 2.25], cover: 'none', mount: 'opening', build: (b) => windowProp(b) },
  { id: 'blind', label: 'Store vénitien', family: 'ouvertures', footprint: [1.64, 0.4, 2.25], cover: 'none', mount: 'opening', build: (b) => blind(b) },
  { id: 'window_blind', label: 'Fenêtre avec store', family: 'ouvertures', footprint: [1.7, 0.4, 2.25], cover: 'none', mount: 'opening', build: (b) => windowWithBlind(b) },
];
