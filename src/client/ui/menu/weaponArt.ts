/**
 * Load-out helpers: side-view weapon silhouettes (inline SVG, muzzle to the
 * right, drawn with `currentColor`) and the five stat bars derived from the
 * WeaponDef numbers.
 */
import { WEAPONS, type WeaponDef, type WeaponId } from '../../../shared/weapons/defs';
import { clamp, svg } from '../dom';

/** Furniture (stock, grip, hand guard) is drawn lighter than the metal parts. */
const SOFT = 'opacity="0.58"';
const LINE = 'fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"';

const ART: Record<WeaponId, string> = {
  // Assault rifle with a curved magazine shaped like a bent test tube.
  rifle_ak: `
    <path ${SOFT} d="M4 31L52 25h8v17l-20 2L8 53z"/>
    <path d="M58 22h68l5 4v16H58z"/>
    <path d="M110 17.5h11V22h-11z"/>
    <path ${SOFT} d="M84 42h15l-5 24H78z"/>
    <path ${LINE} d="M99 43v6q0 3 3 3h9"/>
    <path d="M112 42h17c1.5 13 9 23 21 29l-8 11c-17-8-28-22-30-40z"/>
    <path ${SOFT} d="M131 27h40v12h-40z"/>
    <path d="M131 19.5h44V25h-44zM171 19.5h7V34h-7zM171 28h54v5h-54zM204 15.5h5V28h-5zM200 25.5h13V29h-13zM225 26.5h10l-3 8h-7z"/>`,
  // Flat-top carbine: carry handle, collapsible stock, straight magazine.
  rifle_m4: `
    <path ${SOFT} d="M4 26h24l3 4v10l-6 12H6l-2-4z"/>
    <path d="M28 27h34v7H28zM60 22h74v18h-23l-4 4H62l-2-4z"/>
    <path fill-rule="evenodd" d="M70 22l4-9h38l6 9zM80 19.5l1.5-3.5h25l2 3.5z"/>
    <path ${SOFT} d="M90 44h14l-4 22H85z"/>
    <path ${LINE} d="M104 45v5q0 3 3 3h8"/>
    <path d="M116 40h16l5 30h-15z"/>
    <path ${SOFT} fill-rule="evenodd" d="M134 22h54v16h-54zM142 28h8v4h-8zM156 28h8v4h-8zM170 28h8v4h-8z"/>
    <path d="M188 27.5h34v5h-34zM194 27.5L199 12h4l5 15.5zM222 26h12v8h-12z"/>`,
  // Sub-machine gun fed by a drum that looks suspiciously like a centrifuge rotor.
  smg: `
    <path ${SOFT} d="M8 26h54v5H14v20H8z"/>
    <path d="M60 21h90l4 4v16H60zM68 16h8v5h-8zM138 16h6v5h-6z"/>
    <path ${SOFT} d="M72 41h15l-5 24H66z"/>
    <path ${LINE} d="M87 42v5q0 3 3 3h7"/>
    <path fill-rule="evenodd" d="M101 57a17 17 0 1 0 34 0a17 17 0 1 0-34 0zM114.5 47.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0zM124 57a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0zM114.5 66.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0zM105 57a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0zM116 57a2 2 0 1 0 4 0a2 2 0 1 0-4 0z"/>
    <path ${SOFT} d="M154 26h30v14h-30z"/>
    <path d="M184 29h22v6h-22zM206 27h10v10h-10z"/>`,
  // Pump-action shotgun.
  shotgun: `
    <path ${SOFT} d="M4 33l56-7h10v16l-16 2-26 6-20 5z"/>
    <path d="M68 23h52v20H68z"/>
    <path ${LINE} d="M84 44v4q0 3 3 3h7q3 0 3-3v-4"/>
    <path d="M120 24h112v6H120zM120 32.5h92V38h-92zM226 19.5h4V24h-4z"/>
    <path ${SOFT} fill-rule="evenodd" d="M142 30.5h44a3 3 0 0 1 3 3V42a3 3 0 0 1-3 3h-44a3 3 0 0 1-3-3v-8.5a3 3 0 0 1 3-3zM148 34h2.5v7.5H148zM156 34h2.5v7.5H156zM164 34h2.5v7.5H164zM172 34h2.5v7.5H172zM180 34h2.5v7.5H180z"/>`,
  // Bolt-action rifle with an oversized scope and a bipod.
  sniper: `
    <path ${SOFT} fill-rule="evenodd" d="M4 30l40-3 20-2v18l-14 2-16 7H6zM28 36l18-2v6l-12 4z"/>
    <path d="M62 25h80v15H62z"/>
    <path ${SOFT} d="M68 40h13l-4 22H63z"/>
    <path d="M98 40h18v13H98zM142 29.5h86v5h-86zM224 27h14v10h-14z"/>
    <path d="M64 8.5h12l4 2.5h44l6-4.5h16v16h-16l-6-4.5H80l-4 2.5H64zM98 4.5h10V11H98zM86 18h6v7h-6zM112 18h6v7h-6z"/>
    <path ${LINE} stroke-width="3" d="M176 35l-10 28M176 35l12 28M121 31l7 7"/>
    <circle cx="129" cy="39" r="2.6"/>`,
  // Compact semi-automatic pistol.
  pistol: `
    <path fill-rule="evenodd" d="M60 22h110l8 4v13H60zM65 26h3v9h-3zM71 26h3v9h-3zM77 26h3v9h-3zM116 26h22v5h-22z"/>
    <path d="M64 17.5h8V22h-8zM163 17.5h6V22h-6zM178 28h4v7h-4z"/>
    <path ${SOFT} d="M66 39h112v5q0 4-4 4h-32l-6 6H66z"/>
    <path ${SOFT} d="M68 50h40l-5 9-6 22q-1 4-5 4H66q-5 0-4-5z"/>
    <path ${LINE} d="M107 55q0 10 9 10h10q8 0 8-8v-5M117 50q0 6 4 9"/>`,
  // Heavy hand cannon: long ribbed barrel, big grip.
  deagle: `
    <path fill-rule="evenodd" d="M46 16h128l20 6v14h-12v6H46zM51 20h3v11h-3zM57 20h3v11h-3zM63 20h3v11h-3zM112 21h26v6h-26z"/>
    <path d="M94 11h94v5H94zM50 11h8v5h-8zM194 24h5v9h-5z"/>
    <path ${SOFT} d="M54 42h124v6q0 4-4 4h-36l-6 6H54z"/>
    <path ${SOFT} d="M58 54h46l-6 10-6 20q-1 4-5 4H55q-5 0-4-5z"/>
    <path ${LINE} d="M103 60q0 11 10 11h13q9 0 9-9v-6M114 54q0 7 5 11"/>`,
  // Scalpel.
  knife: `
    <path ${SOFT} fill-rule="evenodd" d="M34 37h112l6-4h16v14h-16l-6-4H34a3 3 0 0 1 0-6zM48 38.5h30v3H48z"/>
    <path d="M168 33h16c16 0 28 6 36 15l-52-1z"/>`,
};

/** Framing of each drawing inside the common 240 × 86 canvas (short weapons are shown larger). */
const VIEWBOX: Partial<Record<WeaponId, string>> = {
  pistol: '34 8 174 82',
  deagle: '26 4 196 90',
  knife: '20 12 212 60',
};

/** Side-view silhouette of a weapon. */
export function weaponArt(id: WeaponId): SVGSVGElement {
  return svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX[id] ?? '0 0 240 86'}" fill="currentColor">${ART[id]}</svg>`, 'bas-weapon-art');
}

export interface WeaponStat {
  label: string;
  /** 0 … 1, length of the bar. */
  value: number;
  /** Short raw figure shown next to the bar. */
  text: string;
}

const DEG = 180 / Math.PI;

/** Dégâts / Cadence / Précision / Mobilité / Chargeur, normalised for the stat bars. */
export function weaponStats(id: WeaponId): WeaponStat[] {
  const w: WeaponDef = WEAPONS[id];

  // Damage of one trigger pull, weighted by armour penetration (perceptual curve).
  const perShot = w.damage * w.pellets * (0.5 + 0.5 * w.armorPen);
  const damage = clamp(Math.pow(perShot / 120, 0.6), 0.05, 1);

  const rpm = 60 / w.fireInterval;
  const rate = clamp(rpm / 850, 0.04, 1);

  // Inaccuracy in degrees: resting spread (zoomed for scoped rifles) plus what
  // sustained fire adds, the latter weighted by how fast the weapon shoots.
  const sustained = Math.min(1, 0.12 / w.fireInterval);
  const inaccuracy =
    (w.zoomSpread ?? w.spread) * DEG + sustained * (0.5 * w.spreadShot + 0.15 * w.recoilUp + 0.2 * w.recoilSide) * DEG;
  const accuracy = clamp(1 - Math.pow(inaccuracy / 2.8, 0.9), 0.08, 1);

  const mobility = clamp((w.moveSpeed - 0.75) / 0.25, 0.05, 1);
  const clip = clamp(w.clip / 30, 0.05, 1);

  return [
    { label: 'Dégâts', value: damage, text: w.pellets > 1 ? `${w.pellets}×${w.damage}` : String(w.damage) },
    { label: 'Cadence', value: rate, text: String(Math.round(rpm / 10) * 10) },
    { label: 'Précision', value: accuracy, text: String(Math.round(accuracy * 100)) },
    { label: 'Mobilité', value: mobility, text: String(Math.round(w.moveSpeed * 100)) },
    { label: 'Chargeur', value: clip, text: String(w.clip) },
  ];
}

export const CATEGORY_LABEL: Record<WeaponDef['category'], string> = {
  melee: 'Arme blanche',
  pistol: 'Pistolet',
  smg: 'Pistolet-mitrailleur',
  rifle: 'Fusil d’assaut',
  shotgun: 'Fusil à pompe',
  sniper: 'Fusil de précision',
};
