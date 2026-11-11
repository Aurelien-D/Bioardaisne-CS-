import { describe, expect, it } from 'vitest';
import { ACTION, BTN, TICK_RATE } from '../src/shared/constants';
import { anglesFromDir } from '../src/shared/math/vec3';
import type { GameEvent, ServerMsg } from '../src/shared/protocol';
import { Room, sanitizeConfig } from '../src/shared/sim/room';
import type { MatchState } from '../src/shared/types';

const MAP = 'de_labo_charleville';
/** Open spot inside site B (reception), and a place well away from it. */
const SITE_B = { x: 24.5, y: 0.03, z: 27.4 };
const FAR = { x: 39, y: 0.03, z: 20 };

function makeRoom(cfg: Parameters<typeof sanitizeConfig>[0], seed = 11) {
  let clock = 0;
  const inbox = new Map<number, ServerMsg[]>();
  const room = new Room('TEST2', sanitizeConfig(cfg), {
    now: () => clock,
    send: (id, msg) => {
      const q = inbox.get(id) ?? [];
      q.push(JSON.parse(JSON.stringify(msg)) as ServerMsg);
      inbox.set(id, q);
    },
  }, seed);
  return {
    room,
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        clock += 1000 / TICK_RATE;
        room.tick();
      }
    },
    /** Events and last match state received by a client since the previous call. */
    take(id: number): { events: GameEvent[]; match: MatchState | null } {
      const q = inbox.get(id) ?? [];
      inbox.set(id, []);
      const events: GameEvent[] = [];
      let match: MatchState | null = null;
      for (const m of q) {
        if (m.t === 's') events.push(...m.ev);
        else if (m.t === 'match') match = m.match;
      }
      return { events, match };
    },
  };
}

/** Two humans, no bots: returns the attacker (team 1, carries the bomb) and the defender. */
function duel() {
  const h = makeRoom({ mapId: MAP, mode: 'defuse', botFill: 0, freezeTime: 0 });
  const x = h.room.addClient('Alice');
  const y = h.room.addClient('Bob');
  h.step(4);
  const players = h.room.debugState().players;
  const att = players.find((p) => p.team === 1)!;
  const def = players.find((p) => p.team === 0)!;
  expect([x, y]).toContain(att.id);
  expect([x, y]).toContain(def.id);
  let seq = 0;
  const hold = (id: number, buttons: number, ticks: number, yaw = 0, pitch = 0): void => {
    for (let i = 0; i < ticks; i++) {
      h.room.handleMessage(id, { t: 'c', c: [[++seq, buttons, yaw, pitch, -1, 0]] });
      h.step();
    }
  };
  const place = (p: typeof att, pos: { x: number; y: number; z: number }): void => {
    p.state.pos = { ...pos };
    p.state.vel = { x: 0, y: 0, z: 0 };
    p.state.protect = 0;
  };
  return { h, att, def, hold, place };
}

describe('bomb defusal mode ("Audit surprise")', () => {
  it('is an accepted mode with its own defaults', () => {
    const cfg = sanitizeConfig({ mode: 'defuse' });
    expect(cfg.mode).toBe('defuse');
    expect(cfg.killLimit).toBe(0);
    expect(cfg.roundsToWin).toBeGreaterThan(1);
  });

  it('gives the bomb to an attacker, who plants it on a site by holding Use', () => {
    const { h, att, def, hold, place } = duel();
    expect(h.room.debugState().bomb.carrier).toBe(att.id);
    // Outside a site, Use does nothing.
    place(att, FAR);
    place(def, { x: 8, y: 0.03, z: 3 });
    h.step(3);
    hold(att.id, BTN.Use, TICK_RATE);
    expect(att.state.action).toBe(ACTION.None);
    // On the site: planting locks the player; letting go cancels it.
    place(att, SITE_B);
    h.step(3);
    hold(att.id, BTN.Use, TICK_RATE);
    expect(att.state.action).toBe(ACTION.Plant);
    expect(att.state.actionT).toBeGreaterThan(0.2);
    const before = { ...att.state.pos };
    hold(att.id, BTN.Use | BTN.Forward, 20);
    expect(Math.hypot(att.state.pos.x - before.x, att.state.pos.z - before.z)).toBeLessThan(0.05);
    hold(att.id, 0, 3);
    expect(att.state.action).toBe(ACTION.None);
    expect(h.room.debugState().bomb.planted).toBeNull();
    // Holding all the way plants.
    h.take(def.id);
    hold(att.id, BTN.Use, Math.ceil(3.2 * TICK_RATE) + 8);
    const bomb = h.room.debugState().bomb;
    expect(bomb.planted).not.toBeNull();
    expect(bomb.planted!.site).toBe('B');
    expect(bomb.carrier).toBe(-1);
    expect(att.state.action).toBe(ACTION.None);
    const seen = h.take(def.id);
    expect(seen.events.some((e) => e.e === 'obj' && e.kind === 'bomb_planted')).toBe(true);
    expect(seen.match?.obj.kind).toBe('defuse');
    // The fuse replaces the round clock.
    expect(seen.match!.phaseEnd).toBe(bomb.planted!.explodeAt);
  });

  it('lets a defender defuse a planted bomb and win the round', () => {
    const { h, att, def, hold, place } = duel();
    place(att, SITE_B);
    place(def, FAR);
    h.step(3);
    hold(att.id, BTN.Use, Math.ceil(3.2 * TICK_RATE) + 8);
    const at = h.room.debugState().bomb.planted!.pos;
    // Too far: nothing happens.
    hold(def.id, BTN.Use, TICK_RATE);
    expect(def.state.action).toBe(ACTION.None);
    place(att, FAR);
    place(def, { x: at.x + 0.9, y: at.y, z: at.z });
    h.step(3);
    hold(def.id, BTN.Use, TICK_RATE * 2);
    expect(def.state.action).toBe(ACTION.Defuse);
    h.take(att.id);
    hold(def.id, BTN.Use, TICK_RATE * 6);
    const st = h.room.debugState();
    expect(st.bomb.defused).toBe(true);
    expect(st.lastReason).toBe('defused');
    expect(st.lastWinner).toBe(0);
    expect(st.score).toEqual([1, 0]);
    expect(h.take(att.id).events.some((e) => e.e === 'obj' && e.kind === 'bomb_defused')).toBe(true);
  });

  it('explodes when nobody defuses: the attackers win and the blast kills around the bomb', () => {
    const { h, att, def, hold, place } = duel();
    place(att, SITE_B);
    place(def, FAR);
    h.step(3);
    hold(att.id, BTN.Use, Math.ceil(3.2 * TICK_RATE) + 8);
    expect(h.room.debugState().bomb.planted).not.toBeNull();
    h.step(TICK_RATE * 39);
    expect(h.room.debugState().bomb.exploded).toBe(false);
    h.step(TICK_RATE * 2);
    const st = h.room.debugState();
    expect(st.bomb.exploded).toBe(true);
    expect(st.lastReason).toBe('exploded');
    expect(st.score).toEqual([0, 1]);
    expect(att.state.alive).toBe(false); // stood on the bomb
    expect(def.state.alive).toBe(true); // far away
  });

  it('ends the round on elimination and never respawns before the next round', () => {
    const { h, att, def, hold, place } = duel();
    place(att, { x: 9, y: 0.03, z: 3.5 });
    place(def, { x: 15, y: 0.03, z: 3.5 });
    h.step(3);
    let killed = false;
    for (let i = 0; i < TICK_RATE * 5 && !killed; i++) {
      const eye = { x: att.state.pos.x, y: att.state.pos.y + 1.64, z: att.state.pos.z };
      const aim = anglesFromDir({ x: def.state.pos.x - eye.x, y: def.state.pos.y + 1.2 - eye.y, z: def.state.pos.z - eye.z });
      hold(att.id, BTN.Fire, 1, aim.yaw, aim.pitch - att.state.punchPitch);
      killed = !def.state.alive;
    }
    expect(killed).toBe(true);
    let st = h.room.debugState();
    expect(st.lastReason).toBe('elimination');
    expect(st.lastWinner).toBe(1);
    expect(st.phase).toBe('post');
    // Still dead well after a team-deathmatch respawn delay…
    h.step(TICK_RATE * 4);
    expect(def.state.alive).toBe(false);
    // …and back, with a fresh bomb, when the next round starts.
    h.step(TICK_RATE * 2);
    st = h.room.debugState();
    expect(st.round).toBe(2);
    expect(def.state.alive).toBe(true);
    expect(att.state.alive).toBe(true);
    expect(st.bomb.planted).toBeNull();
    expect(st.bomb.carrier).toBe(att.id);
  });

  it('drops the bomb when its carrier dies and lets a team-mate pick it up', () => {
    const h = makeRoom({ mapId: MAP, mode: 'defuse', botFill: 0, freezeTime: 0 });
    for (const n of ['A', 'B', 'C', 'D']) h.room.addClient(n);
    h.step(4);
    const st = h.room.debugState();
    const carrier = st.players.find((p) => p.id === st.bomb.carrier)!;
    const mate = st.players.find((p) => p.team === 1 && p.id !== carrier.id)!;
    expect(carrier.team).toBe(1);
    // The carrier falls out of the world.
    carrier.state.pos = { x: 20, y: -80, z: 4 };
    mate.state.pos = { x: 30, y: 0.03, z: 4 };
    for (let i = 0; i < 3; i++) {
      h.room.handleMessage(carrier.id, { t: 'c', c: [[i + 1, 0, 0, 0, -1, 0]] });
      h.step();
    }
    expect(carrier.state.alive).toBe(false);
    const bomb = h.room.debugState().bomb;
    expect(bomb.carrier).toBe(-1);
    expect(bomb.dropped).not.toBeNull();
    // Fallen out of the world, the bomb is put back where the attackers start.
    expect(bomb.dropped!.y).toBeGreaterThan(-5);
    mate.state.pos = { x: bomb.dropped!.x + 0.3, y: bomb.dropped!.y, z: bomb.dropped!.z };
    h.step(2);
    expect(h.room.debugState().bomb.carrier).toBe(mate.id);
    expect(h.room.debugState().bomb.dropped).toBeNull();
  });

  it('lets bots play whole rounds: they plant, defuse and eliminate', () => {
    const h = makeRoom({ mapId: MAP, mode: 'defuse', botFill: 10, botDifficulty: 2, freezeTime: 1 }, 5);
    const reasons = new Map<string, number>();
    let plants = 0;
    let wasPlanted = false;
    let phase = h.room.debugState().phase;
    let roundTicks = 0;
    let longest = 0;
    for (let i = 0; i < TICK_RATE * 60 * 14; i++) {
      h.step();
      const st = h.room.debugState();
      const planted = st.bomb.planted !== null;
      if (planted && !wasPlanted) plants++;
      wasPlanted = planted;
      if (st.phase === 'live') roundTicks++;
      if (phase === 'live' && st.phase !== 'live') {
        // A round just ended.
        reasons.set(st.lastReason, (reasons.get(st.lastReason) ?? 0) + 1);
        longest = Math.max(longest, roundTicks);
        roundTicks = 0;
      }
      phase = st.phase;
    }
    const total = [...reasons.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(4);
    for (const r of reasons.keys()) expect(['elimination', 'defused', 'exploded', 'time']).toContain(r);
    expect(plants).toBeGreaterThanOrEqual(1);
    console.log(`bots, ${total} rounds: ${[...reasons].map(([k, v]) => `${k} ${v}`).join(', ')} — ${plants} plants, longest round ${(longest / TICK_RATE).toFixed(0)} s`);
    // A round can never outlast its clock plus the fuse (and the pauses between rounds).
    expect(longest / TICK_RATE).toBeLessThan(135 + 40 + 20);
  });
});
