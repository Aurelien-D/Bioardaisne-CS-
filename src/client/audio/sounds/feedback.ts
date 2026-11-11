/**
 * Non-spatial sounds: gameplay feedback (fb_*), interface (ui_*) and the short
 * announcer jingles (jingle_*) that precede the spoken lines.
 */
import { defineSound, type SoundGroup } from '../bank';
import type { Kit } from '../kit';
import { beep, bell, brass, chime, hz, kick, pluck, snare } from './instruments';

const def = (
  group: SoundGroup,
  name: string,
  label: string,
  dur: number,
  channels: 1 | 2,
  peak: number,
  build: (k: Kit, v: number) => void,
  variants = 1,
): void => defineSound({ name, group, label, dur, channels, variants, peak, build });

/** A bus with a touch of generated reverb, for the musical cues. */
function wetBus(k: Kit, kind: 'room' | 'hall', wet: number): GainNode {
  const bus = k.gain(1);
  bus.connect(k.out);
  k.reverb(bus, kind, wet);
  return bus;
}

// =================================================================================
// Gameplay feedback
// =================================================================================

// Hit confirmation: a dry, bright tick.
def(
  'feedback',
  'fb_hitmarker',
  'Touche confirmée',
  0.12,
  1,
  0.3,
  (k) => {
    const f = k.vary(1750, 0.03);
    k.burst({ type: 'highpass', freq: 3000, attack: 0.0002, decay: 0.004, gain: 0.6 });
    k.tone({ freq: f, attack: 0.0005, decay: 0.035, gain: 1 });
    k.tone({ freq: f * 1.5, attack: 0.0005, decay: 0.022, gain: 0.45 });
  },
  3,
);

// Headshot: the "dink" — a bullet on a thin steel shell. A hard tick, then a handful of
// inharmonic partials that die within a fifth of a second. Nothing else in the game rings like it.
def(
  'feedback',
  'fb_headshot',
  'Tir à la tête (« dink »)',
  0.5,
  2,
  0.46,
  (k) => {
    const bus = wetBus(k, 'room', 0.12);
    const base = k.vary(2380, 0.025);
    k.burst({ type: 'highpass', freq: 4200, attack: 0.0002, decay: 0.004, gain: 0.8, to: bus });
    k.burst({ type: 'bandpass', freq: base, q: 8, attack: 0.0003, decay: 0.018, gain: 2.4, to: bus });
    k.partials({
      base,
      ratios: [1, 1.34, 1.81, 2.47, 3.32, 4.21],
      gains: [1, 0.7, 0.5, 0.32, 0.2, 0.1],
      decay: 0.2,
      damp: 0.9,
      attack: 0.0006,
      gain: 0.8,
      to: bus,
    });
    // The dent: a short, lower knock under the ring.
    k.tone({ freq: 640, freqEnd: 390, sweep: 0.02, decay: 0.035, gain: 0.35, to: bus });
  },
  2,
);

// Kill: a tight low hit and two rising notes — "sample validated". Lower and rounder than
// the dink, so a headshot kill (both play) reads as two events.
def('feedback', 'fb_kill', 'Élimination', 0.6, 2, 0.44, (k) => {
  const bus = wetBus(k, 'room', 0.18);
  k.tone({ freq: 170, freqEnd: 62, sweep: 0.05, attack: 0.001, decay: 0.09, gain: 0.9, to: bus });
  k.burst({ type: 'bandpass', freq: 1300, q: 1.2, attack: 0.0004, decay: 0.014, gain: 1.2, to: bus });
  pluck(k, 0.004, hz(74), 0.1, 0.8, bus, 1.2, -0.2);
  pluck(k, 0.078, hz(81), 0.24, 1, bus, 1.4, 0.2);
  chime(k, 0.078, hz(93), 0.26, 0.22, bus);
});

// Hurt: a short dull thud in the body, no voice (the engine also muffles the world for a moment).
def(
  'feedback',
  'fb_hurt',
  'Dégâts reçus',
  0.3,
  1,
  0.6,
  (k) => {
    k.tone({ freq: k.vary(118, 0.08), freqEnd: 50, sweep: 0.05, attack: 0.0015, decay: 0.12, gain: 1 });
    k.burst({ color: 'pink', type: 'lowpass', freq: 520, freqEnd: 180, attack: 0.001, decay: 0.075, gain: 1.9 });
    k.burst({ type: 'bandpass', freq: k.vary(820, 0.1), q: 1.2, attack: 0.0006, decay: 0.022, gain: 0.7 });
    // Cloth and gear taking the hit: barely there.
    k.burst({ type: 'bandpass', freq: k.vary(2100, 0.12), q: 1, attack: 0.002, decay: 0.03, gain: 0.12 });
  },
  3,
);

// Death: low hit, a sinking dark chord and the monitor going flat.
def('feedback', 'fb_death', 'Mort', 1.9, 2, 0.55, (k) => {
  const bus = wetBus(k, 'hall', 0.3);
  k.tone({ freq: 92, freqEnd: 38, sweep: 0.2, decay: 0.45, gain: 1, to: bus });
  k.burst({ color: 'pink', type: 'lowpass', freq: 500, attack: 0.002, decay: 0.2, gain: 1.2, to: bus });
  const lp = k.lp(1800, 1);
  k.glide(lp.frequency, 0, 1800, 180, 1.0);
  const env = k.gain(0);
  k.perc(env.gain, 0, 0.32, 0.012, 1.2);
  for (const [midi, cents] of [
    [55, -9],
    [55, 9],
    [61, 0],
    [43, 0],
  ] as const) {
    const o = k.osc('sawtooth', hz(midi), 0, 1.4);
    o.detune.value = cents;
    k.glide(o.frequency, 0.05, hz(midi), hz(midi - 7), 1.0);
    o.connect(lp);
  }
  k.chain(lp, env, bus);
  // Flatline.
  k.tone({ at: 0.12, freq: 932, attack: 0.04, hold: 0.55, decay: 0.7, gain: 0.1, to: bus });
  k.tone({ at: 0.12, freq: 1864, attack: 0.04, hold: 0.55, decay: 0.5, gain: 0.015, to: bus });
});

// Respawn: rising shimmer.
def('feedback', 'fb_respawn', 'Retour au poste', 1.5, 2, 0.4, (k) => {
  const bus = wetBus(k, 'hall', 0.35);
  const notes = [84, 88, 91, 96, 100];
  notes.forEach((m, i) => chime(k, i * 0.05, hz(m), 0.55, 0.6 - i * 0.05, bus, i % 2 === 0 ? -0.5 : 0.5));
  const src = k.noise('white', 0, 0.45);
  const env = k.gain(0);
  k.swell(env.gain, 0, 0.1, 0.3, 0, 0.12);
  const hp = k.hp(3000);
  k.glide(hp.frequency, 0, 2500, 7000, 0.35);
  k.chain(src, hp, env, bus);
  k.tone({ freq: 110, freqEnd: 220, sweep: 0.3, attack: 0.12, decay: 0.3, gain: 0.3, to: bus });
});

// Pickup: latch + two quick rising notes.
def('feedback', 'fb_pickup', 'Ramassage', 0.3, 1, 0.34, (k) => {
  k.burst({ type: 'bandpass', freq: 2200, q: 4, attack: 0.0003, decay: 0.014, gain: 2 });
  pluck(k, 0.012, hz(76), 0.07, 0.8, undefined, 1.2);
  pluck(k, 0.065, hz(83), 0.13, 1, undefined, 1.3);
});

// Countdown: bench-timer beep.
def('feedback', 'fb_countdown', 'Compte à rebours', 0.24, 1, 0.34, (k) => {
  k.tone({ freq: 880, attack: 0.003, hold: 0.07, decay: 0.06, gain: 1 });
  k.tone({ freq: 1760, attack: 0.003, hold: 0.07, decay: 0.04, gain: 0.14 });
  k.burst({ type: 'highpass', freq: 3000, attack: 0.0002, decay: 0.004, gain: 0.2 });
});

// Round start: riser, then a bright stab with a referee-whistle trill on top.
def('feedback', 'fb_round_start', 'Début de manche', 1.7, 2, 0.55, (k) => {
  const bus = wetBus(k, 'hall', 0.28);
  const rise = 0.52;
  const src = k.noise('white', 0, rise + 0.06);
  const bp = k.bp(300, 1.3);
  k.glide(bp.frequency, 0, 300, 5200, rise);
  const nEnv = k.gain(0);
  k.swell(nEnv.gain, 0, 0.5, rise * 0.92, 0, 0.05);
  k.chain(src, bp, nEnv, bus);
  const lp = k.lp(400, 2);
  k.glide(lp.frequency, 0, 400, 4200, rise);
  const sEnv = k.gain(0);
  k.swell(sEnv.gain, 0, 0.3, rise * 0.9, 0.01, 0.04);
  for (const cents of [-10, 10]) {
    const o = k.osc('sawtooth', hz(45), 0, rise + 0.08);
    o.detune.value = cents;
    k.glide(o.frequency, 0, hz(45), hz(57), rise);
    o.connect(lp);
  }
  k.chain(lp, sEnv, bus);
  // Stab: D major.
  kick(k, rise, 0.9, bus);
  k.burst({ at: rise, type: 'highpass', freq: 4500, attack: 0.001, decay: 0.35, gain: 0.25, to: bus });
  [50, 62, 69, 74, 78].forEach((m, i) => brass(k, rise, hz(m), 0.3, 0.2, bus, 1.1, (i - 2) * 0.25));
  // Whistle.
  k.tone({ at: rise + 0.01, freq: 2350, attack: 0.012, hold: 0.13, decay: 0.12, gain: 0.1, vibrato: [26, 90], to: bus });
  k.burst({ at: rise + 0.01, type: 'bandpass', freq: 2400, q: 7, attack: 0.012, decay: 0.2, gain: 0.25, to: bus });
});

// Round won: short upbeat fanfare.
def('feedback', 'fb_round_win', 'Manche gagnée', 2.1, 2, 0.55, (k) => {
  const bus = wetBus(k, 'hall', 0.3);
  kick(k, 0, 0.7, bus);
  snare(k, 0, 0.3, bus);
  const run = [67, 72, 76, 79];
  run.forEach((m, i) => brass(k, i * 0.105, hz(m), 0.085, 0.42, bus, 1.2, -0.3 + i * 0.2));
  const land = 0.46;
  kick(k, land, 0.9, bus);
  snare(k, land, 0.4, bus, 0.2);
  [60, 72, 76, 79, 84].forEach((m, i) => brass(k, land, hz(m), 0.55, i === 4 ? 0.34 : 0.2, bus, 1.25, (i - 2) * 0.22));
  [96, 100, 103].forEach((m, i) => bell(k, land + 0.02 + i * 0.05, hz(m), 0.6, 0.14, bus, i % 2 ? 0.6 : -0.6));
});

// Round lost: three mellow descending notes.
def('feedback', 'fb_round_lose', 'Manche perdue', 2.0, 2, 0.5, (k) => {
  const bus = wetBus(k, 'hall', 0.32);
  k.tone({ freq: 95, freqEnd: 50, sweep: 0.1, decay: 0.3, gain: 0.7, to: bus });
  brass(k, 0, hz(64), 0.2, 0.42, bus, 0.45, -0.2);
  brass(k, 0.25, hz(60), 0.2, 0.42, bus, 0.42, 0.2);
  k.tone({ at: 0.52, freq: 80, freqEnd: 42, sweep: 0.12, decay: 0.4, gain: 0.8, to: bus });
  // Last note sags.
  const lp = k.lp(900, 1);
  k.glide(lp.frequency, 0.52, 1100, 300, 0.9);
  const env = k.gain(0);
  k.perc(env.gain, 0.52, 0.5, 0.015, 0.75, 0.25);
  for (const [midi, cents] of [
    [57, -8],
    [57, 8],
    [45, 0],
    [52, 0],
  ] as const) {
    const o = k.osc('sawtooth', hz(midi), 0.52, 1.2);
    o.detune.value = cents;
    k.glide(o.frequency, 0.75, hz(midi), hz(midi - 1), 0.7);
    o.connect(lp);
  }
  k.chain(lp, env, bus);
});

// Planting the "écart critique": a rubber stamp on the audit form.
def(
  'feedback',
  'fb_plant_tick',
  'Dépôt de l’écart (tampon)',
  0.18,
  1,
  0.3,
  (k) => {
    k.tone({ freq: k.vary(190, 0.08), freqEnd: 105, sweep: 0.03, decay: 0.055, gain: 1 });
    k.burst({ type: 'bandpass', freq: k.vary(900, 0.1), q: 1.5, decay: 0.03, gain: 1.8 });
    k.burst({ type: 'highpass', freq: 2500, attack: 0.001, decay: 0.018, gain: 0.3 });
  },
  2,
);

// Lifting it: ratchet double-click of a pen being put to work.
def(
  'feedback',
  'fb_defuse_tick',
  'Levée de l’écart (stylo)',
  0.18,
  1,
  0.28,
  (k) => {
    k.burst({ type: 'bandpass', freq: k.vary(3100, 0.06), q: 6, attack: 0.0003, decay: 0.012, gain: 3 });
    k.burst({ at: 0.036, type: 'bandpass', freq: k.vary(3900, 0.06), q: 6, attack: 0.0003, decay: 0.01, gain: 1.8 });
    k.tone({ freq: 1500, decay: 0.02, gain: 0.3 });
    k.burst({ type: 'highpass', freq: 5000, attack: 0, decay: 0.004, gain: 0.5 });
  },
  2,
);

// =================================================================================
// Interface
// =================================================================================

def('ui', 'ui_click', 'Clic', 0.1, 1, 0.22, (k) => {
  k.tone({ freq: 1150, freqEnd: 900, sweep: 0.03, attack: 0.0005, decay: 0.045, gain: 1 });
  k.burst({ type: 'highpass', freq: 4000, attack: 0.0002, decay: 0.004, gain: 0.4 });
});
def('ui', 'ui_hover', 'Survol', 0.06, 1, 0.08, (k) => {
  k.tone({ freq: 2300, attack: 0.001, decay: 0.022, gain: 1 });
});
def('ui', 'ui_back', 'Retour', 0.14, 1, 0.2, (k) => {
  k.tone({ type: 'triangle', freq: 720, freqEnd: 420, sweep: 0.07, attack: 0.001, decay: 0.075, gain: 1 });
  k.burst({ type: 'highpass', freq: 3500, attack: 0.0002, decay: 0.004, gain: 0.25 });
});
def('ui', 'ui_error', 'Erreur', 0.3, 1, 0.22, (k) => {
  beep(k, 0, 185, 0.055, 1);
  beep(k, 0.11, 185, 0.075, 1);
  beep(k, 0, 277, 0.055, 0.3);
  beep(k, 0.11, 262, 0.075, 0.3);
});
def('ui', 'ui_join', 'Joueur connecté', 0.6, 2, 0.24, (k) => {
  const bus = wetBus(k, 'room', 0.2);
  [72, 76, 79].forEach((m, i) => chime(k, i * 0.065, hz(m), 0.26, 0.8, bus, (i - 1) * 0.4));
});
def('ui', 'ui_chat', 'Message', 0.16, 1, 0.18, (k) => {
  k.tone({ freq: 880, freqEnd: 1320, sweep: 0.035, attack: 0.002, decay: 0.065, gain: 1 });
});

// =================================================================================
// Announcer jingles (played on the voice bus just before the spoken line)
// =================================================================================

// Neutral: the public-address "ding-dong" of the waiting room.
def('jingle', 'jingle_neutral', 'Annonce — neutre', 1.2, 2, 0.36, (k) => {
  const bus = wetBus(k, 'hall', 0.3);
  chime(k, 0, hz(76), 0.6, 1, bus, -0.25);
  chime(k, 0.17, hz(81), 0.75, 1, bus, 0.25);
});
def('jingle', 'jingle_good', 'Annonce — bonne nouvelle', 1.2, 2, 0.36, (k) => {
  const bus = wetBus(k, 'hall', 0.3);
  [72, 76, 79, 84].forEach((m, i) => chime(k, i * 0.075, hz(m), 0.6, 0.9, bus, -0.45 + i * 0.3));
});
def('jingle', 'jingle_bad', 'Annonce — mauvaise nouvelle', 1.3, 2, 0.36, (k) => {
  const bus = wetBus(k, 'hall', 0.3);
  [76, 72, 69].forEach((m, i) => {
    chime(k, i * 0.15, hz(m), 0.6, 0.8, bus, 0.3 - i * 0.3);
    k.tone({ at: i * 0.15, type: 'triangle', freq: hz(m - 12), attack: 0.004, decay: 0.3, gain: 0.3, to: bus });
  });
});
def('jingle', 'jingle_alert', 'Annonce — alerte', 0.9, 2, 0.38, (k) => {
  const bus = wetBus(k, 'room', 0.22);
  beep(k, 0, hz(86), 0.055, 0.8, bus);
  beep(k, 0.115, hz(86), 0.055, 0.8, bus);
  beep(k, 0.23, hz(91), 0.11, 0.9, bus);
  k.tone({ type: 'sawtooth', freq: hz(38), attack: 0.004, decay: 0.3, gain: 0.35, to: bus });
});
def('jingle', 'jingle_streak', 'Annonce — série', 0.8, 2, 0.38, (k) => {
  const bus = wetBus(k, 'room', 0.25);
  kick(k, 0, 0.7, bus, 170, 60, 0.12);
  k.burst({ type: 'highpass', freq: 3500, attack: 0.0003, decay: 0.02, gain: 0.5, to: bus });
  [81, 85, 88].forEach((m, i) => pluck(k, i * 0.048, hz(m), i === 2 ? 0.3 : 0.1, 0.9, bus, 1.5, (i - 1) * 0.35));
  chime(k, 0.1, hz(100), 0.3, 0.2, bus);
});
def('jingle', 'jingle_tense', 'Annonce — tension', 1.3, 2, 0.36, (k) => {
  const bus = wetBus(k, 'hall', 0.25);
  // Heartbeat: lub-dub.
  k.tone({ freq: 74, freqEnd: 44, sweep: 0.06, decay: 0.16, gain: 1, to: bus });
  k.tone({ at: 0.17, freq: 66, freqEnd: 40, sweep: 0.06, decay: 0.2, gain: 0.8, to: bus });
  k.tone({ at: 0.05, freq: hz(91), attack: 0.12, hold: 0.1, decay: 0.7, gain: 0.1, to: bus });
  k.tone({ at: 0.05, freq: hz(92), attack: 0.12, hold: 0.1, decay: 0.7, gain: 0.05, to: bus });
});
def('jingle', 'jingle_warn', 'Annonce — délai', 0.6, 2, 0.34, (k) => {
  const bus = wetBus(k, 'room', 0.2);
  beep(k, 0, hz(81), 0.06, 1, bus, 'triangle');
  beep(k, 0.13, hz(81), 0.06, 1, bus, 'triangle');
});
def('jingle', 'jingle_info', 'Annonce — information', 0.6, 2, 0.26, (k) => {
  const bus = wetBus(k, 'room', 0.2);
  chime(k, 0, hz(83), 0.3, 1, bus);
});
def('jingle', 'jingle_match', 'Annonce — fin de match', 2.2, 2, 0.4, (k) => {
  const bus = wetBus(k, 'hall', 0.32);
  kick(k, 0, 0.8, bus, 120, 45, 0.4);
  [72, 76, 79, 84, 88].forEach((m, i) => chime(k, i * 0.07, hz(m), 0.7, 0.8, bus, -0.5 + i * 0.25));
  [60, 67, 72, 76].forEach((m, i) => brass(k, 0.36, hz(m), 0.5, 0.16, bus, 0.9, (i - 1.5) * 0.3));
  bell(k, 0.36, hz(96), 0.9, 0.2, bus);
});
