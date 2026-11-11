/**
 * Menu music: an original 16-bar loop in A minor at 104 BPM — warm pad, pulsing
 * bass, light percussion, a plucked arpeggio through a dotted-eighth echo and a
 * glassy lead (bars 9-16). Rendered once, with the release tails folded back onto
 * the first bars so the loop point is inaudible.
 */
import { defineSound } from '../bank';
import type { Kit } from '../kit';
import { chime, hat, hz, kick, pluck, rim, shaker, snare } from './instruments';

const BPM = 104;
const BEAT = 60 / BPM;
const STEP = BEAT / 4;
const BAR = BEAT * 4;
const BARS = 16;
const LENGTH = BAR * BARS;
const TAIL = 3.2;

interface Chord {
  pad: number[];
  bass: number;
  arp: number[];
}

const Am9: Chord = { pad: [57, 60, 64, 67, 71], bass: 45, arp: [69, 72, 76, 79, 83] };
const Fmaj7: Chord = { pad: [53, 57, 60, 64], bass: 41, arp: [69, 72, 76, 77, 81] };
const Cadd9: Chord = { pad: [55, 60, 62, 64, 67], bass: 48, arp: [67, 72, 74, 76, 79] };
const G6: Chord = { pad: [55, 59, 62, 64], bass: 43, arp: [67, 71, 74, 76, 79] };
const Dm7: Chord = { pad: [53, 57, 60, 62, 65], bass: 38, arp: [69, 72, 74, 77, 81] };
const Em7: Chord = { pad: [52, 55, 59, 62, 67], bass: 40, arp: [67, 71, 74, 76, 79] };
const E7: Chord = { pad: [52, 56, 59, 62, 64], bass: 40, arp: [68, 71, 74, 76, 80] };

/** One chord per bar. */
const PROGRESSION: Chord[] = [Am9, Am9, Fmaj7, Fmaj7, Cadd9, Cadd9, G6, G6, Am9, Am9, Fmaj7, Fmaj7, Dm7, Dm7, Em7, E7];

/** Lead melody: [bar, beat, midi, length in beats]. */
const LEAD: [number, number, number, number][] = [
  // First half: sparse answers.
  [1, 2.5, 76, 0.5],
  [1, 3, 81, 1],
  [3, 2.5, 76, 0.5],
  [3, 3, 72, 1],
  [5, 2.5, 74, 0.5],
  [5, 3, 79, 1],
  [7, 2, 74, 0.5],
  [7, 2.5, 71, 0.5],
  [7, 3, 74, 0.5],
  [7, 3.5, 76, 0.5],
  // Second half: the tune.
  [8, 0, 76, 1.5],
  [8, 1.5, 79, 0.5],
  [8, 2, 81, 2],
  [9, 0, 79, 1],
  [9, 1, 76, 1],
  [9, 2, 74, 0.5],
  [9, 2.5, 76, 1.5],
  [10, 0, 72, 1.5],
  [10, 1.5, 76, 0.5],
  [10, 2, 77, 2],
  [11, 0, 76, 1],
  [11, 1, 72, 1],
  [11, 2, 69, 2],
  [12, 0, 74, 1.5],
  [12, 1.5, 77, 0.5],
  [12, 2, 81, 2],
  [13, 0, 79, 1],
  [13, 1, 77, 1],
  [13, 2, 74, 2],
  [14, 0, 76, 1.5],
  [14, 1.5, 79, 0.5],
  [14, 2, 83, 2],
  [15, 0, 81, 1],
  [15, 1, 80, 1],
  [15, 2, 76, 1],
  [15, 3, 80, 1],
];

const ARP_ORDER = [0, 2, 1, 3, 2, 4, 3, 1];

function buildMenuMusic(k: Kit): void {
  const total = LENGTH + TAIL;

  // --- Buses -------------------------------------------------------------------
  const dry = k.gain(1);
  dry.connect(k.out);
  const wet = k.gain(1);
  wet.connect(k.out);
  k.reverb(wet, 'hall', 0.45);
  // Pad and bass duck under the kick: that is what makes a calm loop "drive".
  const duck = k.gain(1);
  duck.connect(wet);
  const bassBus = k.gain(1);
  bassBus.connect(dry);
  // Dotted-eighth echo for the arpeggio.
  const echoIn = k.gain(1);
  const echo = k.delay(STEP * 3);
  const feedback = k.gain(0.38);
  const echoTone = k.lp(2600, 0.6);
  k.chain(echoIn, echo, echoTone, feedback, echo);
  for (const [node, side] of [
    [echoIn, -0.35],
    [echoTone, 0.45],
  ] as const) {
    const p = k.pan(side);
    node.connect(p);
    p.connect(wet);
  }

  // --- Pad ---------------------------------------------------------------------
  const padFilter = k.lp(820, 0.9);
  const padLfo = k.osc('sine', 4 / LENGTH, 0, total);
  const padDepth = k.gain(260);
  padLfo.connect(padDepth);
  padDepth.connect(padFilter.frequency);
  padFilter.connect(duck);
  let bar = 0;
  while (bar < BARS) {
    const chord = PROGRESSION[bar];
    let span = 1;
    while (bar + span < BARS && PROGRESSION[bar + span] === chord) span++;
    const at = bar * BAR;
    const len = span * BAR;
    const env = k.gain(0);
    k.swell(env.gain, Math.max(0, at - 0.08), 1, 0.55, len - 0.75, 1.5);
    env.connect(padFilter);
    for (const midi of chord.pad) {
      for (const [cents, side] of [
        [-9, -0.6],
        [9, 0.6],
      ] as const) {
        const o = k.osc('sawtooth', hz(midi), Math.max(0, at - 0.08), len + 1.5);
        o.detune.value = cents;
        const g = k.gain(0.034);
        k.chain(o, g, k.pan(side), env);
      }
    }
    // A soft sine an octave above the root keeps the harmony readable on small speakers.
    const o = k.osc('sine', hz(chord.pad[0] + 12), Math.max(0, at - 0.08), len + 1.5);
    k.chain(o, k.gain(0.03), env);
    bar += span;
  }

  // --- Drums, bass, arpeggio -----------------------------------------------------
  for (let b = 0; b < BARS; b++) {
    const chord = PROGRESSION[b];
    const t = b * BAR;
    const second = b >= 8;
    const odd = b % 2 === 1;

    const kicks = second ? [0, 6, 10] : odd ? [0, 7, 10] : [0, 10];
    for (const s of kicks) {
      const at = t + s * STEP;
      kick(k, at, 0.85, dry);
      duck.gain.setValueAtTime(0.5, k.t0 + at);
      duck.gain.linearRampToValueAtTime(1, k.t0 + at + 0.2);
      bassBus.gain.setValueAtTime(0.6, k.t0 + at);
      bassBus.gain.linearRampToValueAtTime(1, k.t0 + at + 0.14);
    }
    for (const s of [4, 12]) {
      if (second) snare(k, t + s * STEP, 0.2, wet, 0.11);
      rim(k, t + s * STEP, second ? 0.16 : 0.24, wet);
    }
    for (let s = 0; s < 16; s++) {
      const at = t + s * STEP;
      const offbeat = s % 4 === 2;
      if (s % 2 === 0) hat(k, at, offbeat ? 0.15 : 0.085, dry);
      else if (second) hat(k, at, 0.05, dry, 0.022);
      if (s % 2 === 1) shaker(k, at, second ? 0.05 : 0.035, dry);
    }
    if (second && odd) hat(k, t + 14 * STEP, 0.11, dry, 0.16);
    if (b === 7) for (const s of [13, 14, 15]) rim(k, t + s * STEP, 0.12 + 0.04 * (s - 13), wet);
    if (b === 15) for (const s of [12, 13, 14, 15]) snare(k, t + s * STEP, 0.1 + 0.035 * (s - 12), wet, 0.08);

    // Bass: [step, semitones above the root].
    const line: [number, number][] = odd
      ? [
          [0, 0],
          [3, 0],
          [6, 12],
          [8, 0],
          [10, 7],
          [12, 0],
          [14, 12],
        ]
      : [
          [0, 0],
          [3, 0],
          [6, 0],
          [8, 12],
          [11, 0],
          [14, 7],
        ];
    for (let i = 0; i < line.length; i++) {
      const [s, up] = line[i];
      const next = i + 1 < line.length ? line[i + 1][0] : 16;
      const at = t + s * STEP;
      const len = Math.max(0.11, (next - s) * STEP * 0.82);
      const f = hz(chord.bass + up);
      const lp = k.lp(700, 3);
      k.glide(lp.frequency, at, Math.min(1500, f * 7), Math.max(120, f * 1.6), len * 0.7);
      const env = k.gain(0);
      k.perc(env.gain, at, s === 0 ? 0.42 : 0.33, 0.004, 0.08, len - 0.05);
      const saw = k.osc('sawtooth', f, at, len + 0.12);
      const sub = k.osc('sine', f, at, len + 0.12);
      const subG = k.gain(0.9);
      saw.connect(lp);
      sub.connect(subG);
      subG.connect(env);
      k.chain(lp, env, bassBus);
    }

    // Arpeggio: 3-3-2 accents in the first half, running eighths in the second.
    for (let e = 0; e < 8; e++) {
      const accent = e === 0 || e === 3 || e === 6;
      if (!second && !accent) continue;
      const midi = chord.arp[ARP_ORDER[e]];
      pluck(k, t + e * 2 * STEP, hz(midi), accent ? 0.34 : 0.24, (accent ? 0.13 : 0.085) * (second ? 1 : 0.9), echoIn, accent ? 1.1 : 0.85);
    }
  }

  // Bench-timer blip: the lab's metronome (every other bar, off the beat).
  for (let b = 0; b < BARS; b += 2) {
    k.tone({ at: b * BAR + 6 * STEP, freq: hz(88), attack: 0.003, hold: 0.03, decay: 0.09, gain: 0.035, to: wet });
  }

  // Centrifuge spin-up into the second half and into the loop point.
  for (const end of [8 * BAR, LENGTH]) {
    const start = end - BEAT * 2;
    const src = k.noise('white', start, BEAT * 2 + 0.05);
    const bp = k.bp(500, 2);
    k.glide(bp.frequency, start, 400, 5200, BEAT * 2);
    const env = k.gain(0);
    k.swell(env.gain, start, 0.05, BEAT * 1.9, 0, 0.06);
    k.chain(src, bp, env, wet);
  }

  // --- Lead ----------------------------------------------------------------------
  for (const [b, beat, midi, len] of LEAD) {
    const at = b * BAR + beat * BEAT;
    const g = b < 8 ? 0.13 : 0.17;
    chime(k, at, hz(midi), 0.35 + len * BEAT * 1.1, g, wet, b % 2 ? 0.2 : -0.2);
    k.tone({ at, type: 'triangle', freq: hz(midi), attack: 0.02, hold: len * BEAT * 0.5, decay: 0.3, gain: g * 0.3, vibrato: [5.2, 9], to: wet });
  }
}

defineSound({
  name: 'music_menu',
  group: 'music',
  label: 'Musique du menu',
  dur: LENGTH + TAIL,
  channels: 2,
  variants: 1,
  peak: 0.5,
  loop: { length: LENGTH, overlap: TAIL, mode: 'fold' },
  build: buildMenuMusic,
});

export const MENU_MUSIC_BPM = BPM;
