/** Player hitboxes (axis-aligned) shared by the server hit detection and client effects. */
import { HITGROUP, PLAYER_CROUCH_HEIGHT, PLAYER_HEIGHT } from '../constants';
import type { Vec3 } from '../math/vec3';

export interface Hitbox {
  /** Half width (X and Z). */
  hw: number;
  y0: number;
  y1: number;
  group: number;
}

/** Hitboxes relative to the feet for a crouch fraction. Order: head, chest, stomach, legs. */
export function getHitboxes(crouch: number): Hitbox[] {
  const h = PLAYER_HEIGHT + (PLAYER_CROUCH_HEIGHT - PLAYER_HEIGHT) * crouch;
  return [
    { hw: 0.13, y0: h - 0.27, y1: h - 0.01, group: HITGROUP.Head },
    { hw: 0.24, y0: h * 0.62, y1: h - 0.27, group: HITGROUP.Chest },
    { hw: 0.22, y0: h * 0.47, y1: h * 0.62, group: HITGROUP.Stomach },
    { hw: 0.2, y0: 0, y1: h * 0.47, group: HITGROUP.Legs },
  ];
}

function rayBox(o: Vec3, d: Vec3, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, maxT: number): number {
  let t0 = 0;
  let t1 = maxT;
  const ax = [o.x, o.y, o.z];
  const dx = [d.x, d.y, d.z];
  const lo = [x0, y0, z0];
  const hi = [x1, y1, z1];
  for (let i = 0; i < 3; i++) {
    const dv = dx[i]!;
    if (Math.abs(dv) < 1e-9) {
      if (ax[i]! < lo[i]! || ax[i]! > hi[i]!) return -1;
    } else {
      let a = (lo[i]! - ax[i]!) / dv;
      let b = (hi[i]! - ax[i]!) / dv;
      if (a > b) {
        const t = a;
        a = b;
        b = t;
      }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 > t1) return -1;
    }
  }
  return t0;
}

/** Nearest hit of a ray against a player's hitboxes: { dist, group } or null. */
export function rayPlayer(origin: Vec3, dir: Vec3, maxDist: number, feet: Vec3, crouch: number): { dist: number; group: number } | null {
  // Quick reject against the whole hull.
  const h = PLAYER_HEIGHT + (PLAYER_CROUCH_HEIGHT - PLAYER_HEIGHT) * crouch;
  if (rayBox(origin, dir, feet.x - 0.3, feet.y, feet.z - 0.3, feet.x + 0.3, feet.y + h, feet.z + 0.3, maxDist) < 0) return null;
  let best: { dist: number; group: number } | null = null;
  for (const b of getHitboxes(crouch)) {
    const t = rayBox(origin, dir, feet.x - b.hw, feet.y + b.y0, feet.z - b.hw, feet.x + b.hw, feet.y + b.y1, feet.z + b.hw, maxDist);
    if (t >= 0 && (!best || t < best.dist)) best = { dist: t, group: b.group };
  }
  return best;
}
