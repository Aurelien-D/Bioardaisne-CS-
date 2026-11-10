/**
 * Weapon definitions (pure data). Behaviour is implemented in weapons/logic.ts.
 * All weapons are original designs with lab-flavoured names; the archetypes and
 * numbers follow classic tactical-FPS balance.
 */
import { SLOT } from '../constants';

export type WeaponId = 'knife' | 'pistol' | 'deagle' | 'smg' | 'rifle_ak' | 'rifle_m4' | 'shotgun' | 'sniper';

export interface WeaponDef {
  id: WeaponId;
  /** Display name. */
  name: string;
  /** Short flavour text for the loadout menu. */
  blurb: string;
  slot: number;
  kind: 'hitscan' | 'melee';
  /** Category used by the UI and by viewmodel/audio look-ups. */
  category: 'melee' | 'pistol' | 'smg' | 'rifle' | 'shotgun' | 'sniper';
  /** Full-auto (hold to fire) vs semi-auto (one shot per click). */
  auto: boolean;
  /** Base damage per pellet at point-blank range, before hit-group multiplier. */
  damage: number;
  headMul: number;
  /** Fraction of the damage that goes through armour to health (0..1). */
  armorPen: number;
  /** Damage multiplier applied per 10 m travelled (e.g. 0.95). */
  falloff: number;
  /** Max range in metres. */
  range: number;
  pellets: number;
  /** Seconds between shots. */
  fireInterval: number;
  clip: number;
  reserve: number;
  reloadTime: number;
  drawTime: number;
  /** Run-speed multiplier while this weapon is in hands. */
  moveSpeed: number;

  // --- Inaccuracy (cone half-angle, radians) ---
  /** Standing still. */
  spread: number;
  /** Multiplier when fully crouched. */
  spreadCrouchMul: number;
  /** Added at full run speed (scaled linearly with horizontal speed / run speed). */
  spreadMove: number;
  /** Added while airborne. */
  spreadAir: number;
  /** Added to the dynamic inaccuracy by each shot. */
  spreadShot: number;
  /** Cap for the dynamic inaccuracy. */
  spreadShotMax: number;
  /** Exponential recovery rate (1/s) of the dynamic inaccuracy. */
  spreadRecovery: number;

  // --- Recoil (view punch, radians) ---
  /** Upward kick per shot. */
  recoilUp: number;
  /** Horizontal kick amplitude per shot (follows a deterministic sway pattern). */
  recoilSide: number;
  /** Random horizontal jitter per shot (seeded). */
  recoilJitter: number;
  /** Maximum accumulated upward punch. */
  recoilMax: number;
  /** Exponential recovery rate (1/s) of the view punch. */
  recoilRecovery: number;
  /** Seconds without firing before the recoil index (PlayerState.shots) starts to decay. */
  shotsResetDelay: number;

  /** Sniper zoom: vertical FOV (degrees) for zoom level 1 and 2. */
  zoomFov?: [number, number];
  /** Inaccuracy when zoomed (replaces `spread`). */
  zoomSpread?: number;
  /** Move-speed multiplier while zoomed. */
  zoomMoveMul?: number;
}

const D2R = Math.PI / 180;

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  knife: {
    id: 'knife',
    name: 'Bistouri',
    blurb: 'Lame stérile. Silencieux, rapide, définitif.',
    slot: SLOT.Melee,
    kind: 'melee',
    category: 'melee',
    auto: true,
    damage: 55,
    headMul: 1.5,
    armorPen: 0.85,
    falloff: 1,
    range: 1.9,
    pellets: 1,
    fireInterval: 0.5,
    clip: 0,
    reserve: 0,
    reloadTime: 0,
    drawTime: 0.5,
    moveSpeed: 1.0,
    spread: 0,
    spreadCrouchMul: 1,
    spreadMove: 0,
    spreadAir: 0,
    spreadShot: 0,
    spreadShotMax: 0,
    spreadRecovery: 10,
    recoilUp: 0,
    recoilSide: 0,
    recoilJitter: 0,
    recoilMax: 0,
    recoilRecovery: 10,
    shotsResetDelay: 0.2,
  },
  pistol: {
    id: 'pistol',
    name: 'Pipette P9',
    blurb: 'Semi-automatique fiable. Dosage précis au microlitre.',
    slot: SLOT.Secondary,
    kind: 'hitscan',
    category: 'pistol',
    auto: false,
    damage: 30,
    headMul: 4,
    armorPen: 0.55,
    falloff: 0.9,
    range: 80,
    pellets: 1,
    fireInterval: 0.13,
    clip: 15,
    reserve: 60,
    reloadTime: 2.0,
    drawTime: 0.6,
    moveSpeed: 0.97,
    spread: 0.35 * D2R,
    spreadCrouchMul: 0.75,
    spreadMove: 2.2 * D2R,
    spreadAir: 6 * D2R,
    spreadShot: 0.55 * D2R,
    spreadShotMax: 3.2 * D2R,
    spreadRecovery: 7,
    recoilUp: 1.0 * D2R,
    recoilSide: 0.25 * D2R,
    recoilJitter: 0.2 * D2R,
    recoilMax: 5 * D2R,
    recoilRecovery: 9,
    shotsResetDelay: 0.25,
  },
  deagle: {
    id: 'deagle',
    name: 'Lancette .50',
    blurb: 'Gros calibre. Pique fort, à ne pas mettre entre toutes les mains.',
    slot: SLOT.Secondary,
    kind: 'hitscan',
    category: 'pistol',
    auto: false,
    damage: 54,
    headMul: 4,
    armorPen: 0.93,
    falloff: 0.92,
    range: 100,
    pellets: 1,
    fireInterval: 0.27,
    clip: 7,
    reserve: 35,
    reloadTime: 2.2,
    drawTime: 0.75,
    moveSpeed: 0.94,
    spread: 0.3 * D2R,
    spreadCrouchMul: 0.75,
    spreadMove: 3.5 * D2R,
    spreadAir: 9 * D2R,
    spreadShot: 2.6 * D2R,
    spreadShotMax: 6 * D2R,
    spreadRecovery: 3.2,
    recoilUp: 3.4 * D2R,
    recoilSide: 0.6 * D2R,
    recoilJitter: 0.5 * D2R,
    recoilMax: 9 * D2R,
    recoilRecovery: 6,
    shotsResetDelay: 0.4,
  },
  smg: {
    id: 'smg',
    name: 'Centri-9',
    blurb: 'Pistolet-mitrailleur. 800 tours/minute, comme une bonne centrifugeuse.',
    slot: SLOT.Primary,
    kind: 'hitscan',
    category: 'smg',
    auto: true,
    damage: 25,
    headMul: 4,
    armorPen: 0.6,
    falloff: 0.86,
    range: 70,
    pellets: 1,
    fireInterval: 0.075,
    clip: 30,
    reserve: 120,
    reloadTime: 2.4,
    drawTime: 0.8,
    moveSpeed: 0.95,
    spread: 0.5 * D2R,
    spreadCrouchMul: 0.8,
    spreadMove: 1.3 * D2R,
    spreadAir: 5 * D2R,
    spreadShot: 0.2 * D2R,
    spreadShotMax: 2.2 * D2R,
    spreadRecovery: 6,
    recoilUp: 0.62 * D2R,
    recoilSide: 0.42 * D2R,
    recoilJitter: 0.18 * D2R,
    recoilMax: 6.5 * D2R,
    recoilRecovery: 7.5,
    shotsResetDelay: 0.22,
  },
  rifle_ak: {
    id: 'rifle_ak',
    name: 'AK-Tube 47',
    blurb: 'Fusil d’assaut rustique. Puissant, recul marqué : maîtrise le spray.',
    slot: SLOT.Primary,
    kind: 'hitscan',
    category: 'rifle',
    auto: true,
    damage: 36,
    headMul: 4,
    armorPen: 0.78,
    falloff: 0.95,
    range: 150,
    pellets: 1,
    fireInterval: 0.1,
    clip: 30,
    reserve: 90,
    reloadTime: 2.5,
    drawTime: 0.95,
    moveSpeed: 0.88,
    spread: 0.2 * D2R,
    spreadCrouchMul: 0.7,
    spreadMove: 5.5 * D2R,
    spreadAir: 10 * D2R,
    spreadShot: 0.28 * D2R,
    spreadShotMax: 2.6 * D2R,
    spreadRecovery: 5.5,
    recoilUp: 1.25 * D2R,
    recoilSide: 0.8 * D2R,
    recoilJitter: 0.22 * D2R,
    recoilMax: 11 * D2R,
    recoilRecovery: 6.5,
    shotsResetDelay: 0.3,
  },
  rifle_m4: {
    id: 'rifle_m4',
    name: 'M4 Sérum',
    blurb: 'Fusil d’assaut de précision. Stable, régulier, validé biologiquement.',
    slot: SLOT.Primary,
    kind: 'hitscan',
    category: 'rifle',
    auto: true,
    damage: 31,
    headMul: 4,
    armorPen: 0.72,
    falloff: 0.96,
    range: 150,
    pellets: 1,
    fireInterval: 0.09,
    clip: 30,
    reserve: 90,
    reloadTime: 2.8,
    drawTime: 0.95,
    moveSpeed: 0.9,
    spread: 0.17 * D2R,
    spreadCrouchMul: 0.7,
    spreadMove: 5.0 * D2R,
    spreadAir: 9 * D2R,
    spreadShot: 0.22 * D2R,
    spreadShotMax: 2.2 * D2R,
    spreadRecovery: 6,
    recoilUp: 0.95 * D2R,
    recoilSide: 0.55 * D2R,
    recoilJitter: 0.18 * D2R,
    recoilMax: 9 * D2R,
    recoilRecovery: 7,
    shotsResetDelay: 0.28,
  },
  shotgun: {
    id: 'shotgun',
    name: 'Agitateur 12',
    blurb: 'Fusil à pompe. Huit plombs par dose, redoutable dans les couloirs.',
    slot: SLOT.Primary,
    kind: 'hitscan',
    category: 'shotgun',
    auto: false,
    damage: 18,
    headMul: 2,
    armorPen: 0.55,
    falloff: 0.7,
    range: 40,
    pellets: 8,
    fireInterval: 0.9,
    clip: 8,
    reserve: 32,
    reloadTime: 2.9,
    drawTime: 0.9,
    moveSpeed: 0.9,
    spread: 2.6 * D2R,
    spreadCrouchMul: 0.9,
    spreadMove: 0.8 * D2R,
    spreadAir: 2.5 * D2R,
    spreadShot: 0.4 * D2R,
    spreadShotMax: 1.2 * D2R,
    spreadRecovery: 4,
    recoilUp: 4.2 * D2R,
    recoilSide: 0.9 * D2R,
    recoilJitter: 0.6 * D2R,
    recoilMax: 9 * D2R,
    recoilRecovery: 5.5,
    shotsResetDelay: 0.5,
  },
  sniper: {
    id: 'sniper',
    name: 'Le Microscope',
    blurb: 'Fusil de précision à verrou. Grossissement x10 : un tir, un résultat.',
    slot: SLOT.Primary,
    kind: 'hitscan',
    category: 'sniper',
    auto: false,
    damage: 115,
    headMul: 4,
    armorPen: 0.97,
    falloff: 0.99,
    range: 250,
    pellets: 1,
    fireInterval: 1.45,
    clip: 5,
    reserve: 20,
    reloadTime: 3.4,
    drawTime: 1.15,
    moveSpeed: 0.82,
    spread: 4.5 * D2R,
    spreadCrouchMul: 0.9,
    spreadMove: 8 * D2R,
    spreadAir: 14 * D2R,
    spreadShot: 1.5 * D2R,
    spreadShotMax: 3 * D2R,
    spreadRecovery: 3,
    recoilUp: 3.2 * D2R,
    recoilSide: 0.5 * D2R,
    recoilJitter: 0.4 * D2R,
    recoilMax: 6 * D2R,
    recoilRecovery: 5,
    shotsResetDelay: 0.5,
    zoomFov: [36, 12],
    zoomSpread: 0.03 * D2R,
    zoomMoveMul: 0.55,
  },
};

export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];
/** Stable numeric index for compact network encoding. */
export const WEAPON_INDEX: Record<WeaponId, number> = Object.fromEntries(WEAPON_IDS.map((id, i) => [id, i])) as Record<
  WeaponId,
  number
>;
export const weaponFromIndex = (i: number): WeaponId => WEAPON_IDS[i] ?? 'knife';

export const PRIMARY_WEAPONS: WeaponId[] = ['rifle_ak', 'rifle_m4', 'smg', 'shotgun', 'sniper'];
export const SECONDARY_WEAPONS: WeaponId[] = ['pistol', 'deagle'];

export interface Loadout {
  primary: WeaponId;
  secondary: WeaponId;
}
export const DEFAULT_LOADOUT: Loadout = { primary: 'rifle_m4', secondary: 'pistol' };
/** Default loadout per team (flavour: the Auditeurs come with the AK-Tube). */
export const TEAM_DEFAULT_LOADOUT: Record<0 | 1, Loadout> = {
  0: { primary: 'rifle_m4', secondary: 'pistol' },
  1: { primary: 'rifle_ak', secondary: 'pistol' },
};

export function isValidLoadout(l: Loadout): boolean {
  return PRIMARY_WEAPONS.includes(l.primary) && SECONDARY_WEAPONS.includes(l.secondary);
}
