import { describe, expect, it } from 'vitest';
import { BTN, TICK_RATE } from '../src/shared/constants';
import { getMap } from '../src/shared/maps';
import { anglesFromDir } from '../src/shared/math/vec3';
import { NavGrid } from '../src/shared/nav/navgrid';
import { CollisionWorld } from '../src/shared/physics/world';
import type { ServerMsg, S_Snapshot } from '../src/shared/protocol';
import { Room, sanitizeConfig } from '../src/shared/sim/room';

function makeRoom(cfg: Parameters<typeof sanitizeConfig>[0], seed = 7) {
  let clock = 0;
  const inbox = new Map<number, ServerMsg[]>();
  const room = new Room('TEST1', sanitizeConfig(cfg), {
    now: () => clock,
    send: (id, msg) => {
      const q = inbox.get(id) ?? [];
      q.push(JSON.parse(JSON.stringify(msg)) as ServerMsg);
      inbox.set(id, q);
    },
  }, seed);
  return {
    room,
    inbox,
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        clock += 1000 / TICK_RATE;
        room.tick();
      }
    },
    take(id: number): ServerMsg[] {
      const q = inbox.get(id) ?? [];
      inbox.set(id, []);
      return q;
    },
  };
}

describe('navigation', () => {
  it('builds a connected grid on dev_test and finds a path up the stairs', () => {
    const map = getMap('dev_test');
    const world = new CollisionWorld(map.solids);
    const nav = NavGrid.build(world, map);
    expect(nav.stats.nodes).toBeGreaterThan(2000);
    for (const s of map.spawns) expect(nav.nearest(s.pos, 1.5)).not.toBeNull();
    const top = map.points.find((p) => p.id === 'passerelle')!;
    const path = nav.findPath(map.spawns[0]!.pos, top.pos);
    expect(path).not.toBeNull();
    expect(path![path!.length - 1]!.y).toBeGreaterThan(1.5);
  });
});

describe('room simulation', () => {
  it('runs a bot match: kills, rounds and a match end', () => {
    const h = makeRoom({ mapId: 'dev_test', botFill: 8, botDifficulty: 1, killLimit: 10, roundsToWin: 2, freezeTime: 1, roundTime: 120 });
    const id = h.room.addClient('Testeur');
    expect(h.room.debugState().players.length).toBe(8);
    let kills = 0;
    let matchOver = false;
    let maxSnap = 0;
    const t0 = performance.now();
    const ticks = TICK_RATE * 60 * 8;
    for (let i = 0; i < ticks && !matchOver; i++) {
      h.step();
      for (const m of h.take(id)) {
        if (m.t === 's') {
          maxSnap = Math.max(maxSnap, JSON.stringify(m).length);
          for (const e of m.ev) if (e.e === 'kill') kills++;
        } else if (m.t === 'match' && m.match.phase === 'over') matchOver = true;
      }
    }
    const ms = performance.now() - t0;
    const st = h.room.debugState();
    console.log(`bot match: ${kills} kills, round ${st.round}, score ${st.score}, tick ${(ms / st.tick).toFixed(3)} ms, max snapshot ${maxSnap} bytes`);
    expect(kills).toBeGreaterThan(15);
    expect(matchOver).toBe(true);
    for (const p of st.players) {
      expect(Number.isFinite(p.state.pos.x + p.state.pos.y + p.state.pos.z)).toBe(true);
    }
    expect(ms / st.tick).toBeLessThan(4);
  });

  it('lets a human move, shoot and kill with server authority', () => {
    const h = makeRoom({ mapId: 'dev_test', botFill: 0, freezeTime: 0, killLimit: 0, respawnDelay: 1 });
    const a = h.room.addClient('Alice');
    const b = h.room.addClient('Bob');
    h.step(4);
    const last = (id: number): S_Snapshot => {
      const snaps = h.take(id).filter((m): m is S_Snapshot => m.t === 's');
      return snaps[snaps.length - 1]!;
    };
    let seq = 0;
    let sa = last(a);
    last(b);
    expect(sa.you).not.toBeNull();
    const start = { ...sa.you!.pos };
    // Walk forward for one second.
    for (let i = 0; i < TICK_RATE; i++) {
      h.room.handleMessage(a, { t: 'c', c: [[++seq, BTN.Forward, sa.you!.yaw, 0, -1, 0]] });
      h.step();
    }
    sa = last(a);
    expect(sa.ack).toBe(seq);
    expect(Math.hypot(sa.you!.pos.x - start.x, sa.you!.pos.z - start.z)).toBeGreaterThan(3);
    // Teleport-free duel: put them face to face through the debug state.
    const st = h.room.debugState();
    const pa = st.players.find((p) => p.id === a)!;
    const pb = st.players.find((p) => p.id === b)!;
    expect(pa.team).not.toBe(pb.team);
    pa.state.pos = { x: 0, y: 0.01, z: 10 };
    pb.state.pos = { x: 0, y: 0.01, z: 4 };
    pa.state.vel = { x: 0, y: 0, z: 0 };
    pa.state.protect = 0;
    pb.state.protect = 0;
    h.step(3);
    let killed = false;
    let hits = 0;
    for (let i = 0; i < TICK_RATE * 4 && !killed; i++) {
      const eye = { x: pa.state.pos.x, y: pa.state.pos.y + 1.64, z: pa.state.pos.z };
      const aim = anglesFromDir({ x: pb.state.pos.x - eye.x, y: pb.state.pos.y + 1.2 - eye.y, z: pb.state.pos.z - eye.z });
      h.room.handleMessage(a, { t: 'c', c: [[++seq, BTN.Fire, aim.yaw, aim.pitch - pa.state.punchPitch, -1, 0]] });
      h.step();
      for (const m of h.take(a)) {
        if (m.t !== 's') continue;
        for (const e of m.ev) {
          if (e.e === 'hit') hits++;
          if (e.e === 'kill' && e.killer === a && e.victim === b) killed = true;
        }
      }
    }
    expect(hits).toBeGreaterThan(1);
    expect(killed).toBe(true);
    expect(h.room.debugState().players.find((p) => p.id === a)!.kills).toBe(1);
    // Bob respawns.
    h.step(TICK_RATE * 2);
    expect(h.room.debugState().players.find((p) => p.id === b)!.state.alive).toBe(true);
  });

  it('survives hostile input and manages bots as humans come and go', () => {
    const h = makeRoom({ mapId: 'dev_test', botFill: 6 });
    const a = h.room.addClient('  A\u0000lice\n  ');
    expect(h.room.debugState().players.filter((p) => p.bot).length).toBe(5);
    const b = h.room.addClient('Alice');
    expect(h.room.debugState().players.filter((p) => p.bot).length).toBe(4);
    const bad: unknown[] = [null, 42, 'x', {}, { t: 'c' }, { t: 'c', c: 'no' }, { t: 'c', c: [[1, 2]] }, { t: 'c', c: [[NaN, 0, 0, 0, 0, 0]] },
      { t: 'chat', text: 12 }, { t: 'team', team: 'x' }, { t: 'loadout', primary: 'nope', secondary: 'pistol' }, { t: 'config', patch: { mapId: 1 }, restart: true }, { t: 'zzz' }];
    for (const m of bad) expect(() => h.room.handleMessage(a, m as never)).not.toThrow();
    h.room.handleMessage(b, { t: 'config', patch: { botFill: 0 }, restart: false });
    expect(h.room.config.botFill).toBe(6); // not the host
    h.room.removeClient(a);
    h.step(10);
    expect(h.room.debugState().players.filter((p) => p.bot).length).toBe(5);
    h.room.handleMessage(b, { t: 'config', patch: { botFill: 0 }, restart: false });
    expect(h.room.debugState().players.filter((p) => p.bot).length).toBe(0);
  });
});
