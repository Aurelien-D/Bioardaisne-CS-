/**
 * Adversarial tests for the weapon state machine (src/shared/weapons/logic.ts).
 *
 * tests/weapons.test.ts checks each rule of docs/ARCHITECTURE.md §6 on its own.
 * This file attacks the machine instead:
 *   - exhaustive sweeps over every tick of a timer (no off-by-one, no drift);
 *   - exploits: quick-switching, reload cancelling, mashing during timers;
 *   - random button mashing for 200 simulated seconds per weapon, with the
 *     invariants checked on every tick;
 *   - a differential run against an independent model of the discrete rules;
 *   - hostile commands, corrupt state, empty inventories, dead players;
 *   - the integration with stepPlayer (edge detection relies on prevButtons
 *     being written after stepWeapons) and with the real movement code.
 *
 * Expected values are derived from weapons/defs.ts: a balance change does not
 * break these tests, an exploit re-opened by a balance change does.
 *
 * The last block prints a designer's audit of the gunplay numbers. If your
 * reporter hides the output of passing tests, run with `--reporter=default`.
 */
import { describe, expect, it } from 'vitest';
import { ACTION, BTN, MAX_ARMOR, MAX_HEALTH, MOVE, SLOT, TICK_DT, TICK_RATE } from '../src/shared/constants';
import { mulberry32, type Rng } from '../src/shared/math/rng';
import { cross, dot, forwardFromAngles, length, type Vec3 } from '../src/shared/math/vec3';
import { CollisionWorld } from '../src/shared/physics/world';
import {
  MAX_PITCH,
  clonePlayerState,
  createPlayerState,
  eyePosition,
  newStepEvents,
  stepPlayer,
} from '../src/shared/player/step';
import type { PlayerState, StepEvents, UserCmd, WeaponSlotState } from '../src/shared/types';
import {
  DEFAULT_LOADOUT,
  WEAPONS,
  WEAPON_IDS,
  type Loadout,
  type WeaponDef,
  type WeaponId,
} from '../src/shared/weapons/defs';
import { activeWeapon, createSlots, currentSpread, stepWeapons } from '../src/shared/weapons/logic';

// --- Helpers -------------------------------------------------------------------------

const R2D = 180 / Math.PI;
const FIREARMS = WEAPON_IDS.filter((id) => WEAPONS[id].kind === 'hitscan');
const AUTOMATICS = FIREARMS.filter((id) => WEAPONS[id].auto);
const SEMI_AUTOMATICS = FIREARMS.filter((id) => !WEAPONS[id].auto);
/** Buttons the machine ignores during freeze time and timed actions. */
const LOCKED = BTN.Fire | BTN.AltFire | BTN.Reload;
const NO_EVENTS: Readonly<StepEvents> = newStepEvents();
/** The weapon fields of PlayerState that are plain numbers. */
const NUMERIC_FIELDS = [
  'fireCd',
  'reload',
  'draw',
  'shots',
  'sinceShot',
  'punchPitch',
  'punchYaw',
  'spread',
  'zoom',
] as const;

/** Ticks a timer of `seconds` lasts: it stops blocking on the first tick at or after its end. */
const ticksFor = (seconds: number): number => Math.ceil(seconds * TICK_RATE - 1e-6);

/** Tick on which shot number k (0-based) leaves at the maximum rate: the first one at or after k x fireInterval. */
const idealShotTick = (w: WeaponDef, k: number): number =>
  Math.max(0, Math.ceil(k * w.fireInterval * TICK_RATE - 1e-6));

const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)];

const angleBetween = (a: Vec3, b: Vec3): number => Math.atan2(length(cross(a, b)), dot(a, b));

/** Rounds in the whole inventory. */
const ammoOf = (s: PlayerState): number => s.slots.reduce((n, slot) => n + (slot ? slot.clip + slot.reserve : 0), 0);

/** A slot to switch to in order to put `w` away. */
const awayFrom = (w: WeaponDef): number => (w.slot === SLOT.Melee ? SLOT.Secondary : SLOT.Melee);

/** State as a string, without the one field the test rigs write themselves. */
const fingerprint = (s: PlayerState): string => JSON.stringify({ ...s, prevButtons: 0 });

function loadoutFor(weapon: WeaponId): Loadout {
  const def = WEAPONS[weapon];
  return {
    primary: def.slot === SLOT.Primary ? weapon : DEFAULT_LOADOUT.primary,
    secondary: def.slot === SLOT.Secondary ? weapon : DEFAULT_LOADOUT.secondary,
  };
}

/**
 * A copy of `s` the way it arrives from the network: plain JSON. Tests that
 * store junk in a state do it in such a copy, which has its own hidden class;
 * junk stored in an object made by createPlayerState would change how the
 * engine represents that field in every PlayerState of the process (and make
 * the allocation test measure the junk instead of the code).
 */
const detached = (s: PlayerState): PlayerState => JSON.parse(JSON.stringify(s)) as PlayerState;

/** A player standing still on the ground with `weapon` in hands, ready to fire. */
function playerWith(weapon: WeaponId): PlayerState {
  const s = createPlayerState({ x: 0, y: 0, z: 0 }, 0, loadoutFor(weapon));
  s.onGround = true;
  s.active = WEAPONS[weapon].slot;
  return s;
}

/**
 * Drives one player through stepWeapons the way stepPlayer does: one command
 * per tick, `prevButtons` written after the call. Every command is frozen, so
 * the machine cannot mutate its input without the test blowing up.
 */
class Rig {
  seq = 0;

  constructor(readonly s: PlayerState) {}

  static with(weapon: WeaponId): Rig {
    return new Rig(playerWith(weapon));
  }

  /** Independent copy: same state, same command numbering. */
  fork(): Rig {
    const copy = new Rig(clonePlayerState(this.s));
    copy.seq = this.seq;
    return copy;
  }

  get def(): WeaponDef {
    return activeWeapon(this.s);
  }

  /** Ammo of the weapon in hands. */
  get gun(): WeaponSlotState {
    const slot = this.s.slots[this.s.active];
    if (!slot) throw new Error('empty active slot');
    return slot;
  }

  tick(buttons = 0, slot = -1): StepEvents {
    const ev = newStepEvents();
    const cmd: UserCmd = { seq: ++this.seq, buttons, yaw: this.s.yaw, pitch: this.s.pitch, slot, st: 0 };
    const prev = this.s.prevButtons;
    stepWeapons(this.s, Object.freeze(cmd), ev);
    if (this.s.prevButtons !== prev) throw new Error('stepWeapons must not write prevButtons');
    this.s.prevButtons = buttons;
    return ev;
  }

  /** Hold `buttons` for `ticks` ticks; returns the number of shots fired. */
  hold(buttons: number, ticks: number): number {
    let shots = 0;
    for (let i = 0; i < ticks; i++) if (this.tick(buttons).fired) shots++;
    return shots;
  }

  /** Make the clip of the weapon in hands bottomless (it never needs a reload). */
  bottomless(): this {
    if (this.def.kind !== 'melee') this.gun.clip = 1e9;
    return this;
  }
}

/**
 * Number of ticks before the weapon can fire again (1 = the very next tick),
 * found by clicking on every other tick, in both phases. `rig` is not modified.
 */
function earliestShot(rig: Rig, limit = 3000): number {
  let best = Infinity;
  for (const phase of [0, 1]) {
    const probe = rig.fork();
    for (let n = 1; n <= limit && n < best; n++) {
      if (probe.tick(n % 2 === phase ? BTN.Fire : 0).fired) best = n;
    }
  }
  if (!Number.isFinite(best)) throw new Error(`no shot within ${limit} ticks`);
  return best;
}

/** Slot requests a hostile or buggy client could send. */
const SLOT_REQUESTS = [-1, 0, 1, 2, 3, 99, -2, 1.5, -0, Number.NaN, Number.POSITIVE_INFINITY];

/**
 * Reproducible button masher. Each button is toggled with its own probability,
 * and those probabilities are re-rolled every half second or so: steady holds,
 * frantic mashing and quiet moments all occur, in every combination.
 */
class Masher {
  buttons = 0;
  private fire = 0;
  private alt = 0;
  private reload = 0;
  private swap = 0;

  constructor(
    private readonly rng: Rng,
    /** Slot of the weapon under test: half of the switch requests go back to it. */
    private readonly home: number,
    private readonly switching = true,
  ) {}

  next(): { buttons: number; slot: number } {
    const rng = this.rng;
    let slot = -1;
    if (rng() < 1 / 40) {
      this.fire = pick(rng, [0, 0, 0.03, 0.15, 0.5, 1]);
      this.alt = pick(rng, [0, 0, 0.03, 0.5]);
      this.reload = pick(rng, [0, 0, 0, 0.03, 0.5]);
      this.swap = this.switching ? pick(rng, [0, 0, 0, 0, 0, 0.01, 0.05, 0.5, 1]) : 0;
      this.buttons =
        (rng() < 0.6 ? BTN.Fire : 0) |
        (rng() < 0.1 ? BTN.AltFire : 0) |
        (rng() < 0.1 ? BTN.Reload : 0) |
        // Buttons the weapons must ignore.
        (rng() < 0.3 ? BTN.Forward | BTN.Jump | BTN.Use : 0);
      if (this.switching && rng() < 0.5) slot = this.home;
    }
    if (rng() < this.fire) this.buttons ^= BTN.Fire;
    if (rng() < this.alt) this.buttons ^= BTN.AltFire;
    if (rng() < this.reload) this.buttons ^= BTN.Reload;
    if (rng() < this.swap) slot = rng() < 0.5 ? this.home : pick(rng, SLOT_REQUESTS);
    return { buttons: this.buttons, slot };
  }
}

interface ChaosTick {
  buttons: number;
  slot: number;
  ev: StepEvents;
  /** State right before the command (after the world events of this tick). */
  before: PlayerState;
  /** The player came back to life with a fresh state on this tick. */
  respawned: boolean;
  /** The ammo of every weapon was topped up on this tick. */
  refilled: boolean;
}

/**
 * A masher plus everything the rest of the game does to a player between two
 * commands: movement (speed, stance, view), freeze time, timed actions, death
 * and respawn, ammo top-ups.
 */
class Chaos {
  readonly rig: Rig;
  readonly home: number;
  private readonly rng: Rng;
  private readonly masher: Masher;
  private frozenLeft = 0;
  private actingLeft = 0;
  private deadLeft = 0;
  private dryFor = 0;

  constructor(
    readonly weapon: WeaponId,
    seed: number,
    switching = true,
  ) {
    this.rig = new Rig(this.spawn());
    this.home = WEAPONS[weapon].slot;
    this.rng = mulberry32(seed);
    this.masher = new Masher(this.rng, this.home, switching);
  }

  /**
   * Fresh state with very little ammo (a few rounds, then one partial reload):
   * every life starts with partial reloads, an empty weapon and dry fire. The
   * top-up then hands out full ammo, so abundance is covered as well.
   */
  private spawn(): PlayerState {
    const s = playerWith(this.weapon);
    for (const slot of s.slots) {
      if (!slot) continue;
      slot.clip = Math.min(slot.clip, 3);
      slot.reserve = Math.min(slot.reserve, 4);
    }
    s.protect = 2; // spawn protection: the Room counts it down, a shot gives it up
    return s;
  }

  step(): ChaosTick {
    const s = this.rig.s;
    const rng = this.rng;
    let respawned = false;
    let refilled = false;

    if (this.deadLeft > 0) {
      if (--this.deadLeft === 0) {
        // The Room respawns a player with a brand-new state.
        Object.assign(s, this.spawn());
        this.frozenLeft = 0;
        this.actingLeft = 0;
        respawned = true;
      }
    } else if (rng() < 1 / (45 * TICK_RATE)) {
      s.alive = false;
      this.deadLeft = 30 + Math.floor(rng() * 150);
    }
    if (this.frozenLeft > 0) {
      if (--this.frozenLeft === 0) s.frozen = false;
    } else if (rng() < 1 / (25 * TICK_RATE)) {
      s.frozen = true;
      this.frozenLeft = 20 + Math.floor(rng() * 120);
    }
    if (this.actingLeft > 0) {
      if (--this.actingLeft === 0) s.action = ACTION.None;
    } else if (rng() < 1 / (30 * TICK_RATE)) {
      s.action = pick(rng, [ACTION.Plant, ACTION.Defuse, ACTION.Secure]);
      this.actingLeft = 20 + Math.floor(rng() * 150);
    }
    if (rng() < 1 / 32) {
      const speed = pick(rng, [0, 0, 1.5, 3, 5.5, 9]);
      const heading = rng() * Math.PI * 2;
      s.vel.x = Math.cos(heading) * speed;
      s.vel.z = Math.sin(heading) * speed;
      s.vel.y = pick(rng, [0, 0, 6, -12]);
      s.onGround = rng() < 0.75;
      s.crouch = pick(rng, [0, 0, 1, rng()]);
      s.yaw = (rng() * 2 - 1) * Math.PI;
      s.pitch = (rng() * 2 - 1) * MAX_PITCH;
    }
    // A weapon that stays completely dry for a while is topped up, so that the run keeps shooting.
    const gun = s.slots[this.home];
    if (gun && gun.clip + gun.reserve === 0 && s.alive) {
      if (++this.dryFor > 6 * TICK_RATE) {
        for (const slot of s.slots) {
          if (!slot) continue;
          slot.clip = WEAPONS[slot.id].clip;
          slot.reserve = WEAPONS[slot.id].reserve;
        }
        this.dryFor = 0;
        refilled = true;
      }
    } else {
      this.dryFor = 0;
    }

    const { buttons, slot } = this.masher.next();
    const before = clonePlayerState(s);
    const ev = this.rig.tick(buttons, slot);
    return { buttons, slot, ev, before, respawned, refilled };
  }
}

/**
 * Upper bound of |punchYaw| for a weapon: every sideways kick at full strength
 * and in the same direction, as close together as the rate of fire allows.
 */
function yawBound(w: WeaponDef): number {
  const kick = w.recoilSide + w.recoilJitter;
  const gap = Math.floor(w.fireInterval * TICK_RATE + 1e-6) * TICK_DT;
  return kick / (1 - Math.exp(-w.recoilRecovery * gap));
}

/** Largest cone the weapon can have before the dynamic (firing) inaccuracy. */
const staticSpreadCap = (w: WeaponDef): number => Math.max(w.spread, w.zoomSpread ?? 0) + w.spreadMove + w.spreadAir;

const isUnit = (d: Vec3): boolean =>
  Number.isFinite(d.x) && Number.isFinite(d.y) && Number.isFinite(d.z) && Math.abs(length(d) - 1) < 1e-12;

// --- Idle cost -------------------------------------------------------------------------
// First in the file on purpose: the measurement depends on how the engine has
// compiled stepWeapons, and later tests feed it the oddest states they can find.

describe('idle cost', () => {
  it('ticks on which no shot leaves allocate nothing', () => {
    const TICKS = 20000;
    interface Scenario {
      name: string;
      s: PlayerState;
      buttons: (t: number) => number;
      /** Called before every tick, e.g. to restart a recovery that would otherwise end. */
      before?: (s: PlayerState, t: number) => void;
    }
    const scenario = (name: string, weapon: WeaponId, setup: (s: PlayerState) => Omit<Scenario, 'name' | 's'>): Scenario => {
      const s = playerWith(weapon);
      return { name, s, ...setup(s) };
    };
    const mash = (t: number): number => (t % 2 === 0 ? BTN.Fire | BTN.AltFire : BTN.Reload);
    const scenarios: Scenario[] = [
      scenario('at rest', 'rifle_ak', () => ({ buttons: () => 0 })),
      scenario('everything held on an empty weapon', 'rifle_ak', (s) => {
        s.slots[SLOT.Primary] = { id: 'rifle_ak', clip: 0, reserve: 0 };
        return { buttons: () => BTN.Fire | BTN.Reload | BTN.AltFire };
      }),
      scenario('mashing during freeze time', 'sniper', (s) => {
        s.frozen = true;
        return { buttons: mash };
      }),
      scenario('mashing during a draw', 'sniper', (s) => {
        s.draw = 1e9;
        return { buttons: mash };
      }),
      scenario('mashing during a reload', 'rifle_m4', (s) => {
        s.slots[SLOT.Primary] = { id: 'rifle_m4', clip: 1, reserve: 90 };
        s.reload = 1e9;
        return { buttons: mash };
      }),
      scenario('trigger held during the fire cooldown', 'rifle_ak', (s) => {
        s.fireCd = 1e9;
        return { buttons: () => BTN.Fire };
      }),
      scenario('view punch, cone and recoil index recovering', 'rifle_ak', () => ({
        buttons: () => 0,
        before: (s, t) => {
          if (t % 100 !== 0) return;
          s.punchPitch = 0.1;
          s.punchYaw = -0.05;
          s.spread = 0.04;
          s.shots = 6;
          s.sinceShot = 0;
        },
      })),
      scenario('dead', 'rifle_ak', (s) => {
        s.alive = false;
        return { buttons: () => BTN.Fire };
      }),
    ];
    for (const { name, s, buttons, before } of scenarios) {
      const ev = newStepEvents();
      const cmd: UserCmd = { seq: 1, buttons: 0, yaw: 0, pitch: 0, slot: -1, st: 0 };
      const run = (): void => {
        for (let t = 0; t < TICKS; t++) {
          if (before) before(s, t);
          cmd.buttons = buttons(t);
          stepWeapons(s, cmd, ev);
          s.prevButtons = cmd.buttons;
        }
      };
      // Interpreted code boxes every fractional number, so give the JIT time to
      // compile, then look for one clean sample. Allocating code never has one:
      // a single 16-byte number per tick is 320 kB per sample, while the
      // measurement itself costs a few hundred bytes. A negative figure is a
      // sample cut by a garbage collection.
      for (let warm = 0; warm < 3; warm++) run();
      const limit = 2 * TICKS;
      let best = Infinity;
      for (let sample = 0; sample < 40 && best >= limit; sample++) {
        const start = process.memoryUsage().heapUsed;
        run();
        const grown = process.memoryUsage().heapUsed - start;
        if (grown >= 0 && grown < best) best = grown;
      }
      expect(ev.fired, name).toBeNull();
      expect(best / TICKS, `${name}: bytes allocated per tick`).toBeLessThan(2);
    }
  });
});

// --- Rate of fire --------------------------------------------------------------------

describe('rate of fire: no off-by-one, no drift', () => {
  const SECONDS = 200;

  it('a held trigger delivers shot k on the first tick at or after k x fireInterval, for 200 s', () => {
    for (const id of WEAPON_IDS.filter((w) => WEAPONS[w].auto)) {
      const w = WEAPONS[id];
      const rig = Rig.with(id).bottomless();
      const wrong: string[] = [];
      let k = 0;
      for (let t = 0; t < SECONDS * TICK_RATE; t++) {
        const fired = rig.tick(BTN.Fire).fired !== null;
        const due = t === idealShotTick(w, k);
        if (fired !== due && wrong.length < 5) wrong.push(`tick ${t}: fired=${fired}, shot ${k} due=${due}`);
        if (fired) k++;
      }
      expect(wrong, id).toEqual([]);
      // 600 rpm means 600 rpm: not 549 (rounded up to whole ticks), not 640 (rounded down).
      expect(Math.abs(k - SECONDS / w.fireInterval), id).toBeLessThanOrEqual(1);
    }
  });

  it('a semi-automatic weapon clicked exactly at its rate never drops a shot, for 200 s', () => {
    expect(SEMI_AUTOMATICS.length).toBeGreaterThan(0);
    for (const id of SEMI_AUTOMATICS) {
      const w = WEAPONS[id];
      expect(w.fireInterval * TICK_RATE, id).toBeGreaterThanOrEqual(2); // room for a release between two clicks
      const rig = Rig.with(id).bottomless();
      const wrong: string[] = [];
      let k = 0;
      for (let t = 0; t < SECONDS * TICK_RATE; t++) {
        const due = t === idealShotTick(w, k);
        const fired = rig.tick(due ? BTN.Fire : 0).fired !== null;
        if (fired !== due && wrong.length < 5) wrong.push(`tick ${t}: fired=${fired}, click ${k} due=${due}`);
        if (due) k++;
      }
      expect(wrong, id).toEqual([]);
      expect(Math.abs(k - SECONDS / w.fireInterval), id).toBeLessThanOrEqual(1);
    }
  });

  it('no input sequence beats the fire interval, over any run of consecutive shots', () => {
    for (const id of WEAPON_IDS) {
      const w = WEAPONS[id];
      const rig = Rig.with(id).bottomless();
      const masher = new Masher(mulberry32(0xf1 + WEAPON_IDS.indexOf(id)), w.slot, false);
      const shots: number[] = [];
      for (let t = 0; t < 150 * TICK_RATE; t++) if (rig.tick(masher.next().buttons).fired) shots.push(t);
      expect(shots.length, id).toBeGreaterThan(15);

      // n consecutive shots always span more than n x fireInterval minus one tick: the
      // one-tick slack of quantised time never adds up (that would be drift).
      const perShot = w.fireInterval * TICK_RATE;
      let slack = Infinity;
      for (let i = 0; i < shots.length; i++) {
        for (let j = i + 1; j < shots.length && j <= i + 60; j++) {
          slack = Math.min(slack, shots[j] - shots[i] - (j - i) * perShot);
        }
      }
      expect(slack, id).toBeGreaterThan(-1 - 1e-6);
      expect(shots.length, id).toBeLessThanOrEqual((150 * TICK_RATE) / perShot + 1);
    }
  });

  it('waiting longer than the cooldown earns no credit towards the next shot', () => {
    for (const id of WEAPON_IDS) {
      const w = WEAPONS[id];
      for (const extra of [1, 2, 3, 7, 40]) {
        const rig = Rig.with(id).bottomless();
        expect(rig.tick(BTN.Fire).fired, id).not.toBeNull();
        rig.hold(0, ticksFor(w.fireInterval) - 1 + extra); // the cooldown has been over for `extra` ticks
        expect(rig.s.fireCd, id).toBe(0);
        expect(rig.tick(BTN.Fire).fired, id).not.toBeNull();
        expect(earliestShot(rig), `${id} +${extra}`).toBe(ticksFor(w.fireInterval));
      }
    }
  });

  it('the cooldown counts down by exactly one tick per tick and stops at 0', () => {
    for (const id of WEAPON_IDS) {
      const w = WEAPONS[id];
      const rig = Rig.with(id);
      rig.tick(BTN.Fire);
      let cd = rig.s.fireCd;
      expect(cd, id).toBe(w.fireInterval);
      for (let n = 1; n <= ticksFor(w.fireInterval) + 3; n++) {
        rig.tick(0);
        const expected = cd - TICK_DT > 1e-9 ? cd - TICK_DT : 0;
        expect(rig.s.fireCd, `${id} tick ${n}`).toBe(expected);
        cd = rig.s.fireCd;
      }
      expect(cd, id).toBe(0);
    }
  });
});

// --- stepPlayer integration ------------------------------------------------------------

/** A large flat floor: enough of a world for stepPlayer. */
const FLOOR = new CollisionWorld([
  { min: { x: -200, y: -1, z: -200 }, max: { x: 200, y: 0, z: 200 }, surf: 'concrete' },
]);

/** Drives a player through the real stepPlayer (movement + weapons) on the flat floor. */
class LiveRig {
  readonly s: PlayerState;
  readonly ev = newStepEvents();
  seq = 0;
  yaw = 0;
  pitch = 0;

  constructor(weapon: WeaponId) {
    this.s = createPlayerState({ x: 0, y: 0, z: 0 }, 0, loadoutFor(weapon));
    this.s.active = WEAPONS[weapon].slot;
    for (let i = 0; i < 16; i++) this.tick(0); // settle on the floor
  }

  /** The returned events object is reused by the next tick. */
  tick(buttons = 0, slot = -1): StepEvents {
    const cmd: UserCmd = { seq: ++this.seq, buttons, yaw: this.yaw, pitch: this.pitch, slot, st: 0 };
    stepPlayer(this.s, Object.freeze(cmd), FLOOR, this.ev);
    return this.ev;
  }

  hold(buttons: number, ticks: number): number {
    let shots = 0;
    for (let i = 0; i < ticks; i++) if (this.tick(buttons).fired) shots++;
    return shots;
  }
}

describe('through stepPlayer: edges come from prevButtons, written after the weapon step', () => {
  it('stands on the test floor', () => {
    const live = new LiveRig('pistol');
    expect(live.s.onGround).toBe(true);
    expect(Math.abs(live.s.pos.y)).toBeLessThan(0.01);
  });

  it('a held trigger fires a semi-automatic weapon once; every new press fires again', () => {
    for (const id of SEMI_AUTOMATICS) {
      const w = WEAPONS[id];
      const cooldown = ticksFor(w.fireInterval);
      const live = new LiveRig(id);
      expect(live.tick(BTN.Fire).fired?.weapon, id).toBe(id);
      expect(live.s.prevButtons, id).toBe(BTN.Fire);
      expect(live.hold(BTN.Fire, cooldown + 30), id).toBe(0);
      expect(live.s.slots[w.slot]!.clip, id).toBe(w.clip - 1);

      // One-tick clicks, each one a full cooldown after the previous shot: none is lost.
      for (let click = 0; click < 3; click++) {
        expect(live.hold(0, cooldown - 1), id).toBe(0);
        expect(live.tick(BTN.Fire).fired, `${id} click ${click}`).not.toBeNull();
        expect(live.s.prevButtons, id).toBe(BTN.Fire);
      }
      expect(live.s.slots[w.slot]!.clip, id).toBe(w.clip - 4);
    }
  });

  it('an automatic weapon fires at its exact rate through stepPlayer too', () => {
    for (const id of AUTOMATICS) {
      const w = WEAPONS[id];
      const live = new LiveRig(id);
      const shots: number[] = [];
      for (let t = 0; shots.length < 10; t++) if (live.tick(BTN.Fire).fired) shots.push(t);
      expect(shots, id).toEqual(shots.map((_, k) => idealShotTick(w, k)));
    }
  });

  it('freeze time: nothing happens, and a trigger held through its end is not a new press', () => {
    const buttons = BTN.Fire | BTN.AltFire | BTN.Reload | BTN.Forward | BTN.Jump;
    for (const id of FIREARMS) {
      const w = WEAPONS[id];
      const live = new LiveRig(id);
      live.s.slots[w.slot]!.clip = w.clip - 1; // a reload would be possible
      live.s.frozen = true;
      const before = fingerprint(live.s);
      for (let t = 0; t < 40; t++) expect(live.tick(buttons), id).toEqual(NO_EVENTS);
      expect(fingerprint(live.s), id).toBe(before);
      expect(live.s.prevButtons, id).toBe(buttons); // the raw command, not the masked one

      live.s.frozen = false;
      const ev = live.tick(BTN.Fire | BTN.AltFire);
      expect(ev.zoomChanged, id).toBe(false); // alt-fire was already down
      if (w.auto) {
        expect(ev.fired?.weapon, id).toBe(id);
      } else {
        expect(ev.fired, id).toBeNull();
        expect(live.hold(BTN.Fire, ticksFor(w.fireInterval) + 20), id).toBe(0);
        live.tick(0);
        expect(live.tick(BTN.Fire).fired?.weapon, id).toBe(id);
      }
    }
    // A press made on the first live tick is a real press.
    const live = new LiveRig('pistol');
    live.s.frozen = true;
    live.hold(0, 10);
    live.s.frozen = false;
    expect(live.tick(BTN.Fire).fired?.weapon).toBe('pistol');
  });

  it('timed action: fully locked, including switching; a held trigger is not a new press afterwards', () => {
    for (const action of [ACTION.Plant, ACTION.Defuse, ACTION.Secure]) {
      const live = new LiveRig('deagle');
      live.s.slots[SLOT.Secondary]!.clip = 3;
      live.s.action = action;
      const before = fingerprint(live.s);
      for (let t = 0; t < 30; t++) {
        const slot = t % 2 === 0 ? SLOT.Primary : SLOT.Melee;
        expect(live.tick(BTN.Fire | BTN.Reload | BTN.AltFire | BTN.Back, slot)).toEqual(NO_EVENTS);
      }
      expect(fingerprint(live.s)).toBe(before);
      live.s.action = ACTION.None;
      expect(live.hold(BTN.Fire, 30)).toBe(0);
      live.tick(0);
      expect(live.tick(BTN.Fire).fired?.weapon).toBe('deagle');
    }
  });

  it('dead: nothing moves, and the trigger held at respawn is not a new press', () => {
    const live = new LiveRig('pistol');
    live.s.alive = false;
    const before = fingerprint(live.s);
    for (let t = 0; t < 20; t++) expect(live.tick(BTN.Fire | BTN.Reload, SLOT.Melee)).toEqual(NO_EVENTS);
    expect(fingerprint(live.s)).toBe(before);
    expect(live.s.prevButtons).toBe(BTN.Fire | BTN.Reload);
    live.s.alive = true;
    expect(live.hold(BTN.Fire, 30)).toBe(0);
    live.tick(0);
    expect(live.tick(BTN.Fire).fired?.weapon).toBe('pistol');
  });

  it('the zoom changes once per press', () => {
    const live = new LiveRig('sniper');
    const levels: number[] = [];
    for (let press = 0; press < 4; press++) {
      let changes = 0;
      for (let t = 0; t < 12; t++) if (live.tick(BTN.AltFire).zoomChanged) changes++;
      expect(changes).toBe(1);
      levels.push(live.s.zoom);
      expect(live.tick(0).zoomChanged).toBe(false);
    }
    expect(levels).toEqual([1, 2, 0, 1]);
  });

  it('non-finite view angles in a command never reach the bullets', () => {
    for (const [yaw, pitch] of [
      [Number.NaN, 0],
      [0, Number.NaN],
      [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
      [Number.NaN, Number.NaN],
    ]) {
      const live = new LiveRig('shotgun');
      live.yaw = yaw;
      live.pitch = pitch;
      const fired = live.tick(BTN.Fire).fired;
      expect(fired).not.toBeNull();
      expect(fired!.dirs).toHaveLength(WEAPONS.shotgun.pellets);
      for (const d of fired!.dirs) expect(isUnit(d)).toBe(true);
      for (const key of NUMERIC_FIELDS) expect(Number.isFinite(live.s[key]), key).toBe(true);
    }
  });

  it('running ruins the first shot, stopping or crouch-walking restores it (real movement)', () => {
    for (const id of ['rifle_ak', 'rifle_m4', 'smg', 'pistol'] as WeaponId[]) {
      const w = WEAPONS[id];
      const live = new LiveRig(id);
      expect(currentSpread(live.s), id).toBe(w.spread);

      live.hold(BTN.Forward, 2 * TICK_RATE);
      expect(Math.hypot(live.s.vel.x, live.s.vel.z), id).toBeGreaterThan(0.9 * MOVE.runSpeed * w.moveSpeed);
      const running = currentSpread(live.s);
      expect(running, id).toBeGreaterThan(w.spread + 0.8 * w.spreadMove);
      expect(running, id).toBeLessThanOrEqual(w.spread + w.spreadMove + 1e-12);

      // Let go of the key: full accuracy is back in well under half a second.
      let ticks = 0;
      while (currentSpread(live.s) > w.spread && ticks < 5 * TICK_RATE) {
        live.tick(0);
        ticks++;
      }
      expect(currentSpread(live.s), id).toBe(w.spread);
      expect(ticks * TICK_DT, id).toBeLessThan(0.5);

      // Crouch-walking is the accurate way to move.
      live.hold(BTN.Forward | BTN.Crouch, 2 * TICK_RATE);
      expect(live.s.crouch, id).toBe(1);
      expect(Math.hypot(live.s.vel.x, live.s.vel.z), id).toBeGreaterThan(1);
      expect(currentSpread(live.s), id).toBeLessThanOrEqual(w.spread * w.spreadCrouchMul + 0.02 * w.spreadMove);
    }
  });
});

// --- Reload exploits -------------------------------------------------------------------

describe('reload exploits', () => {
  it('switching away on any tick of a reload transfers nothing, until the very last tick', () => {
    for (const id of FIREARMS) {
      const w = WEAPONS[id];
      const total = ticksFor(w.reloadTime);
      const problems: string[] = [];
      for (let cancelAt = 1; cancelAt <= total; cancelAt++) {
        const rig = Rig.with(id);
        const gun = rig.gun;
        gun.clip = 1;
        const start = rig.tick(BTN.Reload);
        rig.hold(0, cancelAt - 1);
        const ev = rig.tick(0, awayFrom(w));
        const done = cancelAt === total;
        const clip = done ? Math.min(w.clip, 1 + w.reserve) : 1;
        const reserve = w.reserve - (clip - 1);
        // Back to the weapon, and wait: the reload neither resumes nor finishes behind the player's back.
        rig.tick(0, w.slot);
        let late = false;
        for (let n = 0; n < ticksFor(w.drawTime) + total + 5; n++) {
          const e = rig.tick(0);
          if (e.reloadStarted || e.reloadFinished) late = true;
        }
        const ok =
          start.reloadStarted &&
          ev.switched &&
          ev.reloadFinished === done &&
          gun.clip === clip &&
          gun.reserve === reserve &&
          rig.s.reload === 0 &&
          !late;
        if (!ok && problems.length < 5) problems.push(`cancel at tick ${cancelAt}/${total}: ${JSON.stringify(gun)}`);
      }
      expect(problems, id).toEqual([]);
    }
  });

  it('an empty weapon put away mid-reload starts over from scratch when it is drawn again', () => {
    for (const id of FIREARMS) {
      const w = WEAPONS[id];
      const rig = Rig.with(id);
      rig.gun.clip = 0;
      expect(rig.tick(0).reloadStarted, id).toBe(true); // automatic
      rig.hold(0, ticksFor(w.reloadTime) - 2); // one tick from the end
      expect(rig.tick(0, awayFrom(w)).switched, id).toBe(true);
      expect(rig.tick(0, w.slot).switched, id).toBe(true);
      // The whole draw, then the whole reload again.
      const events: string[] = [];
      for (let n = 1; n <= ticksFor(w.drawTime) + ticksFor(w.reloadTime) + 3; n++) {
        const ev = rig.tick(0);
        if (ev.reloadStarted) events.push(`start@${n}`);
        if (ev.reloadFinished) events.push(`end@${n}`);
      }
      const draw = ticksFor(w.drawTime);
      expect(events, id).toEqual([`start@${draw}`, `end@${draw + ticksFor(w.reloadTime)}`]);
      expect(rig.gun, id).toEqual({ id, clip: w.clip, reserve: w.reserve - w.clip });
    }
  });

  it('a refused reload changes nothing, however long the key is mashed', () => {
    const cases: { name: string; make: () => Rig }[] = [];
    for (const id of FIREARMS) {
      cases.push({ name: `${id}, full clip`, make: () => Rig.with(id) });
      cases.push({
        name: `${id}, empty reserve`,
        make: () => {
          const rig = Rig.with(id);
          rig.gun.clip = 1;
          rig.gun.reserve = 0;
          return rig;
        },
      });
    }
    cases.push({ name: 'knife', make: () => Rig.with('knife') });
    cases.push({
      name: 'empty hands',
      make: () => {
        const rig = Rig.with('rifle_ak');
        rig.s.slots[SLOT.Primary] = null;
        return rig;
      },
    });
    for (const { name, make } of cases) {
      const rig = make();
      if (rig.def.zoomFov) expect(rig.tick(BTN.AltFire).zoomChanged, name).toBe(true); // a refused reload must not unzoom
      rig.tick(0);
      const before = fingerprint(rig.s);
      for (let t = 0; t < 200; t++) expect(rig.tick(t % 3 === 0 ? 0 : BTN.Reload), name).toEqual(NO_EVENTS);
      expect(fingerprint(rig.s), name).toBe(before);
    }
  });

  it('nothing done during a reload makes it shorter, longer or more generous', () => {
    for (const id of FIREARMS) {
      const w = WEAPONS[id];
      const total = ticksFor(w.reloadTime);
      const problems: string[] = [];
      for (let seed = 1; seed <= 12; seed++) {
        const rig = Rig.with(id);
        const gun = rig.gun;
        gun.clip = 1;
        const masher = new Masher(mulberry32(seed * 7919), w.slot, false);
        if (!rig.tick(BTN.Reload).reloadStarted) problems.push(`seed ${seed}: no reload`);
        for (let n = 1; n <= total; n++) {
          const ev = rig.tick(masher.next().buttons);
          const ok =
            n < total
              ? !ev.reloadFinished && !ev.reloadStarted && !ev.fired && !ev.dryFire && !ev.zoomChanged && gun.clip === 1
              : ev.reloadFinished && gun.clip + (ev.fired ? 1 : 0) === Math.min(w.clip, 1 + w.reserve);
          if (!ok && problems.length < 5) problems.push(`seed ${seed}, tick ${n}/${total}: ${JSON.stringify(ev)}`);
        }
        if (gun.clip + gun.reserve < w.reserve || gun.clip + gun.reserve > 1 + w.reserve) problems.push('ammo');
      }
      expect(problems, id).toEqual([]);
    }
  });

  it('a reload moves exactly min(missing, reserve) rounds, for every clip and reserve', () => {
    for (const id of FIREARMS) {
      const w = WEAPONS[id];
      const clips = [...new Set([0, 1, Math.floor(w.clip / 2), w.clip - 1])];
      for (const clip of clips) {
        const missing = w.clip - clip;
        for (const reserve of [...new Set([1, 2, missing - 1, missing, missing + 1, w.reserve])]) {
          if (reserve < 1) continue;
          const rig = Rig.with(id);
          rig.gun.clip = clip;
          rig.gun.reserve = reserve;
          const moved = Math.min(missing, reserve);
          const at = `${id}, clip ${clip}, reserve ${reserve}`;
          expect(rig.tick(BTN.Reload).reloadStarted, at).toBe(true);
          const events: string[] = [];
          for (let n = 1; n <= ticksFor(w.reloadTime) + 100; n++) {
            const ev = rig.tick(BTN.Reload); // the key stays down: still one reload only
            if (ev.reloadStarted) events.push(`start@${n}`);
            if (ev.reloadFinished) events.push(`end@${n}`);
          }
          expect(events, at).toEqual([`end@${ticksFor(w.reloadTime)}`]);
          expect(rig.gun, at).toEqual({ id, clip: clip + moved, reserve: reserve - moved });
        }
      }
    }
  });

  it('a reload requested during the draw starts on the tick the draw ends, never earlier', () => {
    for (const id of FIREARMS) {
      const w = WEAPONS[id];
      for (const clip of [0, 1]) {
        const rig = Rig.with(id);
        rig.gun.clip = clip;
        // Put the weapon away before the automatic reload of an empty clip gets going, then draw it again.
        rig.tick(0, awayFrom(w));
        expect(rig.tick(BTN.Reload, w.slot).switched, id).toBe(true);
        const events: string[] = [];
        for (let n = 1; n <= ticksFor(w.drawTime) + ticksFor(w.reloadTime) + 3; n++) {
          const ev = rig.tick(BTN.Reload);
          if (ev.reloadStarted) events.push(`start@${n}`);
          if (ev.reloadFinished) events.push(`end@${n}`);
        }
        const draw = ticksFor(w.drawTime);
        expect(events, `${id} clip ${clip}`).toEqual([`start@${draw}`, `end@${draw + ticksFor(w.reloadTime)}`]);
      }
    }
  });

  it('cannot fire, zoom or get ammo early during a reload, and fires on the tick it ends', () => {
    for (const id of FIREARMS) {
      const w = WEAPONS[id];
      const rig = Rig.with(id);
      rig.gun.clip = 0;
      rig.gun.reserve = 3;
      expect(rig.tick(BTN.Fire).reloadStarted, id).toBe(true);
      const total = ticksFor(w.reloadTime);
      for (let n = 1; n < total; n++) {
        const ev = rig.tick(n % 2 === 0 ? BTN.Fire | BTN.AltFire : 0);
        expect(ev, `${id} tick ${n}`).toEqual(NO_EVENTS);
        expect(rig.gun, `${id} tick ${n}`).toEqual({ id, clip: 0, reserve: 3 });
      }
      const last = rig.tick(total % 2 === 0 ? BTN.Fire : 0);
      expect(last.reloadFinished, id).toBe(true);
      expect(rig.gun.reserve, id).toBe(Math.max(0, 3 - w.clip));
      expect(rig.gun.clip + rig.gun.reserve + (last.fired ? 1 : 0), id).toBe(3);
    }
  });
});

// --- Weapon switching ------------------------------------------------------------------

describe('weapon switching', () => {
  it('no shot leaves during the draw, from any slot to any other, whatever the trigger does', () => {
    for (const id of WEAPON_IDS) {
      const w = WEAPONS[id];
      const draw = ticksFor(w.drawTime);
      for (const from of [SLOT.Primary, SLOT.Secondary, SLOT.Melee]) {
        if (from === w.slot) continue;
        for (const phase of [0, 1]) {
          const rig = Rig.with(id);
          rig.s.active = from;
          expect(rig.tick(BTN.Fire, w.slot).switched, id).toBe(true);
          expect(rig.s.draw, id).toBe(w.drawTime);
          let first = -1;
          for (let n = 1; n <= draw + 2 && first < 0; n++) {
            const ev = rig.tick(n % 2 === phase ? BTN.Fire | BTN.AltFire : 0);
            if (ev.fired) first = n;
            else if (n < draw) expect(ev, `${id} tick ${n}`).toEqual(NO_EVENTS);
          }
          // The trigger alternates: the shot leaves on the tick the draw ends, or on the next press.
          expect(first, `${id} from slot ${from}`).toBeGreaterThanOrEqual(draw);
          expect(first, `${id} from slot ${from}`).toBeLessThanOrEqual(draw + 1);
        }
      }
    }
  });

  it('putting a weapon away and drawing it again never beats its fire interval', () => {
    // The fire cooldown is cleared by a switch (the sidearm must not wait for the
    // sniper's bolt), so the draw time is what stops "shoot, swap, swap, shoot".
    for (const id of WEAPON_IDS) {
      const w = WEAPONS[id];
      const fair = ticksFor(w.fireInterval);
      for (const via of [SLOT.Primary, SLOT.Secondary, SLOT.Melee]) {
        if (via === w.slot) continue;
        for (const awayAfter of [1, 2, 5, Math.floor(fair / 2), fair - 1].filter((n) => n >= 1)) {
          const rig = Rig.with(id).bottomless();
          expect(rig.tick(BTN.Fire).fired, id).not.toBeNull();
          expect(earliestShot(rig), id).toBe(fair);
          rig.hold(0, awayAfter - 1);
          expect(rig.tick(0, via).switched, id).toBe(true);
          expect(rig.tick(0, w.slot).switched, id).toBe(true);
          const again = awayAfter + 1 + earliestShot(rig);
          expect(again, `${id} via slot ${via}, away after ${awayAfter} ticks`).toBeGreaterThanOrEqual(fair);
        }
      }
    }
  });

  it('swapping on every tick never fires, and the weapon left in hands needs its whole draw', () => {
    for (const id of WEAPON_IDS) {
      const w = WEAPONS[id];
      const rig = Rig.with(id);
      const ammo = ammoOf(rig.s);
      for (let t = 0; t < 5 * TICK_RATE; t++) {
        const ev = rig.tick(BTN.Fire | BTN.Reload | BTN.AltFire, t % 2 === 0 ? awayFrom(w) : w.slot);
        expect(ev.switched, id).toBe(true);
        expect(ev.fired, id).toBeNull();
        expect(ev.reloadStarted, id).toBe(false);
        expect(rig.s.zoom, id).toBe(0);
      }
      expect(rig.s.active, id).toBe(w.slot);
      expect(ammoOf(rig.s), id).toBe(ammo);
      expect(earliestShot(rig), id).toBe(ticksFor(w.drawTime));
    }
  });

  it('requests for the current, an empty or an impossible slot are not requests at all', () => {
    const run = (noise: boolean): string => {
      const rig = Rig.with('sniper');
      rig.s.slots[SLOT.Secondary] = null;
      const masher = new Masher(mulberry32(99), SLOT.Primary, false);
      const rng = mulberry32(5);
      const log: string[] = [];
      for (let t = 0; t < 30 * TICK_RATE; t++) {
        const { buttons } = masher.next();
        const junk = pick(rng, [SLOT.Primary, SLOT.Secondary, ...SLOT_REQUESTS.filter((r) => r !== SLOT.Melee)]);
        log.push(JSON.stringify(rig.tick(buttons, noise ? junk : -1)));
      }
      return `${log.join('\n')}\n${JSON.stringify(rig.s)}`;
    };
    expect(run(true)).toBe(run(false));
  });
});

// --- Zoom ------------------------------------------------------------------------------

describe('zoom state never leaks', () => {
  const SCOPED = WEAPON_IDS.filter((id) => WEAPONS[id].zoomFov);

  it('there is a scoped weapon to test', () => {
    expect(SCOPED.length).toBeGreaterThan(0);
  });

  it('every way of leaving the scoped weapon, or of reloading it, resets the zoom on that tick', () => {
    const leaks: { name: string; apply: (rig: Rig) => StepEvents }[] = [
      { name: 'switch', apply: (rig) => rig.tick(0, awayFrom(rig.def)) },
      { name: 'switch while firing', apply: (rig) => rig.tick(BTN.Fire, awayFrom(rig.def)) },
      {
        name: 'manual reload',
        apply: (rig) => {
          rig.gun.clip -= 1;
          return rig.tick(BTN.Reload);
        },
      },
      {
        name: 'automatic reload',
        apply: (rig) => {
          rig.gun.clip = 0;
          return rig.tick(0);
        },
      },
      {
        name: 'weapon taken away',
        apply: (rig) => {
          rig.s.slots[rig.s.active] = null;
          return rig.tick(0);
        },
      },
      {
        name: 'weapon replaced',
        apply: (rig) => {
          rig.s.slots[rig.s.active] = { id: 'rifle_ak', clip: 30, reserve: 90 };
          return rig.tick(0);
        },
      },
    ];
    for (const id of SCOPED) {
      for (const level of [1, 2]) {
        for (const { name, apply } of leaks) {
          const rig = Rig.with(id);
          for (let press = 0; press < level; press++) {
            rig.tick(BTN.AltFire);
            rig.tick(0);
          }
          expect(rig.s.zoom, name).toBe(level);
          const ev = apply(rig);
          expect(ev.zoomChanged, `${id} level ${level}: ${name}`).toBe(true);
          expect(rig.s.zoom, `${id} level ${level}: ${name}`).toBe(0);
          // And it stays off: the accuracy and the speed are those of an unscoped weapon.
          expect(rig.tick(0).zoomChanged, name).toBe(false);
          expect(rig.s.zoom, name).toBe(0);
        }
      }
    }
  });

  it('alt-fire mashed through a whole draw and a whole reload never zooms', () => {
    for (const id of SCOPED) {
      const w = WEAPONS[id];
      const rig = Rig.with(id);
      rig.tick(0, awayFrom(w));
      rig.tick(0, w.slot);
      for (let n = 1; n < ticksFor(w.drawTime); n++) {
        expect(rig.tick(n % 2 === 0 ? BTN.AltFire : 0).zoomChanged, `draw tick ${n}`).toBe(false);
      }
      expect(rig.s.zoom).toBe(0);
      rig.hold(0, 4);
      rig.gun.clip = 1;
      expect(rig.tick(BTN.Reload).reloadStarted).toBe(true);
      for (let n = 1; n < ticksFor(w.reloadTime); n++) {
        expect(rig.tick(n % 2 === 0 ? BTN.AltFire : 0).zoomChanged, `reload tick ${n}`).toBe(false);
      }
      expect(rig.s.zoom).toBe(0);
      // As soon as the weapon is usable again, the next press works.
      rig.hold(0, 3);
      expect(rig.tick(BTN.AltFire).zoomChanged).toBe(true);
      expect(rig.s.zoom).toBe(1);
    }
  });

  it('a zoom level that is not a level counts as unzoomed: the next press gives level 1', () => {
    for (const id of SCOPED) {
      for (const junk of [Number.NaN, undefined, null, -1, 0.5] as unknown as number[]) {
        const rig = new Rig(detached(playerWith(id)));
        rig.s.zoom = junk;
        expect(rig.tick(BTN.AltFire).zoomChanged, `${id} zoom = ${junk}`).toBe(true);
        expect(rig.s.zoom, `${id} zoom = ${junk}`).toBe(1);
      }
      // Above the last level: back to no zoom, like the last level itself.
      const rig = new Rig(detached(playerWith(id)));
      rig.s.zoom = 7;
      rig.tick(BTN.AltFire);
      expect(rig.s.zoom, id).toBe(0);
    }
  });

  it('a zoom level left on a weapon without a scope is dropped, and cannot be raised', () => {
    for (const id of WEAPON_IDS.filter((w) => !WEAPONS[w].zoomFov)) {
      const rig = Rig.with(id);
      rig.s.zoom = 2;
      expect(rig.tick(BTN.AltFire).zoomChanged, id).toBe(true);
      expect(rig.s.zoom, id).toBe(0);
      for (let t = 0; t < 20; t++) expect(rig.tick(t % 2 === 0 ? 0 : BTN.AltFire).zoomChanged, id).toBe(false);
      expect(rig.s.zoom, id).toBe(0);
    }
  });
});

// --- Recoil and inaccuracy -------------------------------------------------------------

describe('recoil and inaccuracy stay bounded and always recover', () => {
  it('a 200 s spray never runs away: punch, sway and cone stay under their caps', () => {
    for (const id of AUTOMATICS) {
      const w = WEAPONS[id];
      const rig = Rig.with(id).bottomless();
      let maxPitch = 0;
      let maxYaw = 0;
      let maxSpread = 0;
      let sumYaw = 0;
      const ticks = 200 * TICK_RATE;
      for (let t = 0; t < ticks; t++) {
        rig.tick(BTN.Fire);
        maxPitch = Math.max(maxPitch, rig.s.punchPitch);
        maxYaw = Math.max(maxYaw, Math.abs(rig.s.punchYaw));
        maxSpread = Math.max(maxSpread, rig.s.spread);
        sumYaw += rig.s.punchYaw;
      }
      expect(maxPitch, id).toBeGreaterThan(0);
      expect(maxPitch, id).toBeLessThanOrEqual(w.recoilMax);
      expect(maxYaw, id).toBeLessThanOrEqual(yawBound(w));
      expect(maxSpread, id).toBeLessThanOrEqual(w.spreadShotMax);
      // The sway goes both ways: over a long spray the view does not creep sideways.
      expect(Math.abs(sumYaw / ticks), id).toBeLessThan(0.2 * w.recoilSide);
      expect(Number.isFinite(rig.s.shots) && rig.s.shots > 0, id).toBe(true);
    }
  });

  it('from any state reached by mashing, a few idle seconds bring everything back to exactly zero', () => {
    for (const id of WEAPON_IDS) {
      for (let seed = 1; seed <= 6; seed++) {
        const rig = Rig.with(id);
        const masher = new Masher(mulberry32(seed * 31 + WEAPON_IDS.indexOf(id)), WEAPONS[id].slot, true);
        let shots = 0;
        for (let t = 0; t < 10 * TICK_RATE; t++) {
          const { buttons, slot } = masher.next();
          if (rig.tick(buttons, slot).fired) shots++;
        }
        for (const slot of rig.s.slots) if (slot) slot.reserve = 0; // no new reload once the keys are released
        // Six seconds cover the longest timer and the recovery of the view and of the cone.
        rig.hold(0, 6 * TICK_RATE);
        expect(rig.s.punchPitch, id).toBe(0);
        expect(rig.s.punchYaw, id).toBe(0);
        expect(rig.s.spread, id).toBe(0);
        expect(rig.s.fireCd, id).toBe(0);
        expect(rig.s.draw, id).toBe(0);
        expect(rig.s.reload, id).toBe(0);
        const inHands = activeWeapon(rig.s);
        const atRest = rig.s.zoom > 0 ? (inHands.zoomSpread ?? inHands.spread) : inHands.spread;
        expect(currentSpread(rig.s), id).toBe(atRest);
        // The recoil index goes down by 12 per second: a long burst takes longer to forget.
        rig.hold(0, Math.ceil((shots / 12) * TICK_RATE) + 5 * TICK_RATE);
        expect(rig.s.shots, id).toBe(0);
        expect(rig.s.sinceShot, id).toBe(10);
        // ...and the rested state is a fixed point.
        const rest = fingerprint(rig.s);
        for (let t = 0; t < 10; t++) expect(rig.tick(0), id).toEqual(NO_EVENTS);
        expect(fingerprint(rig.s), id).toBe(rest);
      }
    }
  });
});

// --- Shot directions -------------------------------------------------------------------

describe('shot directions under hostile conditions', () => {
  it('unit length, finite, inside the cone around view + punch, for any view, stance and accumulated recoil', () => {
    for (const id of FIREARMS) {
      const w = WEAPONS[id];
      const rng = mulberry32(0xd1 + WEAPON_IDS.indexOf(id));
      let worst = 0;
      for (let n = 0; n < 400; n++) {
        const s = playerWith(id);
        s.yaw = pick(rng, [0, Math.PI, -Math.PI, (rng() * 2 - 1) * Math.PI]);
        s.pitch = pick(rng, [0, MAX_PITCH, -MAX_PITCH, (rng() * 2 - 1) * MAX_PITCH]);
        s.punchPitch = pick(rng, [0, w.recoilMax, rng() * w.recoilMax]);
        s.punchYaw = rng() < 0.5 ? (rng() * 2 - 1) * yawBound(w) : 0;
        s.spread = pick(rng, [0, w.spreadShotMax, rng() * w.spreadShotMax]);
        s.shots = Math.floor(rng() * 40);
        s.crouch = pick(rng, [0, 1, rng()]);
        s.onGround = rng() < 0.7;
        s.vel.x = pick(rng, [0, 2, 6, 40]);
        s.vel.z = pick(rng, [0, -3, 9]);
        s.zoom = w.zoomFov ? Math.floor(rng() * 3) : 0;
        s.pos = { x: rng() * 100 - 50, y: rng() * 10, z: rng() * 100 - 50 };

        const cone = currentSpread(s);
        const aim = forwardFromAngles(s.yaw + s.punchYaw, s.pitch + s.punchPitch);
        const eye = eyePosition(s);
        const rig = new Rig(s);
        rig.seq = Math.floor(rng() * 1e9);
        const fired = rig.tick(BTN.Fire).fired;
        expect(fired?.weapon, id).toBe(id);
        expect(fired!.origin, id).toEqual(eye);
        expect(fired!.dirs, id).toHaveLength(w.pellets);
        for (const d of fired!.dirs) {
          if (!isUnit(d)) throw new Error(`${id}: direction ${JSON.stringify(d)} is not a unit vector`);
          const off = angleBetween(d, aim);
          if (off > cone + 1e-9) throw new Error(`${id}: ${off * R2D} deg off the aim, cone is ${cone * R2D} deg`);
          worst = Math.max(worst, off / cone);
        }
        // The shot itself never pushes the recoil or the inaccuracy past their caps.
        if (rig.s.punchPitch > w.recoilMax) throw new Error(`${id}: punchPitch ${rig.s.punchPitch} above recoilMax`);
        if (rig.s.spread > w.spreadShotMax) throw new Error(`${id}: spread ${rig.s.spread} above spreadShotMax`);
      }
      expect(worst, id).toBeGreaterThan(0.9); // the cone is used up to its edge...
      expect(worst, id).toBeLessThanOrEqual(1 + 1e-9); // ...and never beyond
    }
  });

  it('garbage in a command never throws and never leaves the state or the bullets non-finite', () => {
    const junk = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 2.5, 1e300, -(2 ** 40), 2 ** 53];
    for (const id of WEAPON_IDS) {
      const rng = mulberry32(0xbad + WEAPON_IDS.indexOf(id));
      const s = detached(playerWith(id));
      const ammo = ammoOf(s);
      let shots = 0;
      for (let t = 0; t < 40 * TICK_RATE; t++) {
        const any = (fallback: number): number => (rng() < 0.4 ? pick(rng, junk) : fallback);
        s.yaw = any(rng() * 6 - 3);
        s.pitch = any(rng() * 3 - 1.5);
        const buttons = any(rng() < 0.5 ? BTN.Fire : rng() < 0.3 ? BTN.AltFire | BTN.Reload : 0);
        const cmd = { seq: any(t), buttons, yaw: any(0), pitch: any(0), slot: any(-1), st: any(0) };
        const ev = newStepEvents();
        stepWeapons(s, cmd, ev);
        s.prevButtons = buttons;
        for (const key of NUMERIC_FIELDS) {
          if (!Number.isFinite(s[key])) throw new Error(`${id} tick ${t}: ${key} = ${s[key]}`);
        }
        if (ev.fired) {
          shots++;
          for (const d of ev.fired.dirs) if (!isUnit(d)) throw new Error(`${id} tick ${t}: ${JSON.stringify(d)}`);
        }
        if (!Number.isInteger(s.active) || !s.slots[s.active]) throw new Error(`${id} tick ${t}: active = ${s.active}`);
      }
      expect(shots, id).toBeGreaterThan(3);
      expect(ammoOf(s), id).toBeLessThanOrEqual(ammo);
    }
  });

  it('an absurd inaccuracy never sends bullets sideways or backwards', () => {
    for (const id of FIREARMS) {
      const w = WEAPONS[id];
      for (const spread of [2, 1e9, Number.POSITIVE_INFINITY]) {
        const rig = new Rig(detached(playerWith(id))).bottomless();
        const aim = forwardFromAngles(rig.s.yaw, rig.s.pitch);
        for (let shot = 0; shot < 20; shot++) {
          rig.s.spread = spread;
          rig.s.fireCd = 0;
          rig.s.punchPitch = 0;
          rig.s.punchYaw = 0;
          rig.s.prevButtons = 0;
          const fired = rig.tick(BTN.Fire).fired;
          expect(fired, id).not.toBeNull();
          for (const d of fired!.dirs) {
            expect(isUnit(d), `${id} spread ${spread}`).toBe(true);
            expect(angleBetween(d, aim), `${id} spread ${spread}`).toBeLessThanOrEqual(Math.PI / 3 + 1e-9);
          }
          expect(rig.s.spread, `${id} spread ${spread}`).toBeLessThanOrEqual(w.spreadShotMax);
        }
      }
    }
  });

  it('a corrupt state heals within a tick, and never produces a non-finite bullet', () => {
    // What a mangled snapshot or a field missing after a protocol change looks like once parsed.
    const garbage = [Number.NaN, undefined, null, -1] as unknown as number[];
    const healed = ['fireCd', 'reload', 'draw', 'shots', 'sinceShot', 'punchPitch', 'punchYaw', 'spread'] as const;
    for (const id of ['rifle_ak', 'shotgun', 'sniper', 'knife'] as WeaponId[]) {
      for (const key of healed) {
        for (const value of garbage) {
          const at = `${id}.${key} = ${value}`;
          const isHealthy = (s: PlayerState): string | null => {
            for (const field of healed) {
              const v: unknown = s[field];
              // The view punch may be negative (it is an angle); everything else is a duration or a count.
              const ok = typeof v === 'number' && Number.isFinite(v) && (field.startsWith('punch') || v >= 0);
              if (!ok) return `${field} = ${String(v)}`;
            }
            return null;
          };
          // Without touching anything: one tick is enough.
          const idle = new Rig(detached(playerWith(id)));
          idle.s[key] = value;
          expect(idle.tick(0), at).toEqual(NO_EVENTS);
          expect(isHealthy(idle.s), at).toBeNull();

          // With the trigger pulled: the shot leaves, and it is a clean one.
          const rig = new Rig(detached(playerWith(id)));
          rig.s[key] = value;
          let shots = 0;
          for (let t = 0; t < 3; t++) {
            const fired = rig.tick(t === 1 ? 0 : BTN.Fire).fired;
            if (!fired) continue;
            shots++;
            for (const d of fired.dirs) expect(isUnit(d), at).toBe(true);
          }
          expect(shots, at).toBe(1);
          expect(isHealthy(rig.s), at).toBeNull();
          expect(rig.s.shots, at).toBe(1); // the shot was counted
          expect(rig.s.punchPitch, at).toBeLessThanOrEqual(WEAPONS[id].recoilMax);
          if (typeof value !== 'number' || !Number.isFinite(value)) {
            // What is not a number counts as "at rest": the one shot fired starts from zero.
            const w = WEAPONS[id];
            expect(rig.s.punchPitch, at).toBeLessThanOrEqual(Math.min(w.recoilUp, w.recoilMax));
            expect(Math.abs(rig.s.punchYaw), at).toBeLessThanOrEqual(w.recoilSide + w.recoilJitter);
            expect(rig.s.spread, at).toBeLessThanOrEqual(Math.min(w.spreadShot, w.spreadShotMax));
            expect(rig.s.shots, at).toBeLessThanOrEqual(1);
          }
        }
      }
      // Stance fields belong to the movement code, but a bad one must not poison a shot either.
      for (const value of garbage) {
        const rig = new Rig(detached(playerWith(id)));
        rig.s.crouch = value;
        rig.s.vel.x = value;
        rig.s.vel.y = value;
        rig.s.vel.z = value;
        const fired = rig.tick(BTN.Fire).fired;
        expect(fired, id).not.toBeNull();
        for (const d of fired!.dirs) expect(isUnit(d), `${id} crouch/vel = ${value}`).toBe(true);
        expect(Number.isFinite(fired!.origin.y), `${id} crouch = ${value}`).toBe(true);
        expect(Number.isFinite(currentSpread(rig.s)), `${id} crouch/vel = ${value}`).toBe(true);
      }
    }
  });
});

// --- Degenerate players ----------------------------------------------------------------

describe('degenerate players', () => {
  it('a dead player is left untouched whatever the command says', () => {
    for (const id of WEAPON_IDS) {
      const rig = Rig.with(id);
      // Die in the middle of things: mid-burst, zoomed, cooling down.
      rig.tick(BTN.AltFire);
      rig.tick(BTN.Fire);
      rig.s.alive = false;
      const before = fingerprint(rig.s);
      const masher = new Masher(mulberry32(3), WEAPONS[id].slot, true);
      for (let t = 0; t < 5 * TICK_RATE; t++) {
        const { buttons, slot } = masher.next();
        expect(rig.tick(buttons, slot), id).toEqual(NO_EVENTS);
      }
      expect(fingerprint(rig.s), id).toBe(before);
    }
  });

  it('empty slots, an empty inventory, unknown weapons and a bad active index never break anything', () => {
    const cases: { name: string; make: () => PlayerState; ammo?: boolean }[] = [
      {
        name: 'no weapon at all',
        make: () => {
          const s = detached(playerWith('rifle_ak'));
          s.slots = [null, null, null];
          return s;
        },
      },
      {
        name: 'empty inventory array',
        make: () => {
          const s = detached(playerWith('rifle_ak'));
          s.slots = [];
          return s;
        },
      },
      {
        name: 'empty slot in hands',
        make: () => {
          const s = detached(playerWith('rifle_ak'));
          s.slots[SLOT.Primary] = null;
          return s;
        },
      },
      {
        name: 'unknown weapon in hands',
        make: () => {
          const s = detached(playerWith('rifle_ak'));
          s.slots[SLOT.Primary] = { id: 'bazooka' as WeaponId, clip: 5, reserve: 5 };
          return s;
        },
      },
      ...[7, -1, 1.5, Number.NaN].map((active) => ({
        name: `active = ${active}`,
        make: () => {
          const s = detached(playerWith('rifle_ak'));
          s.active = active;
          return s;
        },
      })),
    ];
    for (const { name, make } of cases) {
      const rig = new Rig(make());
      const ammo = ammoOf(rig.s);
      const masher = new Masher(mulberry32(11), SLOT.Primary, true);
      for (let t = 0; t < 20 * TICK_RATE; t++) {
        const { buttons, slot } = masher.next();
        const inHands = rig.s.slots[rig.s.active] ?? null;
        const ev = rig.tick(buttons, slot);
        for (const key of NUMERIC_FIELDS) {
          if (!Number.isFinite(rig.s[key]) || rig.s[key] < (key === 'punchYaw' ? -Infinity : 0)) {
            throw new Error(`${name}, tick ${t}: ${key} = ${rig.s[key]}`);
          }
        }
        if (ev.fired) for (const d of ev.fired.dirs) expect(isUnit(d), name).toBe(true);
        // Bare hands (or an unknown item) behave like the knife and never touch any ammo.
        if (!inHands || !(inHands.id in WEAPONS)) {
          if (ev.fired && !ev.switched) expect(ev.fired.weapon, name).toBe('knife');
          expect(ev.reloadStarted || ev.reloadFinished || ev.dryFire, name).toBe(false);
        }
        if (ev.switched) expect(rig.s.slots[rig.s.active], name).toBeTruthy();
      }
      expect(ammoOf(rig.s), name).toBeLessThanOrEqual(ammo);
    }
  });

  it('a player stuck on an empty slot or a bad index can still switch to a real weapon', () => {
    for (const active of [SLOT.Primary, 7, -1, Number.NaN]) {
      const s = detached(playerWith('rifle_ak'));
      s.slots[SLOT.Primary] = null;
      s.active = active;
      const rig = new Rig(s);
      expect(rig.tick(0, SLOT.Primary).switched, String(active)).toBe(false); // still empty
      expect(rig.tick(0, SLOT.Secondary).switched, String(active)).toBe(true);
      expect(rig.s.active, String(active)).toBe(SLOT.Secondary);
      expect(earliestShot(rig), String(active)).toBe(ticksFor(WEAPONS[DEFAULT_LOADOUT.secondary].drawTime));
    }
  });

  it('createSlots survives hostile loadouts', () => {
    const hostile = [null, undefined, {}, { primary: 'knife', secondary: 'knife' }, { primary: 7, secondary: [] }];
    for (const loadout of hostile as unknown as Loadout[]) {
      const slots = createSlots(loadout);
      expect(slots[SLOT.Primary]?.id).toBe(DEFAULT_LOADOUT.primary);
      expect(slots[SLOT.Secondary]?.id).toBe(DEFAULT_LOADOUT.secondary);
      expect(slots[SLOT.Melee]?.id).toBe('knife');
    }
  });
});

// --- Determinism -----------------------------------------------------------------------

describe('determinism', () => {
  const record = (chaos: Chaos, ticks: number): string[] => {
    const log: string[] = [];
    for (let t = 0; t < ticks; t++) log.push(`${JSON.stringify(chaos.step().ev)}|${JSON.stringify(chaos.rig.s)}`);
    return log;
  };

  it('two identical runs agree bit for bit on every tick, for every weapon', () => {
    for (const id of WEAPON_IDS) {
      const a = record(new Chaos(id, 0xabc), 40 * TICK_RATE);
      const b = record(new Chaos(id, 0xabc), 40 * TICK_RATE);
      const firstDiff = a.findIndex((line, i) => line !== b[i]);
      expect(firstDiff, id).toBe(-1);
      expect(a.some((line) => line.includes('"fired":{')), id).toBe(true);
      // A different seed really is a different run.
      expect(record(new Chaos(id, 0xabd), 10 * TICK_RATE), id).not.toEqual(a.slice(0, 10 * TICK_RATE));
    }
  });

  it('the machine keeps nothing outside PlayerState: other players do not influence a run', () => {
    for (const id of ['rifle_ak', 'sniper', 'shotgun'] as WeaponId[]) {
      const alone = record(new Chaos(id, 77), 20 * TICK_RATE);
      const subject = new Chaos(id, 77);
      const crowd = WEAPON_IDS.map((other, i) => new Chaos(other, 1000 + i));
      const mixed: string[] = [];
      for (let t = 0; t < 20 * TICK_RATE; t++) {
        for (const other of crowd) other.step();
        mixed.push(`${JSON.stringify(subject.step().ev)}|${JSON.stringify(subject.rig.s)}`);
        crowd[t % crowd.length].step();
      }
      expect(mixed.findIndex((line, i) => line !== alone[i]), id).toBe(-1);
    }
  });

  it('a state copied at any moment replays the same future (prediction and reconciliation)', () => {
    for (const id of WEAPON_IDS) {
      const rig = Rig.with(id);
      const masher = new Masher(mulberry32(0x5eed + WEAPON_IDS.indexOf(id)), WEAPONS[id].slot, true);
      const inputs = Array.from({ length: 30 * TICK_RATE }, () => masher.next());
      const rng = mulberry32(42);
      const forks: { at: number; rig: Rig; viaJson: boolean }[] = [];
      for (let t = 0; t < inputs.length; t++) {
        if (rng() < 0.01 && forks.length < 12) {
          // Half of the copies go through JSON, like a snapshot on the wire.
          const viaJson = forks.length % 2 === 0;
          const copy = viaJson ? new Rig(JSON.parse(JSON.stringify(rig.s)) as PlayerState) : rig.fork();
          copy.seq = rig.seq;
          forks.push({ at: t, rig: copy, viaJson });
        }
        rig.tick(inputs[t].buttons, inputs[t].slot);
      }
      expect(forks.length, id).toBeGreaterThan(3);
      for (const fork of forks) {
        for (let t = fork.at; t < inputs.length; t++) fork.rig.tick(inputs[t].buttons, inputs[t].slot);
        expect(JSON.stringify(fork.rig.s), `${id} from tick ${fork.at}${fork.viaJson ? ' (JSON)' : ''}`).toBe(
          JSON.stringify(rig.s),
        );
      }
    }
  });
});

// --- Button mashing --------------------------------------------------------------------

describe('button mashing: invariants hold on every tick', () => {
  const SECONDS = 200;

  for (const id of WEAPON_IDS) {
    it(`${id}: ${SECONDS} simulated seconds of mashing, switching, freezing, dying`, () => {
      const chaos = new Chaos(id, 0xbeef + WEAPON_IDS.indexOf(id));
      const s = chaos.rig.s;
      const carried = s.slots.filter((slot) => slot !== null).map((slot) => WEAPONS[slot.id]);
      const maxPunchPitch = Math.max(...carried.map((w) => w.recoilMax));
      // The punch survives a switch (and decays through the draw): leave room for what is left of it.
      const maxPunchYaw = 1.25 * Math.max(...carried.map(yawBound));
      const maxDynamicSpread = Math.max(...carried.map((w) => w.spreadShotMax));

      const problems: string[] = [];
      const seen = { shots: 0, reloads: 0, switches: 0, zooms: 0, dry: 0, dead: 0, frozen: 0, acting: 0 };
      const lastShot = new Map<WeaponId, number>();
      let ammo = ammoOf(s);

      for (let t = 0; t < SECONDS * TICK_RATE; t++) {
        const { ev, before, buttons, respawned, refilled } = chaos.step();
        const check = (ok: boolean, what: string): void => {
          if (!ok && problems.length < 12) problems.push(`tick ${t}: ${what}`);
        };
        if (respawned || refilled) ammo = ammoOf(before);
        if (respawned) lastShot.clear();

        if (!before.alive) {
          seen.dead++;
          check(fingerprint(s) === fingerprint(before), 'a dead player changed');
          check(JSON.stringify(ev) === JSON.stringify(NO_EVENTS), 'a dead player raised an event');
          continue;
        }
        const locked = before.frozen || before.action !== ACTION.None;
        if (before.frozen) seen.frozen++;
        if (before.action !== ACTION.None) seen.acting++;
        const w = activeWeapon(s);
        const gun = s.slots[s.active];

        // Numbers: finite, in range, timers never negative.
        for (const key of NUMERIC_FIELDS) check(Number.isFinite(s[key]), `${key} = ${s[key]}`);
        check(s.fireCd >= 0 && s.fireCd <= w.fireInterval, `fireCd = ${s.fireCd}`);
        check(s.draw >= 0 && s.draw <= w.drawTime, `draw = ${s.draw}`);
        check(s.reload >= 0 && s.reload <= w.reloadTime, `reload = ${s.reload}`);
        check(!(s.reload > 0 && s.draw > 0), 'reloading while drawing');
        check(s.sinceShot >= 0 && s.sinceShot <= 10, `sinceShot = ${s.sinceShot}`);
        check(s.shots >= 0, `shots = ${s.shots}`);
        check(s.punchPitch >= 0 && s.punchPitch <= maxPunchPitch, `punchPitch = ${s.punchPitch}`);
        check(Math.abs(s.punchYaw) <= maxPunchYaw, `punchYaw = ${s.punchYaw}`);
        check(s.spread >= 0 && s.spread <= maxDynamicSpread, `spread = ${s.spread}`);
        const cone = currentSpread(s);
        check(cone >= 0 && cone <= staticSpreadCap(w) + s.spread + 1e-12, `currentSpread = ${cone}`);

        // Zoom: a level of the weapon in hands, never while it cannot be used.
        check(s.zoom === 0 || s.zoom === 1 || s.zoom === 2, `zoom = ${s.zoom}`);
        check(s.zoom === 0 || w.zoomFov !== undefined, `zoom ${s.zoom} on ${w.id}`);
        check(s.zoom === 0 || (s.reload === 0 && s.draw === 0), 'zoomed while drawing or reloading');
        check(ev.zoomChanged === (s.zoom !== before.zoom), 'zoomChanged does not match the zoom level');

        // Inventory: whole rounds, within capacity, never created.
        check(Number.isInteger(s.active) && gun != null, `active = ${s.active}`);
        s.slots.forEach((slot, i) => {
          if (!slot) return;
          const def = WEAPONS[slot.id];
          const was = before.slots[i]!;
          check(Number.isInteger(slot.clip) && slot.clip >= 0 && slot.clip <= def.clip, `${slot.id} clip = ${slot.clip}`);
          check(Number.isInteger(slot.reserve) && slot.reserve >= 0 && slot.reserve <= def.reserve, `${slot.id} reserve`);
          check(slot.clip + slot.reserve <= was.clip + was.reserve, `${slot.id} gained ammo`);
          check(slot.id === was.id, 'a weapon changed slot');
        });
        const now = ammoOf(s);
        const spent = ev.fired && w.kind !== 'melee' ? 1 : 0;
        check(now === ammo - spent, `total ammo ${ammo} -> ${now}, shot=${ev.fired !== null}`);
        ammo = now;

        // Spawn protection is given up by a shot and by nothing else.
        check(s.protect === (ev.fired ? 0 : before.protect), `protect ${before.protect} -> ${s.protect}`);

        // Events.
        if (ev.fired) {
          seen.shots++;
          check(!locked, 'fired while frozen or acting');
          check(!ev.switched && !ev.reloadStarted && !ev.dryFire, 'fired with a conflicting event');
          check(s.active === before.active && before.draw <= TICK_DT + 1e-9, 'fired while drawing');
          check(before.reload <= TICK_DT + 1e-9 && s.reload === 0 && s.draw === 0, 'fired while reloading');
          check(before.fireCd <= TICK_DT + 1e-9, `fired with ${before.fireCd} s of cooldown left`);
          check(ev.fired.weapon === w.id, `fired ${ev.fired.weapon} with ${w.id} in hands`);
          check(ev.fired.dirs.length === (w.kind === 'melee' ? 1 : w.pellets), 'pellet count');
          check(ev.fired.dirs.every(isUnit), 'direction not a finite unit vector');
          check(JSON.stringify(ev.fired.origin) === JSON.stringify(eyePosition(before)), 'origin is not the eye');
          check(s.fireCd > w.fireInterval - TICK_DT && s.sinceShot === 0, 'shot bookkeeping');
          check(s.shots >= 1, 'recoil index not advanced');
          const last = lastShot.get(w.id);
          if (last !== undefined) {
            check(t - last > w.fireInterval * TICK_RATE - 1 - 1e-6, `${w.id} fired again after ${t - last} ticks`);
          }
          lastShot.set(w.id, t);
        }
        if (ev.switched) {
          seen.switches++;
          check(s.active !== before.active, 'switched to the same slot');
          check(before.action === ACTION.None, 'switched during an action');
          check(s.draw === w.drawTime && s.reload === 0 && s.fireCd === 0, 'timers after a switch');
          check(s.zoom === 0 && s.shots === 0, 'zoom or recoil index kept through a switch');
        } else {
          check(s.active === before.active, 'active slot changed without an event');
        }
        if (ev.reloadStarted) {
          check(s.reload === w.reloadTime && before.reload === 0, 'reload timer at start');
          check(gun != null && gun.clip < w.clip && gun.reserve > 0, 'pointless reload');
          check(!ev.reloadFinished, 'reload started and finished on the same tick');
          check(!locked || (gun != null && gun.clip === 0), 'manual reload while frozen or acting');
        }
        if (ev.reloadFinished) {
          seen.reloads++;
          check(before.reload > 0 && s.reload === 0, 'reload timer at the end');
        } else {
          check(s.reload === 0 || s.reload < before.reload || ev.reloadStarted, 'reload timer not counting down');
        }
        if (ev.dryFire) {
          seen.dry++;
          check(!locked && gun != null && gun.clip === 0 && gun.reserve === 0, 'dry fire with ammo left');
          check((buttons & BTN.Fire & ~before.prevButtons) !== 0, 'dry fire without a new press');
        }
        if (ev.zoomChanged) seen.zooms++;
        if (locked) {
          check(!ev.dryFire && (s.zoom === before.zoom || s.zoom === 0), 'trigger or zoom obeyed while locked');
        }
        if ((buttons & LOCKED) === 0 && before.action === ACTION.None && !ev.switched) {
          check(!ev.fired && !ev.dryFire && s.zoom <= before.zoom, 'acted without any button');
        }
      }

      expect(problems).toEqual([]);
      // The run really went everywhere.
      expect(seen.shots).toBeGreaterThan(30);
      expect(seen.switches).toBeGreaterThan(30);
      if (WEAPONS[id].kind !== 'melee') {
        // (With the knife as the weapon under test, firearms are rarely held long enough.)
        expect(seen.reloads).toBeGreaterThan(2);
        expect(seen.dry).toBeGreaterThan(0);
      }
      expect(seen.dead).toBeGreaterThan(0);
      expect(seen.frozen).toBeGreaterThan(0);
      expect(seen.acting).toBeGreaterThan(0);
      if (WEAPONS[id].zoomFov) expect(seen.zooms).toBeGreaterThan(10);
    });
  }
});

// --- Differential test -----------------------------------------------------------------

interface ModelEvents {
  fired: WeaponId | null;
  dryFire: boolean;
  reloadStarted: boolean;
  reloadFinished: boolean;
  switched: boolean;
  zoomChanged: boolean;
}

/**
 * Independent statement of the discrete rules of ARCHITECTURE §6: inventory,
 * ammo, zoom level, events, and the tick on which each timer ends. It counts
 * whole ticks and absolute time instead of counting timers down, so an
 * off-by-one in the real machine cannot hide behind identical arithmetic.
 */
class TickModel {
  readonly slots: (WeaponSlotState | null)[];
  active: number;
  zoom = 0;
  prevButtons: number;
  /** Ticks simulated while alive. */
  private now = 0;
  /** Tick on which the weapon in hands becomes usable. */
  private drawEnd = 0;
  /** Tick on which the reload in progress completes, -1 when not reloading. */
  private reloadEnd = -1;
  /** Time (seconds) from which the next shot is allowed. */
  private readyAt = -Infinity;

  /** Start from a rested player (no timer running). */
  constructor(s: PlayerState) {
    this.slots = s.slots.map((slot) => (slot ? { ...slot } : null));
    this.active = s.active;
    this.prevButtons = s.prevButtons;
  }

  /** Ammo changed behind the machine's back (top-up). */
  resupply(s: PlayerState): void {
    s.slots.forEach((slot, i) => {
      this.slots[i] = slot ? { ...slot } : null;
    });
  }

  step(raw: number, request: number, alive: boolean, frozen: boolean, acting: boolean): ModelEvents {
    const out: ModelEvents = {
      fired: null,
      dryFire: false,
      reloadStarted: false,
      reloadFinished: false,
      switched: false,
      zoomChanged: false,
    };
    const prev = this.prevButtons;
    this.prevButtons = raw;
    if (!alive) return out;
    const now = ++this.now;
    const buttons = frozen || acting ? raw & ~LOCKED : raw;
    const pressed = buttons & ~prev;
    const unzoom = (): void => {
      if (this.zoom !== 0) out.zoomChanged = true;
      this.zoom = 0;
    };

    let gun = this.slots[this.active] ?? null;
    let w = gun ? WEAPONS[gun.id] : WEAPONS.knife;

    if (this.reloadEnd === now && gun) {
      const moved = Math.min(w.clip - gun.clip, gun.reserve);
      gun.clip += moved;
      gun.reserve -= moved;
      out.reloadFinished = true;
      this.reloadEnd = -1;
    }

    const target = Number.isInteger(request) && request >= 0 ? this.slots[request] : null;
    if (target && request !== this.active && !acting) {
      this.active = request;
      gun = target;
      w = WEAPONS[gun.id];
      this.drawEnd = now + ticksFor(w.drawTime);
      this.reloadEnd = -1;
      this.readyAt = -Infinity;
      unzoom();
      out.switched = true;
    }
    const drawing = now < this.drawEnd;

    const wanted = (buttons & BTN.Reload) !== 0 || (gun !== null && gun.clip === 0);
    if (gun && this.reloadEnd < 0 && !drawing && gun.clip < w.clip && gun.reserve > 0 && wanted) {
      unzoom();
      out.reloadStarted = true;
      this.reloadEnd = now + ticksFor(w.reloadTime);
    }
    const reloading = this.reloadEnd >= 0;

    if (!w.zoomFov) {
      unzoom();
    } else if ((pressed & BTN.AltFire) !== 0 && !drawing && !reloading) {
      this.zoom = (this.zoom + 1) % 3;
      out.zoomChanged = true;
    }

    const time = now * TICK_DT;
    if ((buttons & BTN.Fire) !== 0 && time >= this.readyAt - 1e-9 && !drawing && !reloading) {
      const trigger = w.auto || (pressed & BTN.Fire) !== 0;
      let shoot = false;
      if (w.kind === 'melee') {
        shoot = trigger;
      } else if (gun && gun.clip > 0) {
        if (trigger) {
          gun.clip--;
          shoot = true;
        }
      } else if ((pressed & BTN.Fire) !== 0) {
        out.dryFire = true;
      }
      if (shoot) {
        out.fired = w.id;
        // A shot that leaves on the first tick it could counts from the moment it was due.
        const onTime = time - TICK_DT < this.readyAt - 1e-9;
        this.readyAt = (onTime ? this.readyAt : time) + w.fireInterval;
      }
    }
    return out;
  }
}

describe('differential: the machine agrees with an independent model of the rules', () => {
  for (const id of WEAPON_IDS) {
    it(`${id}: 200 simulated seconds, compared on every tick`, () => {
      const chaos = new Chaos(id, 0xd1ff + WEAPON_IDS.indexOf(id));
      const s = chaos.rig.s;
      let model = new TickModel(s);
      const fired = { real: 0, model: 0 };
      for (let t = 0; t < 200 * TICK_RATE; t++) {
        // World events are applied by chaos.step() before the command: read them from `before`.
        const { ev, before, buttons, slot, respawned, refilled } = chaos.step();
        if (respawned) model = new TickModel(before);
        else if (refilled) model.resupply(before);
        const expected = model.step(buttons, slot, before.alive, before.frozen, before.action !== ACTION.None);

        const real = {
          events: {
            fired: ev.fired ? ev.fired.weapon : null,
            dryFire: ev.dryFire,
            reloadStarted: ev.reloadStarted,
            reloadFinished: ev.reloadFinished,
            switched: ev.switched,
            zoomChanged: ev.zoomChanged,
          },
          active: s.active,
          zoom: s.zoom,
          slots: s.slots,
        };
        const want = { events: expected, active: model.active, zoom: model.zoom, slots: model.slots };
        if (ev.fired) fired.real++;
        if (expected.fired) fired.model++;
        if (JSON.stringify(real) !== JSON.stringify(want)) {
          throw new Error(
            `${id}, tick ${t} (buttons ${buttons}, slot ${slot}):\n  machine ${JSON.stringify(real)}\n  model   ${JSON.stringify(want)}`,
          );
        }
      }
      expect(fired.real).toBe(fired.model);
      expect(fired.real).toBeGreaterThan(30);
    });
  }
});

// --- Designer's audit ------------------------------------------------------------------

describe('gunplay audit', () => {
  const pad = (v: string | number, n: number): string => String(v).padStart(n);

  /** Shots to kill a 100 HP / 100 armour target (ARCHITECTURE §7), every pellet on the same hit group. */
  function shotsToKill(w: WeaponDef, mul: number, metres: number, armoured = true): number {
    const perPellet = w.damage * mul * w.falloff ** (metres / 10);
    let health = MAX_HEALTH;
    let armor = armoured ? MAX_ARMOR : 0;
    let shots = 0;
    while (health > 1e-9 && shots < 200) {
      shots++;
      for (let p = 0; p < w.pellets; p++) {
        const toHealth = armor > 0 ? perPellet * w.armorPen : perPellet;
        health -= toHealth;
        armor -= (perPellet - toHealth) / 2;
      }
    }
    return shots;
  }

  /** View punch and cone at the moment each of the first `count` bullets of a held burst leaves. */
  function spray(id: WeaponId, count: number): { up: number; right: number; cone: number }[] {
    const rig = Rig.with(id).bottomless();
    const out: { up: number; right: number; cone: number }[] = [];
    while (out.length < count) {
      const leaving = { up: rig.s.punchPitch, right: 0 - rig.s.punchYaw, cone: currentSpread(rig.s) }; // positive yaw is left
      if (rig.tick(BTN.Fire).fired) out.push(leaving);
    }
    return out;
  }

  it('prints the time-to-kill table (armoured target, body and head, by range)', () => {
    const ranges = [0, 10, 20, 30];
    const lines = [
      '',
      'Time to kill a 100 HP / 100 armour target at the maximum rate of fire, every bullet on target.',
      'Each cell: shots to kill / seconds = (shots - 1) x fireInterval. Shotgun: all pellets hit.',
      '',
      `${'weapon'.padEnd(10)}${ranges.map((r) => pad(`body ${r} m`, 13)).join('')}${ranges.map((r) => pad(`head ${r} m`, 13)).join('')}${pad('no armour', 13)}`,
    ];
    for (const id of WEAPON_IDS) {
      const w = WEAPONS[id];
      const cell = (mul: number, metres: number, armoured = true): string => {
        if (metres > w.range) return pad('-', 13);
        const n = shotsToKill(w, mul, metres, armoured);
        expect(n, id).toBeLessThan(200);
        return pad(`${n} / ${((n - 1) * w.fireInterval).toFixed(2)}`, 13);
      };
      lines.push(
        `${id.padEnd(10)}${ranges.map((r) => cell(1, r)).join('')}${ranges.map((r) => cell(w.headMul, r)).join('')}${cell(1, 0, false)}`,
      );
      // A headshot is never worse than a body shot, armour never helps the shooter.
      expect(shotsToKill(w, w.headMul, 0), id).toBeLessThanOrEqual(shotsToKill(w, 1, 0));
      expect(shotsToKill(w, 1, 0, false), id).toBeLessThanOrEqual(shotsToKill(w, 1, 0));
    }
    console.log(lines.join('\n'));
  });

  it('prints the spray pattern of both rifles and the SMG', () => {
    const lines = [
      '',
      'Spray patterns: trigger held, standing still. Where each bullet is aimed relative to the',
      'crosshair (view punch when it leaves, degrees): up / right. "cone" = random spread around it.',
    ];
    for (const id of ['rifle_ak', 'rifle_m4', 'smg'] as WeaponId[]) {
      const w = WEAPONS[id];
      const shots = spray(id, 30);
      const tail = shots.slice(10);
      const plateau = tail.reduce((sum, shot) => sum + shot.up, 0) / tail.length;
      const reach = shots.findIndex((shot) => shot.up >= 0.9 * plateau) + 1;
      const sway = shots.slice(3).map((shot) => shot.right);
      // What a player holding a steady pull-down equal to the plateau still has to live with.
      const residual = Math.max(...shots.slice(reach).map((shot) => Math.abs(shot.up - plateau)));
      lines.push(
        '',
        `${id} (${w.name}): climbs for ${reach} bullets to ${(plateau * R2D).toFixed(2)} deg (cap recoilMax = ${(w.recoilMax * R2D).toFixed(1)} deg),`,
        `  then sways between ${(Math.min(...sway) * R2D).toFixed(2)} and +${(Math.max(...sway) * R2D).toFixed(2)} deg; cone ${(shots[0].cone * R2D).toFixed(2)} -> ${(shots[20].cone * R2D).toFixed(2)} deg.`,
        `  At 20 m: ${(20 * Math.tan(plateau) * 100).toFixed(0)} cm above the crosshair, +/-${(20 * Math.tan(Math.max(...sway.map(Math.abs))) * 100).toFixed(0)} cm sideways, cone radius ${(20 * Math.tan(shots[20].cone) * 100).toFixed(0)} cm.`,
        `  With a steady pull-down of ${(plateau * R2D).toFixed(2)} deg the vertical error stays within ${(residual * R2D).toFixed(2)} deg.`,
        `  bullet  ${shots.slice(0, 12).map((_, i) => pad(i + 1, 6)).join('')}`,
        `  up      ${shots.slice(0, 12).map((shot) => pad((shot.up * R2D).toFixed(2), 6)).join('')}`,
        `  right   ${shots.slice(0, 12).map((shot) => pad((shot.right * R2D).toFixed(2), 6)).join('')}`,
      );

      // Shape: the first bullet is on the crosshair, the next ones climb, then the
      // pattern weaves to both sides without ever passing the cap.
      expect(shots[0].up, id).toBe(0);
      expect(shots[0].right, id).toBe(0);
      expect(shots[1].up, id).toBeGreaterThan(0);
      expect(shots[2].up, id).toBeGreaterThan(shots[1].up);
      // The sideways sway fades in: the second bullet goes almost straight up (jitter only).
      expect(Math.abs(shots[1].right), id).toBeLessThanOrEqual(w.recoilJitter);
      expect(Math.min(...sway), id).toBeLessThan(0);
      expect(Math.max(...sway), id).toBeGreaterThan(0);
      expect(Math.max(...shots.map((shot) => shot.up)), id).toBeLessThanOrEqual(w.recoilMax);
    }
    console.log(lines.join('\n'));
  });

  it('prints first-shot accuracy at 20 m and the recovery times', () => {
    const HEAD = 0.12; // radius of a head-sized target, metres
    const CHEST = 0.25;
    const lines = [
      '',
      'First shot at 20 m: cone radius in cm (chance to hit a head-sized / chest-sized target aimed dead centre;',
      'per pellet for the shotgun).',
      '',
      `${'weapon'.padEnd(10)}${['crouched', 'standing', 'walking', 'running', 'jumping'].map((h) => pad(h, 20)).join('')}`,
    ];
    const recovery = [
      '',
      'Recovery after one shot / after a 10-round burst (automatics):',
      '  "view" = seconds until the view punch is under 0.1 deg, "cone" = until the inaccuracy is back within 10 % of rest,',
      '  "index" = until the recoil pattern restarts from its first shot.',
      '',
      `${'weapon'.padEnd(10)}${pad('kick deg', 10)}${pad('view', 8)}${pad('cone', 8)}${pad('burst: view', 14)}${pad('cone', 8)}${pad('index', 8)}`,
    ];
    for (const id of FIREARMS) {
      const w = WEAPONS[id];
      const top = MOVE.runSpeed * w.moveSpeed;
      const coneAt = (speed: number, crouch: number, onGround: boolean): number => {
        const s = playerWith(id);
        s.vel.x = speed;
        s.crouch = crouch;
        s.onGround = onGround;
        return currentSpread(s);
      };
      // crouched, standing, walking (silent walk), running, jumping
      const cones = [
        coneAt(0, 1, true),
        coneAt(0, 0, true),
        coneAt(top * MOVE.walkMul, 0, true),
        coneAt(top, 0, true),
        coneAt(top, 0, false),
      ];
      const cell = (cone: number): string => {
        const radius = 20 * Math.tan(cone);
        const chance = (target: number): string => `${Math.round(Math.min(1, (target / radius) ** 2) * 100)}%`;
        return pad(`${(radius * 100).toFixed(0)} (${chance(HEAD)} / ${chance(CHEST)})`, 20);
      };
      lines.push(`${id.padEnd(10)}${cones.map(cell).join('')}`);
      if (w.zoomFov) {
        const scoped = playerWith(id);
        scoped.zoom = 1;
        const radius = 20 * Math.tan(currentSpread(scoped));
        lines.push(`${''.padEnd(10)}  through the scope, standing: ${(radius * 100).toFixed(1)} cm`);
        expect(radius, id).toBeLessThan(HEAD); // a scoped shot goes where the crosshair is
      }
      // Stopping must pay: running is never as accurate as standing, crouching never worse.
      expect(cones[3], id).toBeGreaterThan(cones[1]);
      expect(cones[0], id).toBeLessThanOrEqual(cones[1]);
      expect(cones[4], id).toBeGreaterThan(cones[3]);

      const settle = (shots: number): { view: number; cone: number; index: number } => {
        const rig = Rig.with(id).bottomless();
        let fired = 0;
        while (fired < shots) {
          const click = w.auto || (rig.s.prevButtons === 0 && rig.s.fireCd <= TICK_DT);
          if (rig.tick(click ? BTN.Fire : 0).fired) fired++;
        }
        const out = { view: -1, cone: -1, index: -1 };
        for (let t = 1; t <= 10 * TICK_RATE; t++) {
          rig.tick(0);
          if (out.view < 0 && rig.s.punchPitch < 0.1 / R2D && Math.abs(rig.s.punchYaw) < 0.1 / R2D) out.view = t * TICK_DT;
          if (out.cone < 0 && currentSpread(rig.s) <= w.spread * 1.1) out.cone = t * TICK_DT;
          if (out.index < 0 && rig.s.shots === 0) out.index = t * TICK_DT;
        }
        for (const v of Object.values(out)) expect(v, id).toBeGreaterThan(0); // everything recovers
        return out;
      };
      const one = settle(1);
      const burst = w.auto ? settle(10) : null;
      recovery.push(
        `${id.padEnd(10)}${pad((w.recoilUp * R2D).toFixed(2), 10)}${pad(one.view.toFixed(2), 8)}${pad(one.cone.toFixed(2), 8)}` +
          (burst ? `${pad(burst.view.toFixed(2), 14)}${pad(burst.cone.toFixed(2), 8)}${pad(burst.index.toFixed(2), 8)}` : ''),
      );
    }
    console.log([...lines, ...recovery].join('\n'));
  });
});
