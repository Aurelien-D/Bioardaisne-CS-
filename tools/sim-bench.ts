/**
 * Headless bot match used to validate maps and bot behaviour.
 * Usage: npx tsx tools/sim-bench.ts --map de_labo_charleville [--bots 10] [--minutes 4] [--difficulty 1] [--seed 1]
 */
import { TICK_RATE } from '../src/shared/constants';
import type { ServerMsg } from '../src/shared/protocol';
import { Room, sanitizeConfig } from '../src/shared/sim/room';

const arg = (n: string, d: string): string => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? (process.argv[i + 1] ?? d) : d;
};
const mapId = arg('map', 'dev_test');
const bots = Number(arg('bots', '10'));
const minutes = Number(arg('minutes', '4'));
const difficulty = Number(arg('difficulty', '1'));
let clock = 0;
let kills = 0;
const room = new Room(
  'BENCH',
  sanitizeConfig({ mapId, botFill: bots + 1, botDifficulty: difficulty, killLimit: 0, roundTime: 1200, freezeTime: 1, roundsToWin: 9 }),
  {
    now: () => clock,
    send: (_id: number, m: ServerMsg) => {
      if (m.t === 's') for (const e of m.ev) if (e.e === 'kill') kills++;
    },
  },
  Number(arg('seed', '1')),
);
const me = room.addClient('Observateur');
room.handleMessage(me, { t: 'team', team: 2 });
const ticks = Math.round(minutes * 60 * TICK_RATE);
const last = new Map<number, { x: number; z: number; dist: number; stuck: number; mark: { x: number; z: number } }>();
const t0 = performance.now();
let worst = 0;
for (let i = 0; i < ticks; i++) {
  clock += 1000 / TICK_RATE;
  const a = performance.now();
  room.tick();
  worst = Math.max(worst, performance.now() - a);
  if (i % TICK_RATE === 0) {
    for (const p of room.debugState().players) {
      if (!p.bot) continue;
      const s = p.state;
      let r = last.get(p.id);
      if (!r) last.set(p.id, (r = { x: s.pos.x, z: s.pos.z, dist: 0, stuck: 0, mark: { x: s.pos.x, z: s.pos.z } }));
      const d = Math.hypot(s.pos.x - r.x, s.pos.z - r.z);
      if (d < 20) r.dist += d;
      r.x = s.pos.x;
      r.z = s.pos.z;
      if (i % (TICK_RATE * 5) === 0) {
        if (s.alive && Math.hypot(s.pos.x - r.mark.x, s.pos.z - r.mark.z) < 0.5) r.stuck += 5;
        r.mark = { x: s.pos.x, z: s.pos.z };
      }
    }
  }
}
const ms = performance.now() - t0;
const st = room.debugState();
const rows = st.players.filter((p) => p.bot);
console.log(`Carte ${mapId} — ${rows.length} bots, difficulté ${difficulty}, ${minutes} min simulées en ${(ms / 1000).toFixed(1)} s`);
console.log(`Éliminations : ${kills} (${(kills / minutes).toFixed(1)} / min) — Labo ${st.kills[0]} · Auditeurs ${st.kills[1]}`);
console.log(`Tick : ${(ms / ticks).toFixed(3)} ms en moyenne, ${worst.toFixed(1)} ms au pire`);
let stuck = 0;
for (const p of rows) {
  const r = last.get(p.id)!;
  stuck += r.stuck;
  console.log(`  ${p.name.padEnd(20)} équipe ${p.team}  ${String(p.kills).padStart(3)} élim. / ${String(p.deaths).padStart(3)} morts  ${r.dist.toFixed(0).padStart(5)} m parcourus  ${r.stuck} s immobile`);
}
console.log(`Temps immobile cumulé : ${stuck} s sur ${Math.round(rows.length * minutes * 60)} s-bot`);
