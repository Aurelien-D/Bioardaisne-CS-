/**
 * BioArd'Aisne Strike emblem and wordmark, as inline SVG markup.
 *
 * Original artwork for the game (NOT the company's logo): a crosshair ring around
 * a blood drop, "BioArd'Aisne" in bold italics and a custom "STRIKE" lettering
 * whose "I" is a test tube. Pure string builders (no DOM) so the same code also
 * generates public/logo.svg:
 *
 *   npx tsx -e "import { writeFileSync } from 'node:fs'; import { logoFileMarkup } from './src/client/ui/menu/logo.ts'; writeFileSync('public/logo.svg', logoFileMarkup());"
 */

import { svg } from '../dom';

/** 'full' = emblem + wordmark side by side, 'stacked' = emblem above the wordmark, 'emblem' = crosshair and drop only. */
export type LogoVariant = 'full' | 'stacked' | 'emblem';

const FONT = "Bahnschrift, 'DIN Alternate', 'Avenir Next Condensed', 'Roboto Condensed', Inter, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

let uid = 0;

/** Gradients shared by the pieces; `id` keeps several inline copies independent. */
function defs(id: string): string {
  return `<defs>
    <linearGradient id="${id}-ring" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7cc0f8"/><stop offset="1" stop-color="#2b6cb0"/>
    </linearGradient>
    <linearGradient id="${id}-drop" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#ff5a63"/><stop offset="0.55" stop-color="#e7343f"/><stop offset="1" stop-color="#a81824"/>
    </linearGradient>
    <clipPath id="${id}-caps"><rect x="-14" y="-4.5" width="270" height="45"/></clipPath>
  </defs>`;
}

/** Crosshair ring + blood drop, drawn in a 120 × 120 box. */
function emblem(id: string): string {
  return `<g>
    <circle cx="60" cy="60" r="43" fill="none" stroke="url(#${id}-ring)" stroke-width="7.5" stroke-dasharray="53.54 14" stroke-dashoffset="-7"/>
    <circle cx="60" cy="60" r="33.5" fill="none" stroke="#7cc0f8" stroke-opacity="0.28" stroke-width="1.5"/>
    <path d="M60 3v25M60 92v25M3 60h25M92 60h25" stroke="#fff" stroke-width="7" stroke-linecap="round"/>
    <path d="M60 35.5c9.5 12.5 16.5 21 16.5 30.5a16.5 16.5 0 0 1-33 0c0-9.5 7-18 16.5-30.5z" fill="url(#${id}-drop)"/>
    <path d="M50.5 66.5a9.8 9.8 0 0 0 6.3 9" fill="none" stroke="#fff" stroke-opacity="0.82" stroke-width="3" stroke-linecap="round"/>
  </g>`;
}

/**
 * "STRIKE" custom lettering (cap height 45, about 232 wide before the italic
 * slant). Letters are thick strokes clipped to the cap band; the I is a test tube.
 */
function strike(id: string): string {
  const base = 'fill="none" stroke="#fff" stroke-width="9" stroke-miterlimit="6"';
  const s = `${base} stroke-linejoin="miter"`;
  return `<g clip-path="url(#${id}-caps)">
    <path ${s} d="M26 0H5L0 5v8l5 5h14l5 5v8l-5 5H-3"/>
    <path ${s} d="M35.5 0h33M52 -5v46"/>
    <path ${s} d="M82 41V0h19l5 5v8l-5 5H82M93 18l15 26"/>
    <g transform="translate(122 0)">
      <path d="M6.2 11h7.6v19a3.8 3.8 0 0 1-7.6 0z" fill="url(#${id}-drop)"/>
      <path d="M4 -5v35a6 6 0 0 0 12 0V-5" fill="none" stroke="#fff" stroke-width="4.5"/>
      <path d="M-1.5 -2.2h23" stroke="#fff" stroke-width="4.6"/>
      <circle cx="8.6" cy="17" r="1" fill="#fff" fill-opacity="0.85"/>
      <circle cx="11.4" cy="23.5" r="0.8" fill="#fff" fill-opacity="0.7"/>
    </g>
    <path ${s} d="M159 -5v46"/>
    <path ${base} stroke-linejoin="bevel" d="M184 -6L163.5 17.5M169 12.5l16 30"/>
    <path ${s} d="M221 0h-22v36h22M199 18h17"/>
  </g>`;
}

/** Brand line + lettering + ECG underline; origin = top-left of the text block (240 × 100). */
function wordmark(id: string): string {
  return `<g>
    <text x="1" y="27" font-family="${FONT}" font-size="30" font-weight="800" font-style="italic" fill="#fff" textLength="194" lengthAdjust="spacingAndGlyphs" letter-spacing="0.5">BioArd&#39;Aisne</text>
    <g transform="translate(16 42.5) skewX(-11)">${strike(id)}</g>
    <path d="M0 97h166l5-8 6.5 14 5-9 3 3h48" fill="none" stroke="#e7343f" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
  </g>`;
}

/** Inline SVG markup of the logo. `title` adds an accessible name (omit when decorative). */
export function logoMarkup(variant: LogoVariant = 'full', title?: string): string {
  const id = `basl${++uid}`;
  const a11y = title ? `role="img" aria-label="${title.replace(/"/g, '&quot;')}"` : 'aria-hidden="true"';
  if (variant === 'emblem') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" ${a11y}>${defs(id)}${emblem(id)}</svg>`;
  }
  if (variant === 'stacked') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 252" ${a11y}>${defs(id)}
      <g transform="translate(64 0) scale(1.1)">${emblem(id)}</g>
      <g transform="translate(10 146)">${wordmark(id)}</g>
    </svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 120" ${a11y}>${defs(id)}
    ${emblem(id)}
    <g transform="translate(138 10)">${wordmark(id)}</g>
  </svg>`;
}

/**
 * The logo as an inline SVG element: crisp at any size, sized by CSS (set a width,
 * the height follows the viewBox). Pass `title` when the logo is the accessible name
 * of something, omit it when it is decorative.
 */
export function createLogo(variant: LogoVariant = 'full', className?: string, title?: string): SVGSVGElement {
  return svg(logoMarkup(variant, title), className);
}

/**
 * Standalone file version (public/logo.svg): the horizontal lock-up on a dark
 * navy plate so it stays readable on any page background.
 */
export function logoFileMarkup(): string {
  const id = 'bas';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 176" role="img" aria-label="BioArd'Aisne Strike">
  <title>BioArd'Aisne Strike</title>
  ${defs(id)}
  <defs>
    <linearGradient id="${id}-plate" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b2d52"/><stop offset="1" stop-color="#04101f"/>
    </linearGradient>
    <pattern id="${id}-hex" width="28" height="48.5" patternUnits="userSpaceOnUse">
      <path d="M14 0l14 8.08v16.17l-14 8.08-14-8.08V8.08zM14 32.33v16.17M0 24.25v0M28 24.25v0" fill="none" stroke="#7cc0f8" stroke-opacity="0.09" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="480" height="176" rx="18" fill="url(#${id}-plate)"/>
  <rect width="480" height="176" rx="18" fill="url(#${id}-hex)"/>
  <rect x="1" y="1" width="478" height="174" rx="17" fill="none" stroke="#7cc0f8" stroke-opacity="0.22" stroke-width="2"/>
  <g transform="translate(40 28)">
    ${emblem(id)}
    <g transform="translate(138 10)">${wordmark(id)}</g>
  </g>
</svg>
`;
}
