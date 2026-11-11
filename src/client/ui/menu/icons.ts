/**
 * Inline SVG icons of the menus (24 × 24 grid, drawn with `currentColor`).
 * Original line icons: lab motifs (test tube, blood drop, flask…) and the usual
 * interface glyphs. `icon('tube')` returns an <svg class="bas-icon"> element.
 */
import { svg } from '../dom';

const PATHS = {
  // --- Lab motifs ---
  tube: '<path d="M9 3h6M10 3v13.5a2 2 0 0 0 4 0V3"/><path d="M10 11h4"/><circle cx="12" cy="15" r="0.6" fill="currentColor"/>',
  tubes:
    '<path d="M5 4h4M6 4v12a1.5 1.5 0 0 0 3 0V4M15 4h4M16 4v12a1.5 1.5 0 0 0 3 0V4"/><path d="M6 10h3M16 12h3M3 20h18"/>',
  drop: '<path d="M12 3.5c3.5 4.5 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 2.5-6.5 6-11z"/><path d="M9.5 15a2.8 2.8 0 0 0 1.8 2.5"/>',
  flask:
    '<path d="M9.5 3h5M10.5 3v6L5 18.5A1.7 1.7 0 0 0 6.5 21h11a1.7 1.7 0 0 0 1.5-2.5L13.5 9V3"/><path d="M7.8 15h8.4"/>',
  microscope:
    '<path d="M9 3l4 2-3.5 7-4-2zM11.5 8.5l3 1.5M6 21h12M12 21v-3M8 18h8a5 5 0 0 0 1-9.5"/>',
  ecg: '<path d="M2 12.5h5l2-5 3.5 10 2.5-7 1.5 2H22"/>',
  hex: '<path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z"/>',
  clipboard:
    '<path d="M9 4.5H6.5A1.5 1.5 0 0 0 5 6v13.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H15"/><rect x="9" y="3" width="6" height="3.5" rx="1"/><path d="M8.5 11h7M8.5 14.5h7M8.5 18h4"/>',
  clipboardCheck:
    '<path d="M9 4.5H6.5A1.5 1.5 0 0 0 5 6v13.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H15"/><rect x="9" y="3" width="6" height="3.5" rx="1"/><path d="M8.5 13.5l2.5 2.5 4.5-5"/>',
  // --- Navigation ---
  crosshair: '<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/>',
  users:
    '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.9M17.5 14.3c2.1 0.7 3.5 2.6 3.5 5.2"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/>',
  enter: '<path d="M13.5 4H18a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 18 20h-4.5"/><path d="M4 12h10.5M10.5 8l4 4-4 4"/>',
  exit: '<path d="M10.5 4H6a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 6 20h4.5"/><path d="M10 12h10.5M16.5 8l4 4-4 4"/>',
  sliders:
    '<path d="M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h10M18 17.5h2"/><circle cx="15" cy="6.5" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="16" cy="17.5" r="2"/>',
  keyboard:
    '<rect x="2.5" y="6" width="19" height="12" rx="1.8"/><path d="M6 9.5h0.01M9.5 9.5h0.01M13 9.5h0.01M16.5 9.5h0.01M6 12.5h0.01M9.5 12.5h0.01M13 12.5h0.01M16.5 12.5h0.01M8 15.5h8"/>',
  award: '<circle cx="12" cy="9" r="5.5"/><path d="M8.5 13.5L7 21l5-2.5 5 2.5-1.5-7.5"/><path d="M12 6.5v5M9.5 9h5"/>',
  // --- Actions ---
  play: '<path d="M7.5 4.5v15l12-7.5z" fill="currentColor"/>',
  arrowRight: '<path d="M4.5 12h15M13.5 6l6 6-6 6"/>',
  arrowLeft: '<path d="M19.5 12h-15M10.5 6l-6 6 6 6"/>',
  chevronRight: '<path d="M9.5 5.5l6 6.5-6 6.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M4.5 12.5l5 5 10-11"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="1.8"/><path d="M15.5 5.5V6M5 15.5h0.5A1.5 1.5 0 0 1 4.5 14V6A1.5 1.5 0 0 1 6 4.5h8A1.5 1.5 0 0 1 15.5 6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  dice: '<rect x="3.5" y="3.5" width="17" height="17" rx="3.2"/><path d="M8.2 8.2h0.01M15.8 8.2h0.01M12 12h0.01M8.2 15.8h0.01M15.8 15.8h0.01" stroke-width="2.6"/>',
  restart: '<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5"/><path d="M4.5 4.5v4.2h4.2"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5"/><path d="M4.5 4.5v4.2h4.2"/><path d="M12 8.5V12l2.5 1.5"/>',
  shuffle: '<path d="M3.5 7H7c2 0 3 1 4.2 2.8l1.6 2.4C14 14 15 15 17 15h3.5M3.5 17H7c1.3 0 2.2-0.5 3-1.3M14 8.3c0.8-0.8 1.7-1.3 3-1.3h3.5"/><path d="M18 4.5L20.5 7 18 9.5M18 12.5l2.5 2.5-2.5 2.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  // --- Status ---
  alert: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.2h0.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.7h0.01"/>',
  crown: '<path d="M3.5 8l4 4.5L12 5.5l4.5 7 4-4.5-1.5 10h-14z"/>',
  bot: '<rect x="4.5" y="8" width="15" height="11" rx="2.2"/><path d="M12 8V4.5M9 13h0.01M15 13h0.01M9.5 16.2h5M2.5 12.5v3M21.5 12.5v3" /><circle cx="12" cy="3.5" r="1"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  flag: '<path d="M5.5 21V4M5.5 5h11l-2 3.5 2 3.5h-11"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.8" fill="currentColor"/>',
  shield: '<path d="M12 3l7.5 2.8v5.7c0 4.5-3.1 8-7.5 9.5-4.4-1.5-7.5-5-7.5-9.5V5.8z"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.3 3.8 5.2 3.8 8.5s-1.3 6.2-3.8 8.5c-2.5-2.3-3.8-5.2-3.8-8.5s1.3-6.2 3.8-8.5z"/>',
  map: '<path d="M3.5 6.5l5.5-2 6 2 5.5-2v13l-5.5 2-6-2-5.5 2z"/><path d="M9 4.5v13M15 6.5v13"/>',
  // --- Options tabs ---
  mouse: '<rect x="7" y="3" width="10" height="18" rx="5"/><path d="M12 7v3.5"/>',
  monitor: '<rect x="3" y="4.5" width="18" height="12" rx="1.8"/><path d="M8.5 20h7M12 16.5V20"/>',
  volume: '<path d="M4 9.5h3.5l4.5-4v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  swords: '<path d="M4 4l9 9M4 4v3.5M4 4h3.5M20 4l-9 9M20 4v3.5M20 4h-3.5M5.5 15l3.5 3.5M18.5 15L15 18.5M4.5 19.5l2.2-2.2M19.5 19.5l-2.2-2.2"/>',
  gun: '<path d="M3 8h15.5v3.5H12l-1 2.5H8.5l-1.2 5H4l1.3-5.5V11.5H3z"/><path d="M18.5 8.8H21"/>',
} as const;

export type IconName = keyof typeof PATHS;

/** Create an icon element. Extra classes are appended to `bas-icon`. */
export function icon(name: IconName, extraClass?: string): SVGSVGElement {
  return svg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`,
    extraClass ? `bas-icon ${extraClass}` : 'bas-icon',
  );
}
