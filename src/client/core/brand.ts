/**
 * Official Laboratoire Bio Ard'Aisne brand assets (taken from the public website
 * bioardaisne.fr at the request of the laboratory). These files belong to the
 * laboratory; keep them unmodified apart from the documented colour variants.
 *
 * Usage:
 *  - menus / loading screen: BRAND_LOGO.horizontalDark over dark panels,
 *    BRAND_LOGO.horizontal over light panels;
 *  - in-map signage, uniforms, vehicles: the "ba" monogram (vector path below,
 *    drawable on a canvas with `new Path2D(BRAND_MONOGRAM.path)`).
 */

/** Exact brand colours sampled from the official logo files. */
export const BRAND_COLORS = {
  /** Monogram red. */
  red: '#e7343f',
  /** Wordmark grey. */
  grey: '#4a4a49',
  /** Light blue used for watermarks. */
  sky: '#bce4fa',
  /** Website accent blue. */
  blue: '#3182ce',
} as const;

/** Raster logos served from /public/brand (transparent PNG). */
export const BRAND_LOGO = {
  /** Monogram + "LABORATOIRE bio ard'aisne", grey text — for light backgrounds. 1164 × 310. */
  horizontal: '/brand/logo-horizontal.png',
  /** Same with white text — for dark backgrounds. */
  horizontalDark: '/brand/logo-horizontal-dark.png',
  /** Stacked version, grey text. 861 × 599. */
  vertical: '/brand/logo-vertical.png',
  /** Stacked version, white text. */
  verticalDark: '/brand/logo-vertical-dark.png',
  /** Red "ba" monogram alone. 822 × 750. */
  monogram: '/brand/monogram-red.png',
  /** Vector monogram (red). */
  monogramSvg: '/brand/monogram.svg',
} as const;

/** Vector outline of the "ba" monogram. Fill it with BRAND_COLORS.red (or white on a red / blue plate). */
export const BRAND_MONOGRAM = {
  /** Bounding box of the path: x 0..453, y -57..341. */
  minX: 0,
  minY: -57,
  width: 453,
  height: 398,
  path: 'M315.264 65.9256C281.366 65.9256 250.282 78.2583 226.299 98.6342C202.316 78.2583 171.232 65.9256 137.334 65.9256C92.7169 65.9256 53.0577 87.3739 27.8687 120.351V-42.9246C28.0027 -50.6996 21.7054 -57 14.0683 -57C6.43123 -57 0 -50.6996 0 -42.9246V203.463C0 279.336 61.6327 341 137.468 341C171.366 341 202.45 328.667 226.433 308.291C250.416 328.667 281.5 341 315.398 341C360.015 341 399.674 319.552 424.863 286.575V327.059C424.863 334.834 431.161 341 438.932 341C446.703 341 453 334.7 453 327.059V203.463C453 127.589 391.367 65.9256 315.532 65.9256M226.567 267.271C213.705 249.309 205.933 227.324 205.933 203.463C205.933 179.602 213.571 157.617 226.567 139.654C239.429 157.617 247.201 179.602 247.201 203.463C247.201 227.324 239.563 249.309 226.567 267.271ZM28.2706 203.463C28.2706 143.139 77.3088 93.9424 137.736 93.9424C164.13 93.9424 188.248 103.326 207.273 118.876C189.051 142.201 178.065 171.558 178.065 203.463C178.065 235.367 189.051 264.724 207.273 288.049C188.382 303.6 164.13 312.983 137.736 312.983C77.3088 312.983 28.2706 263.92 28.2706 203.463ZM315.532 312.983C289.138 312.983 265.02 303.6 245.995 288.049C264.216 264.724 275.203 235.367 275.203 203.463C275.203 171.558 264.216 142.201 245.995 118.876C264.886 103.326 289.138 93.9424 315.532 93.9424C375.825 93.9424 424.997 143.139 424.997 203.463C424.997 263.786 375.825 312.983 315.532 312.983Z',
} as const;

/** The wordmark as written by the laboratory. */
export const BRAND_WORDMARK = { top: 'LABORATOIRE', bottom: 'bio ard\u2019aisne' } as const;
