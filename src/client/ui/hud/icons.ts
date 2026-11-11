/**
 * HUD pictograms: solid 24 × 24 glyphs drawn with `currentColor` (solid shapes
 * stay readable at 14–20 px over a moving 3D scene, where line icons break up),
 * plus the weapon silhouettes shared with the load-out menu.
 */
import type { WeaponId } from '../../../shared/weapons/defs';
import { svg } from '../dom';
import { weaponArt } from '../menu/weaponArt';

const GLYPHS = {
  /** Health: the medical cross. */
  health: '<path d="M9.2 2.5h5.6a.9.9 0 0 1 .9.9v4.9h4.9a.9.9 0 0 1 .9.9v5.6a.9.9 0 0 1-.9.9h-4.9v4.9a.9.9 0 0 1-.9.9H9.2a.9.9 0 0 1-.9-.9v-4.9H3.4a.9.9 0 0 1-.9-.9V9.2a.9.9 0 0 1 .9-.9h4.9V3.4a.9.9 0 0 1 .9-.9z"/>',
  /** Armour: shield with a lighter half for volume. */
  armor:
    '<path opacity=".62" d="M12 2.2l8.2 3v6.1c0 5-3.4 8.9-8.2 10.5z"/><path d="M12 2.2v19.6C7.2 20.2 3.8 16.3 3.8 11.3V5.2z"/>',
  /** Spawn protection: shield with a check mark cut out. */
  shieldCheck:
    '<path fill-rule="evenodd" d="M12 2.2l8.2 3v6.1c0 5-3.4 8.9-8.2 10.5-4.8-1.6-8.2-5.5-8.2-10.5V5.2zm4.9 6.5l-1.5-1.4-4.5 4.7-2.1-2.1-1.5 1.5 3.6 3.6z"/>',
  /** Elimination without a weapon (fall, objective) and dead players on the scoreboard. */
  skull:
    '<path fill-rule="evenodd" d="M12 2.5c-4.7 0-8.3 3.4-8.3 7.9 0 2.5 1.1 4.6 2.9 6v2.9c0 .9.7 1.7 1.7 1.7h.9v-2h1.6v2h2.4v-2h1.6v2h.9c1 0 1.7-.8 1.7-1.7v-2.9c1.8-1.4 2.9-3.5 2.9-6 0-4.5-3.6-7.9-8.3-7.9zM8.6 9a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zm6.8 0a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zM12 13.6l1.3 2.4h-2.6z"/>',
  /** Headshot ("Hémolysé !"): a blood drop in a reticle. */
  headshot:
    '<path fill-rule="evenodd" d="M11 1.5h2v2.6a8 8 0 0 1 6.9 6.9h2.6v2h-2.6a8 8 0 0 1-6.9 6.9v2.6h-2v-2.6A8 8 0 0 1 4.1 13H1.5v-2h2.6A8 8 0 0 1 11 4.1zm1 4.5a6 6 0 1 0 0 12 6 6 0 0 0 0-12z"/><path d="M12 7.6c1.9 2.4 3.2 4 3.2 5.8a3.2 3.2 0 0 1-6.4 0c0-1.8 1.3-3.4 3.2-5.8z"/>',
  /** The "écart critique" dossier (Désamorçage). */
  dossier:
    '<path fill-rule="evenodd" d="M3.5 4.5h6.1l2 2.4h8.9c.8 0 1.5.7 1.5 1.5V18c0 .8-.7 1.5-1.5 1.5h-17C2.7 19.5 2 18.8 2 18V6c0-.8.7-1.5 1.5-1.5zM11 9.4v5h2v-5zm0 6.2v1.9h2v-1.9z"/>',
  /** Sample cooler (Sécurisation). */
  cooler:
    '<path d="M8 7V5.6C8 4.2 9.1 3 10.6 3h2.8C14.9 3 16 4.2 16 5.6V7h-1.8V5.6c0-.4-.4-.8-.8-.8h-2.8c-.4 0-.8.4-.8.8V7z"/><path d="M2.5 7.6h19v3.2h-19z"/><path fill-rule="evenodd" d="M3.5 12h17v7.5c0 .8-.7 1.5-1.5 1.5H5c-.8 0-1.5-.7-1.5-1.5zm7.6 1.6v2h-2v1.8h2v2h1.8v-2h2v-1.8h-2v-2z"/>',
  /** Spectating. */
  eye: '<path fill-rule="evenodd" d="M12 5c5.6 0 9.3 4.3 10.6 6.3a1.2 1.2 0 0 1 0 1.4C21.3 14.7 17.6 19 12 19S2.7 14.7 1.4 12.7a1.2 1.2 0 0 1 0-1.4C2.7 9.3 6.4 5 12 5zm0 2.8a4.2 4.2 0 1 0 0 8.4 4.2 4.2 0 0 0 0-8.4zm0 2.2a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/>',
  /** Respawn / waiting. */
  hourglass:
    '<path fill-rule="evenodd" d="M5 2.5h14v2h-1.3v2.6c0 1.3-.6 2.5-1.7 3.3L14.2 12l1.8 1.6c1.1.8 1.7 2 1.7 3.3v2.6H19v2H5v-2h1.3v-2.6c0-1.3.6-2.5 1.7-3.3L9.8 12 8 10.4c-1.1-.8-1.7-2-1.7-3.3V4.5H5zm3.3 2v2.6c0 .7.3 1.3.9 1.7L12 11l2.8-2.2c.6-.4.9-1 .9-1.7V4.5z"/>',
} as const;

export type HudIconName = keyof typeof GLYPHS;

/** Create a HUD pictogram (`<svg class="bh-icon …">`). */
export function hudIcon(name: HudIconName, extraClass?: string): SVGSVGElement {
  return svg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">${GLYPHS[name]}</svg>`,
    extraClass ? `bh-icon ${extraClass}` : 'bh-icon',
  );
}

/**
 * Side-view weapon silhouette (same drawings as the load-out menu). The menu
 * class is replaced so that the menu style sheet does not size it.
 */
export function weaponIcon(id: WeaponId, className = 'bh-weapon'): SVGSVGElement {
  const el = weaponArt(id);
  el.setAttribute('class', className);
  // Fixed aspect ratio from the drawing's own frame: the icon is sized by its height in CSS.
  const vb = (el.getAttribute('viewBox') ?? '0 0 240 86').split(/\s+/).map(Number);
  const ratio = vb.length === 4 && vb[3]! > 0 ? vb[2]! / vb[3]! : 240 / 86;
  el.style.setProperty('--ratio', ratio.toFixed(3));
  return el;
}
