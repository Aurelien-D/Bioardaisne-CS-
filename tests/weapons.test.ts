/**
 * Weapon state machine (src/shared/weapons/logic.ts).
 *
 * stepWeapons is driven directly, the way stepPlayer drives it: one command per
 * tick, `prevButtons` updated after the call. Movement is not involved.
 *
 * Expected values are derived from weapons/defs.ts wherever possible, so the
 * tests check the logic and survive balance changes.
 *
 * The last block prints a gunplay report (damage table, accuracy table, spray
 * pattern). Vitest's default reporter shows it; if your reporter hides the
 * output of passing tests, run with `--reporter=default` or `--silent=false`.
 */
import { describe, expect, it } from 'vitest';
import {
  ACTION,
  BTN,
  EYE_TOP_OFFSET,
  MAX_ARMOR,
  MAX_HEALTH,
  MOVE,
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HEIGHT,
  SLOT,
  SLOT_COUNT,
  TICK_DT,
  TICK_RATE,
} from '../src/shared/constants';
import { cross, dot, forwardFromAngles, length, rightFlat, type Vec3 } from '../src/shared/math/vec3';
import { clonePlayerState, createPlayerState, eyePosition, newStepEvents } from '../src/shared/player/step';
import type { PlayerState, StepEvents, UserCmd, WeaponSlotState } from '../src/shared/types';
import {
  DEFAULT_LOADOUT,
  WEAPONS,
  WEAPON_IDS,
  type Loadout,
  type WeaponDef,
  type WeaponId,
} from '../src/shared/weapons/defs';
import { activeWeapon, createSlots, currentSpread, shotSeed, stepWeapons } from '../src/shared/weapons/logic';

type Shot = NonNullable<StepEvents['fired']>;

const R2D = 180 / Math.PI;
const FIREARMS = WEAPON_IDS.filter((id) => WEAPONS[id].kind === 'hitscan');
const AUTOMATICS = FIREARMS.filter((id) => WEAPONS[id].auto);
const SEMI_AUTOMATICS = FIREARMS.filter((id) => !WEAPONS[id].auto);
/** Long enough for any view punch / inaccuracy to recover completely. */
const RECOVERY_TICKS = 10 * TICK_RATE;

/** Number of ticks a timer of `seconds` blocks for. */
const ticksFor = (seconds: number): number => Math.ceil(seconds * TICK_RATE - 1e-9);

/** Shots delivered in `ticks` ticks at the maximum rate: one on tick 0, then one per fireInterval. */
const shotsIn = (w: WeaponDef, ticks: number): number =>
  1 + Math.floor(((ticks - 1) * TICK_DT) / w.fireInterval + 1e-9);

/** Exponential recovery factor over `ticks` ticks. */
const decay = (rate: number, ticks = 1): number => Math.exp(-rate * TICK_DT) ** ticks;

/** Angle (radians) between two unit vectors. */
const angleBetween = (a: Vec3, b: Vec3): number => Math.atan2(length(cross(a, b)), dot(a, b));

/** A player standing still on the ground with `weapon` in hands, ready to fire. */
function playerWith(weapon: WeaponId): PlayerState {
  const def = WEAPONS[weapon];
  const loadout: Loadout = {
    primary: def.slot === SLOT.Primary ? weapon : DEFAULT_LOADOUT.primary,
    secondary: def.slot === SLOT.Secondary ? weapon : DEFAULT_LOADOUT.secondary,
  };
  const s = createPlayerState({ x: 0, y: 0, z: 0 }, 0, loadout);
  s.onGround = true;
  s.active = def.slot;
  return s;
}

/** Drives one player through stepWeapons exactly like stepPlayer does. */
class Rig {
  readonly s: PlayerState;
  seq = 0;

  constructor(weapon: WeaponId = 'rifle_ak') {
    this.s = playerWith(weapon);
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
    stepWeapons(this.s, cmd, ev);
    this.s.prevButtons = buttons;
    return ev;
  }

  /** Hold `buttons` for `ticks` ticks; returns the number of shots fired. */
  hold(buttons: number, ticks: number): number {
    let shots = 0;
    for (let i = 0; i < ticks; i++) if (this.tick(buttons).fired) shots++;
    return shots;
  }

  /** Tick with `buttons` until `done(ev)`; returns how many ticks it took (1 = the very next tick). */
  until(done: (ev: StepEvents) => boolean, buttons = 0, limit = 5000): number {
    for (let n = 1; n <= limit; n++) if (done(this.tick(buttons))) return n;
    throw new Error(`condition not reached within ${limit} ticks`);
  }

  /**
   * Trigger input for the highest possible rate of fire: held for automatic
   * weapons; for semi-automatic ones a perfectly timed click (released, then
   * pressed on the exact tick the cooldown expires).
   */
  bestTrigger(): number {
    if (this.def.auto) return BTN.Fire;
    const ready = this.s.fireCd - TICK_DT <= 1e-9;
    return ready && (this.s.prevButtons & BTN.Fire) === 0 ? BTN.Fire : 0;
  }

  /** Fire `count` shots as fast as the weapon allows. */
  burst(count: number, limit = 5000): Shot[] {
    const out: Shot[] = [];
    for (let n = 0; n < limit && out.length < count; n++) {
      const ev = this.tick(this.bestTrigger());
      if (ev.fired) out.push(ev.fired);
    }
    if (out.length < count) throw new Error(`only ${out.length}/${count} shots fired`);
    return out;
  }
}

/** One shot from a copy of `s` with a given command sequence number; `s` itself is left untouched. */
function shootCopy(s: PlayerState, seq: number): { shot: Shot; after: PlayerState } {
  const after = clonePlayerState(s);
  const ev = newStepEvents();
  stepWeapons(after, { seq, buttons: BTN.Fire, yaw: after.yaw, pitch: after.pitch, slot: -1, st: 0 }, ev);
  if (!ev.fired) throw new Error('no shot fired');
  return { shot: ev.fired, after };
}

const dirsOf = (s: PlayerState, seq: number): Vec3[] => shootCopy(s, seq).shot.dirs;

describe('inventory', () => {
  it('createSlots gives primary, secondary and knife with full ammo', () => {
    const full = (id: WeaponId): WeaponSlotState => ({ id, clip: WEAPONS[id].clip, reserve: WEAPONS[id].reserve });
    for (const primary of WEAPON_IDS.filter((id) => WEAPONS[id].slot === SLOT.Primary)) {
      for (const secondary of WEAPON_IDS.filter((id) => WEAPONS[id].slot === SLOT.Secondary)) {
        const slots = createSlots({ primary, secondary });
        expect(slots).toHaveLength(SLOT_COUNT);
        expect(slots[SLOT.Primary]).toEqual(full(primary));
        expect(slots[SLOT.Secondary]).toEqual(full(secondary));
        expect(slots[SLOT.Melee]).toEqual(full('knife'));
      }
    }
  });

  it('createSlots returns independent objects on every call', () => {
    const a = createSlots(DEFAULT_LOADOUT);
    const b = createSlots(DEFAULT_LOADOUT);
    expect(a).toEqual(b);
    a[SLOT.Primary]!.clip = 0;
    a[SLOT.Melee] = null;
    expect(b[SLOT.Primary]!.clip).toBe(WEAPONS[DEFAULT_LOADOUT.primary].clip);
    expect(b[SLOT.Melee]).not.toBeNull();
  });

  it('createSlots falls back to the default loadout for weapons that do not fit the slot', () => {
    const cases = [
      { primary: 'pistol', secondary: 'nope' },
      { primary: 'knife', secondary: 'rifle_ak' },
      {},
    ] as unknown as Loadout[];
    for (const bad of cases) {
      const slots = createSlots(bad);
      expect(slots[SLOT.Primary]!.id).toBe(DEFAULT_LOADOUT.primary);
      expect(slots[SLOT.Secondary]!.id).toBe(DEFAULT_LOADOUT.secondary);
      expect(slots[SLOT.Melee]!.id).toBe('knife');
    }
  });

  it('activeWeapon follows the active slot and falls back to the knife', () => {
    const s = playerWith('rifle_ak');
    expect(activeWeapon(s)).toBe(WEAPONS.rifle_ak);
    s.active = SLOT.Secondary;
    expect(activeWeapon(s)).toBe(WEAPONS[DEFAULT_LOADOUT.secondary]);
    s.active = SLOT.Melee;
    expect(activeWeapon(s)).toBe(WEAPONS.knife);
    s.slots[SLOT.Primary] = null;
    s.active = SLOT.Primary;
    expect(activeWeapon(s)).toBe(WEAPONS.knife);
    s.active = 7;
    expect(activeWeapon(s)).toBe(WEAPONS.knife);
  });
});

describe('rate of fire', () => {
  for (const id of WEAPON_IDS) {
    const w = WEAPONS[id];
    it(`${id}: ${(60 / w.fireInterval).toFixed(0)} rounds per minute`, () => {
      const rig = new Rig(id);
      rig.gun.clip = 999; // no reload in the way
      let shots = 0;
      for (let t = 0; t < 2 * TICK_RATE; t++) if (rig.tick(rig.bestTrigger()).fired) shots++;
      expect(Math.abs(shots - 2 / w.fireInterval)).toBeLessThanOrEqual(1);
      // Exactly: each shot leaves on the first tick at or after the moment it is due.
      expect(shots).toBe(shotsIn(w, 2 * TICK_RATE));
    });
  }

  it('keeps the exact average rate over a long burst (no rounding up to whole ticks)', () => {
    for (const id of AUTOMATICS) {
      const w = WEAPONS[id];
      const rig = new Rig(id);
      rig.gun.clip = 1e6;
      expect(rig.hold(BTN.Fire, 60 * TICK_RATE), id).toBe(shotsIn(w, 60 * TICK_RATE));
      expect(Math.abs(shotsIn(w, 60 * TICK_RATE) - 60 / w.fireInterval), id).toBeLessThanOrEqual(1);

      // Consecutive shots are floor or ceil of the ideal interval apart, never more.
      const ideal = w.fireInterval * TICK_RATE;
      const gaps = new Set<number>();
      let last = -1;
      for (let t = 0; t < 400; t++) {
        if (!rig.tick(BTN.Fire).fired) continue;
        if (last >= 0) gaps.add(t - last);
        last = t;
      }
      expect(gaps.size, id).toBeGreaterThan(0);
      for (const gap of gaps) expect([Math.floor(ideal + 1e-9), Math.ceil(ideal - 1e-9)], id).toContain(gap);
    }
  });

  it('automatic weapons keep firing while the trigger is held', () => {
    for (const id of AUTOMATICS) {
      const w = WEAPONS[id];
      const rig = new Rig(id);
      expect(rig.tick(BTN.Fire).fired, id).not.toBeNull();
      const expected = Math.min(shotsIn(w, TICK_RATE), w.clip);
      expect(expected, id).toBeGreaterThan(2);
      expect(1 + rig.hold(BTN.Fire, TICK_RATE - 1), id).toBe(expected);
      expect(rig.gun.clip, id).toBe(w.clip - expected);
    }
  });

  it('semi-automatic weapons need the trigger to be released and pressed again', () => {
    expect(SEMI_AUTOMATICS.length).toBeGreaterThan(0);
    for (const id of SEMI_AUTOMATICS) {
      const w = WEAPONS[id];
      const rig = new Rig(id);
      expect(rig.tick(BTN.Fire).fired, id).not.toBeNull();
      // Holding for much longer than the cooldown fires nothing more.
      expect(rig.hold(BTN.Fire, ticksFor(w.fireInterval) + 40), id).toBe(0);
      expect(rig.gun.clip, id).toBe(w.clip - 1);
      expect(rig.tick(0).fired, id).toBeNull();
      expect(rig.tick(BTN.Fire).fired, id).not.toBeNull();
      expect(rig.gun.clip, id).toBe(w.clip - 2);
    }
  });

  it('a click during the cooldown is not buffered', () => {
    for (const id of SEMI_AUTOMATICS) {
      const rig = new Rig(id);
      rig.tick(BTN.Fire);
      rig.tick(0);
      // Pressed too early, then kept down well past the end of the cooldown.
      expect(rig.hold(BTN.Fire, ticksFor(WEAPONS[id].fireInterval) + 20), id).toBe(0);
      expect(rig.s.fireCd, id).toBe(0);
      rig.tick(0);
      expect(rig.tick(BTN.Fire).fired, id).not.toBeNull();
    }
  });

  it('after a late click the cooldown is the plain fire interval', () => {
    for (const id of WEAPON_IDS) {
      const w = WEAPONS[id];
      const rig = new Rig(id);
      rig.tick(BTN.Fire);
      expect(rig.s.fireCd, id).toBe(w.fireInterval);
      rig.hold(0, ticksFor(w.fireInterval) + 5); // cooldown long gone
      expect(rig.s.fireCd, id).toBe(0);
      rig.tick(BTN.Fire);
      expect(rig.s.fireCd, id).toBe(w.fireInterval);
    }
  });
});

describe('ammo and reload', () => {
  it('each shot uses one round and leaves the reserve alone', () => {
    for (const id of FIREARMS) {
      const w = WEAPONS[id];
      const rig = new Rig(id);
      const n = Math.min(3, w.clip - 1);
      rig.burst(n);
      expect(rig.gun, id).toEqual({ id, clip: w.clip - n, reserve: w.reserve });
    }
  });

  it('reload moves the missing rounds from the reserve after reloadTime', () => {
    for (const id of FIREARMS) {
      const w = WEAPONS[id];
      const rig = new Rig(id);
      rig.gun.clip = 1;
      const start = rig.tick(BTN.Reload);
      expect(start.reloadStarted, id).toBe(true);
      expect(start.reloadFinished, id).toBe(false);
      expect(rig.s.reload, id).toBe(w.reloadTime);
      expect(rig.gun.clip, id).toBe(1); // nothing moves before the end
      const took = rig.until((ev) => ev.reloadFinished);
      expect(took, id).toBe(ticksFor(w.reloadTime));
      expect(rig.s.reload, id).toBe(0);
      const moved = Math.min(w.clip - 1, w.reserve);
      expect(rig.gun, id).toEqual({ id, clip: 1 + moved, reserve: w.reserve - moved });
    }
  });

  it('a partial reserve gives a partial clip', () => {
    const rig = new Rig('rifle_ak');
    rig.gun.clip = 1;
    rig.gun.reserve = 2;
    expect(rig.tick(BTN.Reload).reloadStarted).toBe(true);
    rig.until((ev) => ev.reloadFinished);
    expect(rig.gun).toEqual({ id: 'rifle_ak', clip: 3, reserve: 0 });
    // Nothing left: asking again does nothing.
    expect(rig.tick(0).reloadStarted).toBe(false);
    expect(rig.tick(BTN.Reload).reloadStarted).toBe(false);
    expect(rig.s.reload).toBe(0);
  });

  it('reload is ignored with a full clip, an empty reserve, or the knife', () => {
    const full = new Rig('rifle_ak');
    expect(full.tick(BTN.Reload).reloadStarted).toBe(false);
    expect(full.s.reload).toBe(0);

    const dry = new Rig('rifle_ak');
    dry.gun.clip = 1;
    dry.gun.reserve = 0;
    expect(dry.tick(BTN.Reload).reloadStarted).toBe(false);
    expect(dry.s.reload).toBe(0);

    const knife = new Rig('knife');
    expect(knife.tick(BTN.Reload).reloadStarted).toBe(false);
    expect(knife.s.reload).toBe(0);
  });

  it('holding the reload key reloads once', () => {
    const w = WEAPONS.pistol;
    const rig = new Rig('pistol');
    rig.gun.clip = w.clip - 1;
    let started = 0;
    let finished = 0;
    for (let t = 0; t < ticksFor(w.reloadTime) + 100; t++) {
      const ev = rig.tick(BTN.Reload);
      if (ev.reloadStarted) started++;
      if (ev.reloadFinished) finished++;
    }
    expect(started).toBe(1);
    expect(finished).toBe(1);
    expect(rig.gun).toEqual({ id: 'pistol', clip: w.clip, reserve: w.reserve - 1 });
  });

  it('reloads automatically when the clip runs empty', () => {
    for (const id of FIREARMS) {
      const w = WEAPONS[id];
      const rig = new Rig(id);
      rig.gun.clip = 1;
      const shot = rig.tick(BTN.Fire);
      expect(shot.fired, id).not.toBeNull();
      expect(shot.reloadStarted, id).toBe(false);
      expect(rig.gun.clip, id).toBe(0);
      const next = rig.tick(0); // no key pressed
      expect(next.reloadStarted, id).toBe(true);
      expect(next.dryFire, id).toBe(false);
      expect(rig.s.reload, id).toBe(w.reloadTime);
      rig.until((ev) => ev.reloadFinished);
      const moved = Math.min(w.clip, w.reserve);
      expect(rig.gun, id).toEqual({ id, clip: moved, reserve: w.reserve - moved });
    }
  });

  it('the automatic reload waits for the end of the draw', () => {
    const rig = new Rig('rifle_ak');
    rig.gun.clip = 0;
    rig.s.draw = 3 * TICK_DT;
    expect(rig.tick(0).reloadStarted).toBe(false);
    expect(rig.tick(BTN.Reload).reloadStarted).toBe(false);
    expect(rig.tick(0).reloadStarted).toBe(true); // third tick: the draw is over
  });

  it('an automatic weapon held down empties, reloads and resumes on its own', () => {
    for (const id of AUTOMATICS) {
      const w = WEAPONS[id];
      const rig = new Rig(id);
      const reloadsNeeded = Math.ceil(w.reserve / w.clip);
      const seconds = (w.clip + w.reserve) * w.fireInterval + reloadsNeeded * w.reloadTime + 5;
      let shots = 0;
      let reloads = 0;
      let dry = 0;
      for (let t = 0; t < seconds * TICK_RATE; t++) {
        const ev = rig.tick(BTN.Fire);
        if (ev.fired) shots++;
        if (ev.reloadFinished) reloads++;
        if (ev.dryFire) dry++;
      }
      expect(shots, id).toBe(w.clip + w.reserve); // every round was fired
      expect(reloads, id).toBe(reloadsNeeded);
      expect(rig.gun, id).toEqual({ id, clip: 0, reserve: 0 });
      expect(dry, id).toBe(0); // no click without a new press
      expect(rig.s.reload, id).toBe(0);
    }
  });

  it('the first shot leaves on the tick the reload ends', () => {
    const w = WEAPONS.rifle_ak;
    const rig = new Rig('rifle_ak');
    rig.gun.clip = 0;
    expect(rig.tick(BTN.Fire).reloadStarted).toBe(true);
    for (let n = 1; n < ticksFor(w.reloadTime); n++) {
      const ev = rig.tick(BTN.Fire);
      expect(ev.fired).toBeNull();
      expect(ev.reloadFinished).toBe(false);
    }
    const end = rig.tick(BTN.Fire);
    expect(end.reloadFinished).toBe(true);
    expect(end.fired).not.toBeNull();
    expect(rig.gun.clip).toBe(Math.min(w.clip, w.reserve) - 1);
  });
});

describe('when firing is not allowed', () => {
  it('not while the weapon is being drawn', () => {
    const rig = new Rig('rifle_ak');
    rig.s.draw = 0.5;
    expect(rig.hold(BTN.Fire, 31)).toBe(0);
    expect(rig.s.draw).toBeGreaterThan(0);
    expect(rig.tick(BTN.Fire).fired).not.toBeNull(); // 32 ticks = 0.5 s
    expect(rig.s.draw).toBe(0);
  });

  it('not while reloading', () => {
    const w = WEAPONS.rifle_ak;
    const rig = new Rig('rifle_ak');
    rig.gun.clip = 2;
    rig.tick(BTN.Reload);
    expect(rig.hold(BTN.Fire, ticksFor(w.reloadTime) - 1)).toBe(0);
    expect(rig.gun.clip).toBe(2);
    expect(rig.tick(BTN.Fire).fired).not.toBeNull();
  });

  it('not during freeze time, but weapons can be switched', () => {
    const rig = new Rig('sniper');
    rig.s.frozen = true;
    rig.gun.clip = 1;
    for (let t = 0; t < 40; t++) {
      const ev = rig.tick(t % 2 === 0 ? BTN.Fire | BTN.AltFire | BTN.Reload : 0);
      expect(ev).toEqual(newStepEvents());
    }
    expect(rig.gun.clip).toBe(1);
    expect(rig.s.zoom).toBe(0);
    expect(rig.s.reload).toBe(0);
    const ev = rig.tick(BTN.Fire, SLOT.Secondary);
    expect(ev.switched).toBe(true);
    expect(rig.s.active).toBe(SLOT.Secondary);

    // An automatic weapon held through the end of the freeze fires as soon as it is lifted...
    const auto = new Rig('rifle_ak');
    auto.s.frozen = true;
    expect(auto.hold(BTN.Fire, 20)).toBe(0);
    auto.s.frozen = false;
    expect(auto.tick(BTN.Fire).fired).not.toBeNull();
    // ...a semi-automatic one needs a new press.
    const semi = new Rig('pistol');
    semi.s.frozen = true;
    semi.hold(BTN.Fire, 20);
    semi.s.frozen = false;
    expect(semi.hold(BTN.Fire, 20)).toBe(0);
    semi.tick(0);
    expect(semi.tick(BTN.Fire).fired).not.toBeNull();
  });

  it('not during a timed action, and no switching either', () => {
    for (const action of [ACTION.Plant, ACTION.Defuse, ACTION.Secure]) {
      const rig = new Rig('rifle_ak');
      rig.s.action = action;
      rig.gun.clip = 2;
      expect(rig.hold(BTN.Fire | BTN.Reload | BTN.AltFire, 30)).toBe(0);
      expect(rig.gun.clip).toBe(2);
      expect(rig.s.reload).toBe(0);
      const ev = rig.tick(BTN.Fire, SLOT.Secondary);
      expect(ev).toEqual(newStepEvents());
      expect(rig.s.active).toBe(SLOT.Primary);
      rig.s.action = ACTION.None;
      expect(rig.tick(BTN.Fire).fired).not.toBeNull();
    }
  });

  it('not when dead', () => {
    const rig = new Rig('rifle_ak');
    rig.s.alive = false;
    const before = JSON.stringify(rig.s);
    const ev = rig.tick(BTN.Fire | BTN.Reload, SLOT.Secondary);
    expect(ev).toEqual(newStepEvents());
    rig.s.prevButtons = 0; // the only thing the rig itself changed
    expect(JSON.stringify(rig.s)).toBe(before);
  });
});

describe('weapon switching', () => {
  it('cancels the reload and applies the draw time of the new weapon', () => {
    const ak = WEAPONS.rifle_ak;
    const secondary = WEAPONS[DEFAULT_LOADOUT.secondary];
    const rig = new Rig('rifle_ak');
    rig.gun.clip = 1;
    rig.tick(BTN.Reload);
    rig.hold(0, 5);
    expect(rig.s.reload).toBeGreaterThan(0);

    const ev = rig.tick(0, SLOT.Secondary);
    expect(ev.switched).toBe(true);
    expect(ev.reloadFinished).toBe(false);
    expect(rig.s.active).toBe(SLOT.Secondary);
    expect(rig.s.reload).toBe(0);
    expect(rig.s.draw).toBe(secondary.drawTime);
    // The interrupted reload is lost: nothing was transferred.
    expect(rig.s.slots[SLOT.Primary]).toEqual({ id: 'rifle_ak', clip: 1, reserve: ak.reserve });

    // It does not finish in the background either, and the rifle must be drawn again.
    rig.hold(0, ticksFor(ak.reloadTime) + 50);
    expect(rig.s.slots[SLOT.Primary]).toEqual({ id: 'rifle_ak', clip: 1, reserve: ak.reserve });
    expect(rig.tick(0, SLOT.Primary).switched).toBe(true);
    expect(rig.s.draw).toBe(ak.drawTime);
    const took = rig.until((e) => e.fired !== null, BTN.Fire);
    expect(took).toBe(ticksFor(ak.drawTime));
  });

  it('a reload that ends on the tick of the switch still counts', () => {
    const w = WEAPONS.rifle_ak;
    const rig = new Rig('rifle_ak');
    rig.gun.clip = 1;
    rig.tick(BTN.Reload);
    rig.hold(0, ticksFor(w.reloadTime) - 1);
    const ev = rig.tick(0, SLOT.Melee);
    expect(ev.reloadFinished).toBe(true);
    expect(ev.switched).toBe(true);
    expect(rig.s.slots[SLOT.Primary]!.clip).toBe(Math.min(w.clip, 1 + w.reserve));
  });

  it('every weapon needs exactly its draw time before the first shot', () => {
    for (const id of WEAPON_IDS) {
      const w = WEAPONS[id];
      const rig = new Rig(id);
      rig.tick(0, w.slot === SLOT.Melee ? SLOT.Primary : SLOT.Melee);
      expect(rig.tick(0, w.slot).switched, id).toBe(true);
      expect(rig.s.draw, id).toBe(w.drawTime);
      const n = ticksFor(w.drawTime);
      expect(n, id).toBeGreaterThan(3);
      expect(rig.hold(0, n - 3), id).toBe(0);
      // A click before the draw is over does nothing; on the tick it ends, the weapon fires.
      expect(rig.tick(BTN.Fire).fired, id).toBeNull();
      expect(rig.tick(0).fired, id).toBeNull();
      expect(rig.s.draw, id).toBeGreaterThan(0);
      expect(rig.tick(BTN.Fire).fired?.weapon, id).toBe(id);
      expect(rig.s.draw, id).toBe(0);
    }
  });

  it('resets the recoil index and the zoom, and does not inherit the fire cooldown', () => {
    const secondary = WEAPONS[DEFAULT_LOADOUT.secondary];
    const rig = new Rig('sniper');
    rig.tick(BTN.AltFire);
    expect(rig.s.zoom).toBe(1);
    rig.tick(BTN.Fire);
    expect(rig.s.fireCd).toBe(WEAPONS.sniper.fireInterval);
    expect(rig.s.shots).toBe(1);

    const ev = rig.tick(0, SLOT.Secondary);
    expect(ev.switched).toBe(true);
    expect(ev.zoomChanged).toBe(true);
    expect(rig.s.zoom).toBe(0);
    expect(rig.s.shots).toBe(0);
    expect(rig.s.fireCd).toBe(0);
    // The sidearm is ready after its own draw time, whatever is left of the sniper's bolt cycle.
    rig.hold(0, ticksFor(secondary.drawTime) - 1);
    expect(rig.tick(BTN.Fire).fired?.weapon).toBe(secondary.id);
  });

  it('ignores the slot already in hands', () => {
    const rig = new Rig('rifle_ak');
    rig.gun.clip = 1;
    rig.tick(BTN.Reload);
    const reload = rig.s.reload;
    const ev = rig.tick(0, SLOT.Primary);
    expect(ev.switched).toBe(false);
    expect(rig.s.active).toBe(SLOT.Primary);
    expect(rig.s.draw).toBe(0);
    expect(rig.s.reload).toBeCloseTo(reload - TICK_DT, 12); // still reloading
  });

  it('ignores empty and invalid slots', () => {
    const rig = new Rig('pistol');
    rig.s.slots[SLOT.Primary] = null;
    for (const slot of [SLOT.Primary, -1, -2, 3, 99, 1.5, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const ev = rig.tick(0, slot);
      expect(ev.switched, String(slot)).toBe(false);
      expect(rig.s.active, String(slot)).toBe(SLOT.Secondary);
      expect(rig.s.draw, String(slot)).toBe(0);
    }
    expect(rig.tick(BTN.Fire).fired?.weapon).toBe('pistol');
  });

  it('can be chained without waiting for the draw to end', () => {
    const rig = new Rig('rifle_ak');
    expect(rig.tick(0, SLOT.Melee).switched).toBe(true);
    expect(rig.tick(0, SLOT.Secondary).switched).toBe(true);
    expect(rig.s.active).toBe(SLOT.Secondary);
    expect(rig.s.draw).toBe(WEAPONS[DEFAULT_LOADOUT.secondary].drawTime);
  });
});

describe('dry fire', () => {
  it('clicks once per press on a completely empty weapon', () => {
    for (const id of FIREARMS) {
      const rig = new Rig(id);
      rig.gun.clip = 0;
      rig.gun.reserve = 0;
      const first = rig.tick(BTN.Fire);
      expect(first.dryFire, id).toBe(true);
      expect(first.fired, id).toBeNull();
      expect(first.reloadStarted, id).toBe(false);
      for (let t = 0; t < 20; t++) expect(rig.tick(BTN.Fire).dryFire, id).toBe(false); // held: silent
      expect(rig.tick(0).dryFire, id).toBe(false);
      expect(rig.tick(BTN.Fire).dryFire, id).toBe(true);
      expect(rig.gun, id).toEqual({ id, clip: 0, reserve: 0 });
      expect(rig.s.shots, id).toBe(0);
      expect(rig.s.fireCd, id).toBe(0);
    }
  });

  it('does not click when the trigger is still held after the last round', () => {
    const rig = new Rig('rifle_ak');
    rig.gun.clip = 2;
    rig.gun.reserve = 0;
    let dry = 0;
    let shots = 0;
    for (let t = 0; t < 100; t++) {
      const ev = rig.tick(BTN.Fire);
      if (ev.dryFire) dry++;
      if (ev.fired) shots++;
    }
    expect(shots).toBe(2);
    expect(dry).toBe(0);
  });

  it('does not click while drawing or reloading', () => {
    const rig = new Rig('pistol');
    rig.gun.clip = 0; // reserve left: the reload starts instead
    const ev = rig.tick(BTN.Fire);
    expect(ev.dryFire).toBe(false);
    expect(ev.reloadStarted).toBe(true);
    rig.tick(0);
    expect(rig.tick(BTN.Fire).dryFire).toBe(false);

    const drawing = new Rig('pistol');
    drawing.gun.clip = 0;
    drawing.gun.reserve = 0;
    drawing.s.draw = 0.3;
    expect(drawing.tick(BTN.Fire).dryFire).toBe(false);
  });
});

describe('recoil', () => {
  it('kicks the view up by recoilUp and recovers to rest', () => {
    for (const id of FIREARMS) {
      const w = WEAPONS[id];
      const kick = Math.min(w.recoilUp, w.recoilMax);
      const rig = new Rig(id);
      rig.tick(BTN.Fire);
      // The shot adds the full kick; one tick of recovery has already been applied.
      expect(rig.s.punchPitch, id).toBeCloseTo(kick * decay(w.recoilRecovery), 12);
      expect(rig.s.punchPitch, id).toBeGreaterThan(0);
      rig.hold(0, 4);
      expect(rig.s.punchPitch, id).toBeCloseTo(kick * decay(w.recoilRecovery, 5), 12);
      rig.hold(0, RECOVERY_TICKS);
      expect(rig.s.punchPitch, id).toBe(0);
      expect(rig.s.punchYaw, id).toBe(0);
    }
  });

  it('accumulates over a burst, stays under recoilMax, then recovers', () => {
    for (const id of AUTOMATICS) {
      const w = WEAPONS[id];
      const rig = new Rig(id);
      const leaving: number[] = []; // punch at the moment each bullet leaves
      let peak = 0;
      for (let t = 0; leaving.length < 12; t++) {
        const punch = rig.s.punchPitch;
        if (rig.tick(BTN.Fire).fired) leaving.push(punch);
        peak = Math.max(peak, rig.s.punchPitch);
      }
      expect(leaving[0], id).toBe(0); // the first bullet goes exactly where the crosshair is
      expect(leaving[1], id).toBeGreaterThan(0);
      expect(leaving[2], id).toBeGreaterThan(leaving[1]);
      expect(Math.max(...leaving), id).toBeGreaterThan(leaving[2]);
      expect(peak, id).toBeGreaterThan(w.recoilUp); // more than any single kick
      expect(peak, id).toBeLessThanOrEqual(w.recoilMax);

      const afterBurst = rig.s.punchPitch;
      rig.hold(0, 4);
      expect(rig.s.punchPitch, id).toBeLessThan(afterBurst);
      expect(rig.s.punchPitch, id).toBeGreaterThan(0);
      rig.hold(0, RECOVERY_TICKS);
      expect(rig.s.punchPitch, id).toBe(0);
      expect(rig.s.punchYaw, id).toBe(0);
    }
  });

  it('the upward kick fades out near recoilMax and never passes it', () => {
    for (const id of FIREARMS) {
      const w = WEAPONS[id];
      const k = decay(w.recoilRecovery);
      // Kick actually applied by one shot fired with a given punch (the tick's recovery undone).
      const kickAt = (punch: number): number => {
        const s = playerWith(id);
        s.punchPitch = punch;
        return shootCopy(s, 1).after.punchPitch / k - punch;
      };
      expect(kickAt(0), id).toBeCloseTo(Math.min(w.recoilUp, w.recoilMax), 12);
      expect(kickAt(w.recoilMax * 0.5), id).toBeCloseTo(Math.min(w.recoilUp, w.recoilMax) * 0.5, 12);
      expect(kickAt(w.recoilMax * 0.9), id).toBeCloseTo(Math.min(w.recoilUp, w.recoilMax) * 0.1, 12);
      expect(kickAt(w.recoilMax), id).toBeCloseTo(0, 12);

      // Out-of-range punch (never produced by the machine itself) is brought back under the cap.
      const s = playerWith(id);
      s.punchPitch = w.recoilMax * 2;
      expect(shootCopy(s, 1).after.punchPitch, id).toBeLessThanOrEqual(w.recoilMax);
    }
  });

  it('sideways kick = fixed sway pattern indexed by the recent shots + seeded jitter', () => {
    // The formula of docs/ARCHITECTURE.md §6. Positive yaw is to the left.
    const sway = (w: WeaponDef, i: number): number => w.recoilSide * Math.sin(0.62 * i + 0.9) * Math.min(1, i / 3);
    for (const id of FIREARMS) {
      const w = WEAPONS[id];
      const k = decay(w.recoilRecovery);
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      let n = 0;
      for (let i = 0; i <= 14; i++) {
        for (let seq = 1; seq <= 20; seq++) {
          const s = playerWith(id);
          s.shots = i + (seq % 2 === 0 ? 0.6 : 0); // a decaying (fractional) index counts as its floor
          s.sinceShot = 0;
          const kick = shootCopy(s, seq + 100 * i).after.punchYaw / k;
          const jitter = (kick - sway(w, i)) / w.recoilJitter;
          expect(Math.abs(jitter), `${id} shot ${i}`).toBeLessThanOrEqual(1 + 1e-9);
          min = Math.min(min, jitter);
          max = Math.max(max, jitter);
          sum += jitter;
          n++;
        }
      }
      // The jitter covers its whole range and is centred.
      expect(min, id).toBeLessThan(-0.9);
      expect(max, id).toBeGreaterThan(0.9);
      expect(Math.abs(sum / n), id).toBeLessThan(0.15);
    }
    // The pattern itself: nothing on the first shot, then one way, then the other.
    expect(sway(WEAPONS.rifle_ak, 0)).toBe(0);
    expect(sway(WEAPONS.rifle_ak, 2)).toBeGreaterThan(0);
    expect(sway(WEAPONS.rifle_ak, 6)).toBeLessThan(0);
  });

  it('the recoil index counts shots, starts decaying after shotsResetDelay and reaches 0', () => {
    for (const id of WEAPON_IDS) {
      const w = WEAPONS[id];
      const rig = new Rig(id);
      rig.tick(BTN.Fire);
      expect(rig.s.shots, id).toBe(1);
      expect(rig.s.sinceShot, id).toBe(0);
      rig.s.shots = 4; // as if it had been the fourth shot of a burst
      // sinceShot must exceed the delay: that happens on tick floor(delay * 64) + 1.
      const quiet = Math.floor(w.shotsResetDelay * TICK_RATE + 1e-9);
      rig.hold(0, quiet);
      expect(rig.s.shots, id).toBe(4);
      rig.tick(0);
      expect(rig.s.shots, id).toBeCloseTo(4 - 12 * TICK_DT, 12);
      rig.hold(0, Math.ceil(4 / (12 * TICK_DT)));
      expect(rig.s.shots, id).toBe(0);
      rig.hold(0, 10);
      expect(rig.s.shots, id).toBe(0);
    }
  });

  it('a held burst advances the index by one per shot', () => {
    let checked = 0;
    for (const id of AUTOMATICS) {
      if (WEAPONS[id].fireInterval + TICK_DT > WEAPONS[id].shotsResetDelay) continue; // would decay in between
      const rig = new Rig(id);
      rig.burst(5);
      expect(rig.s.shots, id).toBe(5);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('tapping with pauses restarts the pattern from the first shot', () => {
    const w = WEAPONS.rifle_ak;
    const rig = new Rig('rifle_ak');
    for (let tap = 0; tap < 4; tap++) {
      expect(rig.tick(BTN.Fire).fired).not.toBeNull();
      expect(rig.s.shots).toBe(1); // the index was back to 0 before each tap
      rig.hold(0, ticksFor(Math.max(w.fireInterval, w.shotsResetDelay + 1 / 12)) + 2);
    }
  });

  it('sinceShot counts up from the last shot and stops at 10', () => {
    const rig = new Rig('pistol');
    rig.tick(BTN.Fire);
    expect(rig.s.sinceShot).toBe(0);
    rig.hold(0, 32);
    expect(rig.s.sinceShot).toBeCloseTo(0.5, 12);
    rig.hold(0, 11 * TICK_RATE);
    expect(rig.s.sinceShot).toBe(10);
  });
});

describe('inaccuracy', () => {
  /** Give the player a horizontal speed as a fraction of the weapon's top speed. */
  const setSpeed = (s: PlayerState, fraction: number): void => {
    const w = activeWeapon(s);
    const max = MOVE.runSpeed * w.moveSpeed * (s.zoom > 0 && w.zoomMoveMul ? w.zoomMoveMul : 1);
    s.vel.x = 0.6 * max * fraction;
    s.vel.z = -0.8 * max * fraction;
  };

  it('standing still is the base spread of the weapon', () => {
    for (const id of WEAPON_IDS) expect(currentSpread(playerWith(id)), id).toBe(WEAPONS[id].spread);
    expect(currentSpread(playerWith('knife'))).toBe(0);
  });

  it('shrinks when crouched on the ground', () => {
    for (const id of FIREARMS) {
      const w = WEAPONS[id];
      const s = playerWith(id);
      const standing = currentSpread(s);
      s.crouch = 0.5;
      const half = currentSpread(s);
      s.crouch = 1;
      const crouched = currentSpread(s);
      expect(crouched, id).toBeCloseTo(w.spread * w.spreadCrouchMul, 12);
      expect(half, id).toBeCloseTo((standing + crouched) / 2, 12);
      expect(crouched, id).toBeLessThan(half);
      expect(half, id).toBeLessThan(standing);
      // No crouch bonus in the air (crouch-jumping is not accurate).
      s.onGround = false;
      expect(currentSpread(s), id).toBeCloseTo(w.spread + w.spreadAir, 12);
    }
  });

  it('grows with speed above the crouch-walk speed, up to spreadMove at a full run', () => {
    for (const id of FIREARMS) {
      const w = WEAPONS[id];
      const s = playerWith(id);
      setSpeed(s, MOVE.crouchMul);
      expect(currentSpread(s), id).toBeCloseTo(w.spread, 12); // crouch-walking costs nothing
      setSpeed(s, MOVE.walkMul);
      const walking = currentSpread(s);
      // The formula of docs/ARCHITECTURE.md §6.
      const f = Math.min(1, Math.max(0, (MOVE.walkMul - 0.34) / 0.66));
      expect(walking, id).toBeCloseTo(w.spread + w.spreadMove * f, 12);
      setSpeed(s, 0.8);
      const jogging = currentSpread(s);
      expect(jogging, id).toBeCloseTo(w.spread + (w.spreadMove * (0.8 - 0.34)) / 0.66, 12);
      setSpeed(s, 1);
      const running = currentSpread(s);
      expect(running, id).toBeCloseTo(w.spread + w.spreadMove, 12);
      setSpeed(s, 1.6); // faster than the weapon allows (air-strafing): capped
      expect(currentSpread(s), id).toBeCloseTo(running, 12);
      expect(walking, id).toBeGreaterThan(w.spread);
      expect(jogging, id).toBeGreaterThan(walking);
      expect(running, id).toBeGreaterThan(jogging);
      // Vertical speed alone does not count as moving.
      s.vel = { x: 0, y: -9, z: 0 };
      expect(currentSpread(s), id).toBe(w.spread);
    }
  });

  it('grows when airborne', () => {
    for (const id of FIREARMS) {
      const w = WEAPONS[id];
      const s = playerWith(id);
      s.onGround = false;
      expect(currentSpread(s), id).toBeCloseTo(w.spread + w.spreadAir, 12);
      expect(currentSpread(s), id).toBeGreaterThan(w.spread);
      setSpeed(s, 1);
      expect(currentSpread(s), id).toBeCloseTo(w.spread + w.spreadAir + w.spreadMove, 12);
    }
  });

  it('grows with every shot up to spreadShotMax, then recovers', () => {
    for (const id of FIREARMS) {
      const w = WEAPONS[id];
      const k = decay(w.spreadRecovery);
      const rig = new Rig(id);
      rig.gun.clip = 999;
      const rest = currentSpread(rig.s);
      rig.tick(BTN.Fire);
      const afterOne = rig.s.spread;
      expect(afterOne, id).toBeCloseTo(Math.min(w.spreadShot, w.spreadShotMax) * k, 12);
      expect(afterOne, id).toBeGreaterThan(0);
      expect(currentSpread(rig.s), id).toBeCloseTo(rest + afterOne, 12);
      let peak = 0;
      for (let t = 0; t < 600; t++) {
        rig.tick(rig.bestTrigger());
        peak = Math.max(peak, rig.s.spread);
      }
      expect(peak, id).toBeGreaterThanOrEqual(afterOne);
      expect(peak, id).toBeLessThanOrEqual(w.spreadShotMax);
      rig.hold(0, RECOVERY_TICKS);
      expect(rig.s.spread, id).toBe(0);
      expect(currentSpread(rig.s), id).toBe(rest);

      // The cap itself.
      const s = playerWith(id);
      s.spread = w.spreadShotMax;
      expect(shootCopy(s, 1).after.spread, id).toBeCloseTo(w.spreadShotMax * k, 12);
    }
  });

  it('bullets use the spread of the moment they are fired', () => {
    const still = playerWith('rifle_ak');
    const running = playerWith('rifle_ak');
    setSpeed(running, 1);
    const aim = forwardFromAngles(0, 0);
    let worstStill = 0;
    let worstRunning = 0;
    for (let seq = 1; seq <= 300; seq++) {
      worstStill = Math.max(worstStill, angleBetween(dirsOf(still, seq)[0], aim));
      worstRunning = Math.max(worstRunning, angleBetween(dirsOf(running, seq)[0], aim));
    }
    expect(worstStill).toBeLessThanOrEqual(currentSpread(still) + 1e-12);
    expect(worstStill).toBeGreaterThan(currentSpread(still) * 0.9);
    expect(worstRunning).toBeLessThanOrEqual(currentSpread(running) + 1e-12);
    expect(worstRunning).toBeGreaterThan(currentSpread(running) * 0.9);
    expect(worstRunning).toBeGreaterThan(worstStill);
  });
});

describe('sniper zoom', () => {
  it('cycles 0 -> 1 -> 2 -> 0 on each press of alt-fire', () => {
    const rig = new Rig('sniper');
    const levels: number[] = [];
    for (let press = 0; press < 7; press++) {
      const down = rig.tick(BTN.AltFire);
      expect(down.zoomChanged).toBe(true);
      levels.push(rig.s.zoom);
      // Holding the button does not keep cycling.
      for (let t = 0; t < 5; t++) expect(rig.tick(BTN.AltFire).zoomChanged).toBe(false);
      expect(rig.tick(0).zoomChanged).toBe(false);
      expect(rig.s.zoom).toBe(levels[press]);
    }
    expect(levels).toEqual([1, 2, 0, 1, 2, 0, 1]);
  });

  it('zoomed spread replaces the base spread, at both levels', () => {
    const w = WEAPONS.sniper;
    const zoomSpread = w.zoomSpread ?? Number.NaN;
    const rig = new Rig('sniper');
    expect(currentSpread(rig.s)).toBe(w.spread);
    rig.tick(BTN.AltFire);
    rig.tick(0);
    expect(currentSpread(rig.s)).toBe(zoomSpread);
    expect(zoomSpread).toBeLessThan(w.spread);
    rig.tick(BTN.AltFire);
    expect(rig.s.zoom).toBe(2);
    expect(currentSpread(rig.s)).toBe(zoomSpread);
    // Crouching still helps, moving still hurts (relative to the slower zoomed top speed).
    rig.s.crouch = 1;
    expect(currentSpread(rig.s)).toBeCloseTo(zoomSpread * w.spreadCrouchMul, 12);
    rig.s.crouch = 0;
    const zoomedTop = MOVE.runSpeed * w.moveSpeed * (w.zoomMoveMul ?? 1);
    rig.s.vel.x = zoomedTop;
    expect(currentSpread(rig.s)).toBeCloseTo(zoomSpread + w.spreadMove, 12);
    rig.s.vel.x = zoomedTop * MOVE.crouchMul;
    expect(currentSpread(rig.s)).toBeCloseTo(zoomSpread, 12);
  });

  it('a zoomed shot is on target, an unzoomed one is not reliable', () => {
    const w = WEAPONS.sniper;
    const aim = forwardFromAngles(0, 0);
    const hip = playerWith('sniper');
    const scoped = playerWith('sniper');
    scoped.zoom = 2;
    let worstHip = 0;
    let worstScoped = 0;
    for (let seq = 1; seq <= 200; seq++) {
      worstHip = Math.max(worstHip, angleBetween(dirsOf(hip, seq)[0], aim));
      worstScoped = Math.max(worstScoped, angleBetween(dirsOf(scoped, seq)[0], aim));
    }
    expect(worstScoped).toBeLessThanOrEqual((w.zoomSpread ?? 0) + 1e-12);
    expect(worstHip).toBeGreaterThan(w.spread * 0.9);
    expect(worstHip).toBeLessThanOrEqual(w.spread + 1e-12);
  });

  it('stays after a shot', () => {
    const rig = new Rig('sniper');
    rig.tick(BTN.AltFire);
    rig.tick(0);
    rig.tick(BTN.AltFire);
    expect(rig.s.zoom).toBe(2);
    const ev = rig.tick(BTN.Fire);
    expect(ev.fired).not.toBeNull();
    expect(ev.zoomChanged).toBe(false);
    expect(rig.s.zoom).toBe(2);
    rig.hold(0, ticksFor(WEAPONS.sniper.fireInterval));
    expect(rig.s.zoom).toBe(2);
    // The level can still be changed while the bolt is cycling.
    expect(rig.tick(BTN.Fire).fired).not.toBeNull();
    expect(rig.s.fireCd).toBeGreaterThan(0);
    expect(rig.tick(BTN.AltFire).zoomChanged).toBe(true);
    expect(rig.s.zoom).toBe(0);
  });

  it('is cancelled by a reload', () => {
    const manual = new Rig('sniper');
    manual.gun.clip = 1;
    manual.tick(BTN.AltFire);
    expect(manual.s.zoom).toBe(1);
    const ev = manual.tick(BTN.Reload);
    expect(ev.reloadStarted).toBe(true);
    expect(ev.zoomChanged).toBe(true);
    expect(manual.s.zoom).toBe(0);
    // No zooming until the reload is over.
    manual.tick(0);
    expect(manual.tick(BTN.AltFire).zoomChanged).toBe(false);
    expect(manual.s.zoom).toBe(0);
    manual.tick(0);
    manual.until((e) => e.reloadFinished);
    expect(manual.tick(BTN.AltFire).zoomChanged).toBe(true);
    expect(manual.s.zoom).toBe(1);

    // Same for the automatic reload after the last round.
    const auto = new Rig('sniper');
    auto.gun.clip = 1;
    auto.tick(BTN.AltFire);
    auto.tick(BTN.Fire);
    expect(auto.s.zoom).toBe(1);
    const next = auto.tick(0);
    expect(next.reloadStarted).toBe(true);
    expect(next.zoomChanged).toBe(true);
    expect(auto.s.zoom).toBe(0);
  });

  it('is cancelled by a weapon switch and unavailable while drawing', () => {
    const rig = new Rig('sniper');
    rig.tick(BTN.AltFire);
    rig.tick(0);
    const ev = rig.tick(0, SLOT.Melee);
    expect(ev.switched).toBe(true);
    expect(ev.zoomChanged).toBe(true);
    expect(rig.s.zoom).toBe(0);

    rig.tick(0, SLOT.Primary);
    expect(rig.s.draw).toBeGreaterThan(0);
    expect(rig.tick(BTN.AltFire).zoomChanged).toBe(false);
    expect(rig.s.zoom).toBe(0);
    rig.tick(0);
    rig.hold(0, ticksFor(WEAPONS.sniper.drawTime));
    expect(rig.tick(BTN.AltFire).zoomChanged).toBe(true);
    expect(rig.s.zoom).toBe(1);
  });

  it('does nothing on weapons without a scope', () => {
    for (const id of WEAPON_IDS.filter((w) => !WEAPONS[w].zoomFov)) {
      const rig = new Rig(id);
      const ev = rig.tick(BTN.AltFire);
      expect(ev.zoomChanged, id).toBe(false);
      expect(ev.fired, id).toBeNull();
      expect(rig.s.zoom, id).toBe(0);
    }
    // A stray zoom level on such a weapon is cleared.
    const rig = new Rig('rifle_ak');
    rig.s.zoom = 2;
    expect(rig.tick(0).zoomChanged).toBe(true);
    expect(rig.s.zoom).toBe(0);
  });
});

describe('shot directions', () => {
  /** View directions (yaw, pitch) used across the tests, including steep ones. */
  const VIEWS: [number, number][] = [
    [0, 0],
    [Math.PI / 2, 0],
    [2.3, -0.7],
    [-1.1, 0.9],
    [3.1, 1.5],
    [-2.9, -1.55],
  ];

  it('the shotgun emits 8 pellets inside the cone, the others one bullet', () => {
    for (const id of FIREARMS) {
      const { shot } = shootCopy(playerWith(id), 1);
      expect(shot.weapon, id).toBe(id);
      expect(shot.dirs, id).toHaveLength(WEAPONS[id].pellets);
    }
    const pellets = WEAPONS.shotgun.pellets;
    expect(pellets).toBe(8);

    for (const [yaw, pitch] of VIEWS) {
      const s = playerWith('shotgun');
      s.yaw = yaw;
      s.pitch = pitch;
      s.punchYaw = 0.03;
      s.punchPitch = 0.05;
      const cone = currentSpread(s);
      const aim = forwardFromAngles(yaw + 0.03, pitch + 0.05);
      const dirs = dirsOf(s, 77);
      expect(dirs).toHaveLength(pellets);
      const seen = new Set<string>();
      for (const d of dirs) {
        expect(angleBetween(d, aim)).toBeLessThanOrEqual(cone + 1e-12);
        seen.add(`${d.x},${d.y},${d.z}`);
      }
      expect(seen.size).toBe(pellets); // all different
    }
    // One cartridge per shot, whatever the number of pellets.
    const rig = new Rig('shotgun');
    rig.tick(BTN.Fire);
    expect(rig.gun.clip).toBe(WEAPONS.shotgun.clip - 1);
  });

  it('pellets are spread uniformly over the whole cone, centred on the aim', () => {
    const s = playerWith('shotgun');
    s.yaw = 0.8;
    s.pitch = 0.3;
    const cone = currentSpread(s);
    const aim = forwardFromAngles(s.yaw, s.pitch);
    const right = rightFlat(s.yaw);
    const up = cross(right, aim);
    let n = 0;
    let sumA = 0;
    let sumB = 0;
    let sumR2 = 0;
    let maxR = 0;
    const quadrant = [0, 0, 0, 0];
    for (let seq = 1; seq <= 300; seq++) {
      for (const d of dirsOf(s, seq)) {
        const f = dot(d, aim);
        const a = dot(d, right) / f;
        const b = dot(d, up) / f;
        const r = Math.atan(Math.hypot(a, b)) / cone; // 0 = centre, 1 = edge of the cone
        n++;
        sumA += a / Math.tan(cone);
        sumB += b / Math.tan(cone);
        sumR2 += r * r;
        maxR = Math.max(maxR, r);
        quadrant[(a >= 0 ? 0 : 1) + (b >= 0 ? 0 : 2)]++;
      }
    }
    expect(n).toBe(300 * WEAPONS.shotgun.pellets);
    expect(maxR).toBeLessThanOrEqual(1 + 1e-9);
    expect(maxR).toBeGreaterThan(0.97);
    expect(Math.abs(sumR2 / n - 0.5)).toBeLessThan(0.03); // uniform over the disc: E[r^2] = 1/2
    expect(Math.abs(sumA / n)).toBeLessThan(0.06);
    expect(Math.abs(sumB / n)).toBeLessThan(0.06);
    for (const count of quadrant) expect(Math.abs(count - n / 4)).toBeLessThan(n / 20);
  });

  it('all directions are normalised, for every weapon, view and stance', () => {
    for (const id of WEAPON_IDS) {
      for (const [yaw, pitch] of VIEWS) {
        for (const stance of ['still', 'running', 'airborne', 'recoiling'] as const) {
          const s = playerWith(id);
          s.yaw = yaw;
          s.pitch = pitch;
          if (stance === 'running') s.vel.x = 6;
          if (stance === 'airborne') {
            s.onGround = false;
            s.vel = { x: 4, y: 5, z: -4 };
          }
          if (stance === 'recoiling') {
            s.punchPitch = 0.15;
            s.punchYaw = -0.08;
            s.spread = WEAPONS[id].spreadShotMax;
          }
          for (let seq = 1; seq <= 5; seq++) {
            for (const d of dirsOf(s, seq)) {
              expect(Number.isFinite(d.x) && Number.isFinite(d.y) && Number.isFinite(d.z)).toBe(true);
              expect(Math.abs(length(d) - 1)).toBeLessThan(1e-12);
            }
          }
        }
      }
    }
  });

  it('never emits a non-finite direction, even from non-finite view angles', () => {
    const bad: [number, number][] = [
      [Number.NaN, 0],
      [0, Number.NaN],
      [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
    ];
    for (const id of ['shotgun', 'knife'] as const) {
      for (const [yaw, pitch] of bad) {
        const s = playerWith(id);
        s.yaw = yaw;
        s.pitch = pitch;
        for (const d of dirsOf(s, 9)) {
          expect(Number.isFinite(d.x) && Number.isFinite(d.y) && Number.isFinite(d.z)).toBe(true);
          expect(Math.abs(length(d) - 1)).toBeLessThan(1e-12);
        }
      }
    }
  });

  it('aims along the view angles plus the view punch', () => {
    for (const [yaw, pitch] of VIEWS) {
      const aim = forwardFromAngles(yaw + 0.04, pitch + 0.07);
      // The knife has no spread: its direction is the aim itself.
      const knife = playerWith('knife');
      knife.yaw = yaw;
      knife.pitch = pitch;
      knife.punchYaw = 0.04;
      knife.punchPitch = 0.07;
      const stab = dirsOf(knife, 3);
      expect(stab).toHaveLength(1);
      expect(stab[0].x).toBeCloseTo(aim.x, 12);
      expect(stab[0].y).toBeCloseTo(aim.y, 12);
      expect(stab[0].z).toBeCloseTo(aim.z, 12);

      // Firearms: every bullet within the cone around that same aim.
      const rifle = playerWith('rifle_m4');
      rifle.yaw = yaw;
      rifle.pitch = pitch;
      rifle.punchYaw = 0.04;
      rifle.punchPitch = 0.07;
      const cone = currentSpread(rifle);
      for (let seq = 1; seq <= 50; seq++) {
        expect(angleBetween(dirsOf(rifle, seq)[0], aim)).toBeLessThanOrEqual(cone + 1e-12);
      }
    }
  });

  it('bullets start from the eye, standing or crouched', () => {
    const s = playerWith('rifle_ak');
    s.pos = { x: 3, y: 1.5, z: -7 };
    const expectOrigin = (expected: Vec3): void => {
      const { origin } = shootCopy(s, 1).shot;
      expect(origin.x).toBe(expected.x);
      expect(origin.y).toBeCloseTo(expected.y, 12);
      expect(origin.z).toBe(expected.z);
    };
    expectOrigin({ x: 3, y: 1.5 + PLAYER_HEIGHT - EYE_TOP_OFFSET, z: -7 });
    expectOrigin(eyePosition(s));
    s.crouch = 1;
    expectOrigin({ x: 3, y: 1.5 + PLAYER_CROUCH_HEIGHT - EYE_TOP_OFFSET, z: -7 });
    expectOrigin(eyePosition(s));
    s.crouch = 0.4;
    expectOrigin(eyePosition(s));
    // The origin is a fresh object: the Room may keep it without aliasing the player's position.
    const { shot, after } = shootCopy(s, 1);
    expect(shot.origin).not.toBe(after.pos);
  });

  it('the knife strikes straight ahead without using ammo', () => {
    const w = WEAPONS.knife;
    const rig = new Rig('knife');
    const ammo = { ...rig.gun };
    const ev = rig.tick(BTN.Fire);
    expect(ev.fired?.weapon).toBe('knife');
    expect(ev.fired?.dirs).toHaveLength(1);
    expect(ev.dryFire).toBe(false);
    expect(ev.reloadStarted).toBe(false);
    expect(rig.gun).toEqual(ammo);
    // Held: one strike every fireInterval.
    expect(1 + rig.hold(BTN.Fire, 2 * TICK_RATE - 1)).toBe(shotsIn(w, 2 * TICK_RATE));
    expect(rig.gun).toEqual(ammo);
    // Bare hands (empty slot) behave like the knife.
    const bare = playerWith('rifle_ak');
    bare.slots[SLOT.Primary] = null;
    expect(shootCopy(bare, 1).shot.weapon).toBe('knife');
  });
});

describe('determinism', () => {
  it('shotSeed is a stable unsigned 32-bit hash of (seq, weapon)', () => {
    const seen = new Set<number>();
    for (const id of WEAPON_IDS) {
      for (let seq = 1; seq <= 500; seq++) {
        const seed = shotSeed(seq, id);
        expect(seed).toBe(shotSeed(seq, id));
        expect(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff).toBe(true);
        seen.add(seed);
      }
    }
    expect(seen.size).toBe(WEAPON_IDS.length * 500); // no collision across sequences or weapons
    expect(shotSeed(42, 'rifle_ak')).not.toBe(shotSeed(42, 'rifle_m4'));
    expect(shotSeed(42, 'rifle_ak')).not.toBe(shotSeed(43, 'rifle_ak'));
  });

  it('the same cmd.seq gives the same directions, another seq gives different ones', () => {
    for (const id of FIREARMS) {
      const s = playerWith(id);
      s.yaw = 1.2;
      s.pitch = -0.2;
      const a = shootCopy(s, 1234);
      const b = shootCopy(s, 1234);
      const c = shootCopy(s, 1235);
      expect(a, id).toEqual(b);
      expect(a.shot.dirs, id).toHaveLength(c.shot.dirs.length);
      for (let p = 0; p < a.shot.dirs.length; p++) expect(a.shot.dirs[p], id).not.toEqual(c.shot.dirs[p]);
    }
  });

  it('the recoil jitter is seeded by the command too', () => {
    const s = playerWith('rifle_ak');
    const a = shootCopy(s, 10).after;
    expect(shootCopy(s, 10).after).toEqual(a);
    const b = shootCopy(s, 11).after;
    expect(b.punchYaw).not.toBe(a.punchYaw);
    expect(b.punchPitch).toBe(a.punchPitch);
  });

  it('client and server reach the same state and events from the same commands', () => {
    // A busy scenario over all three slots: shots, reloads, switches, zoom, movement changes.
    const script = (t: number): { buttons: number; slot: number } => {
      const phase = t % 1200;
      let buttons = 0;
      if (t % 97 < 60) buttons |= BTN.Fire;
      if (phase === 150 || phase === 640) buttons |= BTN.Reload;
      if (t % 151 === 7) buttons |= BTN.AltFire;
      let slot = -1;
      if (phase === 600) slot = SLOT.Secondary;
      if (phase === 800) slot = SLOT.Melee;
      if (phase === 900) slot = SLOT.Primary;
      return { buttons, slot };
    };
    const run = (): { state: string; log: string; seen: Record<string, number> } => {
      const rig = new Rig('sniper');
      const log: string[] = [];
      const seen = { fired: 0, reloadFinished: 0, switched: 0, zoomChanged: 0 };
      for (let t = 0; t < 6000; t++) {
        rig.s.yaw = Math.sin(t * 0.01) * 3;
        rig.s.pitch = Math.cos(t * 0.013);
        rig.s.vel.x = t % 500 < 250 ? 5 : 0;
        rig.s.onGround = t % 333 > 20;
        const { buttons, slot } = script(t);
        const ev = rig.tick(buttons, slot);
        if (ev.fired) seen.fired++;
        if (ev.reloadFinished) seen.reloadFinished++;
        if (ev.switched) seen.switched++;
        if (ev.zoomChanged) seen.zoomChanged++;
        log.push(JSON.stringify(ev));
      }
      return { state: JSON.stringify(rig.s), log: log.join('\n'), seen };
    };
    const a = run();
    const b = run();
    // The scenario really exercises the machine...
    expect(a.seen.fired).toBeGreaterThan(10);
    expect(a.seen.reloadFinished).toBeGreaterThan(0);
    expect(a.seen.switched).toBe(15);
    expect(a.seen.zoomChanged).toBeGreaterThan(5);
    // ...and two independent runs agree bit for bit.
    expect(a.state).toBe(b.state);
    expect(a.log).toBe(b.log);
  });

  it('replaying from a snapshot gives the same result (prediction / reconciliation)', () => {
    const rig = new Rig('rifle_ak');
    rig.hold(BTN.Fire, 40);
    const snapshot: PlayerState = JSON.parse(JSON.stringify(rig.s));
    let seq = rig.seq;
    const input = (t: number): number => (t < 80 ? BTN.Fire : BTN.Reload);
    const live: string[] = [];
    for (let t = 0; t < 400; t++) live.push(JSON.stringify(rig.tick(input(t))));

    const replay: string[] = [];
    for (let t = 0; t < 400; t++) {
      const buttons = input(t);
      const ev = newStepEvents();
      stepWeapons(snapshot, { seq: ++seq, buttons, yaw: snapshot.yaw, pitch: snapshot.pitch, slot: -1, st: 0 }, ev);
      snapshot.prevButtons = buttons;
      replay.push(JSON.stringify(ev));
    }
    expect(replay).toEqual(live);
    expect(snapshot).toEqual(rig.s);
    expect(live.some((e) => e.includes('"reloadFinished":true'))).toBe(true);
  });

  it('an idle player is a fixed point and raises no event', () => {
    for (const id of WEAPON_IDS) {
      const rig = new Rig(id);
      const before = JSON.stringify(rig.s);
      for (let t = 0; t < 10; t++) expect(rig.tick(0), id).toEqual(newStepEvents());
      expect(JSON.stringify(rig.s), id).toBe(before);
    }
  });

  it('leaves the movement events of the same tick untouched', () => {
    const s = playerWith('rifle_ak');
    const ev = newStepEvents();
    ev.jumped = true;
    ev.landedSpeed = 6.5;
    stepWeapons(s, { seq: 1, buttons: BTN.Fire, yaw: 0, pitch: 0, slot: -1, st: 0 }, ev);
    expect(ev.fired).not.toBeNull();
    expect(ev.jumped).toBe(true);
    expect(ev.landedSpeed).toBe(6.5);
  });
});

describe('spawn protection', () => {
  it('is given up by firing, with any weapon', () => {
    for (const id of WEAPON_IDS) {
      const rig = new Rig(id);
      rig.s.protect = 2;
      rig.hold(0, 10);
      expect(rig.s.protect, id).toBe(2); // counting it down is the Room's job
      expect(rig.tick(BTN.Fire).fired, id).not.toBeNull();
      expect(rig.s.protect, id).toBe(0);
    }
  });

  it('is kept when nothing is actually fired', () => {
    const rig = new Rig('pistol');
    rig.s.protect = 2;
    rig.gun.clip = 0;
    rig.gun.reserve = 0;
    expect(rig.tick(BTN.Fire).dryFire).toBe(true);
    rig.tick(BTN.Reload | BTN.AltFire);
    rig.tick(0, SLOT.Melee);
    expect(rig.s.protect).toBe(2);

    const frozen = new Rig('rifle_ak');
    frozen.s.protect = 2;
    frozen.s.frozen = true;
    frozen.hold(BTN.Fire, 10);
    expect(frozen.s.protect).toBe(2);
  });
});

// ---------------------------------------------------------------------------------
// Gunplay report: printed for reviewers.
// ---------------------------------------------------------------------------------

/**
 * Shots needed to kill a 100 HP / 100 armour target at point-blank range, every
 * pellet hitting the same hit group. Armour model of docs/ARCHITECTURE.md §7:
 * health -= dmg * armorPen, armour -= (dmg - health part) / 2; once the armour
 * is gone the full damage goes to health.
 */
function shotsToKill(w: WeaponDef, hitMul: number): number {
  let health = MAX_HEALTH;
  let armor = MAX_ARMOR;
  for (let shots = 1; shots <= 1000; shots++) {
    for (let p = 0; p < w.pellets; p++) {
      const dmg = w.damage * hitMul;
      let toHealth = dmg;
      if (armor > 0) {
        toHealth = dmg * w.armorPen;
        let toArmor = (dmg - toHealth) / 2;
        if (toArmor > armor) {
          toArmor = armor;
          toHealth = dmg - toArmor * 2;
        }
        armor -= toArmor;
      }
      health -= toHealth;
    }
    if (health <= 0) return shots;
  }
  return Number.POSITIVE_INFINITY;
}

describe('gunplay report', () => {
  const pad = (v: string | number, n: number): string => String(v).padStart(n);
  const deg = (rad: number): string => (rad * R2D).toFixed(2);

  it('prints damage figures for every weapon', () => {
    const lines = [
      '',
      'Weapon balance: point-blank chest hits (x1), all pellets on target, 100 HP / 100 armour.',
      'DPS = damage x pellets / fireInterval (raw, and what reaches health through armour).',
      'STK = shots to kill, TTK = time to kill = (STK - 1) x fireInterval, mag dmg = raw damage of a full clip.',
      '',
      `${'weapon'.padEnd(10)}${'name'.padEnd(15)}${pad('dmg', 7)}${pad('rpm', 6)}${pad('DPS raw', 9)}` +
        `${pad('DPS armd', 10)}${pad('STK body', 10)}${pad('TTK s', 7)}${pad('STK head', 10)}${pad('mag dmg', 9)}`,
    ];
    for (const id of WEAPON_IDS) {
      const w = WEAPONS[id];
      const perShot = w.damage * w.pellets;
      const body = shotsToKill(w, 1);
      const head = shotsToKill(w, w.headMul);
      lines.push(
        `${id.padEnd(10)}${w.name.padEnd(15)}${pad(w.pellets > 1 ? `${w.pellets}x${w.damage}` : w.damage, 7)}` +
          `${pad((60 / w.fireInterval).toFixed(0), 6)}${pad((perShot / w.fireInterval).toFixed(0), 9)}` +
          `${pad(((perShot * w.armorPen) / w.fireInterval).toFixed(0), 10)}${pad(body, 10)}` +
          `${pad(((body - 1) * w.fireInterval).toFixed(2), 7)}${pad(head, 10)}` +
          `${pad(w.kind === 'melee' ? '-' : perShot * w.clip, 9)}`,
      );
      expect(Number.isFinite(body), id).toBe(true);
      expect(head, id).toBeLessThanOrEqual(body);
    }
    console.log(lines.join('\n'));
  });

  it('prints accuracy and recoil figures for every firearm', () => {
    const lines = [
      '',
      'Accuracy (cone half-angle, degrees) and recoil after 10 shots at the maximum rate of fire.',
      '"climb" / "sway" = view punch (up / to the right) when the 10th bullet leaves; "cone@10" = its spread.',
      '',
      `${'weapon'.padEnd(10)}${pad('crouch', 8)}${pad('stand', 8)}${pad('walk', 8)}${pad('run', 8)}${pad('jump', 8)}` +
        `${pad('cone@10', 9)}${pad('climb', 8)}${pad('sway', 8)}`,
    ];
    for (const id of FIREARMS) {
      const w = WEAPONS[id];
      const s = playerWith(id);
      const top = MOVE.runSpeed * w.moveSpeed;
      const stand = currentSpread(s);
      s.crouch = 1;
      const crouch = currentSpread(s);
      s.crouch = 0;
      s.vel.x = top * MOVE.walkMul;
      const walk = currentSpread(s);
      s.vel.x = top;
      const run = currentSpread(s);
      s.onGround = false;
      const jump = currentSpread(s);

      const rig = new Rig(id);
      rig.gun.clip = 999;
      let shots = 0;
      let tenth = { cone: 0, pitch: 0, yaw: 0 };
      for (let t = 0; shots < 10; t++) {
        const leaving = { cone: currentSpread(rig.s), pitch: rig.s.punchPitch, yaw: rig.s.punchYaw };
        if (rig.tick(rig.bestTrigger()).fired && ++shots === 10) tenth = leaving;
      }
      lines.push(
        `${id.padEnd(10)}${pad(deg(crouch), 8)}${pad(deg(stand), 8)}${pad(deg(walk), 8)}${pad(deg(run), 8)}` +
          `${pad(deg(jump), 8)}${pad(deg(tenth.cone), 9)}${pad(deg(tenth.pitch), 8)}${pad(deg(-tenth.yaw), 8)}`,
      );
      for (const v of [crouch, stand, walk, run, jump, tenth.cone, tenth.pitch, tenth.yaw]) {
        expect(Number.isFinite(v), id).toBe(true);
      }
    }
    console.log(lines.join('\n'));
  });

  it('prints the spray pattern of the first 15 shots of rifle_ak', () => {
    // Where each bullet is aimed relative to the crosshair: the view punch
    // accumulated when it leaves (random spread not included).
    const rig = new Rig('rifle_ak');
    const shots: { x: number; y: number; cone: number }[] = [];
    for (let t = 0; shots.length < 15; t++) {
      const x = -rig.s.punchYaw * R2D; // positive yaw is left: flip so that right is right
      const y = rig.s.punchPitch * R2D;
      const cone = currentSpread(rig.s) * R2D;
      if (rig.tick(BTN.Fire).fired) shots.push({ x, y, cone });
    }

    // One character is about twice as tall as wide: a row covers twice the angle of a column.
    // The scale doubles until the pattern fits, so the plot survives any retuning.
    const maxX = Math.max(...shots.map((s) => Math.abs(s.x)));
    const maxY = Math.max(...shots.map((s) => s.y));
    let xStep = 0.025;
    while (maxX / xStep > 38 || maxY / (2 * xStep) > 38) xStep *= 2;
    const yStep = 2 * xStep;
    const half = Math.max(8, Math.ceil(maxX / xStep) + 2);
    const cols = 2 * half + 1;
    const rows = Math.ceil(maxY / yStep) + 2;
    const grid: string[][] = [];
    for (let r = 0; r < rows; r++) {
      const row = new Array<string>(cols).fill(' ');
      row[half] = '.';
      grid.push(row);
    }
    const labels = '123456789ABCDEF';
    shots.forEach((shot, i) => {
      const col = half + Math.round(shot.x / xStep);
      const row = Math.round(shot.y / yStep);
      grid[row][col] = grid[row][col] === ' ' || grid[row][col] === '.' ? labels[i] : '*';
    });

    const lines = [
      '',
      'rifle_ak spray pattern, first 15 shots, trigger held, standing still.',
      'Offset of each bullet from the crosshair due to recoil (cumulative view punch), in degrees.',
      `One column = ${xStep} deg, one row = ${yStep} deg. Labels 1-9 then A-F = shot number, * = overlap.`,
      'Shot 1 is on the crosshair.',
      '',
    ];
    for (let r = rows - 1; r >= 0; r--) {
      lines.push(`${(r * yStep).toFixed(2).padStart(6)} |${grid[r].join('').replace(/\s+$/, '')}`);
    }
    lines.push(`${' '.repeat(7)}+${'-'.repeat(cols)}`);
    const axis = new Array<string>(8 + cols + 4).fill(' ');
    const tick = Math.max(1, Math.floor(half / 2 / 4)) * 4; // label spacing in columns
    for (let c = -Math.floor(half / tick) * tick; c <= half; c += tick) {
      const text = c === 0 ? '0' : (c * xStep).toFixed(2);
      const start = 8 + half + c - (text.length - 1);
      for (let k = 0; k < text.length; k++) axis[start + k] = text[k];
    }
    lines.push(`${axis.join('').replace(/\s+$/, '')}   (left < > right)`);
    lines.push('');
    lines.push('shot   right     up   cone (random spread around that point)');
    shots.forEach((shot, i) => {
      lines.push(
        `${String(i + 1).padStart(4)}${shot.x.toFixed(2).padStart(8)}${shot.y.toFixed(2).padStart(7)}` +
          `${shot.cone.toFixed(2).padStart(7)}`,
      );
    });
    console.log(lines.join('\n'));

    expect(shots[0].x).toBeCloseTo(0, 12);
    expect(shots[0].y).toBeCloseTo(0, 12);
    expect(shots[0].cone).toBeCloseTo(WEAPONS.rifle_ak.spread * R2D, 12);
    expect(maxY).toBeGreaterThan(0);
  });
});
