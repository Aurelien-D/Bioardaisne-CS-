/**
 * Map tests.
 *  - Every registered map (MAP_MODULES) is built and validated, so future maps are covered automatically.
 *  - Unit tests of the level-design helpers (walls, rooms, stairs, slabs…), of the prop
 *    library and of the validation tools.
 */
import { PROP_MODELS } from '../src/shared/maps/props/modelmap';
import { describe, expect, it } from 'vitest';
import { PLAYER_HALF_WIDTH, STEP_HEIGHT } from '../src/shared/constants';
import { MAP_MODULES, getMap, hasMap, listMaps } from '../src/shared/maps';
import { MapBuilder } from '../src/shared/maps/builder';
import {
  ceiling,
  ceilingLights,
  doorLeaf,
  floor,
  gridCells,
  mirrorX,
  mirrorZ,
  pick,
  pillar,
  platform,
  railing,
  rectMinusHoles,
  room,
  seeded,
  skylight,
  spread,
  stairSteps,
  stairs,
  wall,
  wallLayout,
  type Opening,
} from '../src/shared/maps/helpers';
import { MATERIALS } from '../src/shared/maps/materials';
import { PROPS, PROP_CATALOG, PROP_FAMILIES, placeProp } from '../src/shared/maps/props';
import type { MapData, MapMeta, Solid } from '../src/shared/maps/types';
import { checkMap, floodFill, formatReport, groundUnder, hullFree, type NavLike } from '../tools/map-check';
import { renderPlan } from '../tools/map-plan';

const META: MapMeta = { id: 'dev_unit', name: 'Test', description: 'Carte de test', modes: ['tdm'], players: [2, 8] };
const newBuilder = (): MapBuilder => new MapBuilder({ ...META });

const SIGN_STYLES = ['plaque', 'door', 'poster', 'street', 'shop', 'screen', 'banner', 'floor'];
const isMaterial = (m: unknown): boolean => typeof m === 'string' && Object.prototype.hasOwnProperty.call(MATERIALS, m);

type Aabb = Pick<Solid, 'min' | 'max'>;
const volumeOverlap = (a: Aabb, b: Aabb): number => {
  const dx = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
  const dy = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
  const dz = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
  return dx > 1e-6 && dy > 1e-6 && dz > 1e-6 ? dx * dy * dz : 0;
};
const contains = (a: Aabb, x: number, y: number, z: number): boolean =>
  x > a.min.x && x < a.max.x && y > a.min.y && y < a.max.y && z > a.min.z && z < a.max.z;
const countAt = (list: readonly Aabb[], x: number, y: number, z: number): number => list.filter((s) => contains(s, x, y, z)).length;
const expectNoOverlap = (list: readonly Aabb[]): void => {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      expect(volumeOverlap(list[i]!, list[j]!), `boxes ${i} and ${j} overlap`).toBe(0);
    }
  }
};

// =================================================================================
// Every registered map
// =================================================================================

describe('registered maps', () => {
  it('has unique ids and a consistent registry', () => {
    const ids = MAP_MODULES.map((m) => m.meta.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(hasMap(id)).toBe(true);
    expect(hasMap('dev_kit')).toBe(true);
    expect(listMaps(false).every((m) => !m.id.startsWith('dev_'))).toBe(true);
    expect(listMaps(true).length).toBe(MAP_MODULES.length);
  });

  for (const mod of MAP_MODULES) {
    describe(`map ${mod.meta.id}`, () => {
      let cached: MapData | null = null;
      const map = (): MapData => (cached ??= mod.build());
      const minSpawns = mod.meta.id.startsWith('dev_') ? 4 : 8;

      it('builds without throwing and has valid metadata', () => {
        const m = map();
        expect(m.meta.id).toBe(mod.meta.id);
        expect(m.meta.id).toMatch(/^[a-z0-9_]+$/);
        expect(m.meta.name.trim().length).toBeGreaterThan(0);
        expect(m.meta.modes).toContain('tdm');
        expect(m.meta.players[0]).toBeGreaterThanOrEqual(1);
        expect(m.meta.players[1]).toBeGreaterThanOrEqual(m.meta.players[0]);
        expect(getMap(mod.meta.id).meta.id).toBe(mod.meta.id);
      });

      it('is deterministic (two builds give the same data)', () => {
        const a = mod.build();
        const b = mod.build();
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      });

      it('has finite bounds enclosing every solid', () => {
        const m = map();
        for (const v of [m.bounds.min, m.bounds.max]) {
          expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)).toBe(true);
        }
        expect(m.bounds.max.x).toBeGreaterThan(m.bounds.min.x);
        expect(m.bounds.max.y).toBeGreaterThan(m.bounds.min.y);
        expect(m.bounds.max.z).toBeGreaterThan(m.bounds.min.z);
        expect(m.killY).toBeLessThan(m.bounds.min.y);
        for (const s of m.solids) {
          expect(s.min.x >= m.bounds.min.x - 1e-6 && s.max.x <= m.bounds.max.x + 1e-6).toBe(true);
          expect(s.min.y >= m.bounds.min.y - 1e-6 && s.max.y <= m.bounds.max.y + 1e-6).toBe(true);
          expect(s.min.z >= m.bounds.min.z - 1e-6 && s.max.z <= m.bounds.max.z + 1e-6).toBe(true);
        }
      });

      it('has no degenerate, inverted or non-finite solid or box', () => {
        const m = map();
        expect(m.solids.length).toBeGreaterThan(0);
        for (const s of [...m.solids, ...m.boxes]) {
          for (const k of ['x', 'y', 'z'] as const) {
            expect(Number.isFinite(s.min[k]) && Number.isFinite(s.max[k])).toBe(true);
            expect(s.max[k] - s.min[k]).toBeGreaterThan(1e-4);
          }
        }
        for (const p of m.prims) {
          expect(p.size.x > 0 && p.size.y > 0 && p.size.z > 0).toBe(true);
          expect(Number.isFinite(p.pos.x + p.pos.y + p.pos.z)).toBe(true);
        }
      });

      it('only uses materials of the catalogue', () => {
        const m = map();
        for (const bx of m.boxes) {
          expect(isMaterial(bx.mat), `unknown material ${String(bx.mat)}`).toBe(true);
          for (const f of Object.values(bx.faces ?? {})) if (f !== null) expect(isMaterial(f), `unknown material ${String(f)}`).toBe(true);
        }
        for (const p of m.prims) expect(isMaterial(p.mat), `unknown material ${String(p.mat)}`).toBe(true);
      });

      it(`has at least ${minSpawns} valid spawns per team`, () => {
        const m = map();
        for (const team of [0, 1] as const) {
          expect(m.spawns.filter((s) => s.team === team).length).toBeGreaterThanOrEqual(minSpawns);
        }
        for (const s of m.spawns) {
          expect([0, 1]).toContain(s.team);
          expect(Number.isFinite(s.yaw)).toBe(true);
          expect(s.pos.x).toBeGreaterThanOrEqual(m.bounds.min.x);
          expect(s.pos.x).toBeLessThanOrEqual(m.bounds.max.x);
          expect(s.pos.z).toBeGreaterThanOrEqual(m.bounds.min.z);
          expect(s.pos.z).toBeLessThanOrEqual(m.bounds.max.z);
          expect(hullFree(m, s.pos), `spawn at ${JSON.stringify(s.pos)} is obstructed`).toBe(true);
          const g = groundUnder(m, s.pos);
          expect(g, `spawn at ${JSON.stringify(s.pos)} has no ground`).not.toBeNull();
          expect(s.pos.y - (g ?? -1e9)).toBeLessThanOrEqual(0.1);
        }
      });

      it('has valid signs and lights', () => {
        const m = map();
        for (const s of m.signs) {
          expect(Number.isInteger(s.facing) && s.facing >= 0 && s.facing <= 5).toBe(true);
          expect(s.w).toBeGreaterThan(0);
          expect(s.h).toBeGreaterThan(0);
          expect(typeof s.text).toBe('string');
          expect(SIGN_STYLES).toContain(s.style);
          expect(Number.isFinite(s.pos.x + s.pos.y + s.pos.z)).toBe(true);
        }
        for (const l of m.lights) {
          expect(l.intensity).toBeGreaterThan(0);
          expect(l.range).toBeGreaterThan(0);
          expect(Number.isFinite(l.pos.x + l.pos.y + l.pos.z)).toBe(true);
        }
      });

      it('has unique zone and point ids', () => {
        const m = map();
        const zoneIds = m.zones.map((z) => `${z.kind}:${z.id}`);
        expect(new Set(zoneIds).size).toBe(zoneIds.length);
        const pointIds = m.points.map((p) => `${p.kind}:${p.id}`);
        expect(new Set(pointIds).size).toBe(pointIds.length);
        for (const z of m.zones) {
          expect(z.max.x > z.min.x && z.max.y > z.min.y && z.max.z > z.min.z).toBe(true);
        }
      });

      it('passes the validator without errors (tools/map-check)', () => {
        // Navigation checks stay in the CLI: unit tests of the maps must not depend on the nav module.
        const report = checkMap(map(), { noNav: true });
        const errors = report.issues.filter((i) => i.level === 'error').map((i) => `[${i.code}] ${i.message}`);
        expect(errors).toEqual([]);
        expect(report.sealed).toBe(true);
      });
    });
  }
});

// =================================================================================
// Helpers: walls
// =================================================================================

/** Checks that the wall boxes tile the wall rectangle minus the openings (areas + point sampling). */
function expectWallTiling(solids: readonly Solid[], axis: 'x' | 'z', start: number, across: number, length: number, height: number, thickness: number, openings: Opening[], dir = 1): void {
  expectNoOverlap(solids);
  // Area: every box spans the full thickness, so volumes compare directly.
  const volume = solids.reduce((a, s) => a + (s.max.x - s.min.x) * (s.max.y - s.min.y) * (s.max.z - s.min.z), 0);
  const openArea = openings.reduce((a, o) => a + o.width * Math.min(o.height ?? 2.1, height - (o.sill ?? 0)), 0);
  expect(volume).toBeCloseTo((length * height - openArea) * thickness, 5);
  for (const s of solids) {
    const t = axis === 'x' ? s.max.z - s.min.z : s.max.x - s.min.x;
    expect(t).toBeCloseTo(thickness, 6);
    expect(s.max.y - s.min.y).toBeGreaterThan(1e-3);
    expect(axis === 'x' ? s.max.x - s.min.x : s.max.z - s.min.z).toBeGreaterThan(1e-3);
  }
  // Sampling: a point is in exactly one box when it is outside the openings, in none otherwise.
  const nT = 97;
  const nY = 53;
  for (let i = 0; i < nT; i++) {
    const t = ((i + 0.5) / nT) * length;
    for (let j = 0; j < nY; j++) {
      const y = ((j + 0.5) / nY) * height;
      const inOpening = openings.some((o) => Math.abs(t - o.at) < o.width / 2 && y > (o.sill ?? 0) && y < (o.sill ?? 0) + (o.height ?? 2.1));
      const onEdge = openings.some(
        (o) =>
          Math.abs(Math.abs(t - o.at) - o.width / 2) < 1e-3 || Math.abs(y - (o.sill ?? 0)) < 1e-3 || Math.abs(y - (o.sill ?? 0) - (o.height ?? 2.1)) < 1e-3,
      );
      if (onEdge) continue;
      const along = start + dir * t;
      const n = axis === 'x' ? countAt(solids, along, y, across) : countAt(solids, across, y, along);
      expect(n, `t=${t.toFixed(3)} y=${y.toFixed(3)}`).toBe(inOpening ? 0 : 1);
    }
  }
}

describe('helpers: wall', () => {
  it('makes a single box without openings', () => {
    const b = newBuilder();
    const info = wall(b, { x0: 0, z0: 5, x1: 8, z1: 5, height: 3, mat: 'plaster_white' });
    expect(info.boxes).toBe(1);
    expect(info.axis).toBe('x');
    expect(info.length).toBeCloseTo(8);
    expect(b.solids.length).toBe(1);
    expectWallTiling(b.solids, 'x', 0, 5, 8, 3, 0.2, []);
  });

  it('splits around one door: two piers and a lintel', () => {
    const b = newBuilder();
    const openings: Opening[] = [{ at: 3, width: 1.2, height: 2.1 }];
    const info = wall(b, { x0: 0, z0: 5, x1: 8, z1: 5, height: 2.8, thickness: 0.3, mat: 'plaster_white', openings });
    expect(info.boxes).toBe(3);
    expect(info.openings[0]).toMatchObject({ x: 3, z: 5, y0: 0, y1: 2.1, width: 1.2 });
    expectWallTiling(b.solids, 'x', 0, 5, 8, 2.8, 0.3, openings);
  });

  it('splits around three openings (door, window, door) without overlap or gap', () => {
    const b = newBuilder();
    const openings: Opening[] = [
      { at: 1.5, width: 1.2, height: 2.1 },
      { at: 5, width: 2, height: 1.2, sill: 0.9 },
      { at: 8.6, width: 1.8, height: 2.4 },
    ];
    const info = wall(b, { x0: 0, z0: 0, x1: 10, z1: 0, height: 3, mat: 'plaster_white', matPos: 'plaster_blue', openings });
    // 4 piers + lintel, (sill + lintel), lintel
    expect(info.boxes).toBe(8);
    expectWallTiling(b.solids, 'x', 0, 0, 10, 3, 0.2, openings);
    // Face override: +Z faces are blue.
    expect(b.boxes.every((bx) => bx.faces?.pz === 'plaster_blue')).toBe(true);
  });

  it('works along Z, backwards, with stacked openings and openings touching the ends or the top', () => {
    const openings: Opening[] = [
      { at: 0.6, width: 1.2, height: 2.1 }, // touches the start of the wall
      { at: 4, width: 1.6, height: 1.0, sill: 0.4 },
      { at: 4, width: 1.6, height: 0.8, sill: 1.8 }, // stacked above the previous one
      { at: 7, width: 2, height: 5 }, // taller than the wall: no lintel
    ];
    const b = newBuilder();
    wall(b, { x0: 2, z0: 9, x1: 2, z1: 1, height: 3, mat: 'concrete', openings });
    const clipped = openings.map((o) => ({ ...o, height: Math.min(o.height ?? 2.1, 3 - (o.sill ?? 0)) }));
    expectWallTiling(b.solids, 'z', 9, 2, 8, 3, 0.2, clipped, -1);
  });

  it('stays correct inside a rotated frame', () => {
    const openings: Opening[] = [{ at: 2, width: 1.2, height: 2.1 }];
    const b = newBuilder();
    b.at(10, 1, 20, 1, () => wall(b, { x0: 0, z0: 0, x1: 6, z1: 0, height: 3, mat: 'plaster_white', openings }));
    // q = 1: local +X maps to world −Z, so the wall runs from z = 20 down to z = 14 at x = 10.
    const shifted = b.solids.map((s) => ({ ...s, min: { ...s.min, y: s.min.y - 1 }, max: { ...s.max, y: s.max.y - 1 } }));
    expectWallTiling(shifted, 'z', 20, 10, 6, 3, 0.2, openings, -1);
  });

  it('adds glass panes with colliders and decorative frames', () => {
    const b = newBuilder();
    wall(b, {
      x0: 0,
      z0: 0,
      x1: 6,
      z1: 0,
      height: 3,
      mat: 'plaster_white',
      openings: [{ at: 3, width: 2.4, height: 1.2, sill: 0.9, fill: 'glass', frame: 'metal_white' }],
    });
    const glass = b.solids.filter((s) => s.surf === 'glass');
    expect(glass.length).toBe(1);
    expect(glass[0]!.max.z - glass[0]!.min.z).toBeLessThan(0.1);
    // The pane closes the opening for players (centre of the opening is inside the pane).
    expect(contains(glass[0]!, 3, 1.5, 0)).toBe(true);
    expect(b.boxes.some((bx) => bx.mat === 'glass')).toBe(true);
    expect(b.boxes.filter((bx) => bx.mat === 'metal_white').length).toBeGreaterThanOrEqual(4);
    // Frames never add colliders: 4 wall boxes + the pane.
    expect(b.solids.length).toBe(5);
  });

  it('adds skirting boards that skip doorways', () => {
    const b = newBuilder();
    wall(b, {
      x0: 0,
      z0: 0,
      x1: 6,
      z1: 0,
      mat: 'plaster_white',
      skirting: { mat: 'wood_light', side: 'pos' },
      openings: [{ at: 3, width: 1.2 }],
    });
    const skirt = b.boxes.filter((bx) => bx.mat === 'wood_light');
    expect(skirt.length).toBe(2);
    expect(skirt.every((s) => s.min.z >= 0.1 - 1e-9 && s.detail === true)).toBe(true);
    expect(skirt.some((s) => s.min.x < 3 && s.max.x > 3)).toBe(false);
  });

  it('rejects invalid walls and openings', () => {
    const b = newBuilder();
    expect(() => wall(b, { x0: 0, z0: 0, x1: 3, z1: 2, mat: 'concrete' })).toThrow();
    expect(() => wall(b, { x0: 0, z0: 0, x1: 0, z1: 0, mat: 'concrete' })).toThrow();
    expect(() => wall(b, { x0: 0, z0: 0, x1: 4, z1: 0, mat: 'concrete', openings: [{ at: 3.8, width: 1.2 }] })).toThrow();
    expect(() => wall(b, { x0: 0, z0: 0, x1: 4, z1: 0, mat: 'concrete', openings: [{ at: 2, width: 0 }] })).toThrow();
  });

  it('wallLayout merges identical neighbouring columns', () => {
    const cols = wallLayout(6, 3, [
      { at: 2, width: 1, height: 1, sill: 1 },
      { at: 3, width: 1, height: 1, sill: 1 },
    ]);
    // pier, one merged window column, pier
    expect(cols.length).toBe(3);
    expect(cols[1]!.solids).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });
});

// =================================================================================
// Helpers: rooms, slabs
// =================================================================================

describe('helpers: room and slabs', () => {
  it('covers each corner exactly once and never overlaps', () => {
    const b = newBuilder();
    const info = room(b, {
      x0: 0,
      z0: 0,
      x1: 6,
      z1: 4,
      height: 2.8,
      wallMat: 'plaster_white',
      floorMat: 'lino_grey',
      ceilingMat: 'ceiling_tile',
      walls: { pz: { openings: [{ at: 3, width: 1.2 }] }, nx: { openings: [{ at: 2, width: 1.4, height: 1.2, sill: 0.9, fill: 'glass' }] } },
    });
    const walls = b.solids.filter((s) => s.min.y >= -1e-9 && s.max.y <= 2.8 + 1e-9 && s.surf !== 'glass');
    expectNoOverlap(b.solids);
    for (const [x, z] of [
      [0, 0],
      [6, 0],
      [0, 4],
      [6, 4],
    ] as const) {
      expect(countAt(walls, x + 0.05, 1.4, z + 0.05), `corner ${x},${z}`).toBe(1);
      expect(countAt(walls, x - 0.05, 1.4, z - 0.05), `corner ${x},${z}`).toBe(1);
    }
    // Walls are continuous along the four centre-lines (except in the openings).
    for (let i = 0; i <= 60; i++) {
      const x = (i / 60) * 6;
      expect(countAt(walls, x + 1e-3, 2.5, 0)).toBe(1);
      expect(countAt(walls, x + 1e-3, 2.5, 4)).toBe(1);
    }
    for (let i = 1; i < 40; i++) {
      const z = (i / 40) * 4 + 1e-3;
      expect(countAt(walls, 0, 2.5, z)).toBe(1);
      expect(countAt(walls, 6, 2.5, z)).toBe(1);
    }
    expect(countAt(walls, 3, 1, 4)).toBe(0); // the doorway is free
    expect(info.inner).toEqual({ x0: 0.1, z0: 0.1, x1: 5.9, z1: 3.9 });
    expect(info.floorY).toBe(0);
    expect(info.ceilingY).toBeCloseTo(2.8);
    expect(info.width).toBeCloseTo(5.8);
    expect(info.depth).toBeCloseTo(3.8);
    expect(info.openings.pz[0]).toMatchObject({ x: 3, z: 4, width: 1.2 });
    expect(info.openings.nx[0]).toMatchObject({ x: 0, z: 2, y0: 0.9 });
    // Floor and ceiling slabs.
    expect(countAt(b.solids, 3, -0.1, 2)).toBe(1);
    expect(countAt(b.solids, 3, 2.9, 2)).toBe(1);
  });

  it('composes with a neighbour without doubling the shared wall', () => {
    const b = newBuilder();
    room(b, { x0: 0, z0: 0, x1: 5, z1: 4, wallMat: 'plaster_white', floorMat: 'lino_grey', ceilingMat: 'ceiling_tile' });
    room(b, { x0: 5, z0: 0, x1: 9, z1: 4, wallMat: 'plaster_white', floorMat: 'carpet_blue', ceilingMat: 'ceiling_tile', walls: { nx: false } });
    expectNoOverlap(b.solids);
    const walls = b.solids.filter((s) => s.min.y >= -1e-9 && s.max.y <= 2.8 + 1e-9);
    // Shared wall and the two shared corners: exactly one box everywhere.
    for (let i = 0; i <= 40; i++) expect(countAt(walls, 5, 1.4, -0.05 + (i / 40) * 4.1)).toBe(1);
    // Outer walls of both rooms are continuous across the junction.
    for (let i = 0; i <= 90; i++) {
      const x = -0.05 + (i / 90) * 9.1;
      expect(countAt(walls, x, 1.4, 0.03)).toBe(1);
      expect(countAt(walls, x, 1.4, 3.97)).toBe(1);
    }
    // Floors meet on the centre-line without overlapping.
    expect(countAt(b.solids, 4.99, -0.1, 2)).toBe(1);
    expect(countAt(b.solids, 5.01, -0.1, 2)).toBe(1);
  });

  it('cuts holes in slabs with non-overlapping rectangles', () => {
    const rect = { x0: 0, z0: 0, x1: 10, z1: 8 };
    const holes = [
      { x0: 2, z0: 2, x1: 4, z1: 5 },
      { x0: 3, z0: 4, x1: 7, z1: 6 }, // overlaps the first hole
      { x0: 9, z0: 7, x1: 12, z1: 9 }, // sticks out
    ];
    const parts = rectMinusHoles(rect, holes);
    const area = parts.reduce((a, r) => a + (r.x1 - r.x0) * (r.z1 - r.z0), 0);
    // holes: 6 + 8 − 1 (overlap) + 1 (clipped corner) = 14
    expect(area).toBeCloseTo(80 - 14, 6);
    for (let i = 0; i < 50; i++) {
      for (let j = 0; j < 40; j++) {
        const x = (i + 0.5) / 5;
        const z = (j + 0.5) / 5;
        const inHole = holes.some((h) => x > h.x0 && x < h.x1 && z > h.z0 && z < h.z1);
        const n = parts.filter((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1).length;
        expect(n).toBe(inHole ? 0 : 1);
      }
    }
    expect(rectMinusHoles(rect)).toEqual([rect]);

    const b = newBuilder();
    const n = floor(b, { ...rect, y: 3, mat: 'concrete', holes: [holes[0]!] });
    expect(n).toBe(b.solids.length);
    expect(b.solids.every((s) => Math.abs(s.max.y - 3) < 1e-9 && Math.abs(s.min.y - 2.8) < 1e-9)).toBe(true);
    ceiling(b, { ...rect, y: 6, mat: 'ceiling_tile' });
    const top = b.solids[b.solids.length - 1]!;
    expect(top.min.y).toBeCloseTo(6);
    expect(top.max.y).toBeCloseTo(6.2);
  });

  it('skylights keep the ceiling closed', () => {
    const b = newBuilder();
    const sky = { x0: 2, z0: 2, x1: 5, z1: 4 };
    ceiling(b, { x0: 0, z0: 0, x1: 8, z1: 6, y: 5, mat: 'plaster_white', holes: [sky] });
    expect(countAt(b.solids, 3.5, 5.1, 3)).toBe(0);
    skylight(b, { ...sky, y: 5 });
    expect(countAt(b.solids, 3.5, 5.18, 3)).toBe(1);
    expect(b.lights.length).toBe(1);
    expect(b.lights[0]!.pos.y).toBeLessThan(5);
  });
});

// =================================================================================
// Helpers: stairs, railings, platforms, lights, utilities
// =================================================================================

describe('helpers: stairs', () => {
  it('computes steps of 0.2–0.25 m, at least 0.3 m deep', () => {
    for (const rise of [0.5, 0.75, 1, 1.4, 2.8, 3, 3.2, 3.5, 4, 6.4]) {
      const s = stairSteps(rise);
      expect(s.stepHeight, `rise ${rise}`).toBeGreaterThanOrEqual(0.2 - 1e-9);
      expect(s.stepHeight, `rise ${rise}`).toBeLessThanOrEqual(0.25 + 1e-9);
      expect(s.stepDepth).toBeGreaterThanOrEqual(0.3);
      expect(s.steps * s.stepHeight).toBeCloseTo(rise, 9);
      expect(s.run).toBeCloseTo(s.steps * s.stepDepth, 9);
    }
    // Tiny rises fall back to steps the player can still walk up.
    for (const rise of [0.1, 0.3, 0.45]) expect(stairSteps(rise).stepHeight).toBeLessThanOrEqual(STEP_HEIGHT);
    expect(stairSteps(3, 0.2).stepDepth).toBe(0.3);
    expect(stairSteps(3, 0.4).stepDepth).toBe(0.4);
  });

  it('builds a climbable flight in every direction', () => {
    const dirs = [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ] as const;
    for (let dir = 0; dir < 4; dir++) {
      const b = newBuilder();
      const info = stairs(b, { x: 10, y: 1, z: 20, dir: dir as 0 | 1 | 2 | 3, width: 1.6, rise: 3.2, mat: 'concrete' });
      expect(info.steps).toBe(13);
      expect(b.solids.length).toBe(13);
      const [vx, vz] = dirs[dir]!;
      expect(info.top.x).toBeCloseTo(10 + vx * info.run);
      expect(info.top.z).toBeCloseTo(20 + vz * info.run);
      expect(info.top.y).toBeCloseTo(4.2);
      // Walking up the centre line: the ground rises by one step height at a time.
      let prev = 1;
      for (let i = 0; i < info.steps; i++) {
        const d = (i + 0.5) * info.stepDepth;
        const x = 10 + vx * d;
        const z = 20 + vz * d;
        const tops = b.solids.filter((s) => x > s.min.x && x < s.max.x && z > s.min.z && z < s.max.z).map((s) => s.max.y);
        const ground = Math.max(...tops);
        expect(ground - prev).toBeCloseTo(info.stepHeight, 6);
        expect(ground - prev).toBeLessThanOrEqual(STEP_HEIGHT);
        prev = ground;
      }
      expect(prev).toBeCloseTo(4.2);
      // Width: 1.6 m perpendicular to the ascent.
      const s0 = b.solids[0]!;
      expect(vx === 0 ? s0.max.x - s0.min.x : s0.max.z - s0.min.z).toBeCloseTo(1.6);
    }
  });

  it('open flights have thin treads; rails and walls stay outside the clear width', () => {
    const b = newBuilder();
    const info = stairs(b, { x: 0, z: 0, dir: 0, width: 1.4, rise: 3, mat: 'metal_grey', open: true, left: 'rail', right: 'wall' });
    const treads = b.solids.filter((s) => !s.noBullets && s.max.x - s.min.x > 1.3);
    expect(treads.length).toBe(info.steps);
    expect(treads.every((s) => s.max.y - s.min.y < 0.1)).toBe(true);
    const rails = b.solids.filter((s) => s.noBullets);
    expect(rails.length).toBe(info.steps);
    expect(rails.every((s) => s.min.x >= 0.7 - 1e-9)).toBe(true);
    const parapet = b.solids.filter((s) => !s.noBullets && s.max.x <= -0.7 + 1e-9);
    expect(parapet.length).toBe(info.steps);
    // Nothing intrudes into the clear width above the treads.
    for (const s of [...rails, ...parapet]) expect(s.min.x >= 0.7 - 1e-9 || s.max.x <= -0.7 + 1e-9).toBe(true);
  });
});

describe('helpers: railings, platforms, pillars, doors', () => {
  it('railings block players but not bullets (glass ones block both)', () => {
    const b = newBuilder();
    railing(b, { x0: 0, z0: 0, x1: 6, z1: 0, y: 3 });
    expect(b.solids.length).toBe(1);
    expect(b.solids[0]!.noBullets).toBe(true);
    expect(b.solids[0]!.min.y).toBeCloseTo(3);
    expect(b.solids[0]!.max.y).toBeCloseTo(4);
    expect(b.solids[0]!.max.x - b.solids[0]!.min.x).toBeCloseTo(6);
    railing(b, { x0: 2, z0: 5, x1: 2, z1: 1, style: 'glass' });
    expect(b.solids[1]!.noBullets).toBeUndefined();
    expect(b.solids[1]!.max.z - b.solids[1]!.min.z).toBeCloseTo(4);
    expect(() => railing(b, { x0: 0, z0: 0, x1: 1, z1: 1 })).toThrow();
  });

  it('platforms carry pillars and railings with gaps', () => {
    const b = newBuilder();
    platform(b, { x0: 0, z0: 0, x1: 10, z1: 4, y: 3.2, mat: 'concrete', pillars: 'concrete', rails: { pz: [[0, 6], [7.6, 10]], nx: true } });
    expectNoOverlap(b.solids.filter((s) => !s.noBullets));
    const slab = b.solids.find((s) => s.max.y === 3.2 && s.max.x - s.min.x === 10);
    expect(slab).toBeDefined();
    const rails = b.solids.filter((s) => s.noBullets);
    expect(rails.length).toBe(3);
    // The gap for the stairs is free.
    expect(rails.some((s) => s.min.x < 6.8 && s.max.x > 6.8 && s.max.z > 3.9)).toBe(false);
    const pillars = b.solids.filter((s) => s.min.y === 0 && Math.abs(s.max.y - 3.0) < 1e-9);
    expect(pillars.length).toBeGreaterThanOrEqual(4);
  });

  it('pillars and door leaves produce sensible colliders', () => {
    const b = newBuilder();
    pillar(b, { x: 3, z: 3, height: 3, mat: 'concrete' });
    pillar(b, { x: 6, z: 3, height: 3, size: 0.6, mat: 'stone_white', round: true, trim: true });
    expect(b.solids.length).toBe(2);
    expect(b.prims.length).toBe(1);
    const before = b.solids.length;
    doorLeaf(b, { x: 4, z: 5, axis: 'x', width: 1.2, hinge: 'low', swing: 'pos', open: 90 });
    const leaf = b.solids[before]!;
    expect(leaf.max.x).toBeLessThanOrEqual(3.4 + 1e-9); // outside the clear width (3.4 .. 4.6)
    expect(leaf.max.z - leaf.min.z).toBeCloseTo(1.2);
    doorLeaf(b, { x: 4, z: 5, axis: 'x', width: 1.2, open: 180 });
    doorLeaf(b, { x: 4, z: 5, axis: 'x', width: 1.2, open: 30 });
    expect(b.solids.length).toBe(before + 1); // folded and ajar leaves have no collider
    doorLeaf(b, { x: 4, z: 5, axis: 'x', width: 1.2, open: 0 });
    expect(contains(b.solids[b.solids.length - 1]!, 4, 1, 5)).toBe(true); // a closed door blocks the doorway
  });
});

describe('helpers: lights and utilities', () => {
  it('lays ceiling lights on a regular grid inside the area', () => {
    const b = newBuilder();
    const area = { x0: 0, z0: 0, x1: 12, z1: 8 };
    const pts = ceilingLights(b, area, 4, 2.8);
    expect(pts.length).toBe(6);
    expect(b.lights.length).toBe(6);
    expect(b.solids.length).toBe(0);
    for (const l of b.lights) {
      expect(l.pos.y).toBeLessThan(2.8);
      expect(l.pos.x > 0 && l.pos.x < 12 && l.pos.z > 0 && l.pos.z < 8).toBe(true);
      expect(l.intensity).toBeGreaterThan(0.5);
      expect(l.range).toBeGreaterThanOrEqual(7);
    }
    expect(b.boxes.every((bx) => bx.mat === 'light_panel' && bx.max.y <= 2.8 + 1e-9)).toBe(true);
    const b2 = newBuilder();
    expect(ceilingLights(b2, area, 2, 2.8, { lightEvery: 2 }).length).toBe(24);
    expect(b2.lights.length).toBe(6);
  });

  it('spreads, grids, mirrors and picks deterministically', () => {
    expect(spread(0, 10, 3)).toEqual([0, 5, 10]);
    expect(spread(2, 4, 1)).toEqual([3]);
    const cells = gridCells({ x0: 0, z0: 0, x1: 4, z1: 2 }, 2, 1);
    expect(cells.map((c) => [c.x, c.z])).toEqual([
      [1, 1],
      [3, 1],
    ]);
    const list = [{ x: 2, z: 3, q: 1 }];
    expect(mirrorX(list, 10)[0]).toMatchObject({ x: 18, z: 3, q: 3 });
    expect(mirrorZ(list, 0)[0]).toMatchObject({ x: 2, z: -3, q: 1 });
    expect(mirrorZ([{ x: 0, z: 1 }], 0)[0]).toMatchObject({ z: -1, q: 2 });
    expect(mirrorX(mirrorX(list, 4), 4)[0]).toMatchObject({ x: 2, q: 1 });
    const items = ['a', 'b', 'c', 'd'] as const;
    expect(pick(7, items)).toBe(pick(7, items));
    expect(items).toContain(pick(123456, items));
    const r1 = seeded(3, 4);
    const r2 = seeded(3, 4);
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
    const picks = new Set<string>();
    for (let i = 0; i < 50; i++) picks.add(pick(i, items));
    expect(picks.size).toBeGreaterThan(2);
    expect(() => pick(1, [])).toThrow();
  });
});

// =================================================================================
// Prop library
// =================================================================================

describe('prop library', () => {
  it('has a consistent catalogue', () => {
    const ids = PROP_CATALOG.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PROP_CATALOG.length).toBeGreaterThanOrEqual(70);
    const families = new Set(PROP_FAMILIES.map((f) => f.id));
    for (const p of PROP_CATALOG) {
      expect(p.id).toMatch(/^[a-z0-9_]+$/);
      expect(p.label.trim().length).toBeGreaterThan(2);
      expect(families.has(p.family)).toBe(true);
      expect(['none', 'low', 'high']).toContain(p.cover);
      expect(['floor', 'bench', 'wall', 'opening']).toContain(p.mount);
      expect(p.footprint.every((v) => v > 0 && v < 4)).toBe(true);
      expect(PROPS[p.id]).toBe(p);
    }
    for (const f of PROP_FAMILIES) expect(PROP_CATALOG.some((p) => p.family === f.id)).toBe(true);
  });

  for (const info of PROP_CATALOG) {
    it(`${info.id}: believable geometry and sensible colliders`, () => {
      const b = newBuilder();
      info.build(b);
      const parts = b.boxes.length + b.prims.length;
      expect(parts, 'part count').toBeGreaterThanOrEqual(5);
      expect(parts, 'part count').toBeLessThanOrEqual(70);
      expect(b.solids.length).toBeLessThanOrEqual(4);
      expect(b.spawns.length + b.zones.length + b.points.length + b.lights.length).toBe(0);
      for (const bx of b.boxes) {
        expect(isMaterial(bx.mat)).toBe(true);
        expect(bx.min.y).toBeGreaterThanOrEqual(-1e-6); // nothing under the floor
      }
      for (const p of b.prims) expect(isMaterial(p.mat)).toBe(true);
      const [w, d, h] = info.footprint;
      const tol = 0.12;
      if (info.mount !== 'opening') {
        // Colliders stay inside the declared footprint (centred on the origin).
        for (const s of b.solids) {
          expect(s.min.x).toBeGreaterThanOrEqual(-w / 2 - tol);
          expect(s.max.x).toBeLessThanOrEqual(w / 2 + tol);
          expect(s.min.z).toBeGreaterThanOrEqual(-d / 2 - tol);
          expect(s.max.z).toBeLessThanOrEqual(d / 2 + tol);
          expect(s.min.y).toBeGreaterThanOrEqual(-1e-6);
          expect(s.max.y).toBeLessThanOrEqual(h + tol);
        }
        // Visible boxes too.
        for (const bx of b.boxes) {
          expect(bx.min.x).toBeGreaterThanOrEqual(-w / 2 - tol);
          expect(bx.max.x).toBeLessThanOrEqual(w / 2 + tol);
          expect(bx.min.z).toBeGreaterThanOrEqual(-d / 2 - tol);
          expect(bx.max.z).toBeLessThanOrEqual(d / 2 + tol);
          expect(bx.max.y).toBeLessThanOrEqual(h + tol);
        }
      }
      if (info.cover === 'high') expect(Math.max(...b.solids.map((s) => s.max.y))).toBeGreaterThanOrEqual(1.8);
      if (info.cover === 'low') {
        const top = Math.max(...b.solids.filter((s) => !s.noBullets).map((s) => s.max.y));
        expect(top).toBeGreaterThanOrEqual(0.85);
      }
    });
  }

  it('is entirely on display in the dev_kit showroom', () => {
    const subs = getMap('dev_kit').signs.map((s) => s.sub ?? '');
    for (const info of PROP_CATALOG) {
      expect(subs.some((sub) => sub === info.id || sub.startsWith(`${info.id} — `)), `${info.id} is not exhibited`).toBe(true);
    }
  });

  it('can be placed in the four orientations with axis-aligned colliders', () => {
    for (const info of PROP_CATALOG) {
      const base = newBuilder();
      info.build(base);
      for (let q = 1; q < 4; q++) {
        const b = newBuilder();
        placeProp(b, info.id, 5, 2, -3, q);
        expect(b.solids.length).toBe(base.solids.length);
        if (PROP_MODELS[info.id]) {
          // Drawn by a real 3D model: the procedural prop only contributes its colliders.
          expect(b.boxes.length).toBe(0);
          expect(b.prims.length).toBe(0);
          expect(b.models.length).toBe(1);
        } else {
          expect(b.boxes.length).toBe(base.boxes.length);
          expect(b.prims.length).toBe(base.prims.length);
        }
        // Quarter turns swap the X and Z extents of every collider.
        b.solids.forEach((s, i) => {
          const o = base.solids[i]!;
          const sx = s.max.x - s.min.x;
          const sz = s.max.z - s.min.z;
          const ox = o.max.x - o.min.x;
          const oz = o.max.z - o.min.z;
          expect(sx).toBeCloseTo(q % 2 ? oz : ox, 6);
          expect(sz).toBeCloseTo(q % 2 ? ox : oz, 6);
          expect(s.min.y).toBeCloseTo(o.min.y + 2, 6);
        });
      }
    }
  });

  it("placeProp can anchor a prop by its back (against a wall)", () => {
    const b = newBuilder();
    const info = placeProp(b, 'lab_fridge', 10, 0, 0.1, 0, 'back');
    const minZ = Math.min(...b.solids.map((s) => s.min.z));
    expect(minZ).toBeCloseTo(0.1, 6);
    expect(info.id).toBe('lab_fridge');
    const b2 = newBuilder();
    placeProp(b2, 'lab_fridge', 10, 0, 5, 1, 'back'); // front toward +X: the back is at x = 10
    expect(Math.min(...b2.solids.map((s) => s.min.x))).toBeCloseTo(10, 6);
    expect((Math.min(...b2.solids.map((s) => s.min.z)) + Math.max(...b2.solids.map((s) => s.max.z))) / 2).toBeCloseTo(5, 6);
    expect(() => placeProp(b, 'does_not_exist', 0, 0, 0)).toThrow();
  });
});

// =================================================================================
// Validation tools
// =================================================================================

/** Closed room 12 × 12 m (inner), optionally roofless, with 8 + 8 spawns 16 m apart… in a 20 m long version. */
function arena(opts: { roof?: boolean; wallHeight?: number; hole?: boolean; crate?: boolean } = {}): MapBuilder {
  const b = newBuilder();
  const h = opts.wallHeight ?? 3;
  b.box(-10.3, -0.3, -6.3, 10.3, 0, 6.3, 'concrete_floor');
  wall(b, { x0: -10.3, z0: -6.15, x1: 10.3, z1: -6.15, height: h, thickness: 0.3, mat: 'concrete' });
  wall(b, { x0: -10.3, z0: 6.15, x1: 10.3, z1: 6.15, height: h, thickness: 0.3, mat: 'concrete' });
  wall(b, { x0: -10.15, z0: -6, x1: -10.15, z1: 6, height: h, thickness: 0.3, mat: 'concrete' });
  wall(b, { x0: 10.15, z0: -6, x1: 10.15, z1: 6, height: h, thickness: 0.3, mat: 'concrete', openings: opts.hole ? [{ at: 6, width: 1.2 }] : [] });
  if (opts.roof !== false) b.box(-10.3, h, -6.3, 10.3, h + 0.3, 6.3, 'concrete');
  if (opts.crate) b.box(8.9, 0, -1, 10, 1, 1, 'cardboard');
  for (let i = 0; i < 8; i++) {
    b.spawn(0, -9, 0, -5.25 + i * 1.5, -90);
    b.spawn(1, 9, 0, -5.25 + i * 1.5, 90);
  }
  b.light(0, h - 0.5, 0);
  return b;
}

describe('map validator', () => {
  it('accepts a closed arena', () => {
    const report = checkMap(arena().build());
    expect(report.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(report.sealed).toBe(true);
    expect(report.stats.spawns).toEqual([8, 8]);
    expect(report.stats.reachableArea).toBeGreaterThan(150);
    expect(report.stats.reachableArea).toBeLessThan(300);
    expect(report.stats.lightmapArea).toBeGreaterThan(200);
  });

  it('detects a leak through a doorway to the outside', () => {
    const map = arena({ hole: true }).build();
    const report = checkMap(map);
    expect(report.sealed).toBe(false);
    expect(report.leaks.length).toBeGreaterThanOrEqual(1);
    const leak = report.leaks[0]!;
    expect(leak.pos.x).toBeGreaterThan(9);
    expect(Math.abs(leak.pos.z)).toBeLessThan(1.5);
    expect(report.issues.some((i) => i.code === 'leak' && i.level === 'error')).toBe(true);
  });

  it('understands open-air maps: high walls seal, low or climbable walls leak', () => {
    const spawn = [{ x: 0, y: 0, z: 0 }];
    expect(floodFill(arena({ roof: false, wallHeight: 3 }).build(), spawn).leaks.length).toBe(0);
    expect(floodFill(arena({ roof: false, wallHeight: 1.0 }).build(), spawn).leaks.length).toBeGreaterThan(0);
    // 2 m wall: sealed… unless a 1 m crate stands against it.
    expect(floodFill(arena({ roof: false, wallHeight: 2 }).build(), spawn).leaks.length).toBe(0);
    expect(floodFill(arena({ roof: false, wallHeight: 2, crate: true }).build(), spawn).leaks.length).toBeGreaterThan(0);
  });

  it('reports the classic mistakes', () => {
    const b = arena();
    b.spawn(0, -9, 0, -5.0, 0); // too close to another spawn
    b.spawn(1, 0, 0.6, 0, 0); // floating
    b.box(3, 0, 3, 4, 2, 4, 'concrete');
    b.spawn(1, 3.5, 0, 3.5, 0); // inside a solid
    b.spawn(0, 2.9, 0, 3.5, 0); // hull overlaps the same solid
    b.light(3.5, 1, 3.5); // light inside a solid
    b.light(0, 50, 0); // light outside the bounds
    b.sign({ x: 0, y: 1, z: 0, facing: 7, w: 1, h: 1, text: 'Oups', style: 'plaque' });
    b.sign({ x: 0, y: 1, z: 2, facing: 0, w: 0, h: 1, text: 'Oups', style: 'plaque' });
    b.zone('site', 'A', -2, 0, -2, 2, 2, 2, 'Site A');
    b.zone('site', 'A', -2, 0, -2, 2, 2, 2, 'Site A bis');
    b.point('poi', 'p', 0, 0, 1);
    b.point('poi', 'p', 1, 0, 1);
    b.point('sample', 's', 0, 1.5, -3); // a cooler in mid-air
    const map = b.build();
    map.solids.push({ min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 1, z: 1 }, surf: 'concrete' });
    map.solids.push({ min: { x: 1, y: 0, z: 0 }, max: { x: 0.5, y: 1, z: 1 }, surf: 'concrete' });
    map.solids.push({ min: { x: Number.NaN, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 }, surf: 'concrete' });
    const codes = new Set(checkMap(map, { noFlood: true, noNav: true }).issues.filter((i) => i.level === 'error').map((i) => i.code));
    for (const code of [
      'spawn.spacing',
      'spawn.floating',
      'spawn.inSolid',
      'spawn.blocked',
      'light.inSolid',
      'light.outside',
      'sign.facing',
      'sign.size',
      'zone.duplicate',
      'point.duplicate',
      'point.floating',
      'solid.degenerate',
      'solid.inverted',
      'solid.nan',
    ]) {
      expect(codes.has(code), `expected error ${code}`).toBe(true);
    }
  });

  it('requires 8 spawns per team, team areas 15 m apart, and the objects of each mode', () => {
    const b = newBuilder();
    b.box(-5, -0.3, -5, 5, 0, 5, 'concrete_floor');
    for (let i = 0; i < 3; i++) {
      b.spawn(0, -4, 0, -3 + i * 2, 0);
      b.spawn(1, 4, 0, -3 + i * 2, 0);
    }
    const map = b.build();
    map.meta = { ...map.meta, id: 'place_test', modes: ['tdm', 'defuse', 'secure'] };
    const codes = checkMap(map, { noFlood: true, noNav: true }).issues.filter((i) => i.level === 'error').map((i) => i.code);
    expect(codes.filter((c) => c === 'spawn.count').length).toBe(2);
    expect(codes).toContain('spawn.teamGap');
    expect(codes).toContain('mode.defuse');
    expect(codes).toContain('mode.secure');
    // The same shortage is only a warning on a dev_ map.
    map.meta = { ...map.meta, id: 'dev_small', modes: ['tdm'] };
    const dev = checkMap(map, { noFlood: true, noNav: true });
    expect(dev.issues.some((i) => i.code === 'spawn.count' && i.level === 'warning')).toBe(true);
    expect(dev.issues.some((i) => i.code === 'spawn.count' && i.level === 'error')).toBe(false);
  });

  it('uses the navigation grid when it is available (injected stand-in)', () => {
    const map = arena().build();
    const nav: NavLike = {
      stats: { nodes: 1000, regions: 1, largest: 1000, buildMs: 3 },
      nearest: (p) => p,
      reachable: () => true,
      findPath: (_a, b) => [{ x: 0, y: 0, z: 0 }, b],
    };
    const ok = checkMap(map, { navFactory: () => nav });
    expect(ok.navStatus).toBe('ok');
    expect(ok.errors).toBe(0);
    expect(ok.stats.nav?.walkableArea).toBeCloseTo(250);
    expect(ok.stats.nav?.spawnPath).toBeGreaterThan(17.9);
    expect(ok.stats.nav?.spawnPath).toBeLessThan(18.3);
    expect(formatReport(ok, map)).toContain('chemin entre les camps');

    const cut = checkMap(map, { navFactory: () => ({ ...nav, reachable: (_a, b) => b.x < 0, findPath: () => null }) });
    const codes = cut.issues.filter((i) => i.level === 'error').map((i) => i.code);
    expect(codes.filter((c) => c === 'nav.spawn').length).toBe(8); // the eight spawns of the other team
    expect(codes).toContain('nav.path');

    const offGrid = checkMap(map, { navFactory: () => ({ ...nav, nearest: () => null }) });
    expect(offGrid.issues.filter((i) => i.code === 'nav.spawn').length).toBe(16);

    // A module that is not implemented yet only produces a warning.
    const missing = checkMap(map, {
      navFactory: () => {
        throw new Error('NavGrid.build: not implemented');
      },
    });
    expect(missing.errors).toBe(0);
    expect(missing.issues.some((i) => i.code === 'nav.unavailable' && i.level === 'warning')).toBe(true);
    expect(missing.navStatus).toContain('pas encore implémenté');
  });

  it('writes a readable French report', () => {
    const map = arena({ hole: true }).build();
    const text = formatReport(checkMap(map, { noNav: true }), map);
    expect(text).toContain('=== Carte « Test » (dev_unit) ===');
    expect(text).toContain('FUITE');
    expect(text).toContain('Résultat : ÉCHEC');
    const fine = arena().build();
    expect(formatReport(checkMap(fine, { noNav: true }), fine)).toContain('carte fermée');
  });

  it('spawn helpers agree with the hull size', () => {
    const map = arena().build();
    expect(hullFree(map, { x: 0, y: 0, z: 0 })).toBe(true);
    expect(hullFree(map, { x: 10 - PLAYER_HALF_WIDTH + 0.05, y: 0, z: 0 })).toBe(false);
    expect(groundUnder(map, { x: 0, y: 0, z: 0 })).toBeCloseTo(0);
    expect(groundUnder(map, { x: 0, y: 2, z: 0 })).toBeCloseTo(0);
    expect(groundUnder(map, { x: 50, y: 0, z: 0 })).toBeNull();
  });
});

describe('map plan', () => {
  it('renders an SVG plan of the showroom at a legible scale', () => {
    const map = getMap('dev_kit');
    const plan = renderPlan(map);
    expect(plan.svg.startsWith('<svg')).toBe(true);
    expect(plan.svg).toContain('Salon du matériel');
    expect(plan.scale).toBeGreaterThanOrEqual(20);
    expect(plan.cutY).toBeCloseTo(1);
    expect(plan.width).toBeGreaterThan(1000);
    // One arrow per spawn (rotated groups), in both team colours.
    expect((plan.svg.match(/<g transform="translate\([^)]*\) rotate/g) ?? []).length).toBe(map.spawns.length);
    expect(plan.svg).toContain('#3182ce');
    expect(plan.svg).toContain('#e7343f');
    const upper = renderPlan(map, { y: 4.2, scale: 20 });
    expect(upper.scale).toBe(20);
    expect(upper.svg).not.toBe(plan.svg);
  });

  it('reduces the scale for very large maps', () => {
    const b = newBuilder();
    b.box(-100, -0.3, -60, 100, 0, 60, 'asphalt');
    b.spawn(0, 0, 0, 0);
    const plan = renderPlan(b.build());
    expect(plan.scale).toBeLessThan(20);
    expect(plan.scale).toBeGreaterThanOrEqual(6);
    const small = newBuilder();
    small.box(-40, -0.3, -30, 40, 0, 30, 'asphalt');
    expect(renderPlan(small.build()).scale).toBeGreaterThanOrEqual(20);
  });
});
