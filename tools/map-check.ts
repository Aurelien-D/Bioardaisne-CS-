/**
 * Map validator.
 *
 *   npx tsx tools/map-check.ts <mapId|all> [--verbose]
 *
 * Prints a report in French (errors, warnings, statistics) and exits with a non-zero
 * code when at least one map has errors. The checks are also exported (`checkMap`) so
 * that tests and other tools (tools/map-plan.ts) can reuse them.
 *
 * Checks: metadata, geometry sanity (NaN / inverted / degenerate solids, materials),
 * spawns (count, free standing hull, ground, spacing, distance between the teams),
 * zones and points, lights, signs, sealing (voxel "hull walk" flood fill from the
 * spawns, see `floodFill`), statistics, and — when the physics / navigation modules are
 * implemented — reachability on the navigation grid.
 */
import { pathToFileURL } from 'node:url';
import { PLAYER_HALF_WIDTH, PLAYER_HEIGHT } from '../src/shared/constants';
import { MAP_MODULES } from '../src/shared/maps';
import { MATERIALS, type MaterialInfo } from '../src/shared/maps/materials';
import type { FaceName, MapData, Solid } from '../src/shared/maps/types';
import type { Vec3 } from '../src/shared/math/vec3';
import { NavGrid } from '../src/shared/nav/navgrid';
import { CollisionWorld } from '../src/shared/physics/world';

// =================================================================================
// Report types
// =================================================================================

export type IssueLevel = 'error' | 'warning';

export interface Issue {
  level: IssueLevel;
  /** Stable machine-readable code, e.g. 'spawn.blocked'. */
  code: string;
  /** Human-readable message (French). */
  message: string;
  /** Location of the problem, when it has one. */
  pos?: Vec3;
}

export interface Leak {
  /** Last cell inside the bounds before the escape. */
  pos: Vec3;
  /** Coarse path from a spawn to the leak (to find the hole on the plan). */
  path: Vec3[];
}

export interface MapStats {
  size: Vec3;
  solids: number;
  solidsNoBullets: number;
  solidsNoPlayers: number;
  boxes: number;
  detailBoxes: number;
  prims: number;
  lights: number;
  signs: number;
  spawns: [number, number];
  zones: number;
  points: number;
  /** Estimated light-mapped area (m²): visible faces of non-detail boxes. */
  lightmapArea: number;
  /** Estimated light-map texels at 4 texels per metre. */
  lightmapTexels: number;
  /** Walkable floor area reached by the voxel flood fill (m², coarse). */
  reachableArea: number;
  /** From the navigation grid, when available. */
  nav?: { nodes: number; regions: number; walkableArea: number; spawnPath: number | null; buildMs: number };
}

export interface MapReport {
  id: string;
  name: string;
  issues: Issue[];
  errors: number;
  warnings: number;
  stats: MapStats;
  leaks: Leak[];
  sealed: boolean;
  /** 'ok', or the reason why navigation checks were skipped. */
  navStatus: string;
  /** 'ok', or the reason why the cross-check against the physics module was skipped. */
  physicsStatus: string;
}

/** The part of NavGrid the validator needs (lets tests inject a stand-in). */
export type NavLike = Pick<NavGrid, 'stats' | 'findPath' | 'nearest' | 'reachable'>;

export interface CheckOptions {
  /** Skip the (slower) flood fill. */
  noFlood?: boolean;
  /** Skip the physics / navigation checks. */
  noNav?: boolean;
  /** Builds the navigation grid (default: CollisionWorld + NavGrid.build). */
  navFactory?: (map: MapData, cell: number) => NavLike;
}

// =================================================================================
// Small geometry helpers
// =================================================================================

const fmt = (n: number, digits = 2): string => (Math.round(n * 10 ** digits) / 10 ** digits).toFixed(digits).replace(/\.?0+$/, '').replace('.', ',');
export const fmtPos = (p: Vec3): string => `(${fmt(p.x)} ; ${fmt(p.y)} ; ${fmt(p.z)})`;
const finite3 = (v: Vec3): boolean => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const matInfo = (id: string): MaterialInfo | undefined => (MATERIALS as Record<string, MaterialInfo>)[id];
const plural = (n: number, one: string, many: string): string => `${n} ${n > 1 ? many : one}`;

/** True if the point is strictly inside the solid (with a small tolerance). */
function pointIn(s: { min: Vec3; max: Vec3 }, p: Vec3, eps = 1e-4): boolean {
  return p.x > s.min.x + eps && p.x < s.max.x - eps && p.y > s.min.y + eps && p.y < s.max.y - eps && p.z > s.min.z + eps && p.z < s.max.z - eps;
}

function boxOverlap(s: Solid, min: Vec3, max: Vec3, eps = 1e-4): boolean {
  return s.min.x < max.x - eps && s.max.x > min.x + eps && s.min.y < max.y - eps && s.max.y > min.y + eps && s.min.z < max.z - eps && s.max.z > min.z + eps;
}

function insideBounds(map: MapData, p: Vec3, tol = 0.01): boolean {
  const { min, max } = map.bounds;
  return p.x >= min.x - tol && p.x <= max.x + tol && p.y >= min.y - tol && p.y <= max.y + tol && p.z >= min.z - tol && p.z <= max.z + tol;
}

/** Player-blocking solid containing the point, if any. */
export function solidAt(map: MapData, p: Vec3, playersOnly = true): Solid | null {
  for (const s of map.solids) {
    if (playersOnly && s.noPlayers) continue;
    if (pointIn(s, p)) return s;
  }
  return null;
}

/** True if a standing player hull with its feet at `p` overlaps nothing. */
export function hullFree(map: MapData, p: Vec3, height = PLAYER_HEIGHT): boolean {
  const min = { x: p.x - PLAYER_HALF_WIDTH, y: p.y + 0.02, z: p.z - PLAYER_HALF_WIDTH };
  const max = { x: p.x + PLAYER_HALF_WIDTH, y: p.y + height, z: p.z + PLAYER_HALF_WIDTH };
  for (const s of map.solids) {
    if (s.noPlayers) continue;
    if (boxOverlap(s, min, max)) return false;
  }
  return true;
}

/**
 * Height of the highest solid top under a hull standing at `p` (looking down at most
 * `maxDrop`), or null. A hull "stands on the ground" when p.y − groundUnder ≤ 0.1.
 */
export function groundUnder(map: MapData, p: Vec3, maxDrop = 50, halfWidth = PLAYER_HALF_WIDTH): number | null {
  let best: number | null = null;
  for (const s of map.solids) {
    if (s.noPlayers) continue;
    if (s.min.x >= p.x + halfWidth || s.max.x <= p.x - halfWidth || s.min.z >= p.z + halfWidth || s.max.z <= p.z - halfWidth) continue;
    const top = s.max.y;
    if (top > p.y + 0.02 || top < p.y - maxDrop) continue;
    if (best === null || top > best) best = top;
  }
  return best;
}

// =================================================================================
// Sealing: voxel "hull walk" flood fill
// =================================================================================

export interface FloodResult {
  leaks: Leak[];
  /** Number of floor cells (cells with ground right below) reached. */
  floorCells: number;
  cell: number;
  /** True if the feet position was reached by the fill. */
  reached(p: Vec3): boolean;
}

/**
 * Coarse reachability flood fill used to prove that a map is sealed.
 *
 * The space is cut into `cell`-sized voxels (0.5 m). A voxel is blocked as soon as a
 * player-blocking solid touches it, so thin walls never leak; a player "fits" where two
 * stacked voxels are free (crouch height). From the spawns the fill walks, falls, and
 * jumps like a (generous) player: from a voxel with ground below, feet may rise 1.3 m
 * above that ground, travel 4.5 m at that height, then glide down at 45°. That
 * over-estimates what a real player can do, so a map reported as sealed is sealed; a leak
 * through a gap narrower than 1 m may however be missed.
 *
 * A leak is any reached voxel whose centre is outside the map bounds in X / Z, or below them.
 */
export function floodFill(map: MapData, seeds: Vec3[], cell = 0.5): FloodResult {
  const JUMP = 1.3; // max feet rise above the take-off ground (m): 1.225 m apex + margin
  const FLAT = 9; // horizontal voxels travelled at full height before gliding (jump length)
  const M = 2; // margin (voxels) around the bounds
  const { min, max } = map.bounds;
  const ix0 = Math.floor(min.x / cell) - M;
  const iy0 = Math.floor(min.y / cell) - M;
  const iz0 = Math.floor(min.z / cell) - M;
  const nx = Math.ceil(max.x / cell) + M - ix0;
  const ny = Math.ceil(max.y / cell) + 6 - iy0;
  const nz = Math.ceil(max.z / cell) + M - iz0;
  const n = nx * ny * nz;
  const blocked = new Uint8Array(n);
  /** For blocked cells: highest solid top inside the cell (absolute metres). */
  const top = new Float32Array(n).fill(-1e9);
  const idx = (x: number, y: number, z: number): number => (y * nz + z) * nx + x;
  const SLAB = nx * nz;
  const eps = 1e-3;
  for (const s of map.solids) {
    if (s.noPlayers) continue;
    const ax = Math.max(0, Math.floor((s.min.x + eps) / cell) - ix0);
    const bx = Math.min(nx - 1, Math.ceil((s.max.x - eps) / cell) - 1 - ix0);
    const ay = Math.max(0, Math.floor((s.min.y + eps) / cell) - iy0);
    const by = Math.min(ny - 1, Math.ceil((s.max.y - eps) / cell) - 1 - iy0);
    const az = Math.max(0, Math.floor((s.min.z + eps) / cell) - iz0);
    const bz = Math.min(nz - 1, Math.ceil((s.max.z - eps) / cell) - 1 - iz0);
    for (let y = ay; y <= by; y++) {
      const cellTop = (y + 1 + iy0) * cell;
      const t = Math.min(s.max.y, cellTop);
      for (let z = az; z <= bz; z++) {
        for (let x = ax; x <= bx; x++) {
          const i = idx(x, y, z);
          blocked[i] = 1;
          if (t > top[i]!) top[i] = t;
        }
      }
    }
  }
  // Cells whose centre is outside the bounds (in X / Z) or below them.
  const outside = (x: number, y: number, z: number): boolean => {
    const cx = (x + ix0 + 0.5) * cell;
    const cz = (z + iz0 + 0.5) * cell;
    const cy = (y + iy0 + 0.5) * cell;
    return cx < min.x || cx > max.x || cz < min.z || cz > max.z || cy < min.y;
  };
  const fits = (i: number, y: number): boolean => !blocked[i] && (y + 1 >= ny || !blocked[i + SLAB]);

  // State: for every cell and every remaining "flat budget" (0..FLAT), the best ceiling
  // (max feet height, in centimetres above the grid base) the cell was reached with.
  const B = FLAT + 1;
  const NONE = -32768;
  const best = new Int16Array(n * B).fill(NONE);
  const parent = new Int32Array(n).fill(-2);
  const baseY = iy0 * cell;
  const toCm = (h: number): number => Math.max(NONE + 1, Math.min(32767, Math.round((h - baseY) * 100)));
  // FIFO queue (ring buffer of [cell, budget, ceiling] triples): breadth-first order, so the
  // `parent` links form short paths from the seeds — used to describe where a leak goes through.
  let queue = new Int32Array(3 << 15);
  let head = 0;
  let count = 0;
  const push = (i: number, b: number, c: number, from: number): void => {
    // Dominated by a state with at least as much budget and ceiling?
    const o = i * B;
    for (let k = b; k < B; k++) if (best[o + k]! >= c) return;
    best[o + b] = c;
    if (parent[i] === -2) parent[i] = from;
    if (count + 3 > queue.length) {
      const bigger = new Int32Array(queue.length * 2);
      for (let k = 0; k < count; k++) bigger[k] = queue[(head + k) % queue.length]!;
      queue = bigger;
      head = 0;
    }
    let tail = (head + count) % queue.length;
    queue[tail] = i;
    tail = (tail + 1) % queue.length;
    queue[tail] = b;
    tail = (tail + 1) % queue.length;
    queue[tail] = c;
    count += 3;
  };

  const cellOf = (p: Vec3): number => {
    const x = Math.floor(p.x / cell) - ix0;
    const y = Math.floor((p.y + 0.05) / cell) - iy0;
    const z = Math.floor(p.z / cell) - iz0;
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return -1;
    return idx(x, y, z);
  };
  for (const s of seeds) {
    let i = cellOf(s);
    if (i < 0) continue;
    // A seed resting on a thin overlay may fall in a blocked cell: try the cell above, no further
    // (a seed buried in a wall must not be lifted onto the roof).
    if (blocked[i] && i + SLAB < n) i += SLAB;
    if (blocked[i]) continue;
    push(i, FLAT, toCm(s.y + JUMP), -1);
  }

  const leakCells: number[] = [];
  const leakSeen = new Uint8Array(n);
  let floorCells = 0;
  const floorSeen = new Uint8Array(n);
  const cellCm = cell * 100;
  while (count > 0) {
    const i = queue[head]!;
    const b = queue[(head + 1) % queue.length]!;
    const c = queue[(head + 2) % queue.length]!;
    head = (head + 3) % queue.length;
    count -= 3;
    if (best[i * B + b]! > c) continue; // superseded
    const y = Math.floor(i / SLAB);
    const r = i - y * SLAB;
    const z = Math.floor(r / nx);
    const x = r - z * nx;
    if (outside(x, y, z)) {
      if (!leakSeen[i]) {
        leakSeen[i] = 1;
        leakCells.push(i);
      }
      continue;
    }
    const bottomCm = y * cellCm;
    // Standing on something: new take-off.
    if (y > 0 && blocked[i - SLAB]) {
      if (!floorSeen[i]) {
        floorSeen[i] = 1;
        floorCells++;
      }
      const g = top[i - SLAB]!;
      const cc = toCm(g + JUMP);
      if (b < FLAT || c < cc) push(i, FLAT, Math.max(c, cc), i);
    } else if (y > 0 && fits(i - SLAB, y - 1)) {
      push(i - SLAB, b, c, i); // fall
    }
    // Rise within the ceiling.
    if (y + 1 < ny && c >= bottomCm + cellCm && fits(i + SLAB, y + 1)) push(i + SLAB, b, c, i);
    // Horizontal moves.
    const nb = b > 0 ? b - 1 : 0;
    const nc = b > 0 ? c : c - cellCm;
    if (nc >= bottomCm) {
      if (x > 0 && fits(i - 1, y)) push(i - 1, nb, nc, i);
      if (x + 1 < nx && fits(i + 1, y)) push(i + 1, nb, nc, i);
      if (z > 0 && fits(i - nx, y)) push(i - nx, nb, nc, i);
      if (z + 1 < nz && fits(i + nx, y)) push(i + nx, nb, nc, i);
    }
  }

  const centre = (i: number): Vec3 => {
    const y = Math.floor(i / SLAB);
    const r = i - y * SLAB;
    const z = Math.floor(r / nx);
    const x = r - z * nx;
    return { x: (x + ix0 + 0.5) * cell, y: (y + iy0) * cell, z: (z + iz0 + 0.5) * cell };
  };
  // Cluster the leak cells (3 m) and rebuild a coarse path for each cluster.
  const leaks: Leak[] = [];
  for (const i of leakCells) {
    const from = parent[i]!;
    const pos = centre(from >= 0 ? from : i);
    if (leaks.some((l) => Math.hypot(l.pos.x - pos.x, l.pos.y - pos.y, l.pos.z - pos.z) < 3)) continue;
    const path: Vec3[] = [];
    let cur = from;
    let guard = 0;
    while (cur >= 0 && guard++ < 100000) {
      const p = centre(cur);
      const last = path[path.length - 1];
      if (!last || Math.hypot(last.x - p.x, last.y - p.y, last.z - p.z) >= 4) path.push(p);
      const next = parent[cur]!;
      if (next === cur) break;
      cur = next;
    }
    path.reverse();
    leaks.push({ pos, path });
  }
  return {
    leaks,
    floorCells,
    cell,
    reached(p: Vec3): boolean {
      let i = cellOf(p);
      if (i < 0) return false;
      for (let k = 0; k < 2 && i < n; k++) {
        if (parent[i] !== -2) return true;
        i += SLAB;
      }
      return false;
    },
  };
}

// =================================================================================
// The checks
// =================================================================================

const SIGN_STYLES = new Set(['plaque', 'door', 'poster', 'street', 'shop', 'screen', 'banner', 'floor']);
const PRIM_SHAPES = new Set(['box', 'cyl', 'sphere', 'cone', 'prism', 'pyramid', 'wedge']);
const FACE_NAMES: FaceName[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
const SIGN_NORMALS: Vec3[] = [
  { x: 0, y: 0, z: 1 },
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 0, z: -1 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
];

export function checkMap(map: MapData, opts: CheckOptions = {}): MapReport {
  const issues: Issue[] = [];
  const add = (level: IssueLevel, code: string, message: string, pos?: Vec3): void => {
    const issue: Issue = { level, code, message };
    if (pos) issue.pos = { x: pos.x, y: pos.y, z: pos.z };
    issues.push(issue);
  };
  const err = (code: string, message: string, pos?: Vec3): void => add('error', code, message, pos);
  const warn = (code: string, message: string, pos?: Vec3): void => add('warning', code, message, pos);
  const meta = map.meta;
  const isDev = !!meta?.id?.startsWith('dev_');

  // --- Metadata -----------------------------------------------------------------
  if (!meta) err('meta.missing', 'Métadonnées absentes.');
  else {
    if (!meta.id || !/^[a-z0-9_]+$/.test(meta.id)) err('meta.id', `Identifiant de carte invalide : « ${meta.id} » (minuscules, chiffres et _ uniquement).`);
    if (!meta.name?.trim()) err('meta.name', 'La carte n’a pas de nom affichable.');
    if (!meta.description?.trim()) warn('meta.description', 'La carte n’a pas de description pour le menu.');
    if (!Array.isArray(meta.modes) || !meta.modes.includes('tdm')) err('meta.modes', 'La carte doit proposer au moins le mode « tdm ».');
    const pl = meta.players;
    if (!Array.isArray(pl) || pl.length !== 2 || !(pl[0] >= 1) || !(pl[1] >= pl[0])) err('meta.players', 'Nombre de joueurs conseillé invalide (attendu : [min, max]).');
    if (meta.modes?.includes('defuse') && !map.zones.some((z) => z.kind === 'site')) {
      err('mode.defuse', 'Le mode « defuse » exige au moins une zone « site » (A / B).');
    }
    if (meta.modes?.includes('secure')) {
      if (!map.points.some((p) => p.kind === 'sample')) err('mode.secure', 'Le mode « secure » exige au moins un point « sample » (glacière).');
      if (!map.zones.some((z) => z.kind === 'extract')) err('mode.secure', 'Le mode « secure » exige au moins une zone « extract ».');
    }
  }

  // --- Bounds --------------------------------------------------------------------
  const boundsOk = !!map.bounds && finite3(map.bounds.min) && finite3(map.bounds.max);
  if (!boundsOk) err('bounds', 'Limites de la carte non finies.');
  const size = boundsOk
    ? { x: map.bounds.max.x - map.bounds.min.x, y: map.bounds.max.y - map.bounds.min.y, z: map.bounds.max.z - map.bounds.min.z }
    : { x: 0, y: 0, z: 0 };
  if (boundsOk && !(Number.isFinite(map.killY) && map.killY < map.bounds.min.y)) warn('killY', 'killY devrait être sous le point le plus bas de la carte.');

  // --- Solids, boxes, prims --------------------------------------------------------
  const checkAabb = (kind: string, code: string, list: readonly { min: Vec3; max: Vec3 }[]): void => {
    let nan = 0;
    let inverted = 0;
    let degenerate = 0;
    let firstBad: Vec3 | undefined;
    for (const s of list) {
      if (!finite3(s.min) || !finite3(s.max)) {
        nan++;
        continue;
      }
      const dx = s.max.x - s.min.x;
      const dy = s.max.y - s.min.y;
      const dz = s.max.z - s.min.z;
      if (dx < 0 || dy < 0 || dz < 0) {
        inverted++;
        firstBad ??= s.min;
      } else if (dx < 1e-4 || dy < 1e-4 || dz < 1e-4) {
        degenerate++;
        firstBad ??= s.min;
      }
    }
    if (nan) err(`${code}.nan`, `${nan} ${kind}(s) avec des coordonnées non finies (NaN / infini).`);
    if (inverted) err(`${code}.inverted`, `${inverted} ${kind}(s) inversé(s) (min > max).`, firstBad);
    if (degenerate) err(`${code}.degenerate`, `${degenerate} ${kind}(s) dégénéré(s) (épaisseur nulle).`, firstBad);
  };
  checkAabb('solide', 'solid', map.solids);
  checkAabb('boîte', 'box', map.boxes);
  if (map.solids.length === 0) err('solid.none', 'La carte ne contient aucun solide.');
  if (map.solids.length > 6000) warn('solid.count', `${map.solids.length} solides : au-delà de 6 000, la physique et la navigation ralentissent.`);
  const useless = map.solids.filter((s) => s.noBullets && s.noPlayers).length;
  if (useless) warn('solid.useless', `${useless} solide(s) à la fois « noBullets » et « noPlayers » : ils ne servent à rien.`);

  const badMats = new Set<string>();
  const matOk = (m: unknown): boolean => typeof m === 'string' && Object.prototype.hasOwnProperty.call(MATERIALS, m);
  for (const bx of map.boxes) {
    if (!matOk(bx.mat)) badMats.add(String(bx.mat));
    if (bx.faces) {
      for (const f of Object.keys(bx.faces) as FaceName[]) {
        if (!FACE_NAMES.includes(f)) err('box.face', `Nom de face inconnu : « ${f} ».`, bx.min);
        const m = bx.faces[f];
        if (m !== null && m !== undefined && !matOk(m)) badMats.add(String(m));
      }
    }
  }
  let badPrims = 0;
  for (const p of map.prims) {
    if (!matOk(p.mat)) badMats.add(String(p.mat));
    const rotOk = !p.rot || finite3(p.rot);
    if (!PRIM_SHAPES.has(p.shape) || !finite3(p.pos) || !finite3(p.size) || !rotOk || !(p.size.x > 0) || !(p.size.y > 0) || !(p.size.z > 0)) badPrims++;
  }
  if (badPrims) err('prim.invalid', `${badPrims} primitive(s) invalide(s) (forme inconnue, taille nulle ou coordonnées non finies).`);
  for (const m of badMats) err('material.unknown', `Matériau inconnu : « ${m} ».`);

  // --- Spawns -----------------------------------------------------------------------
  const teamNames = ['Équipe Labo', 'Les Auditeurs'];
  const spawnCount: [number, number] = [0, 0];
  for (const s of map.spawns) {
    if (s.team !== 0 && s.team !== 1) {
      err('spawn.team', `Apparition avec une équipe invalide (${String(s.team)}).`, s.pos);
      continue;
    }
    spawnCount[s.team]++;
  }
  for (const t of [0, 1] as const) {
    const c = spawnCount[t];
    if (c < 8) {
      const msg = `${teamNames[t]} : ${c} point(s) d’apparition, il en faut au moins 8.`;
      if (c === 0 || !isDev) err('spawn.count', msg);
      else warn('spawn.count', `${msg} (toléré pour une carte dev_)`);
    }
  }
  map.spawns.forEach((s, i) => {
    const label = `Apparition n° ${i + 1} (${teamNames[s.team] ?? '?'}) ${finite3(s.pos) ? fmtPos(s.pos) : ''}`;
    if (!finite3(s.pos) || !Number.isFinite(s.yaw)) {
      err('spawn.nan', `${label} : coordonnées ou orientation non finies.`);
      return;
    }
    if (boundsOk && !insideBounds(map, s.pos)) err('spawn.outside', `${label} : en dehors des limites de la carte.`, s.pos);
    if (solidAt(map, { x: s.pos.x, y: s.pos.y + 0.05, z: s.pos.z })) {
      err('spawn.inSolid', `${label} : à l’intérieur d’un solide.`, s.pos);
      return;
    }
    if (!hullFree(map, s.pos)) err('spawn.blocked', `${label} : pas la place pour un joueur debout (0,7 × 0,7 × 1,8 m).`, s.pos);
    const g = groundUnder(map, s.pos);
    if (g === null) err('spawn.noGround', `${label} : aucun sol en dessous.`, s.pos);
    else if (s.pos.y - g > 0.1) err('spawn.floating', `${label} : flotte ${fmt(s.pos.y - g)} m au-dessus du sol.`, s.pos);
  });
  for (let i = 0; i < map.spawns.length; i++) {
    for (let j = i + 1; j < map.spawns.length; j++) {
      const a = map.spawns[i]!.pos;
      const c = map.spawns[j]!.pos;
      if (!finite3(a) || !finite3(c) || Math.abs(a.y - c.y) > PLAYER_HEIGHT) continue;
      const d = Math.hypot(a.x - c.x, a.z - c.z);
      if (d < 1.2 - 1e-6) err('spawn.spacing', `Apparitions n° ${i + 1} et n° ${j + 1} trop proches (${fmt(d)} m, minimum 1,2 m).`, a);
    }
  }
  let teamGap = Infinity;
  for (const a of map.spawns) {
    for (const c of map.spawns) {
      if (a.team === 0 && c.team === 1 && finite3(a.pos) && finite3(c.pos)) teamGap = Math.min(teamGap, Math.hypot(a.pos.x - c.pos.x, a.pos.y - c.pos.y, a.pos.z - c.pos.z));
    }
  }
  if (teamGap < 15) err('spawn.teamGap', `Les zones d’apparition des deux équipes ne sont qu’à ${fmt(teamGap)} m l’une de l’autre (minimum 15 m).`);

  // --- Zones and points -----------------------------------------------------------------
  const zoneIds = new Set<string>();
  for (const z of map.zones) {
    const label = `Zone « ${z.kind}:${z.id} »`;
    const key = `${z.kind}:${z.id}`;
    if (zoneIds.has(key)) err('zone.duplicate', `${label} : identifiant en double.`);
    zoneIds.add(key);
    if (!['site', 'extract', 'buy'].includes(z.kind)) err('zone.kind', `${label} : type inconnu.`);
    if (!finite3(z.min) || !finite3(z.max)) {
      err('zone.nan', `${label} : coordonnées non finies.`);
      continue;
    }
    if (z.max.x - z.min.x < 0.5 || z.max.y - z.min.y < 0.5 || z.max.z - z.min.z < 0.5) err('zone.size', `${label} : volume trop petit ou inversé.`, z.min);
    if (boundsOk && (!insideBounds(map, z.min, 0.05) || !insideBounds(map, z.max, 0.05))) err('zone.outside', `${label} : dépasse les limites de la carte.`, z.min);
    const c = { x: (z.min.x + z.max.x) / 2, y: z.min.y, z: (z.min.z + z.max.z) / 2 };
    const g = groundUnder(map, { x: c.x, y: z.max.y, z: c.z }, z.max.y - z.min.y + 0.5, 0.05);
    if (g === null) warn('zone.noGround', `${label} : pas de sol sous son centre.`, c);
    else if (!hullFree(map, { x: c.x, y: g, z: c.z })) warn('zone.blocked', `${label} : son centre est encombré (un joueur n’y tient pas debout).`, c);
    if (!z.label) warn('zone.label', `${label} : pas de nom affichable (label).`);
  }
  const pointIds = new Set<string>();
  for (const p of map.points) {
    const label = `Point « ${p.kind}:${p.id} »`;
    const key = `${p.kind}:${p.id}`;
    if (pointIds.has(key)) err('point.duplicate', `${label} : identifiant en double.`);
    pointIds.add(key);
    if (!finite3(p.pos)) {
      err('point.nan', `${label} : coordonnées non finies.`);
      continue;
    }
    if (boundsOk && !insideBounds(map, p.pos)) err('point.outside', `${label} : en dehors des limites de la carte.`, p.pos);
    const inSolid = !!solidAt(map, { x: p.pos.x, y: p.pos.y + 0.05, z: p.pos.z });
    const g = groundUnder(map, p.pos, 50, 0.05);
    const onGround = g !== null && p.pos.y - g <= 0.1;
    if (p.kind === 'sample') {
      if (inSolid) err('point.inSolid', `${label} ${fmtPos(p.pos)} : à l’intérieur d’un solide.`, p.pos);
      else if (!onGround) err('point.floating', `${label} ${fmtPos(p.pos)} : une glacière doit être posée sur le sol.`, p.pos);
      else if (!hullFree(map, p.pos)) warn('point.blocked', `${label} ${fmtPos(p.pos)} : un joueur ne peut pas se tenir dessus.`, p.pos);
    } else {
      if (inSolid) warn('point.inSolid', `${label} ${fmtPos(p.pos)} : à l’intérieur d’un solide.`, p.pos);
      else if (!onGround) warn('point.floating', `${label} ${fmtPos(p.pos)} : n’est pas au niveau du sol.`, p.pos);
    }
  }

  // --- Lights ------------------------------------------------------------------------------
  let lightsInSolid = 0;
  let firstLight: Vec3 | undefined;
  map.lights.forEach((l, i) => {
    const label = `Lumière n° ${i + 1}`;
    if (!finite3(l.pos) || !Number.isFinite(l.intensity) || !Number.isFinite(l.range) || !Number.isFinite(l.color)) {
      err('light.nan', `${label} : valeurs non finies.`);
      return;
    }
    if (!(l.intensity > 0) || !(l.range > 0)) err('light.value', `${label} ${fmtPos(l.pos)} : intensité et portée doivent être positives.`, l.pos);
    if (boundsOk && !insideBounds(map, l.pos)) err('light.outside', `${label} ${fmtPos(l.pos)} : en dehors des limites de la carte.`, l.pos);
    if (solidAt(map, l.pos, false)) {
      lightsInSolid++;
      firstLight ??= l.pos;
      if (lightsInSolid <= 5) err('light.inSolid', `${label} ${fmtPos(l.pos)} : à l’intérieur d’un solide (elle n’éclairera rien).`, l.pos);
    }
  });
  if (lightsInSolid > 5) err('light.inSolid', `… et ${lightsInSolid - 5} autre(s) lumière(s) dans un solide.`, firstLight);
  if (map.lights.length > 600) warn('light.count', `${map.lights.length} lumières : le précalcul de l’éclairage sera long (pensez à l’option lightEvery de ceilingLights).`);
  if (map.lights.length === 0 && !(map.env.sunIntensity > 0)) warn('light.none', 'Aucune lumière et pas de soleil : la carte sera noire.');

  // --- Signs -----------------------------------------------------------------------------------
  map.signs.forEach((s, i) => {
    const label = `Panneau n° ${i + 1} « ${String(s.text).slice(0, 28)} »`;
    if (!finite3(s.pos)) {
      err('sign.nan', `${label} : coordonnées non finies.`);
      return;
    }
    if (!Number.isInteger(s.facing) || s.facing < 0 || s.facing > 5) {
      err('sign.facing', `${label} : orientation invalide (${String(s.facing)}), attendu 0 à 5.`, s.pos);
      return;
    }
    if (!(s.w > 0) || !(s.h > 0)) err('sign.size', `${label} : largeur et hauteur doivent être positives.`, s.pos);
    if (!SIGN_STYLES.has(s.style)) err('sign.style', `${label} : style inconnu « ${String(s.style)} ».`, s.pos);
    if (typeof s.text !== 'string') err('sign.text', `${label} : texte manquant.`, s.pos);
    else if (!s.text.trim() && !s.icon) warn('sign.empty', `${label} ${fmtPos(s.pos)} : ni texte ni pictogramme.`, s.pos);
    if (boundsOk && !insideBounds(map, s.pos)) warn('sign.outside', `${label} ${fmtPos(s.pos)} : en dehors des limites de la carte.`, s.pos);
    const nrm = SIGN_NORMALS[s.facing]!;
    const front = { x: s.pos.x + nrm.x * 0.005, y: s.pos.y + nrm.y * 0.005, z: s.pos.z + nrm.z * 0.005 };
    const back = { x: s.pos.x - nrm.x * 0.06, y: s.pos.y - nrm.y * 0.06, z: s.pos.z - nrm.z * 0.06 };
    const buried = map.boxes.some((bx) => !matInfo(bx.mat)?.transparent && pointIn(bx, front, 1e-5));
    if (buried) warn('sign.buried', `${label} ${fmtPos(s.pos)} : caché à l’intérieur d’une boîte.`, s.pos);
    else if (!map.boxes.some((bx) => pointIn(bx, back, -1e-3)) && !map.solids.some((so) => pointIn(so, back, -1e-3))) {
      warn('sign.floating', `${label} ${fmtPos(s.pos)} : ne repose sur aucune surface (rien à moins de 6 cm derrière lui).`, s.pos);
    }
  });

  // --- Light-map estimate ----------------------------------------------------------------------
  let lightmapArea = 0;
  for (const bx of map.boxes) {
    if (bx.detail || matInfo(bx.mat)?.emissive) continue;
    const dx = bx.max.x - bx.min.x;
    const dy = bx.max.y - bx.min.y;
    const dz = bx.max.z - bx.min.z;
    const hidden = (f: FaceName): boolean => bx.faces?.[f] === null;
    if (!hidden('px')) lightmapArea += dy * dz;
    if (!hidden('nx')) lightmapArea += dy * dz;
    if (!hidden('py')) lightmapArea += dx * dz;
    if (!hidden('ny')) lightmapArea += dx * dz;
    if (!hidden('pz')) lightmapArea += dx * dy;
    if (!hidden('nz')) lightmapArea += dx * dy;
  }

  // --- Sealing ------------------------------------------------------------------------------------
  let leaks: Leak[] = [];
  let reachableArea = 0;
  let sealed = false;
  const goodSpawns = map.spawns.filter((s) => finite3(s.pos));
  if (!opts.noFlood && boundsOk && goodSpawns.length && map.solids.length && size.x * size.y * size.z < 4e6) {
    // First from one spawn (to detect isolated spawns), then from all of them.
    const first = floodFill(map, [goodSpawns[0]!.pos]);
    goodSpawns.forEach((s, i) => {
      if (!first.reached(s.pos)) err('spawn.isolated', `Apparition n° ${i + 1} ${fmtPos(s.pos)} : inaccessible depuis l’apparition n° 1 (pièce fermée ?).`, s.pos);
    });
    for (const p of map.points) {
      if (finite3(p.pos) && !first.reached(p.pos)) warn('point.isolated', `Point « ${p.kind}:${p.id} » ${fmtPos(p.pos)} : inaccessible depuis les apparitions.`, p.pos);
    }
    for (const z of map.zones) {
      if (!finite3(z.min) || !finite3(z.max)) continue;
      const c = { x: (z.min.x + z.max.x) / 2, y: z.min.y, z: (z.min.z + z.max.z) / 2 };
      const g = groundUnder(map, { x: c.x, y: z.max.y, z: c.z }, z.max.y - z.min.y + 0.5, 0.05);
      if (g !== null && !first.reached({ x: c.x, y: g, z: c.z })) warn('zone.isolated', `Zone « ${z.kind}:${z.id} » : son centre est inaccessible depuis les apparitions.`, c);
    }
    const all = floodFill(map, goodSpawns.map((s) => s.pos));
    leaks = all.leaks;
    reachableArea = all.floorCells * all.cell * all.cell;
    sealed = leaks.length === 0;
    leaks.slice(0, 6).forEach((l, i) => {
      const via = l.path.length > 1 ? ` — trajet : ${l.path.slice(-5).map(fmtPos).join(' → ')}` : '';
      err('leak', `Fuite n° ${i + 1} : un joueur peut sortir de la carte près de ${fmtPos(l.pos)}${via}.`, l.pos);
    });
    if (leaks.length > 6) err('leak', `… et ${leaks.length - 6} autre(s) fuite(s).`);
  } else if (!opts.noFlood) {
    warn('leak.skipped', 'Étanchéité non vérifiée (pas d’apparition valide ou carte trop grande).');
  }

  // --- Physics / navigation (optional modules) -------------------------------------------------------
  let navStatus = 'non vérifiée';
  const stats: MapStats = {
    size,
    solids: map.solids.length,
    solidsNoBullets: map.solids.filter((s) => s.noBullets).length,
    solidsNoPlayers: map.solids.filter((s) => s.noPlayers).length,
    boxes: map.boxes.length,
    detailBoxes: map.boxes.filter((b) => b.detail).length,
    prims: map.prims.length,
    lights: map.lights.length,
    signs: map.signs.length,
    spawns: spawnCount,
    zones: map.zones.length,
    points: map.points.length,
    lightmapArea,
    lightmapTexels: Math.round(lightmapArea * 16),
    reachableArea,
  };
  const unavailable = (e: unknown): string => {
    const msg = e instanceof Error ? e.message : String(e);
    return /not implemented/i.test(msg) ? 'module pas encore implémenté' : `échec (${msg.split('\n')[0]})`;
  };

  // Cross-check of the spawns against the real collision code (same answers expected).
  let physicsStatus = 'non vérifiée';
  if (!opts.noNav && boundsOk) {
    try {
      const world = new CollisionWorld(map.solids);
      const half = { x: PLAYER_HALF_WIDTH, y: PLAYER_HEIGHT / 2 - 0.01, z: PLAYER_HALF_WIDTH };
      goodSpawns.forEach((s, i) => {
        const label = `Apparition n° ${i + 1} ${fmtPos(s.pos)}`;
        const blocked = world.boxOverlaps({ x: s.pos.x, y: s.pos.y + PLAYER_HEIGHT / 2 + 0.01, z: s.pos.z }, half);
        if (blocked && hullFree(map, s.pos)) err('physics.spawn', `${label} : le moteur physique y voit un joueur coincé.`, s.pos);
        const g = world.groundBelow({ x: s.pos.x, y: s.pos.y + 0.05, z: s.pos.z }, 1);
        if (g === null || s.pos.y - g > 0.1) warn('physics.spawnGround', `${label} : pas de sol juste sous le centre du joueur (apparition au bord d’un vide ?).`, s.pos);
      });
      physicsStatus = 'ok';
    } catch (e) {
      physicsStatus = unavailable(e);
      warn('physics.unavailable', `Contrôle croisé avec le moteur physique ignoré : ${physicsStatus}.`);
    }
  }

  if (!opts.noNav && boundsOk && goodSpawns.length) {
    try {
      const cell = 0.5;
      const nav = opts.navFactory ? opts.navFactory(map, cell) : NavGrid.build(new CollisionWorld(map.solids), map, cell);
      navStatus = 'ok';
      const ref = goodSpawns[0]!.pos;
      const onGrid = (p: Vec3): boolean => nav.nearest(p, 1.0) !== null;
      goodSpawns.forEach((s, i) => {
        if (!onGrid(s.pos)) err('nav.spawn', `Apparition n° ${i + 1} ${fmtPos(s.pos)} : hors de la grille de navigation.`, s.pos);
        else if (!nav.reachable(ref, s.pos) || !nav.reachable(s.pos, ref)) err('nav.spawn', `Apparition n° ${i + 1} ${fmtPos(s.pos)} : non reliée à la région de navigation principale.`, s.pos);
      });
      for (const p of map.points) {
        if (!finite3(p.pos)) continue;
        const level: IssueLevel = p.kind === 'sample' ? 'error' : 'warning';
        if (!onGrid(p.pos)) add(level, 'nav.point', `Point « ${p.kind}:${p.id} » ${fmtPos(p.pos)} : hors de la grille de navigation.`, p.pos);
        else if (!nav.reachable(ref, p.pos)) add(level, 'nav.point', `Point « ${p.kind}:${p.id} » ${fmtPos(p.pos)} : non relié à la région de navigation principale.`, p.pos);
      }
      for (const z of map.zones) {
        if (!finite3(z.min) || !finite3(z.max)) continue;
        const cx = (z.min.x + z.max.x) / 2;
        const cz = (z.min.z + z.max.z) / 2;
        const g = groundUnder(map, { x: cx, y: z.max.y, z: cz }, z.max.y - z.min.y + 0.5, 0.05);
        const c = { x: cx, y: g ?? z.min.y, z: cz };
        const level: IssueLevel = z.kind === 'buy' ? 'warning' : 'error';
        if (!onGrid(c)) add(level, 'nav.zone', `Zone « ${z.kind}:${z.id} » : son centre est hors de la grille de navigation.`, c);
        else if (!nav.reachable(ref, c)) add(level, 'nav.zone', `Zone « ${z.kind}:${z.id} » : non reliée à la région de navigation principale.`, c);
      }
      if (nav.stats.regions > 1) warn('nav.regions', `La grille de navigation compte ${nav.stats.regions} régions séparées : des zones marchables sont isolées.`);
      // Shortest path between the two spawn areas (between the spawns closest to each team's centroid).
      let spawnPath: number | null = null;
      const central = (team: number): Vec3 | null => {
        const list = goodSpawns.filter((s) => s.team === team);
        if (!list.length) return null;
        const cx = list.reduce((a, s) => a + s.pos.x, 0) / list.length;
        const cz = list.reduce((a, s) => a + s.pos.z, 0) / list.length;
        return list.reduce((a, s) => (Math.hypot(s.pos.x - cx, s.pos.z - cz) < Math.hypot(a.pos.x - cx, a.pos.z - cz) ? s : a)).pos;
      };
      const a = central(0);
      const c = central(1);
      if (a && c) {
        const path = nav.findPath(a, c);
        if (!path) err('nav.path', 'Aucun chemin entre les deux zones d’apparition.');
        else {
          let len = 0;
          let prev = a;
          for (const p of path) {
            len += Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z);
            prev = p;
          }
          spawnPath = len;
          if (len < 20) warn('nav.pathShort', `Le plus court chemin entre les deux camps ne fait que ${fmt(len)} m.`);
        }
      }
      stats.nav = { nodes: nav.stats.nodes, regions: nav.stats.regions, walkableArea: nav.stats.nodes * cell * cell, spawnPath, buildMs: nav.stats.buildMs };
    } catch (e) {
      navStatus = unavailable(e);
      warn('nav.unavailable', `Vérifications de navigation ignorées : ${navStatus}.`);
    }
  }

  const errors = issues.filter((i) => i.level === 'error').length;
  return { id: meta?.id ?? '?', name: meta?.name ?? '?', issues, errors, warnings: issues.length - errors, stats, leaks, sealed, navStatus, physicsStatus };
}

// =================================================================================
// Command line
// =================================================================================

const nf = (n: number): string => Math.round(n).toLocaleString('fr-FR');

export function formatReport(r: MapReport, map: MapData, verbose = false): string {
  const s = r.stats;
  const out: string[] = [];
  out.push(`=== Carte « ${r.name} » (${r.id}) ===`);
  out.push(`  Modes : ${map.meta.modes.join(', ')} — joueurs conseillés : ${map.meta.players[0]} à ${map.meta.players[1]}`);
  out.push(`  Dimensions : ${fmt(s.size.x, 1)} × ${fmt(s.size.z, 1)} m, hauteur ${fmt(s.size.y, 1)} m`);
  out.push(
    `  Géométrie : ${nf(s.solids)} solides (${s.solidsNoBullets} traversables par les balles, ${s.solidsNoPlayers} par les joueurs), ` +
      `${nf(s.boxes)} boîtes dont ${nf(s.detailBoxes)} de détail, ${nf(s.prims)} primitives`,
  );
  out.push(`  Habillage : ${plural(s.lights, 'lumière', 'lumières')}, ${plural(s.signs, 'panneau', 'panneaux')}`);
  out.push(`  Jeu : ${s.spawns[0]} + ${s.spawns[1]} apparitions, ${plural(s.zones, 'zone', 'zones')}, ${plural(s.points, 'point', 'points')}`);
  const side = Math.ceil(Math.sqrt(s.lightmapTexels));
  out.push(`  Lightmap estimée : ${nf(s.lightmapArea)} m², soit environ ${nf(s.lightmapTexels)} texels à 4 texels/m (≈ ${side} × ${side})`);
  if (r.issues.some((i) => i.code === 'leak.skipped')) out.push('  Étanchéité : non vérifiée');
  else out.push(`  Étanchéité : ${r.sealed ? 'carte fermée' : `${r.leaks.length} FUITE(S)`} — surface atteignable ≈ ${nf(s.reachableArea)} m²`);
  if (s.nav) {
    out.push(
      `  Navigation : ${nf(s.nav.nodes)} nœuds, ${s.nav.regions} région(s), surface marchable ≈ ${nf(s.nav.walkableArea)} m², ` +
        `chemin entre les camps : ${s.nav.spawnPath === null ? 'aucun' : `${fmt(s.nav.spawnPath, 1)} m`} (grille construite en ${nf(s.nav.buildMs)} ms)`,
    );
  } else out.push(`  Navigation : ${r.navStatus}`);
  out.push(`  Contrôle croisé avec le moteur physique : ${r.physicsStatus}`);

  const list = (level: IssueLevel, title: string, mark: string): void => {
    const items = r.issues.filter((i) => i.level === level);
    out.push(`  ${title} : ${items.length}`);
    const perCode = new Map<string, number>();
    for (const it of items) {
      const c = perCode.get(it.code) ?? 0;
      perCode.set(it.code, c + 1);
      if (verbose || c < 8) out.push(`    ${mark} [${it.code}] ${it.message}`);
      else if (c === 8) out.push(`    ${mark} [${it.code}] … (autres messages du même type masqués, --verbose pour tout voir)`);
    }
  };
  list('error', 'Erreurs', '✖');
  list('warning', 'Avertissements', '⚠');
  out.push(`  Résultat : ${r.errors ? 'ÉCHEC' : r.warnings ? 'OK (avec avertissements)' : 'OK'}`);
  return out.join('\n');
}

function main(argv: string[]): number {
  const args = argv.filter((a) => !a.startsWith('--'));
  const verbose = argv.includes('--verbose');
  const target = args[0] ?? 'all';
  const mods = target === 'all' ? MAP_MODULES : MAP_MODULES.filter((m) => m.meta.id === target);
  if (!mods.length) {
    console.error(`Carte inconnue : « ${target} ». Cartes disponibles : ${MAP_MODULES.map((m) => m.meta.id).join(', ')}.`);
    console.error('Usage : npx tsx tools/map-check.ts <mapId|all> [--verbose]');
    return 2;
  }
  let failed = 0;
  for (const mod of mods) {
    let map: MapData;
    try {
      map = mod.build();
    } catch (e) {
      console.log(`=== Carte « ${mod.meta.name} » (${mod.meta.id}) ===`);
      console.log(`  ✖ build() a échoué : ${e instanceof Error ? e.message : String(e)}`);
      console.log('  Résultat : ÉCHEC\n');
      failed++;
      continue;
    }
    const t0 = performance.now();
    const report = checkMap(map);
    console.log(formatReport(report, map, verbose));
    console.log(`  (vérifiée en ${nf(performance.now() - t0)} ms)\n`);
    if (report.errors) failed++;
  }
  if (mods.length > 1) console.log(failed ? `${failed} carte(s) en échec sur ${mods.length}.` : `Les ${mods.length} cartes sont valides.`);
  return failed ? 1 : 0;
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exit(main(process.argv.slice(2)));
