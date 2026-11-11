/**
 * Bot AI. A bot is a pure "input generator": each tick it looks at the world
 * through BotEnv and returns a UserCmd that the Room feeds to stepPlayer exactly
 * like a human player's input. Bots therefore obey the same movement, recoil and
 * line-of-sight rules as humans. See docs/ARCHITECTURE.md §9.
 */
import { BTN, SLOT, TICK_DT } from '../constants';
import type { MapData } from '../maps/types';
import { mulberry32, type Rng } from '../math/rng';
import { angleDiff, anglesFromDir, clamp, forwardFlat, rightFlat, wrapAngle, type Vec3 } from '../math/vec3';
import type { NavGrid } from '../nav/navgrid';
import type { CollisionWorld } from '../physics/world';
import { eyeHeight, hullHeight } from '../player/step';
import type { MatchPhase, PlayerState, TeamId, UserCmd } from '../types';
import { WEAPONS } from '../weapons/defs';

export interface BotPlayerView {
  id: number;
  team: TeamId;
  alive: boolean;
  state: Readonly<PlayerState>;
}

/** A place the mode wants a team's bots to go to. */
export interface BotGoal {
  kind: 'roam' | 'attack' | 'defend' | 'objective';
  pos: Vec3;
  /** Relative priority (higher = more attractive). */
  weight: number;
  /** Hold BTN.Use once within `radius` of `pos` (plant / defuse / secure). */
  use?: boolean;
  radius?: number;
}

export interface BotEnv {
  world: CollisionWorld;
  nav: NavGrid;
  map: MapData;
  /** Seconds since the room was created (monotonic simulation time). */
  time: number;
  phase: MatchPhase;
  friendlyFire: boolean;
  /** Every player in the room (including the bot itself and dead players). */
  players: readonly BotPlayerView[];
  /** Mode-specific goals for a team (may be empty: the bot then roams / hunts). */
  goals(team: TeamId, botId: number): BotGoal[];
}

export interface Bot {
  readonly id: number;
  /** Called every tick while alive. `seq` is the sequence number to put in the returned cmd. */
  think(self: BotPlayerView, env: BotEnv, seq: number): UserCmd;
  /** Called when the bot (re)spawns. */
  onSpawn(): void;
  /** Called when the bot takes damage from `from` (attacker position). */
  onHurt(attackerId: number, from: Vec3): void;
  /** Called when a gunshot is fired at `pos` by a player of `team` (hearing). */
  onSound(pos: Vec3, team: TeamId): void;
}

interface Skill {
  reaction: number; // s
  aimError: number; // rad
  turnSpeed: number; // rad/s
  headChance: number;
  recoilComp: number; // 0..1
  stopToShoot: number; // 0..1 probability to stand still when firing at range
}

const D2R = Math.PI / 180;
const SKILLS: Skill[] = [
  { reaction: 0.6, aimError: 4.2 * D2R, turnSpeed: 240 * D2R, headChance: 0, recoilComp: 0.1, stopToShoot: 0.15 },
  { reaction: 0.38, aimError: 2.6 * D2R, turnSpeed: 330 * D2R, headChance: 0.12, recoilComp: 0.4, stopToShoot: 0.45 },
  { reaction: 0.25, aimError: 1.5 * D2R, turnSpeed: 450 * D2R, headChance: 0.35, recoilComp: 0.65, stopToShoot: 0.75 },
  { reaction: 0.16, aimError: 0.8 * D2R, turnSpeed: 600 * D2R, headChance: 0.6, recoilComp: 0.85, stopToShoot: 0.9 },
];

class BotBrain implements Bot {
  readonly id: number;
  private rng: Rng;
  private skill: Skill;
  private aggression: number;

  private yaw = 0;
  private pitch = 0;
  private init = false;

  private target = -1;
  private visible = false;
  private seenAt = -100;
  private fireAt = 0;
  private aimHead = false;
  private lastKnown: Vec3 | null = null;
  private lastKnownT = -100;
  private errYaw = 0;
  private errPitch = 0;
  private errT = 0;

  private path: Vec3[] | null = null;
  private pathI = 0;
  private dest: Vec3 | null = null;
  private useGoal: BotGoal | null = null;
  private repathAt = 0;

  private strafe = 1;
  private strafeUntil = 0;
  private burstUntil = 0;
  private pauseUntil = 0;
  private standStill = false;
  private fireToggle = false;

  private stuckPos: Vec3 = { x: 0, y: 0, z: 0 };
  private stuckT = 0;
  private unstickUntil = 0;
  private unstickDir = 1;
  private visionTick = 0;

  constructor(id: number, difficulty: number, seed: number) {
    this.id = id;
    this.rng = mulberry32(seed ^ (id * 7919));
    this.skill = SKILLS[clamp(Math.round(difficulty), 0, 3)]!;
    this.aggression = 0.3 + this.rng() * 0.7;
    this.visionTick = id % 4;
  }

  onSpawn(): void {
    this.target = -1;
    this.visible = false;
    this.lastKnown = null;
    this.path = null;
    this.dest = null;
    this.useGoal = null;
    this.init = false;
    this.stuckT = 0;
    this.repathAt = 0;
  }

  onHurt(_attackerId: number, from: Vec3): void {
    if (!this.visible) {
      this.lastKnown = { x: from.x, y: from.y - 1.5, z: from.z };
      this.lastKnownT = 1e9; // refreshed in think() with the real time
      this.path = null;
    }
  }

  onSound(pos: Vec3, _team: TeamId): void {
    if (!this.visible && this.target < 0) {
      this.lastKnown = { x: pos.x, y: pos.y - 1.5, z: pos.z };
      this.lastKnownT = 1e9;
    }
  }

  private see(env: BotEnv, eye: Vec3, q: BotPlayerView): boolean {
    const p = q.state.pos;
    const h = hullHeight(q.state.crouch);
    return env.world.lineOfSight(eye, { x: p.x, y: p.y + h * 0.62, z: p.z }) || env.world.lineOfSight(eye, { x: p.x, y: p.y + h - 0.14, z: p.z });
  }

  private pickDestination(self: BotPlayerView, env: BotEnv): void {
    const goals = self.team === 2 ? [] : env.goals(self.team, this.id);
    this.useGoal = null;
    if (goals.length) {
      let total = 0;
      for (const g of goals) total += g.weight;
      let r = this.rng() * total;
      for (const g of goals) {
        r -= g.weight;
        if (r <= 0) {
          this.dest = g.pos;
          this.useGoal = g.use ? g : null;
          return;
        }
      }
    }
    // Roam: enemy spawn area, a point of interest, or anywhere.
    const r = this.rng();
    const spawns = env.map.spawns.filter((s) => s.team !== self.team);
    const pois = env.map.points.filter((p) => p.kind === 'poi');
    if (r < 0.45 * this.aggression + 0.15 && spawns.length) {
      const s = spawns[Math.floor(this.rng() * spawns.length)]!;
      this.dest = env.nav.randomPointNear(s.pos, 6, this.rng);
    } else if (r < 0.75 && pois.length) {
      this.dest = env.nav.randomPointNear(pois[Math.floor(this.rng() * pois.length)]!.pos, 4, this.rng);
    } else this.dest = env.nav.randomPoint(this.rng);
  }

  think(self: BotPlayerView, env: BotEnv, seq: number): UserCmd {
    const s = self.state;
    const t = env.time;
    const sk = this.skill;
    if (!this.init) {
      this.init = true;
      this.yaw = s.yaw;
      this.pitch = 0;
      this.stuckPos = { x: s.pos.x, y: s.pos.y, z: s.pos.z };
      this.stuckT = t;
    }
    if (this.lastKnownT > 1e8) this.lastKnownT = t;
    const eye = { x: s.pos.x, y: s.pos.y + eyeHeight(s.crouch), z: s.pos.z };
    const slot = s.slots[s.active];
    const def = WEAPONS[slot ? slot.id : 'knife'];
    let buttons = 0;
    let wantSlot = -1;

    // ---------------------------------------------------------------- perception
    if (++this.visionTick % 4 === 0) {
      let best: BotPlayerView | null = null;
      let bestD = Infinity;
      const f = forwardFlat(this.yaw);
      for (const q of env.players) {
        if (!q.alive || q.id === this.id || q.team === self.team || q.team === 2) continue;
        const dx = q.state.pos.x - s.pos.x;
        const dz = q.state.pos.z - s.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 70) continue;
        const inFov = d < 3 || (dx * f.x + dz * f.z) / (d || 1) > 0.5; // ~120° cone
        if (!inFov && q.id !== this.target) continue;
        const score = q.id === this.target ? d * 0.7 : d;
        if (score < bestD && this.see(env, eye, q)) {
          best = q;
          bestD = score;
        }
      }
      if (best) {
        if (best.id !== this.target || !this.visible) {
          const fresh = t - this.seenAt > 1.5;
          if (fresh) this.fireAt = t + sk.reaction * (0.8 + this.rng() * 0.5);
          this.aimHead = this.rng() < sk.headChance;
          this.standStill = this.rng() < sk.stopToShoot;
        }
        this.target = best.id;
        this.visible = true;
        this.seenAt = t;
        this.lastKnown = { x: best.state.pos.x, y: best.state.pos.y, z: best.state.pos.z };
        this.lastKnownT = t;
      } else {
        this.visible = false;
        if (t - this.seenAt > 4) this.target = -1;
      }
    }
    const tgt = this.visible ? env.players.find((q) => q.id === this.target && q.alive) : undefined;
    if (this.visible && !tgt) {
      this.visible = false;
      this.target = -1;
      this.lastKnown = null;
    }

    // ---------------------------------------------------------------- aiming
    let wantYaw = this.yaw;
    let wantPitch = 0;
    let moveX = 0;
    let moveZ = 0;
    let moving = false;

    if (tgt) {
      const ts = tgt.state;
      const h = hullHeight(ts.crouch);
      const dist = Math.hypot(ts.pos.x - eye.x, ts.pos.z - eye.z);
      // Slowly wandering aim error (smaller once on target for a while).
      if (t >= this.errT) {
        this.errT = t + 0.25 + this.rng() * 0.3;
        const settle = clamp(1.4 - (t - this.fireAt) * 0.5, 0.45, 1.4);
        this.errYaw = (this.rng() * 2 - 1) * sk.aimError * settle;
        this.errPitch = (this.rng() * 2 - 1) * sk.aimError * settle * 0.7;
      }
      const aimY = ts.pos.y + (this.aimHead ? h - 0.14 : h * 0.68);
      const a = anglesFromDir({ x: ts.pos.x - eye.x, y: aimY - eye.y, z: ts.pos.z - eye.z });
      wantYaw = a.yaw + this.errYaw - s.punchYaw * sk.recoilComp;
      wantPitch = a.pitch + this.errPitch - s.punchPitch * sk.recoilComp;

      // Fire control.
      const off = Math.abs(angleDiff(this.yaw, a.yaw - s.punchYaw * sk.recoilComp));
      const tol = Math.atan2(0.45, Math.max(dist, 0.5)) + sk.aimError * 1.5;
      const canFire = t >= this.fireAt && off < tol && !s.frozen && s.reload <= 0 && s.draw <= 0;
      const inRange = def.kind === 'melee' ? dist < def.range - 0.2 : def.category === 'shotgun' ? dist < 18 : true;
      if (canFire && inRange && (slot ? slot.clip > 0 || def.kind === 'melee' : true)) {
        if (def.auto && def.kind !== 'melee') {
          if (t >= this.pauseUntil) {
            if (t >= this.burstUntil && this.burstUntil > 0) {
              // End of a burst: pause proportional to distance.
              this.pauseUntil = t + clamp(dist / 60, 0.08, 0.45) * (1.2 - sk.recoilComp * 0.5);
              this.burstUntil = 0;
            } else {
              if (this.burstUntil === 0) this.burstUntil = t + (dist < 8 ? 1.2 : dist < 20 ? 0.45 : 0.25) * (0.7 + this.rng() * 0.6);
              buttons |= BTN.Fire;
            }
          }
        } else {
          // Semi-auto: alternate press / release to create rising edges.
          this.fireToggle = !this.fireToggle;
          if (this.fireToggle && s.fireCd <= 0) buttons |= BTN.Fire;
        }
      }
      if (def.zoomFov && dist > 12 && s.zoom === 0 && s.reload <= 0 && !(s.prevButtons & BTN.AltFire)) buttons |= BTN.AltFire;

      // Combat movement.
      const toX = (ts.pos.x - s.pos.x) / (dist || 1);
      const toZ = (ts.pos.z - s.pos.z) / (dist || 1);
      if (t >= this.strafeUntil) {
        this.strafeUntil = t + 0.4 + this.rng() * 0.8;
        this.strafe = this.rng() < 0.5 ? -1 : 1;
      }
      const prefer = def.category === 'shotgun' || def.kind === 'melee' ? 2 : def.category === 'sniper' ? 30 : def.category === 'smg' ? 9 : 16;
      const still = this.standStill && dist > 9 && (buttons & BTN.Fire) !== 0;
      if (!still) {
        const adv = dist > prefer * 1.3 ? 1 : dist < prefer * 0.5 && def.kind !== 'melee' ? -0.7 : 0;
        moveX = toX * adv + -toZ * this.strafe * (def.kind === 'melee' ? 0.2 : 0.9);
        moveZ = toZ * adv + toX * this.strafe * (def.kind === 'melee' ? 0.2 : 0.9);
        moving = true;
      }
      if (def.category === 'sniper' && s.zoom > 0) moving = false;
      this.path = null;
      // Out of ammo in a fight: pull the sidearm (or the knife).
      if (slot && slot.clip === 0 && def.kind !== 'melee') {
        const sec = s.slots[SLOT.Secondary];
        if (s.active === SLOT.Primary && sec && sec.clip > 0 && dist < 25) wantSlot = SLOT.Secondary;
        else if (slot.reserve === 0) wantSlot = SLOT.Melee;
      }
    } else {
      // ---------------------------------------------------------------- navigation
      if (s.zoom > 0 && !(s.prevButtons & BTN.AltFire)) buttons |= BTN.AltFire; // unzoom
      const prim = s.slots[SLOT.Primary];
      if (s.active !== SLOT.Primary && prim && prim.clip + prim.reserve > 0 && s.reload <= 0) wantSlot = SLOT.Primary;
      if (slot && def.clip > 0 && slot.clip < def.clip * 0.4 && slot.reserve > 0 && s.reload <= 0) buttons |= BTN.Reload;

      const hunting = this.lastKnown && t - this.lastKnownT < 7;
      if (hunting && this.lastKnown && (!this.path || this.dest !== this.lastKnown)) {
        this.dest = this.lastKnown;
        this.path = null;
        this.useGoal = null;
      }
      if (!s.frozen && (!this.path || this.pathI >= this.path.length) && t >= this.repathAt) {
        this.repathAt = t + 0.5 + this.rng() * 0.5;
        if (!hunting || !this.dest) this.pickDestination(self, env);
        else if (this.dest && Math.hypot(this.dest.x - s.pos.x, this.dest.z - s.pos.z) < 2) {
          this.lastKnown = null; // arrived, nobody there
          this.pickDestination(self, env);
        }
        this.path = this.dest ? env.nav.findPath(s.pos, this.dest) : null;
        this.pathI = 0;
        if (!this.path) this.dest = null;
      }
      const g = this.useGoal;
      if (g && this.dest && Math.hypot(g.pos.x - s.pos.x, g.pos.z - s.pos.z) < (g.radius ?? 1.5)) {
        buttons |= BTN.Use;
        this.path = null;
        this.repathAt = t + 0.5;
      } else if (this.path && this.pathI < this.path.length) {
        let wp = this.path[this.pathI]!;
        while (Math.hypot(wp.x - s.pos.x, wp.z - s.pos.z) < 0.45 && Math.abs(wp.y - s.pos.y) < 1.2) {
          if (++this.pathI >= this.path.length) break;
          wp = this.path[this.pathI]!;
        }
        if (this.pathI < this.path.length) {
          const dx = wp.x - s.pos.x;
          const dz = wp.z - s.pos.z;
          const d = Math.hypot(dx, dz) || 1;
          moveX = dx / d;
          moveZ = dz / d;
          moving = true;
          // Look a little further along the path.
          const look = this.path[Math.min(this.pathI + 2, this.path.length - 1)]!;
          const ldx = look.x - s.pos.x;
          const ldz = look.z - s.pos.z;
          if (Math.hypot(ldx, ldz) > 0.8) wantYaw = Math.atan2(-ldx, -ldz);
          else wantYaw = Math.atan2(-dx, -dz);
          wantPitch = clamp(Math.atan2(look.y - s.pos.y, Math.hypot(ldx, ldz) + 2) * 0.6, -0.5, 0.5);
        }
      }
    }

    // ---------------------------------------------------------------- stuck handling
    if (moving && !s.frozen) {
      if (t - this.stuckT > 0.8) {
        const moved = Math.hypot(s.pos.x - this.stuckPos.x, s.pos.z - this.stuckPos.z);
        if (moved < 0.3 && !tgt) {
          this.unstickUntil = t + 0.45;
          this.unstickDir = this.rng() < 0.5 ? -1 : 1;
          this.path = null;
          this.repathAt = t + 0.3;
          buttons |= BTN.Jump;
        }
        this.stuckPos.x = s.pos.x;
        this.stuckPos.z = s.pos.z;
        this.stuckT = t;
      }
      if (t < this.unstickUntil) {
        const mx = moveX;
        moveX = mx * 0.3 - moveZ * this.unstickDir;
        moveZ = moveZ * 0.3 + mx * this.unstickDir;
        if (s.onGround && !(s.prevButtons & BTN.Jump)) buttons |= BTN.Jump;
      }
    } else {
      this.stuckT = t;
      this.stuckPos.x = s.pos.x;
      this.stuckPos.z = s.pos.z;
    }

    // ---------------------------------------------------------------- view + buttons
    const maxTurn = sk.turnSpeed * TICK_DT;
    const dy = angleDiff(this.yaw, wantYaw);
    const dp = wantPitch - this.pitch;
    this.yaw = wrapAngle(this.yaw + clamp(dy * 0.28, -maxTurn, maxTurn));
    this.pitch = clamp(this.pitch + clamp(dp * 0.28, -maxTurn, maxTurn), -1.4, 1.4);

    if (moving && !s.frozen) {
      const f = forwardFlat(this.yaw);
      const r = rightFlat(this.yaw);
      const fw = moveX * f.x + moveZ * f.z;
      const rt = moveX * r.x + moveZ * r.z;
      if (fw > 0.3) buttons |= BTN.Forward;
      else if (fw < -0.3) buttons |= BTN.Back;
      if (rt > 0.3) buttons |= BTN.Right;
      else if (rt < -0.3) buttons |= BTN.Left;
    }
    return { seq, buttons, yaw: this.yaw, pitch: this.pitch, slot: wantSlot, st: 0 };
  }
}

/**
 * Create a bot brain.
 * @param difficulty 0 = facile, 1 = normal, 2 = difficile, 3 = expert
 * @param seed       deterministic personality / randomness seed
 */
export function createBot(id: number, difficulty: number, seed: number): Bot {
  return new BotBrain(id, difficulty, seed);
}
