/**
 * Weapon handling sounds ("foley"): one short mechanical sound per moving part
 * (magazine, bolt, slide, pump, shell, selector), rendered once per weapon family so
 * a polymer pistol, a stamped SMG, two steel rifles, a pump shotgun and a bolt-action
 * rifle do not sound alike.
 *
 *   fol_<family>_<part>   mag_out, mag_in, bolt_back, bolt_forward, slide, pump,
 *                         shell_in, draw, click (the parts a family really has)
 *   fol_swish_gun / fol_swish_blade   a weapon moving quickly through the air
 *   cloth, dryfire, zoom  shared handling noises
 *
 * The first-person animator emits a WeaponFoley event on the exact frame a part moves
 * (IAudio.foley); the engine resolves it with `foleySound`. The same sounds are
 * sequenced by the engine for the other players' reloads, which have no animation events.
 */
import type { WeaponFoley } from '../../core/contracts';
import type { WeaponId } from '../../../shared/weapons/defs';
import { defineSound } from '../bank';
import type { Kit } from '../kit';

export type FoleyFamily = 'pistol' | 'deagle' | 'smg' | 'ak' | 'm4' | 'shotgun' | 'sniper' | 'knife';

export const FOLEY_FAMILY: Record<WeaponId, FoleyFamily> = {
  knife: 'knife',
  pistol: 'pistol',
  deagle: 'deagle',
  smg: 'smg',
  rifle_ak: 'ak',
  rifle_m4: 'm4',
  shotgun: 'shotgun',
  sniper: 'sniper',
};

/** What the parts of a weapon are made of, and how heavy they are. */
interface Profile {
  label: string;
  /** Pitch of every contact (1 = full-size steel rifle): small parts sound higher. */
  pitch: number;
  /** Sharpness of the contact resonance: steel is narrow and hard, polymer broad and dull. */
  q: number;
  /** Metallic ring after a contact (s); 0 for polymer. */
  ring: number;
  /** Low "thock" of the moving mass (Hz) and its level. */
  body: number;
  weight: number;
  /** High-frequency tick of hard surfaces meeting. */
  tick: number;
  /** Hollow resonance (polymer grip, magazine tube) level. */
  hollow: number;
  /** Time scale of the gestures: heavy actions travel further. */
  slow: number;
  /** Loose parts rattling (0 = tight tolerances). */
  rattle: number;
  /** Recoil-spring twang after the bolt closes. */
  spring: number;
  /** Overall level of the family (1 = rifle). */
  level: number;
}

const PROFILES: Record<Exclude<FoleyFamily, 'knife'>, Profile> = {
  // Polymer frame: dull, hollow "tock", almost no ring, light and quick.
  pistol: { label: 'Pipette P9', pitch: 1.5, q: 2.2, ring: 0, body: 300, weight: 0.5, tick: 0.45, hollow: 1, slow: 0.8, rattle: 0, spring: 0, level: 0.86 },
  // Big all-steel pistol: slow, heavy slide, long ring.
  deagle: { label: 'Lancette .50', pitch: 1.02, q: 5, ring: 0.075, body: 185, weight: 0.95, tick: 0.9, hollow: 0, slow: 1.05, rattle: 0, spring: 0.25, level: 1 },
  // Stamped sheet metal: thin, bright, a little tinny.
  smg: { label: 'Centri-9', pitch: 1.3, q: 3.6, ring: 0.03, body: 250, weight: 0.55, tick: 0.85, hollow: 0.35, slow: 0.86, rattle: 0.35, spring: 0, level: 0.92 },
  // Loose, clunky steel: low, rattling, heavy bolt carrier.
  ak: { label: 'AK-Tube 47', pitch: 0.8, q: 3.2, ring: 0.085, body: 145, weight: 1.1, tick: 0.75, hollow: 0, slow: 1.12, rattle: 0.7, spring: 0, level: 1.06 },
  // Tight aluminium receiver: crisp, bright, with the buffer-spring twang.
  m4: { label: 'M4 Sérum', pitch: 1.04, q: 6, ring: 0.05, body: 180, weight: 0.8, tick: 1, hollow: 0.15, slow: 0.98, rattle: 0.12, spring: 1, level: 1 },
  // Big steel tube: lowest of all, hollow, long strokes.
  shotgun: { label: 'Agitateur 12', pitch: 0.68, q: 2.8, ring: 0.045, body: 118, weight: 1.25, tick: 0.6, hollow: 0.8, slow: 1.15, rattle: 0.3, spring: 0, level: 1.1 },
  // Precision bolt: hard, clean, long ring.
  sniper: { label: 'Le Microscope', pitch: 0.9, q: 6.5, ring: 0.11, body: 150, weight: 0.95, tick: 1, hollow: 0, slow: 1.2, rattle: 0, spring: 0, level: 1.04 },
};

// --- Building blocks ----------------------------------------------------------------

interface ContactOpts {
  decay?: number;
  /** Relative level of the low thock (0 = none). */
  body?: number;
  /** Relative length of the ring (0 = none). */
  ring?: number;
  q?: number;
}

/** Two parts meeting: resonant knock + hard tick, then whatever the material adds. */
function contact(k: Kit, p: Profile, at: number, freq: number, gain: number, o: ContactOpts = {}): void {
  const f = k.vary(freq * p.pitch, 0.05);
  const decay = o.decay ?? 0.014;
  k.burst({ at, type: 'bandpass', freq: f, q: o.q ?? p.q, attack: 0.0003, decay, gain: gain * 3 });
  k.burst({ at, type: 'highpass', freq: 4800, attack: 0, decay: 0.0035, gain: gain * 0.75 * p.tick });
  const ring = (o.ring ?? 0) * p.ring;
  if (ring > 0.004) k.partials({ at, base: f * 0.93, ratios: [1, 1.52, 2.31, 3.37], gains: [1, 0.55, 0.35, 0.18], decay: ring, damp: 0.5, gain: gain * 0.26 });
  const body = (o.body ?? 0) * p.weight;
  if (body > 0) k.tone({ at, freq: k.vary(p.body, 0.06), freqEnd: p.body * 0.6, sweep: 0.03, attack: 0.001, decay: 0.05 * p.slow, gain: gain * 0.4 * body });
  if (p.hollow > 0 && (o.body ?? 0) > 0) {
    // Hollow shell (polymer grip, magazine tube): a short, dull, low-mid knock.
    k.burst({ at, type: 'bandpass', freq: k.vary(f * 0.42, 0.06), q: 3.2, attack: 0.0006, decay: 0.03, gain: gain * 2.2 * p.hollow });
  }
}

/** Sliding friction: band-passed noise whose centre follows the movement. */
function scrape(k: Kit, p: Profile, at: number, dur: number, f0: number, f1: number, gain: number, q = 1.9): void {
  const src = k.noise('white', at, dur + 0.02);
  const bp = k.bp(f0 * p.pitch, q);
  k.glide(bp.frequency, at, f0 * p.pitch, f1 * p.pitch, dur);
  const env = k.gain(0);
  k.swell(env.gain, at, gain * 1.6, dur * 0.3, dur * 0.15, dur * 0.55);
  k.chain(src, bp, env, k.out);
}

/** Loose parts settling: a few tiny contacts. */
function rattle(k: Kit, p: Profile, at: number, span: number, gain: number): void {
  if (p.rattle <= 0) return;
  const n = 2 + Math.floor(k.rng() * 2);
  for (let i = 0; i < n; i++) {
    k.burst({
      at: at + k.rand(0, span),
      type: 'bandpass',
      freq: k.rand(2100, 3900) * p.pitch,
      q: 5,
      attack: 0.0003,
      decay: k.rand(0.006, 0.012),
      gain: gain * p.rattle * k.rand(0.8, 1.6),
    });
  }
}

/** Recoil spring ringing after the bolt slams shut. */
function spring(k: Kit, p: Profile, at: number, gain: number): void {
  if (p.spring <= 0) return;
  const f = k.vary(560 * p.pitch, 0.05);
  for (const [ratio, g] of [
    [1, 1],
    [1.48, 0.55],
    [2.21, 0.3],
  ] as const) {
    k.tone({ at, freq: f * ratio * 1.06, freqEnd: f * ratio, sweep: 0.05, attack: 0.002, decay: 0.13, gain: gain * g * p.spring, vibrato: [k.rand(52, 68), 55] });
  }
}

/** Soft cloth rustle: a few overlapping bumps of band-passed pink noise. */
function cloth(k: Kit, at: number, dur: number, gain: number): void {
  const bumps = 2 + Math.floor(k.rng() * 2);
  for (let i = 0; i < bumps; i++) {
    const t = at + (i / bumps) * dur * 0.7 + k.rand(0, dur * 0.1);
    const len = dur * k.rand(0.3, 0.5);
    const src = k.noise('pink', t, len + 0.02);
    const bp = k.bp(k.rand(700, 2100), 0.8);
    const env = k.gain(0);
    k.swell(env.gain, t, gain * k.rand(0.6, 1), len * 0.4, 0, len * 0.6);
    k.chain(src, k.hp(350), bp, env, k.out);
  }
}

// --- Parts --------------------------------------------------------------------------

type Part = (k: Kit, p: Profile) => void;

/** Catch released, magazine slides out of the well. */
const magOut: Part = (k, p) => {
  const s = p.slow;
  contact(k, p, 0, 3100, 0.6, { decay: 0.01 });
  scrape(k, p, 0.016 * s, 0.078 * s, 1700, 950, 0.5, 2.1);
  contact(k, p, 0.1 * s, 1200, 0.42, { decay: 0.02, body: 0.7, ring: 0.3, q: p.q * 0.7 });
  rattle(k, p, 0.03 * s, 0.08 * s, 0.1);
};

/** Magazine pushed in until the catch locks. */
const magIn: Part = (k, p) => {
  const s = p.slow;
  scrape(k, p, 0, 0.066 * s, 900, 1750, 0.42, 2.1);
  const seat = 0.068 * s;
  contact(k, p, seat, 1450, 1, { decay: 0.024 * s, body: 1, ring: 1 });
  contact(k, p, seat + 0.013, 3300, 0.42, { decay: 0.009 });
  rattle(k, p, seat + 0.02, 0.06, 0.07);
};

/** Bolt / charging handle / slide pulled to the rear. */
const boltBack: Part = (k, p) => {
  const s = p.slow;
  contact(k, p, 0, 2300, 0.45, { decay: 0.012 });
  scrape(k, p, 0.008, 0.082 * s, 2000, 1050, 0.7, 1.7);
  contact(k, p, 0.092 * s, 1300, 0.8, { decay: 0.02 * s, body: 0.8, ring: 0.5 });
  rattle(k, p, 0.03 * s, 0.05 * s, 0.08);
};

/** Released: it runs forward on its spring and slams into battery. */
const boltForward: Part = (k, p) => {
  const s = p.slow;
  scrape(k, p, 0, 0.028 * s, 1150, 2400, 0.5, 1.7);
  const home = 0.028 * s;
  contact(k, p, home, 1700, 1.1, { decay: 0.026 * s, body: 1.1, ring: 1 });
  contact(k, p, home + 0.012, 3700, 0.5, { decay: 0.01 });
  spring(k, p, home + 0.004, 0.1);
  rattle(k, p, home + 0.016, 0.05, 0.1);
};

/** Full rack in one gesture (pistol slide, charging handle): back, then forward. */
const rack: Part = (k, p) => {
  const s = p.slow;
  contact(k, p, 0, 2800, 0.42, { decay: 0.011 });
  scrape(k, p, 0.005, 0.064 * s, 2400, 1450, 0.6, 1.8);
  contact(k, p, 0.072 * s, 1850, 0.5, { decay: 0.014, body: 0.5 });
  const fwd = k.vary(0.128 * s, 0.07);
  scrape(k, p, fwd - 0.024, 0.024, 1650, 2800, 0.4, 1.8);
  contact(k, p, fwd, 2250, 1, { decay: 0.022 * s, body: 1, ring: 1 });
  contact(k, p, fwd + 0.011, 4200, 0.45, { decay: 0.009 });
  spring(k, p, fwd + 0.004, 0.07);
};

/** Fore-end pulled back: the action opens. */
const pumpBack: Part = (k, p) => {
  const s = p.slow;
  scrape(k, p, 0, 0.07 * s, 2150, 1150, 0.75, 1.4);
  contact(k, p, 0.066 * s, 1500, 1, { decay: 0.03, body: 1, ring: 0.7 });
  contact(k, p, 0.066 * s + 0.012, 3900, 0.4, { decay: 0.012 });
  rattle(k, p, 0.07 * s, 0.05, 0.1);
};

/** Fore-end pushed forward: the action closes on a fresh shell. */
function pumpForwardAt(k: Kit, p: Profile, at: number): void {
  const s = p.slow;
  scrape(k, p, at, 0.06 * s, 1200, 2400, 0.75, 1.4);
  contact(k, p, at + 0.057 * s, 1950, 1.1, { decay: 0.032, body: 1.1, ring: 1 });
  contact(k, p, at + 0.057 * s + 0.013, 4700, 0.45, { decay: 0.012 });
}

const pumpForward: Part = (k, p) => pumpForwardAt(k, p, 0);

/** The whole "shuck" as one event. */
const pump: Part = (k, p) => {
  pumpBack(k, p);
  pumpForwardAt(k, p, k.vary(0.165 * p.slow, 0.07));
};

/** One shell thumbed into the tube, against the spring. */
const shellIn: Part = (k, p) => {
  contact(k, p, 0, 2700, 0.5, { decay: 0.012 });
  scrape(k, p, 0.012, 0.05, 1600, 2700, 0.5, 2);
  contact(k, p, 0.064, 1650, 1, { decay: 0.024, body: 0.9, ring: 0.5 });
  contact(k, p, 0.077, 4300, 0.3, { decay: 0.008 });
};

/** Weapon brought up: sleeve, hand closing on the grip, the weight settling. */
const draw: Part = (k, p) => {
  const s = p.slow;
  cloth(k, 0, 0.16 * s, 0.4);
  contact(k, p, 0.1 * s, 1750, 0.9, { decay: 0.02, body: 0.8, ring: 0.5 });
  contact(k, p, 0.1 * s + 0.04, 2900, 0.4, { decay: 0.01 });
  rattle(k, p, 0.1 * s + 0.02, 0.08 * s, 0.14);
  if (p.weight > 0.75) contact(k, p, 0.1 * s + 0.11, 1300, 0.25, { decay: 0.02, body: 0.7 });
};

/** Selector, safety, hammer: one small dry tick. */
const click: Part = (k, p) => {
  contact(k, p, 0, 3300, 1, { decay: 0.008, q: p.q * 1.3 });
  contact(k, p, 0.004, 1500, 0.4, { decay: 0.012, body: 0.25 });
};

const PARTS: Record<string, { label: string; dur: number; peak: number; build: Part }> = {
  mag_out: { label: 'chargeur retiré', dur: 0.32, peak: 0.3, build: magOut },
  mag_in: { label: 'chargeur enclenché', dur: 0.32, peak: 0.38, build: magIn },
  bolt_back: { label: 'culasse tirée', dur: 0.32, peak: 0.36, build: boltBack },
  bolt_forward: { label: 'culasse relâchée', dur: 0.34, peak: 0.46, build: boltForward },
  slide: { label: 'armement complet', dur: 0.42, peak: 0.42, build: rack },
  pump: { label: 'pompe (aller-retour)', dur: 0.5, peak: 0.5, build: pump },
  pump_back: { label: 'pompe tirée', dur: 0.3, peak: 0.44, build: pumpBack },
  pump_forward: { label: 'pompe repoussée', dur: 0.3, peak: 0.48, build: pumpForward },
  shell_in: { label: 'cartouche insérée', dur: 0.26, peak: 0.32, build: shellIn },
  draw: { label: 'prise en main', dur: 0.44, peak: 0.27, build: draw },
  click: { label: 'sélecteur', dur: 0.1, peak: 0.19, build: click },
};

/** The parts each family really has (everything else falls back, see FALLBACK). */
const FAMILY_PARTS: Record<Exclude<FoleyFamily, 'knife'>, string[]> = {
  pistol: ['mag_out', 'mag_in', 'bolt_back', 'bolt_forward', 'slide', 'draw', 'click'],
  deagle: ['mag_out', 'mag_in', 'bolt_back', 'bolt_forward', 'slide', 'draw', 'click'],
  smg: ['mag_out', 'mag_in', 'bolt_back', 'bolt_forward', 'slide', 'draw', 'click'],
  ak: ['mag_out', 'mag_in', 'bolt_back', 'bolt_forward', 'slide', 'draw', 'click'],
  m4: ['mag_out', 'mag_in', 'bolt_back', 'bolt_forward', 'slide', 'draw', 'click'],
  shotgun: ['pump', 'pump_back', 'pump_forward', 'shell_in', 'draw', 'click'],
  sniper: ['mag_out', 'mag_in', 'bolt_back', 'bolt_forward', 'slide', 'draw', 'click'],
};

for (const family of Object.keys(FAMILY_PARTS) as Exclude<FoleyFamily, 'knife'>[]) {
  const p = PROFILES[family];
  for (const part of FAMILY_PARTS[family]) {
    const spec = PARTS[part]!;
    defineSound({
      name: `fol_${family}_${part}`,
      group: 'mech',
      label: `${p.label} — ${spec.label}`,
      dur: spec.dur * Math.max(1, p.slow) + p.ring,
      channels: 1,
      variants: 3,
      peak: Math.min(0.6, spec.peak * p.level),
      build: (k) => spec.build(k, p),
    });
  }
}

// --- Knife --------------------------------------------------------------------------

defineSound({
  name: 'fol_knife_draw',
  group: 'mech',
  label: 'Bistouri — dégainé',
  dur: 0.4,
  channels: 1,
  variants: 3,
  peak: 0.2,
  build: (k) => {
    cloth(k, 0, 0.12, 0.35);
    // Blade leaving its sheath: a rising hiss, then the steel sings.
    const src = k.noise('white', 0.05, 0.12);
    const bp = k.bp(4200, 5);
    k.glide(bp.frequency, 0.05, k.vary(4200), k.vary(7200), 0.1);
    const env = k.gain(0);
    k.swell(env.gain, 0.05, 0.8, 0.03, 0.015, 0.055);
    k.chain(src, bp, env, k.out);
    k.partials({ at: 0.13, base: k.vary(4700, 0.05), ratios: [1, 1.41, 1.93, 2.62], decay: 0.2, gain: 0.5, attack: 0.004 });
  },
});

defineSound({
  name: 'fol_knife_click',
  group: 'mech',
  label: 'Bistouri — tintement',
  dur: 0.16,
  channels: 1,
  variants: 3,
  peak: 0.14,
  build: (k) => {
    const f = k.vary(5200, 0.06);
    k.burst({ type: 'highpass', freq: 5000, attack: 0, decay: 0.003, gain: 0.6 });
    k.partials({ base: f, ratios: [1, 1.47, 2.09], decay: 0.09, gain: 0.8, attack: 0.0006 });
  },
});

/** A weapon moving fast through the air (inspection flourish, knife flip). */
function swish(k: Kit, lo: number, hi: number, sheen: boolean): void {
  const dur = k.vary(0.15, 0.12);
  const f = k.vary(1, 0.1);
  const src = k.noise('pink', 0, dur + 0.05);
  const bp = k.bp(lo * f, 1.3);
  k.glide(bp.frequency, 0, lo * f, hi * f, dur * 0.5);
  k.glide(bp.frequency, dur * 0.5 + 0.001, hi * f, lo * 1.2 * f, dur * 0.5);
  const env = k.gain(0);
  k.swell(env.gain, 0, 1, dur * 0.45, 0.004, dur * 0.55);
  k.chain(src, bp, env, k.out);
  const air = k.noise('white', 0, dur + 0.05);
  const airEnv = k.gain(0);
  k.swell(airEnv.gain, 0.01, 0.045, dur * 0.4, 0, dur * 0.5);
  k.chain(air, k.hp(sheen ? 3800 : 2600), airEnv, k.out);
  if (sheen) k.partials({ at: dur * 0.35, base: k.vary(5400, 0.08), ratios: [1, 1.47, 2.09], decay: 0.08, gain: 0.06, attack: 0.015 });
}

defineSound({ name: 'fol_swish_gun', group: 'mech', label: 'Arme — mouvement vif', dur: 0.3, channels: 1, variants: 4, peak: 0.12, build: (k) => swish(k, 420, 1500, false) });
defineSound({ name: 'fol_swish_blade', group: 'mech', label: 'Bistouri — mouvement vif', dur: 0.3, channels: 1, variants: 4, peak: 0.13, build: (k) => swish(k, 900, 3300, true) });

// --- Shared handling noises ----------------------------------------------------------

const GENERIC = PROFILES.m4;

defineSound({ name: 'cloth', group: 'mech', label: 'Froissement de blouse', dur: 0.34, channels: 1, variants: 4, peak: 0.12, build: (k) => cloth(k, 0, k.vary(0.24, 0.15), 1) });

defineSound({
  name: 'dryfire',
  group: 'mech',
  label: 'Percussion à vide',
  dur: 0.14,
  channels: 1,
  variants: 3,
  peak: 0.26,
  build: (k) => {
    contact(k, GENERIC, 0, 2800, 1, { decay: 0.012, body: 0.4 });
    k.tone({ freq: 420, freqEnd: 250, sweep: 0.03, decay: 0.04, gain: 0.5 });
    contact(k, GENERIC, 0.006, 950, 0.5, { decay: 0.022 });
  },
});

defineSound({
  name: 'zoom',
  group: 'mech',
  label: 'Lunette',
  dur: 0.2,
  channels: 1,
  variants: 2,
  peak: 0.16,
  build: (k) => {
    contact(k, GENERIC, 0, 1850, 0.8, { decay: 0.014 });
    // Tiny lens-ring whirr.
    k.tone({ at: 0.004, type: 'triangle', freq: k.vary(1300), freqEnd: k.vary(2500), sweep: 0.05, attack: 0.008, decay: 0.06, gain: 0.25 });
    scrape(k, GENERIC, 0.004, 0.06, 2900, 5300, 0.25, 3);
  },
});

// --- Look-up ------------------------------------------------------------------------

/** What an event falls back to when the family has no such part. */
const FALLBACK: Partial<Record<WeaponFoley, readonly string[]>> = {
  // Tube-fed: "magazine" events are shells; other weapons have no shells or pump.
  mag_in: ['shell_in'],
  mag_out: ['click'],
  shell_in: ['mag_in'],
  bolt_back: ['pump_back'],
  bolt_forward: ['pump_forward'],
  slide: ['pump'],
  pump: ['slide'],
};

export interface FoleySound {
  name: string;
  /** Relative level of the event (cloth and swishes sit well below the metal). */
  gain: number;
}

const EVENTS: readonly WeaponFoley[] = ['mag_out', 'mag_in', 'bolt_back', 'bolt_forward', 'slide', 'pump', 'shell_in', 'cloth', 'draw', 'swish', 'click'];

function resolve(family: FoleyFamily, ev: WeaponFoley): FoleySound | null {
  if (ev === 'cloth') return { name: 'cloth', gain: family === 'knife' ? 0.7 : 0.85 };
  if (ev === 'swish') return { name: family === 'knife' ? 'fol_swish_blade' : 'fol_swish_gun', gain: 1 };
  if (family === 'knife') return ev === 'draw' ? { name: 'fol_knife_draw', gain: 1 } : ev === 'click' ? { name: 'fol_knife_click', gain: 1 } : null;
  const parts = FAMILY_PARTS[family];
  if (parts.includes(ev)) return { name: `fol_${family}_${ev}`, gain: 1 };
  for (const alt of FALLBACK[ev] ?? []) if (parts.includes(alt)) return { name: `fol_${family}_${alt}`, gain: 1 };
  return null;
}

const TABLE = {} as Record<WeaponId, Partial<Record<WeaponFoley, FoleySound>>>;
for (const weapon of Object.keys(FOLEY_FAMILY) as WeaponId[]) {
  const row: Partial<Record<WeaponFoley, FoleySound>> = {};
  for (const ev of EVENTS) {
    const s = resolve(FOLEY_FAMILY[weapon], ev);
    if (s) row[ev] = s;
  }
  TABLE[weapon] = row;
}

/** Sound of a foley event for a weapon (no allocation: the table is built once), or null. */
export function foleySound(weapon: WeaponId, ev: WeaponFoley): FoleySound | null {
  return TABLE[weapon]?.[ev] ?? null;
}

/** Name of a part's sound for a weapon family, for the engine's own sequences ('' when the family has no such part). */
export function partName(weapon: WeaponId, part: string): string {
  const family = FOLEY_FAMILY[weapon];
  if (family === 'knife') return part === 'draw' ? 'fol_knife_draw' : '';
  return FAMILY_PARTS[family].includes(part) ? `fol_${family}_${part}` : '';
}

/** Every weapon family with its parts, for the dev sound board. */
export function foleyCatalogue(): { weapon: WeaponId; events: WeaponFoley[] }[] {
  return (Object.keys(FOLEY_FAMILY) as WeaponId[]).map((weapon) => ({ weapon, events: EVENTS.filter((e) => TABLE[weapon]![e]) }));
}
