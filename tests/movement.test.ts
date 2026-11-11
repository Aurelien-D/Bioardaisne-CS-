import { describe, expect, it } from 'vitest';
import {
  BTN,
  CROUCH_TIME,
  MOVE,
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HALF_WIDTH,
  PLAYER_HEIGHT,
  STEP_HEIGHT,
  TICK_DT,
  TICK_RATE,
} from '../src/shared/constants';
import { getMap } from '../src/shared/maps';
import type { Solid } from '../src/shared/maps/types';
import { mulberry32 } from '../src/shared/math/rng';
import { CollisionWorld } from '../src/shared/physics/world';
import { stepMovement } from '../src/shared/player/movement';
import type { PlayerState, StepEvents, UserCmd } from '../src/shared/types';

// --- Helpers -------------------------------------------------------------------------

/** Gap kept between the hull and a surface it rests against (sweep back-off). */
const SKIN = 1e-3;
const RUN = MOVE.runSpeed;

/** Yaw that makes BTN.Forward move toward each world direction (yaw 0 looks toward -Z). */
const YAW = { negZ: 0, negX: Math.PI / 2, posZ: Math.PI, posX: -Math.PI / 2 } as const;

function solid(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Solid {
  return { min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 }, surf: 'concrete' };
}

/** Hand-made player state (stepMovement only reads the movement fields). */
function makeState(x: number, y: number, z: number): PlayerState {
  return {
    pos: { x, y, z },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    onGround: false,
    crouch: 0,
    landSlow: 1,
    alive: true,
    health: 100,
    armor: 0,
    slots: [null, null, null],
    active: 0,
    fireCd: 0,
    reload: 0,
    draw: 0,
    shots: 0,
    sinceShot: 10,
    punchPitch: 0,
    punchYaw: 0,
    spread: 0,
    zoom: 0,
    prevButtons: 0,
    action: 0,
    actionT: 0,
    protect: 0,
    frozen: false,
  };
}

function makeEvents(): StepEvents {
  return {
    fired: null,
    dryFire: false,
    reloadStarted: false,
    reloadFinished: false,
    switched: false,
    jumped: false,
    landedSpeed: 0,
    zoomChanged: false,
  };
}

const hullHeight = (crouch: number): number => PLAYER_HEIGHT + (PLAYER_CROUCH_HEIGHT - PLAYER_HEIGHT) * crouch;
const speedOf = (s: PlayerState): number => Math.hypot(s.vel.x, s.vel.z);
const seconds = (t: number): number => Math.round(t * TICK_RATE);

/** True if the player's hull overlaps a solid. */
function insideSolid(world: CollisionWorld, s: PlayerState): boolean {
  const hh = hullHeight(s.crouch) / 2;
  return world.boxOverlaps(
    { x: s.pos.x, y: s.pos.y + hh, z: s.pos.z },
    { x: PLAYER_HALF_WIDTH, y: hh, z: PLAYER_HALF_WIDTH },
  );
}

/** One simulated player: feeds commands to stepMovement the way stepPlayer does. */
class Sim {
  readonly s: PlayerState;
  readonly ev = makeEvents();
  seq = 0;
  jumps = 0;
  landings: number[] = [];

  constructor(
    readonly world: CollisionWorld,
    x: number,
    y: number,
    z: number,
    readonly maxSpeed: number = RUN,
  ) {
    this.s = makeState(x, y, z);
  }

  tick(buttons: number, yaw = 0): StepEvents {
    const cmd: UserCmd = { seq: ++this.seq, buttons, yaw, pitch: 0, slot: -1, st: 0 };
    this.s.yaw = yaw;
    stepMovement(this.s, cmd, this.world, this.maxSpeed, this.ev);
    this.s.prevButtons = buttons;
    if (this.ev.jumped) this.jumps++;
    if (this.ev.landedSpeed > 0) this.landings.push(this.ev.landedSpeed);
    return this.ev;
  }

  run(ticks: number, buttons: number, yaw = 0, each?: (sim: Sim, i: number) => void): this {
    for (let i = 0; i < ticks; i++) {
      this.tick(buttons, yaw);
      each?.(this, i);
    }
    return this;
  }
}

/** Large flat floor whose top is at y = 0. */
const flatWorld = (...extra: Solid[]): CollisionWorld => new CollisionWorld([solid(-200, -1, -200, 200, 0, 200), ...extra]);

const devMap = getMap('dev_test');
const devWorld = new CollisionWorld(devMap.solids);

// --- Tests -----------------------------------------------------------------------------

describe('ground movement', () => {
  it('accelerates to ~95 % of the run speed within 0.5 s and never exceeds it', () => {
    const sim = new Sim(flatWorld(), 0, 0, 0);
    let max = 0;
    sim.run(seconds(0.5), BTN.Forward, 0, (p) => (max = Math.max(max, speedOf(p.s))));
    expect(speedOf(sim.s)).toBeGreaterThanOrEqual(0.95 * RUN);
    sim.run(seconds(2), BTN.Forward, 0, (p) => (max = Math.max(max, speedOf(p.s))));
    expect(speedOf(sim.s)).toBeCloseTo(RUN, 9);
    expect(max).toBeLessThanOrEqual(RUN + 1e-9);
    // Responsive start: more than a third of the top speed after 100 ms.
    const quick = new Sim(flatWorld(), 0, 0, 0).run(seconds(0.1), BTN.Forward);
    expect(speedOf(quick.s)).toBeGreaterThan(RUN / 3);
  });

  it('stops crisply after releasing the keys', () => {
    const sim = new Sim(flatWorld(), 0, 0, 0).run(seconds(1.5), BTN.Forward);
    expect(speedOf(sim.s)).toBeCloseTo(RUN, 9);
    const z0 = sim.s.pos.z;
    let stoppedAt = -1;
    const speeds: number[] = [];
    sim.run(seconds(1), 0, 0, (p, i) => {
      speeds.push(speedOf(p.s));
      if (stoppedAt < 0 && speedOf(p.s) === 0) stoppedAt = i + 1;
    });
    // Below walking pace (and below the weapon accuracy threshold) after 0.35 s...
    expect(speeds[seconds(0.35) - 1]!).toBeLessThan(0.15 * RUN);
    // ...and at a complete standstill (exactly zero velocity) within half a second.
    expect(stoppedAt).toBeGreaterThan(0);
    expect(stoppedAt * TICK_DT).toBeLessThanOrEqual(0.5);
    expect(sim.s.vel).toEqual({ x: 0, y: 0, z: 0 });
    const distance = z0 - sim.s.pos.z;
    expect(distance).toBeGreaterThan(0.6);
    expect(distance).toBeLessThan(1.15);
    // Speed decreases monotonically while stopping.
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]!).toBeLessThanOrEqual(speeds[i - 1]!);
    // Standing still is perfectly stable.
    const rest = { ...sim.s.pos };
    sim.run(seconds(1), 0);
    expect(sim.s.pos).toEqual(rest);
    expect(sim.s.onGround).toBe(true);
  });

  it('counter-strafing stops faster than just releasing', () => {
    const sim = new Sim(flatWorld(), 0, 0, 0).run(seconds(1.5), BTN.Forward);
    let ticks = 0;
    while (sim.s.vel.z < 0 && ticks < 64) {
      sim.tick(BTN.Back);
      ticks++;
    }
    expect(ticks * TICK_DT).toBeLessThan(0.2);
  });

  it('follows the view conventions for every key', () => {
    const cases: { yaw: number; buttons: number; dir: [number, number] }[] = [
      { yaw: YAW.negZ, buttons: BTN.Forward, dir: [0, -1] },
      { yaw: YAW.negZ, buttons: BTN.Back, dir: [0, 1] },
      { yaw: YAW.negZ, buttons: BTN.Right, dir: [1, 0] },
      { yaw: YAW.negZ, buttons: BTN.Left, dir: [-1, 0] },
      { yaw: YAW.negX, buttons: BTN.Forward, dir: [-1, 0] },
      { yaw: YAW.negX, buttons: BTN.Right, dir: [0, -1] },
      { yaw: YAW.posZ, buttons: BTN.Forward, dir: [0, 1] },
      { yaw: YAW.posX, buttons: BTN.Forward, dir: [1, 0] },
      { yaw: YAW.posX, buttons: BTN.Left, dir: [0, -1] },
      { yaw: YAW.negZ, buttons: BTN.Forward | BTN.Right, dir: [Math.SQRT1_2, -Math.SQRT1_2] },
      { yaw: YAW.negZ, buttons: BTN.Back | BTN.Left, dir: [-Math.SQRT1_2, Math.SQRT1_2] },
    ];
    for (const c of cases) {
      const sim = new Sim(flatWorld(), 0, 0, 0).run(seconds(1.5), c.buttons, c.yaw);
      // Diagonals are not faster than straight lines.
      expect(speedOf(sim.s)).toBeCloseTo(RUN, 9);
      expect(sim.s.vel.x / RUN).toBeCloseTo(c.dir[0], 9);
      expect(sim.s.vel.z / RUN).toBeCloseTo(c.dir[1], 9);
      expect(sim.s.vel.y).toBe(0);
    }
    // Opposite keys cancel out.
    const still = new Sim(flatWorld(), 0, 0, 0).run(seconds(1), BTN.Forward | BTN.Back | BTN.Left | BTN.Right);
    expect(still.s.pos.x).toBe(0);
    expect(still.s.pos.z).toBe(0);
  });

  it('applies the walk, crouch and weapon speed modifiers', () => {
    const walk = new Sim(flatWorld(), 0, 0, 0).run(seconds(2), BTN.Forward | BTN.Walk);
    expect(speedOf(walk.s)).toBeCloseTo(RUN * MOVE.walkMul, 9);
    const crouch = new Sim(flatWorld(), 0, 0, 0).run(seconds(2), BTN.Forward | BTN.Crouch);
    expect(speedOf(crouch.s)).toBeCloseTo(RUN * MOVE.crouchMul, 9);
    const both = new Sim(flatWorld(), 0, 0, 0).run(seconds(2), BTN.Forward | BTN.Crouch | BTN.Walk);
    expect(speedOf(both.s)).toBeCloseTo(RUN * MOVE.crouchMul * MOVE.walkMul, 9);
    const heavy = new Sim(flatWorld(), 0, 0, 0, 4.2).run(seconds(2), BTN.Forward);
    expect(speedOf(heavy.s)).toBeCloseTo(4.2, 9);
    const none = new Sim(flatWorld(), 0, 0, 0, 0).run(seconds(1), BTN.Forward);
    expect(none.s.pos.z).toBe(0);
  });

  it('reaches slow target speeds too (heavy weapon, scoped, crouched)', () => {
    // With the textbook formula these targets gain less speed per tick than the stopSpeed
    // friction removes: the player would be unable to move.
    const sniper = RUN * 0.82;
    const cases: { maxSpeed: number; buttons: number; expected: number }[] = [
      { maxSpeed: sniper, buttons: BTN.Forward | BTN.Crouch, expected: sniper * MOVE.crouchMul },
      { maxSpeed: sniper * 0.55, buttons: BTN.Forward, expected: sniper * 0.55 },
      { maxSpeed: sniper * 0.55, buttons: BTN.Forward | BTN.Walk, expected: sniper * 0.55 * MOVE.walkMul },
      { maxSpeed: sniper * 0.55, buttons: BTN.Forward | BTN.Crouch, expected: sniper * 0.55 * MOVE.crouchMul },
    ];
    for (const c of cases) {
      const sim = new Sim(flatWorld(), 0, 0, 0, c.maxSpeed);
      sim.run(seconds(0.3), c.buttons & BTN.Crouch); // settle into the stance first
      sim.run(seconds(0.5), c.buttons);
      expect(speedOf(sim.s)).toBeCloseTo(c.expected, 9);
      const z = sim.s.pos.z;
      sim.run(seconds(1), c.buttons);
      expect(z - sim.s.pos.z).toBeCloseTo(c.expected, 6);
      // And still stops dead.
      sim.run(seconds(0.5), c.buttons & BTN.Crouch);
      expect(speedOf(sim.s)).toBe(0);
    }
  });

  it('only touches the movement fields and never the command history', () => {
    const sim = new Sim(flatWorld(), 0, 0, 0);
    const s = sim.s;
    s.prevButtons = BTN.Fire;
    s.pitch = 0.3;
    s.yaw = 1.1;
    const before = JSON.stringify({ ...s, pos: 0, vel: 0, onGround: 0, crouch: 0, landSlow: 0 });
    const ev = makeEvents();
    ev.jumped = true;
    ev.landedSpeed = 5;
    ev.dryFire = true;
    stepMovement(s, { seq: 1, buttons: BTN.Forward | BTN.Crouch, yaw: 2, pitch: 0, slot: -1, st: 0 }, sim.world, RUN, ev);
    expect(JSON.stringify({ ...s, pos: 0, vel: 0, onGround: 0, crouch: 0, landSlow: 0 })).toBe(before);
    // Stale events of a previous tick are cleared; unrelated events are left alone.
    expect(ev.jumped).toBe(false);
    expect(ev.landedSpeed).toBe(0);
    expect(ev.dryFire).toBe(true);
  });
});

describe('jumping and falling', () => {
  const apexExpected = MOVE.jumpSpeed ** 2 / (2 * MOVE.gravity);

  it('reaches the expected apex and lands back', () => {
    const sim = new Sim(flatWorld(), 0, 0, 0);
    sim.tick(0);
    expect(sim.s.onGround).toBe(true);
    const ground = sim.s.pos.y;
    const ev = sim.tick(BTN.Jump);
    expect(ev.jumped).toBe(true);
    expect(sim.s.onGround).toBe(false);
    let apex = 0;
    let airTicks = 1;
    while (!sim.s.onGround && airTicks < 200) {
      sim.tick(0);
      apex = Math.max(apex, sim.s.pos.y - ground);
      airTicks++;
    }
    expect(Math.abs(apex - apexExpected) / apexExpected).toBeLessThan(0.05);
    // In practice the trapezoidal integration is much closer than 5 %.
    expect(Math.abs(apex - apexExpected) / apexExpected).toBeLessThan(0.01);
    // Air time = 2 v / g.
    expect(airTicks * TICK_DT).toBeCloseTo((2 * MOVE.jumpSpeed) / MOVE.gravity, 1);
    expect(sim.landings.length).toBe(1);
    expect(sim.landings[0]!).toBeGreaterThan(MOVE.jumpSpeed - 0.4);
    expect(sim.landings[0]!).toBeLessThan(MOVE.jumpSpeed + 0.4);
    expect(sim.s.pos.y).toBeCloseTo(ground, 6);
    expect(sim.s.vel.y).toBe(0);
  });

  it('cannot jump in the air', () => {
    const sim = new Sim(flatWorld(), 0, 0, 0);
    sim.tick(0);
    sim.tick(BTN.Jump);
    sim.run(6, 0);
    const vy = sim.s.vel.y;
    const ev = sim.tick(BTN.Jump); // fresh key press while airborne
    expect(ev.jumped).toBe(false);
    expect(sim.s.vel.y).toBeLessThan(vy);
    sim.run(4, 0);
    sim.tick(BTN.Jump);
    while (!sim.s.onGround) sim.tick(0);
    expect(sim.jumps).toBe(1);
  });

  it('holding jump does not auto-hop; pressing again does', () => {
    const sim = new Sim(flatWorld(), 0, 0, 0);
    sim.tick(0);
    sim.run(seconds(3), BTN.Jump | BTN.Forward);
    expect(sim.jumps).toBe(1);
    expect(sim.s.onGround).toBe(true);
    sim.tick(BTN.Forward);
    sim.tick(BTN.Jump | BTN.Forward);
    expect(sim.jumps).toBe(2);
    // A press made in the air does not carry over to the landing.
    sim.run(10, BTN.Forward);
    sim.run(seconds(2), BTN.Jump | BTN.Forward);
    expect(sim.jumps).toBe(2);
  });

  it('slows the player down after a jump landing, then recovers', () => {
    const sim = new Sim(flatWorld(), 0, 0, 0).run(seconds(1), BTN.Forward);
    sim.tick(BTN.Forward | BTN.Jump);
    while (!sim.s.onGround) sim.tick(BTN.Forward);
    expect(sim.s.landSlow).toBe(MOVE.landingSlow);
    // No friction in the air: the run speed is carried through the jump.
    expect(speedOf(sim.s)).toBeCloseTo(RUN, 6);
    sim.run(6, BTN.Forward);
    expect(speedOf(sim.s)).toBeLessThan(RUN * 0.95);
    sim.run(seconds(0.5), BTN.Forward);
    expect(sim.s.landSlow).toBe(1);
    expect(speedOf(sim.s)).toBeCloseTo(RUN, 9);
  });

  it('gives only a little air control', () => {
    const sim = new Sim(flatWorld(), 0, 0, 0);
    sim.tick(0);
    sim.tick(BTN.Jump);
    let max = 0;
    while (!sim.s.onGround) {
      sim.tick(BTN.Forward);
      if (!sim.s.onGround) max = Math.max(max, speedOf(sim.s));
    }
    expect(max).toBeGreaterThan(0.5 * MOVE.airMaxWishSpeed);
    expect(max).toBeLessThanOrEqual(MOVE.airMaxWishSpeed + 1e-9);
  });

  it('reports the impact speed of a fall and caps the fall speed', () => {
    for (const height of [0.6, 2, 5, 12]) {
      const sim = new Sim(flatWorld(), 0, height, 0);
      let ticks = 0;
      while (!sim.s.onGround && ticks++ < 1000) sim.tick(0);
      const expected = Math.sqrt(2 * MOVE.gravity * height);
      expect(sim.landings.length).toBe(1);
      expect(Math.abs(sim.landings[0]! - expected)).toBeLessThan(0.35);
      expect(sim.s.pos.y).toBeCloseTo(SKIN, 6);
      expect(sim.s.landSlow).toBe(expected > 4 ? MOVE.landingSlow : 1);
    }
    const sim = new Sim(flatWorld(), 0, 190, 0);
    let fastest = 0;
    while (!sim.s.onGround) {
      sim.tick(0);
      fastest = Math.min(fastest, sim.s.vel.y);
    }
    expect(fastest).toBe(-MOVE.maxFallSpeed);
    expect(sim.landings[0]!).toBe(MOVE.maxFallSpeed);
    expect(sim.s.pos.y).toBeCloseTo(SKIN, 6);
  });

  it('bumps its head on a low ceiling without going through', () => {
    // Ceiling 2.3 m above the floor: 0.5 m of headroom.
    const world = flatWorld(solid(-5, 2.3, -5, 5, 2.6, 5));
    const sim = new Sim(world, 0, 0, 0);
    sim.tick(0);
    sim.tick(BTN.Jump);
    let top = 0;
    while (!sim.s.onGround) {
      sim.tick(0);
      top = Math.max(top, sim.s.pos.y + PLAYER_HEIGHT);
      expect(insideSolid(world, sim.s)).toBe(false);
    }
    expect(top).toBeLessThan(2.3);
    expect(top).toBeGreaterThan(2.29);
    // The jump is cut short.
    expect(sim.seq * TICK_DT).toBeLessThan(0.55);
  });

  it('walking off a ledge higher than a step means falling', () => {
    // Platform 2 m high ending at x = 0.
    const world = flatWorld(solid(-20, 0, -5, 0, 2, 5));
    const sim = new Sim(world, -3, 2, 0);
    let airborne = 0;
    sim.run(seconds(2), BTN.Forward, YAW.posX, (p) => {
      if (!p.s.onGround) airborne++;
    });
    expect(sim.s.pos.x).toBeGreaterThan(1);
    expect(sim.s.pos.y).toBeCloseTo(SKIN, 6);
    expect(airborne).toBeGreaterThan(20);
    expect(sim.landings.length).toBe(1);
    expect(sim.landings[0]!).toBeGreaterThan(8.3);
    expect(sim.landings[0]!).toBeLessThan(9.3);
  });
});

describe('stairs of dev_test', () => {
  it('walks up to the 2 m walkway and back down at run speed', () => {
    const sim = new Sim(devWorld, 12, 0, -15.3);
    // Up: toward +Z, from the courtyard to the walkway.
    let slowest = Infinity;
    let airborneUp = 0;
    sim.run(seconds(1.2), BTN.Forward, YAW.posZ, (p, i) => {
      if (i >= seconds(0.5)) slowest = Math.min(slowest, speedOf(p.s));
      if (i > 0 && !p.s.onGround) airborneUp++;
      expect(insideSolid(devWorld, p.s)).toBe(false);
    });
    expect(sim.s.pos.z).toBeGreaterThan(-10);
    expect(sim.s.pos.y).toBeCloseTo(2 + SKIN, 6);
    expect(sim.s.onGround).toBe(true);
    expect(airborneUp).toBe(0);
    // Steps do not slow the player down.
    expect(slowest).toBeGreaterThan(0.99 * RUN);
    expect(sim.jumps).toBe(0);

    // Keep going along the walkway, then turn around and go back down.
    sim.run(seconds(0.5), BTN.Forward, YAW.posZ);
    expect(sim.s.pos.y).toBeCloseTo(2 + SKIN, 6);
    sim.run(seconds(0.6), BTN.Forward, YAW.negZ);
    let descending = 0;
    let grounded = 0;
    let lastY = sim.s.pos.y;
    let biggestDrop = 0;
    let ticks = 0;
    while (sim.s.pos.z > -15 && ticks++ < seconds(4)) {
      sim.tick(BTN.Forward, YAW.negZ);
      if (sim.s.pos.z < -10.3 && sim.s.pos.y > 0.1) {
        descending++;
        if (sim.s.onGround) grounded++;
        expect(speedOf(sim.s)).toBeGreaterThan(0.99 * RUN);
      }
      biggestDrop = Math.max(biggestDrop, lastY - sim.s.pos.y);
      lastY = sim.s.pos.y;
      expect(insideSolid(devWorld, sim.s)).toBe(false);
    }
    expect(sim.s.pos.y).toBeCloseTo(SKIN, 6);
    expect(descending).toBeGreaterThan(30);
    // On the ground (almost) every tick: no bouncing down the stairs.
    expect(grounded / descending).toBeGreaterThanOrEqual(0.97);
    // One 25 cm stair at a time, and no landing impact at all.
    expect(biggestDrop).toBeLessThan(0.26);
    expect(sim.landings.length).toBe(0);
  });

  it('jumping on the stairs does not kill the momentum on the risers', () => {
    // One jump, started from every position along the staircase.
    let slowest = Infinity;
    let longest = 0;
    let runs = 0;
    for (let jumpAt = -14.8; jumpAt < -10.4; jumpAt += 0.03) {
      const sim = new Sim(devWorld, 12, 0, -15.6);
      let jumped = false;
      let ticks = 0;
      while (sim.s.pos.z < -9.5 && ticks < seconds(4)) {
        const jump = !jumped && sim.s.onGround && sim.s.pos.z >= jumpAt;
        if (jump) jumped = true;
        sim.tick(BTN.Forward | (jump ? BTN.Jump : 0), YAW.posZ);
        if (ticks > seconds(0.5)) slowest = Math.min(slowest, sim.s.vel.z);
        expect(insideSolid(devWorld, sim.s)).toBe(false);
        ticks++;
      }
      expect(sim.jumps).toBe(1);
      expect(sim.s.pos.y).toBeGreaterThan(1.9);
      longest = Math.max(longest, ticks * TICK_DT);
      runs++;
    }
    expect(runs).toBeGreaterThan(100);
    // Never slower than the landing slow-down allows, and barely longer than walking up (1.2 s).
    expect(slowest).toBeGreaterThan(RUN * MOVE.landingSlow - 0.01);
    expect(longest).toBeLessThan(1.4);
  });

  it('also climbs them diagonally and while walking slowly', () => {
    // Heading 0.15 rad off the stair axis: crosses every riser at an angle.
    const diag = new Sim(devWorld, 11.5, 0, -15.3);
    diag.run(seconds(1.3), BTN.Forward, YAW.posZ + 0.15);
    expect(diag.s.pos.y).toBeCloseTo(2 + SKIN, 6);
    expect(diag.s.pos.x).toBeGreaterThan(12);
    expect(diag.s.pos.z).toBeGreaterThan(-10);
    const slow = new Sim(devWorld, 12, 0, -14.5);
    slow.run(seconds(6), BTN.Forward | BTN.Walk | BTN.Crouch, YAW.posZ);
    expect(slow.s.pos.y).toBeCloseTo(2 + SKIN, 6);
    expect(slow.s.pos.z).toBeGreaterThan(-10);
  });
});

describe('crouching', () => {
  // Slab whose underside is 1.4 m above the floor, covering x in [2, 6].
  const world = flatWorld(solid(2, 1.4, -5, 6, 1.7, 5));

  it('ducks and stands up in CROUCH_TIME, feet in place', () => {
    const sim = new Sim(flatWorld(), 0, 0, 0);
    sim.tick(0);
    const y = sim.s.pos.y;
    const ticks = Math.ceil(CROUCH_TIME / TICK_DT - 1e-9);
    sim.run(ticks - 1, BTN.Crouch);
    expect(sim.s.crouch).toBeGreaterThan(0.85);
    expect(sim.s.crouch).toBeLessThan(1);
    sim.tick(BTN.Crouch);
    expect(sim.s.crouch).toBe(1);
    sim.run(20, BTN.Crouch);
    expect(sim.s.crouch).toBe(1);
    expect(sim.s.pos.y).toBe(y);
    sim.run(ticks - 1, 0);
    expect(sim.s.crouch).toBeGreaterThan(0);
    sim.tick(0);
    expect(sim.s.crouch).toBe(0);
    expect(sim.s.pos.y).toBe(y);
    expect(sim.s.onGround).toBe(true);
  });

  it('a standing player cannot walk under a 1.4 m ceiling', () => {
    const sim = new Sim(world, 0, 0, 0).run(seconds(2), BTN.Forward, YAW.posX);
    expect(sim.s.pos.x).toBeLessThan(2 - PLAYER_HALF_WIDTH);
    expect(sim.s.pos.x).toBeGreaterThan(2 - PLAYER_HALF_WIDTH - 0.01);
    expect(sim.s.crouch).toBe(0);
  });

  it('fits under it crouched, cannot stand up underneath, stands up once clear', () => {
    const sim = new Sim(world, 0, 0, 0);
    sim.run(seconds(0.3), BTN.Crouch, YAW.posX);
    // Walk under the slab.
    let ticks = 0;
    while (sim.s.pos.x < 4 && ticks++ < seconds(5)) {
      sim.tick(BTN.Forward | BTN.Crouch, YAW.posX);
      expect(insideSolid(world, sim.s)).toBe(false);
    }
    expect(sim.s.pos.x).toBeGreaterThanOrEqual(4);
    expect(sim.s.crouch).toBe(1);

    // Release crouch underneath: the player stays ducked for as long as it is under the slab.
    sim.run(seconds(1), 0, YAW.posX);
    expect(sim.s.crouch).toBe(1);
    expect(insideSolid(world, sim.s)).toBe(false);
    ticks = 0;
    while (sim.s.pos.x < 6 + PLAYER_HALF_WIDTH && ticks++ < seconds(5)) {
      sim.tick(BTN.Forward, YAW.posX);
      expect(sim.s.crouch).toBe(1);
      expect(insideSolid(world, sim.s)).toBe(false);
    }
    // Still moving at crouch speed under there.
    expect(speedOf(sim.s)).toBeCloseTo(RUN * MOVE.crouchMul, 6);

    // Once clear of the slab the player stands up by itself.
    sim.run(seconds(0.3), BTN.Forward, YAW.posX);
    expect(sim.s.crouch).toBe(0);
    expect(sim.s.pos.x).toBeGreaterThan(6.4);
    expect(insideSolid(world, sim.s)).toBe(false);
  });

  it('holds a half-crouched stance when released under a ceiling that is too low to stand', () => {
    // Underside at 1.7 m: a half-ducked hull (1.55 m) fits, the standing hull (1.8 m) does not.
    const low = flatWorld(solid(-5, 1.7, -5, 5, 2, 5));
    const sim = new Sim(low, 0, 0, 0);
    sim.s.crouch = 0.5;
    sim.run(seconds(1), BTN.Forward, YAW.posX);
    expect(sim.s.crouch).toBe(0.5);
    expect(insideSolid(low, sim.s)).toBe(false);
    expect(sim.s.pos.x).toBeGreaterThan(2);
  });

  it('crouching in the air keeps the feet on the same trajectory', () => {
    const a = new Sim(flatWorld(), 0, 0, 0);
    const b = new Sim(flatWorld(), 0, 0, 0);
    a.tick(0);
    b.tick(0);
    a.tick(BTN.Jump);
    b.tick(BTN.Jump);
    for (let i = 0; i < 60; i++) {
      a.tick(0);
      b.tick(BTN.Crouch);
      expect(b.s.pos.y).toBe(a.s.pos.y);
    }
    expect(b.s.crouch).toBe(1);
    expect(b.s.onGround).toBe(true);
  });
});

describe('steps and ledges', () => {
  const ledge = (height: number): CollisionWorld => flatWorld(solid(3, 0, -5, 20, height, 5));

  it('walks up ledges up to STEP_HEIGHT (0.5 m)', () => {
    for (const h of [0.02, 0.1, 0.25, 0.4, STEP_HEIGHT]) {
      const world = ledge(h);
      const sim = new Sim(world, 0, 0, 0).run(seconds(1.5), BTN.Forward, YAW.posX, (p) => {
        expect(insideSolid(world, p.s)).toBe(false);
      });
      expect(sim.s.pos.x).toBeGreaterThan(5);
      expect(sim.s.pos.y).toBeCloseTo(h + SKIN, 6);
      expect(sim.s.onGround).toBe(true);
      expect(sim.jumps).toBe(0);
      expect(speedOf(sim.s)).toBeCloseTo(RUN, 9);
    }
  });

  it('is stopped by a 0.55 m ledge', () => {
    const world = ledge(0.55);
    const sim = new Sim(world, 0, 0, 0).run(seconds(2), BTN.Forward, YAW.posX);
    expect(sim.s.pos.x).toBeLessThan(3 - PLAYER_HALF_WIDTH);
    expect(sim.s.pos.x).toBeGreaterThan(3 - PLAYER_HALF_WIDTH - 0.01);
    expect(sim.s.pos.y).toBeCloseTo(SKIN, 6);
    expect(sim.s.vel.x).toBe(0);
  });

  it('walks down ledges up to STEP_HEIGHT without leaving the ground, falls from higher ones', () => {
    for (const h of [0.25, STEP_HEIGHT, 0.6]) {
      const world = flatWorld(solid(-20, 0, -5, 0, h, 5));
      const sim = new Sim(world, -3, h, 0);
      let airborne = 0;
      sim.run(seconds(1.5), BTN.Forward, YAW.posX, (p, i) => {
        if (i > 0 && !p.s.onGround) airborne++;
      });
      expect(sim.s.pos.x).toBeGreaterThan(2);
      expect(sim.s.pos.y).toBeCloseTo(SKIN, 6);
      if (h <= STEP_HEIGHT) {
        expect(airborne).toBe(0);
        expect(sim.landings.length).toBe(0);
      } else {
        expect(airborne).toBeGreaterThan(5);
        expect(sim.landings.length).toBe(1);
      }
    }
  });

  it('cannot step up when there is no headroom above the step', () => {
    // 0.4 m step under a ceiling 2.0 m above the floor: the 1.8 m hull would need 2.2 m.
    const world = flatWorld(solid(3, 0, -5, 20, 0.4, 5), solid(-5, 2, -5, 20, 2.3, 5));
    const sim = new Sim(world, 0, 0, 0).run(seconds(2), BTN.Forward, YAW.posX, (p) => {
      expect(insideSolid(world, p.s)).toBe(false);
    });
    expect(sim.s.pos.x).toBeLessThan(3 - PLAYER_HALF_WIDTH);
    // Crouched (1.3 m hull) it fits: 0.4 + 1.3 < 2.0.
    const ducked = new Sim(world, 0, 0, 0).run(seconds(4), BTN.Forward | BTN.Crouch, YAW.posX);
    expect(ducked.s.pos.x).toBeGreaterThan(4);
    expect(ducked.s.pos.y).toBeCloseTo(0.4 + SKIN, 6);
  });

  it('jumps onto the 1.0 m crate of dev_test', () => {
    // Metal crate: x in [5.5, 7], z in [-2, 2], 1.0 m high. Run toward -Z and jump 1.8 m before it.
    const sim = new Sim(devWorld, 6.25, 0, 10);
    let jumped = false;
    for (let i = 0; i < seconds(3); i++) {
      const lead = sim.s.pos.z - PLAYER_HALF_WIDTH - 2;
      const jump = !jumped && lead <= 1.8;
      if (jump) jumped = true;
      sim.tick(BTN.Forward | (jump ? BTN.Jump : 0), YAW.negZ);
      expect(insideSolid(devWorld, sim.s)).toBe(false);
      if (jumped && sim.s.onGround) break;
    }
    expect(sim.jumps).toBe(1);
    expect(sim.s.onGround).toBe(true);
    expect(sim.s.pos.y).toBeCloseTo(1 + SKIN, 6);
    expect(sim.s.pos.z).toBeLessThan(2 + PLAYER_HALF_WIDTH);
    // Walking into the same crate without jumping does not climb it.
    const walker = new Sim(devWorld, 6.25, 0, 10).run(seconds(3), BTN.Forward, YAW.negZ);
    expect(walker.s.pos.y).toBeCloseTo(SKIN, 6);
    expect(walker.s.pos.z).toBeGreaterThan(2 + PLAYER_HALF_WIDTH);
  });

  it('in the air, only obstacles low enough to be stepped onto preserve the speed', () => {
    // Run toward a ledge and jump right in front of it, so that it is hit while still rising;
    // then look at the player a quarter of a second later.
    const run = (height: number): Sim => {
      const world = flatWorld(solid(3, 0, -5, 20, height, 5));
      const sim = new Sim(world, -6, 0, 0);
      while (3 - PLAYER_HALF_WIDTH - sim.s.pos.x > 0.15) sim.tick(BTN.Forward, YAW.posX);
      expect(speedOf(sim.s)).toBeCloseTo(RUN, 6);
      sim.tick(BTN.Forward | BTN.Jump, YAW.posX);
      expect(sim.jumps).toBe(1);
      for (let i = 0; i < seconds(0.25); i++) {
        sim.tick(BTN.Forward, YAW.posX);
        // The face of the ledge blocks the way for as long as the feet are below its top.
        if (sim.s.pos.y < height) expect(sim.s.pos.x).toBeLessThan(3 - PLAYER_HALF_WIDTH);
        expect(insideSolid(world, sim.s)).toBe(false);
      }
      return sim;
    };
    // A 0.4 m ledge could be stepped onto: the run speed is carried over it.
    const low = run(0.4);
    expect(low.s.vel.x).toBeCloseTo(RUN, 6);
    expect(low.s.pos.x).toBeGreaterThan(3.5);
    // A 0.9 m bench could not: the player bumps into it and loses its speed (holding forward
    // still gets it on top once the feet are above the bench, as in any Source game).
    const high = run(0.9);
    expect(high.s.vel.x).toBeLessThanOrEqual(MOVE.airMaxWishSpeed + 1e-9);
    expect(high.s.pos.x).toBeLessThan(3);
    high.run(seconds(1), BTN.Forward, YAW.posX);
    expect(high.s.pos.y).toBeCloseTo(0.9 + SKIN, 6);
    // A wall, obviously, stops the player.
    const wall = run(3);
    expect(wall.s.vel.x).toBe(0);
    expect(wall.s.pos.x).toBeLessThan(3 - PLAYER_HALF_WIDTH);
  });

  it('cannot jump onto something higher than the jump apex', () => {
    const world = flatWorld(solid(3, 0, -5, 20, 1.3, 5));
    for (const distance of [0.3, 0.8, 1.3, 1.8, 2.3]) {
      const sim = new Sim(world, -6, 0, 0);
      let jumped = false;
      for (let i = 0; i < seconds(3); i++) {
        const jump = !jumped && 3 - PLAYER_HALF_WIDTH - sim.s.pos.x <= distance;
        if (jump) jumped = true;
        sim.tick(BTN.Forward | (jump ? BTN.Jump : 0), YAW.posX);
      }
      expect(sim.jumps).toBe(1);
      expect(sim.s.pos.y).toBeCloseTo(SKIN, 6);
      expect(sim.s.pos.x).toBeLessThan(3 - PLAYER_HALF_WIDTH);
    }
  });

  it('walks through a 1.0 m wide doorway', () => {
    // Wall in the plane x = 3 with an opening for z in [-0.5, 0.5], 2.1 m high.
    const world = flatWorld(
      solid(3, 0, -10, 3.2, 3, -0.5),
      solid(3, 0, 0.5, 3.2, 3, 10),
      solid(3, 2.1, -0.5, 3.2, 3, 0.5),
    );
    const through = new Sim(world, 0, 0, 0).run(seconds(1.5), BTN.Forward, YAW.posX);
    expect(through.s.pos.x).toBeGreaterThan(5);
    // Arriving off-centre and at an angle, the player slides along the wall into the opening.
    const sliding = new Sim(world, 0, 0, 2.5).run(seconds(3), BTN.Forward, YAW.posX + 0.5, (p) => {
      expect(insideSolid(world, p.s)).toBe(false);
    });
    expect(sliding.s.pos.x).toBeGreaterThan(4);
  });
});

describe('no tunnelling', () => {
  // 0.2 m wall in the plane x = 5.
  const world = flatWorld(solid(5, 0, -50, 5.2, 4, 50));
  const limit = 5 - PLAYER_HALF_WIDTH;

  it('a player moving at 60 m/s never crosses a 0.2 m wall', () => {
    for (let k = 0; k < 40; k++) {
      // Different starting offsets so the wall falls anywhere within the 0.94 m travelled per tick.
      const sim = new Sim(world, -3 + k * 0.0237, 0, 0);
      for (let i = 0; i < 40; i++) {
        sim.s.vel.x = 60;
        sim.tick(BTN.Forward, YAW.posX);
        expect(sim.s.pos.x).toBeLessThan(limit);
        expect(insideSolid(world, sim.s)).toBe(false);
      }
      expect(sim.s.pos.x).toBeGreaterThan(limit - 0.01);
      expect(sim.s.vel.x).toBe(0);
    }
  });

  it('nor in the air, nor diagonally, nor at absurd speeds', () => {
    const rng = mulberry32(11);
    for (let k = 0; k < 60; k++) {
      const sim = new Sim(world, -2 + rng() * 2, rng() * 2, (rng() - 0.5) * 10);
      const speed = k % 3 === 0 ? 5000 : 60 + rng() * 200;
      for (let i = 0; i < 20; i++) {
        sim.s.vel.x = speed;
        sim.s.vel.z = (rng() - 0.5) * 40;
        sim.tick(0, 0);
        expect(sim.s.pos.x).toBeLessThan(limit);
        expect(Math.abs(sim.s.pos.z)).toBeLessThan(50);
        expect(sim.s.pos.y).toBeGreaterThan(0);
        expect(insideSolid(world, sim.s)).toBe(false);
      }
    }
  });

  it('a single 60 m/s shove toward the wall ends against it', () => {
    const sim = new Sim(world, 0, 0, 0);
    sim.tick(0);
    sim.s.vel.x = 60;
    sim.run(seconds(1), 0);
    expect(sim.s.pos.x).toBeLessThan(limit);
    expect(sim.s.pos.x).toBeGreaterThan(limit - 0.01);
  });
});

describe('seams between boxes', () => {
  it('running on a floor made of 1 m tiles keeps full speed and never leaves the ground', () => {
    const tiles: Solid[] = [];
    for (let x = -3; x < 45; x++) for (let z = -6; z < 30; z++) tiles.push(solid(x, -0.2, z, x + 1, 0, z + 1));
    const world = new CollisionWorld(tiles);
    for (const [yaw, buttons] of [
      [YAW.posX, BTN.Forward],
      [YAW.posX + 0.05, BTN.Forward],
      [YAW.posX, BTN.Forward | BTN.Right],
      [YAW.posX - 0.3, BTN.Forward | BTN.Walk],
    ] as const) {
      const sim = new Sim(world, 0, 0, 0.5);
      sim.tick(0);
      const y = sim.s.pos.y;
      const top = buttons & BTN.Walk ? RUN * MOVE.walkMul : RUN;
      sim.run(seconds(4), buttons, yaw, (p, i) => {
        expect(p.s.onGround).toBe(true);
        expect(p.s.pos.y).toBe(y);
        expect(p.s.vel.y).toBe(0);
        if (i > seconds(1)) expect(speedOf(p.s)).toBeCloseTo(top, 9);
      });
      expect(Math.hypot(sim.s.pos.x, sim.s.pos.z - 0.5)).toBeGreaterThan(top * 3.4);
      expect(sim.landings.length).toBe(0);
    }
  });

  it('running along a wall made of stacked and adjacent boxes never snags', () => {
    // Wall in the plane x = 0 (solid for x < 0): two staggered courses of bricks of different lengths.
    const bricks: Solid[] = [solid(-5, -1, -5, 60, 0, 60)];
    for (let z = -4; z < 50; z += 0.7) bricks.push(solid(-0.3, 0, z, 0, 0.9, z + 0.7));
    for (let z = -4.35; z < 50; z += 1.1) bricks.push(solid(-0.3, 0.9, z, 0, 2.5, z + 1.1));
    const world = new CollisionWorld(bricks);

    // 1. Brushing the wall while running parallel to it: full speed.
    for (const gap of [0, SKIN, 0.0004]) {
      const sim = new Sim(world, PLAYER_HALF_WIDTH + gap, 0, 0);
      sim.run(seconds(5), BTN.Forward, YAW.posZ, (p, i) => {
        if (i > seconds(1)) expect(speedOf(p.s)).toBeCloseTo(RUN, 9);
        expect(insideSolid(world, p.s)).toBe(false);
      });
      expect(sim.s.pos.z).toBeGreaterThan(25);
    }

    // 2. Pushing into the wall at an angle: slides along it at a steady speed, without a hitch.
    for (const angle of [0.2, Math.PI / 4, 1.2]) {
      const sim = new Sim(world, 1, 0, 0);
      let last = 0;
      sim.run(seconds(6), BTN.Forward, YAW.posZ - angle, (p) => {
        // The speed along the wall only ever builds up: a snag on a seam would make it drop.
        expect(p.s.vel.z).toBeGreaterThanOrEqual(last - 1e-12);
        last = p.s.vel.z;
        expect(insideSolid(world, p.s)).toBe(false);
      });
      // Pressed against the wall (within the skin), never inside it.
      expect(sim.s.pos.x).toBeGreaterThan(PLAYER_HALF_WIDTH);
      expect(sim.s.pos.x).toBeLessThan(PLAYER_HALF_WIDTH + SKIN * 1.01);
      expect(sim.s.vel.x).toBe(0);
      // Steady state of friction + acceleration with the velocity clipped to the wall.
      const cos = Math.cos(angle);
      const k = 1 - MOVE.friction * TICK_DT;
      const uncapped = (MOVE.accel * RUN * cos) / MOVE.friction;
      const capped = (RUN * cos) / (1 - k + k * cos * cos);
      expect(sim.s.vel.z).toBeCloseTo(Math.min(uncapped, capped), 6);
      expect(sim.s.pos.z).toBeGreaterThan(sim.s.vel.z * 5);
    }
  });

  it('strafe-jumping along a tiled corridor never catches on a seam', () => {
    const solids: Solid[] = [];
    for (let z = 0; z < 60; z++) {
      solids.push(solid(-1, -0.2, z, 1, 0, z + 1)); // floor
      solids.push(solid(-1.2, 0, z, -1, 3, z + 1)); // left wall
      solids.push(solid(1, 0, z, 1.2, 3, z + 1)); // right wall
    }
    const world = new CollisionWorld(solids);
    const sim = new Sim(world, 0, 0, 1);
    const rng = mulberry32(3);
    let buttons = BTN.Forward;
    for (let i = 0; i < seconds(8); i++) {
      if (i % 16 === 0) {
        buttons = BTN.Forward | (rng() < 0.5 ? BTN.Left : BTN.Right) | (rng() < 0.4 ? BTN.Jump : 0);
      }
      sim.tick(buttons, YAW.posZ);
      expect(insideSolid(world, sim.s)).toBe(false);
      // A seam catching the hull would stop it dead; landing slow-downs and wall friction do not.
      if (i > seconds(1.5)) expect(sim.s.vel.z).toBeGreaterThan(1.5);
    }
    expect(sim.s.pos.z).toBeGreaterThan(30);
    expect(Math.abs(sim.s.pos.x)).toBeLessThan(1 - PLAYER_HALF_WIDTH);
  });
});

describe('safety', () => {
  it('pushes a player that starts inside the floor back onto it', () => {
    for (const depth of [1e-9, 0.0005, 0.004, 0.05, 0.3, 0.9]) {
      const world = flatWorld();
      const sim = new Sim(world, 0, -depth, 0);
      sim.run(seconds(1), 0);
      expect(insideSolid(world, sim.s)).toBe(false);
      expect(sim.s.onGround).toBe(true);
      expect(sim.s.pos.y).toBeGreaterThan(0);
      expect(sim.s.pos.y).toBeLessThan(0.002);
      expect(sim.s.pos.x).toBe(0);
      expect(sim.s.pos.z).toBe(0);
    }
  });

  it('frees a player spawned inside a prop', () => {
    // Inside the big central crate of dev_test (3 x 1.2 x 3 m, with a smaller crate on top).
    for (const [x, z] of [
      [1.2, 1.2],
      [-1.3, 0.2],
      [0, 0],
    ] as const) {
      const sim = new Sim(devWorld, x, 0.3, z);
      sim.tick(0);
      expect(insideSolid(devWorld, sim.s)).toBe(false);
      sim.run(seconds(1.5), 0);
      expect(insideSolid(devWorld, sim.s)).toBe(false);
      expect(sim.s.onGround).toBe(true);
    }
  });

  it('ducks instead of moving when only the head is in a ceiling', () => {
    const world = flatWorld(solid(-5, 1.4, -5, 5, 1.7, 5));
    const sim = new Sim(world, 0, SKIN, 0);
    sim.tick(0);
    expect(sim.s.crouch).toBe(1);
    expect(sim.s.pos.x).toBe(0);
    expect(sim.s.pos.z).toBe(0);
    expect(sim.s.pos.y).toBeCloseTo(SKIN, 9);
    expect(insideSolid(world, sim.s)).toBe(false);
  });

  it('stays put (and finite) when completely entombed', () => {
    const world = new CollisionWorld([solid(-10, -10, -10, 10, 10, 10)]);
    const sim = new Sim(world, 0, 0, 0);
    sim.s.vel = { x: 3, y: -2, z: 1 };
    sim.run(10, BTN.Forward | BTN.Jump);
    expect(sim.s.pos).toEqual({ x: 0, y: 0, z: 0 });
    expect(sim.s.vel).toEqual({ x: 0, y: 0, z: 0 });
    expect(sim.jumps).toBe(0);
  });

  it('never produces NaN, even from a corrupted state or command', () => {
    const world = flatWorld();
    const sim = new Sim(world, 0, 0, 0);
    sim.s.vel = { x: NaN, y: Infinity, z: -Infinity };
    sim.s.crouch = NaN;
    sim.s.landSlow = NaN;
    sim.tick(BTN.Forward, NaN);
    sim.s.pos.x = NaN;
    sim.s.yaw = NaN;
    sim.tick(BTN.Forward | BTN.Jump, Infinity);
    stepMovement(sim.s, { seq: 3, buttons: NaN, yaw: 0, pitch: 0, slot: -1, st: 0 }, world, NaN, sim.ev);
    stepMovement(sim.s, { seq: 4, buttons: BTN.Forward, yaw: 1e300, pitch: 0, slot: -1, st: 0 }, world, Infinity, sim.ev);
    stepMovement(sim.s, { seq: 5, buttons: BTN.Forward, yaw: 0.3, pitch: 0, slot: -1, st: 0 }, world, -5, sim.ev);
    for (const n of [sim.s.pos.x, sim.s.pos.y, sim.s.pos.z, sim.s.vel.x, sim.s.vel.y, sim.s.vel.z, sim.s.crouch, sim.s.landSlow]) {
      expect(Number.isFinite(n)).toBe(true);
    }
    expect(Number.isFinite(sim.ev.landedSpeed)).toBe(true);
    // And it keeps working afterwards.
    sim.run(seconds(2), BTN.Forward, 0);
    expect(speedOf(sim.s)).toBeCloseTo(RUN, 9);
  });
});

// --- Random play ---------------------------------------------------------------------------

/** Random but plausible input: keys held for a while, taps on jump, smooth or abrupt turns. */
function makeInput(seed: number): () => { buttons: number; yaw: number } {
  const rng = mulberry32(seed);
  let buttons = 0;
  let yaw = rng() * Math.PI * 2;
  let turn = 0;
  let hold = 0;
  return () => {
    if (hold-- <= 0) {
      hold = 2 + Math.floor(rng() * (rng() < 0.3 ? 12 : 90));
      buttons = 0;
      const r = rng();
      if (r < 0.75) buttons |= BTN.Forward;
      else if (r < 0.85) buttons |= BTN.Back;
      const side = rng();
      if (side < 0.25) buttons |= BTN.Left;
      else if (side < 0.5) buttons |= BTN.Right;
      if (rng() < 0.2) buttons |= BTN.Crouch;
      if (rng() < 0.15) buttons |= BTN.Walk;
      if (rng() < 0.35) buttons |= BTN.Jump;
      const t = rng();
      if (t < 0.25) yaw = Math.round(rng() * 8) * (Math.PI / 4); // axis-aligned and diagonal headings
      else if (t < 0.5) yaw = rng() * Math.PI * 2;
      turn = rng() < 0.5 ? 0 : (rng() - 0.5) * 0.12;
    } else if ((buttons & BTN.Jump) !== 0 && rng() < 0.5) {
      buttons &= ~BTN.Jump; // jump is usually a tap
    }
    yaw += turn;
    return { buttons, yaw };
  };
}

describe('determinism', () => {
  function play(seed: number, ticks: number, record: string[]): PlayerState {
    const spawn = devMap.spawns[seed % devMap.spawns.length]!;
    const sim = new Sim(devWorld, spawn.pos.x, spawn.pos.y, spawn.pos.z);
    const input = makeInput(seed);
    for (let i = 0; i < ticks; i++) {
      const { buttons, yaw } = input();
      const ev = sim.tick(buttons, yaw);
      record.push(JSON.stringify([sim.s, ev.jumped, ev.landedSpeed]));
    }
    return sim.s;
  }

  it('the same command sequence twice gives bit-identical states', () => {
    for (const seed of [1, 2, 3]) {
      const a: string[] = [];
      const b: string[] = [];
      play(seed, seconds(30), a);
      // Interleave another player between the two runs: no hidden state may leak across calls.
      play(seed + 100, 500, []);
      play(seed, seconds(30), b);
      expect(b.length).toBe(a.length);
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) throw new Error(`seed ${seed}: states differ at tick ${i}\n${a[i]}\n${b[i]}`);
      }
    }
  });

  it('replaying from a saved state reproduces the same future (client reconciliation)', () => {
    const spawn = devMap.spawns[0]!;
    const sim = new Sim(devWorld, spawn.pos.x, spawn.pos.y, spawn.pos.z);
    const input = makeInput(77);
    const cmds: { buttons: number; yaw: number }[] = [];
    for (let i = 0; i < seconds(20); i++) cmds.push(input());
    const saved: string[] = [];
    for (const c of cmds) {
      saved.push(JSON.stringify(sim.s));
      sim.tick(c.buttons, c.yaw);
    }
    const final = JSON.stringify(sim.s);
    for (const from of [0, 137, 640, 1000, 1279]) {
      const replay = new Sim(devWorld, 0, 0, 0);
      Object.assign(replay.s, JSON.parse(saved[from]!) as PlayerState);
      for (let i = from; i < cmds.length; i++) replay.tick(cmds[i]!.buttons, cmds[i]!.yaw);
      expect(JSON.stringify(replay.s)).toBe(final);
    }
  });
});

describe('fuzz', () => {
  it('20 random players for 60 s each never end inside a solid, leave the map or produce NaN', () => {
    const { min, max } = devMap.bounds;
    const TICKS = seconds(60);
    let onWalkway = 0;
    let jumps = 0;
    let crouched = 0;
    let travelled = 0;
    const t0 = performance.now();
    // Half of the players start from a spawn point, the others from interesting places.
    const starts: [number, number, number][] = [
      [12, 0, -14.6], // foot of the stairs
      [12, 2.001, -10.2], // top of the stairs
      [13.5, 2.001, 0], // walkway
      [15.6, 2.001, 9.6], // walkway corner, against two walls
      [-11.5, 0, 0], // inside the hut
      [-9.6, 0, 0], // in the hut doorway
      [6.25, 1.001, 0], // on a crate
      [0, 2.201, 0], // top of the crate stack
      [12, 0, -8], // under the walkway (1.8 m of headroom)
      [-15.6, 0, -15.6], // map corner
    ];
    for (let player = 0; player < 20; player++) {
      const spawn = devMap.spawns[player % devMap.spawns.length]!;
      const start = player % 2 === 1 ? starts[(player - 1) / 2]! : ([spawn.pos.x, spawn.pos.y, spawn.pos.z] as const);
      const sim = new Sim(devWorld, start[0], start[1], start[2]);
      const input = makeInput(1000 + player);
      let walkway = false;
      for (let i = 0; i < TICKS; i++) {
        const { buttons, yaw } = input();
        const px = sim.s.pos.x;
        const pz = sim.s.pos.z;
        sim.tick(buttons, yaw);
        const s = sim.s;
        const sum = s.pos.x + s.pos.y + s.pos.z + s.vel.x + s.vel.y + s.vel.z + s.crouch + s.landSlow + sim.ev.landedSpeed;
        if (!Number.isFinite(sum)) throw new Error(`player ${player}, tick ${i}: non-finite state ${JSON.stringify(s)}`);
        if (insideSolid(devWorld, s)) throw new Error(`player ${player}, tick ${i}: inside a solid ${JSON.stringify(s.pos)}`);
        if (
          s.pos.x < min.x || s.pos.x > max.x || s.pos.y < min.y || s.pos.y > max.y || s.pos.z < min.z || s.pos.z > max.z ||
          s.pos.y < -1e-9
        ) {
          throw new Error(`player ${player}, tick ${i}: left the map ${JSON.stringify(s.pos)}`);
        }
        // Sanity of the other outputs.
        if (s.crouch < 0 || s.crouch > 1 || s.landSlow < MOVE.landingSlow || s.landSlow > 1) {
          throw new Error(`player ${player}, tick ${i}: bad crouch / landSlow ${s.crouch} ${s.landSlow}`);
        }
        if (s.onGround && s.vel.y !== 0) throw new Error(`player ${player}, tick ${i}: vertical speed on the ground`);
        if (s.vel.y < -MOVE.maxFallSpeed) throw new Error(`player ${player}, tick ${i}: falling too fast`);
        // No teleporting: horizontal steps stay in the range of the run speed (air strafing and
        // wall sliding can exceed it slightly).
        const moved = Math.hypot(s.pos.x - px, s.pos.z - pz);
        if (moved > RUN * 1.5 * TICK_DT) throw new Error(`player ${player}, tick ${i}: moved ${moved} m in one tick`);
        travelled += moved;
        if (s.onGround && s.pos.y > 1.9) walkway = true;
        if (s.crouch === 1) crouched++;
      }
      jumps += sim.jumps;
      if (walkway) onWalkway++;
    }
    const ms = performance.now() - t0;
    const steps = 20 * TICKS;
    console.log(
      `[fuzz] ${steps} player-ticks in ${ms.toFixed(0)} ms (${((ms * 1000) / steps).toFixed(2)} µs per tick incl. checks), ` +
        `${travelled.toFixed(0)} m travelled, ${jumps} jumps, ${onWalkway}/20 players reached the walkway, ` +
        `${((crouched / steps) * 100).toFixed(0)} % of ticks fully crouched`,
    );
    // The random walk really explores the map.
    expect(travelled).toBeGreaterThan(20 * 60);
    expect(jumps).toBeGreaterThan(200);
  });

  it('survives random shoves at up to 80 m/s', () => {
    const { min, max } = devMap.bounds;
    const rng = mulberry32(555);
    for (let player = 0; player < 10; player++) {
      const spawn = devMap.spawns[player % devMap.spawns.length]!;
      const sim = new Sim(devWorld, spawn.pos.x, spawn.pos.y, spawn.pos.z);
      const input = makeInput(2000 + player);
      for (let i = 0; i < seconds(30); i++) {
        if (rng() < 0.05) {
          const a = rng() * Math.PI * 2;
          const speed = 10 + rng() * 70;
          sim.s.vel.x = Math.cos(a) * speed;
          sim.s.vel.z = Math.sin(a) * speed;
          if (rng() < 0.3) sim.s.vel.y = -rng() * 40;
        }
        const { buttons, yaw } = input();
        sim.tick(buttons, yaw);
        const s = sim.s;
        if (!Number.isFinite(s.pos.x + s.pos.y + s.pos.z + s.vel.x + s.vel.y + s.vel.z)) {
          throw new Error(`player ${player}, tick ${i}: non-finite state`);
        }
        if (insideSolid(devWorld, s)) throw new Error(`player ${player}, tick ${i}: inside a solid ${JSON.stringify(s.pos)}`);
        if (s.pos.x < min.x || s.pos.x > max.x || s.pos.y < 0 || s.pos.y > max.y || s.pos.z < min.z || s.pos.z > max.z) {
          throw new Error(`player ${player}, tick ${i}: left the map ${JSON.stringify(s.pos)}`);
        }
      }
    }
  });

  it('movement cost per tick', () => {
    const sims: Sim[] = [];
    const inputs: (() => { buttons: number; yaw: number })[] = [];
    for (let i = 0; i < 16; i++) {
      const spawn = devMap.spawns[i % devMap.spawns.length]!;
      sims.push(new Sim(devWorld, spawn.pos.x, spawn.pos.y, spawn.pos.z));
      inputs.push(makeInput(3000 + i));
    }
    const TICKS = seconds(40);
    const cmds = inputs.map((input) => Array.from({ length: TICKS }, input));
    const t0 = performance.now();
    for (let i = 0; i < TICKS; i++) {
      for (let p = 0; p < sims.length; p++) sims[p]!.tick(cmds[p]![i]!.buttons, cmds[p]![i]!.yaw);
    }
    const ms = performance.now() - t0;
    const perTick = (ms * 1000) / (TICKS * sims.length);
    console.log(
      `[bench] stepMovement: ${perTick.toFixed(2)} µs per player-tick ` +
        `(16 players at ${TICK_RATE} Hz = ${((perTick * 16 * TICK_RATE) / 10000).toFixed(2)} % of one core)`,
    );
    expect(perTick).toBeLessThan(200);
  });
});
