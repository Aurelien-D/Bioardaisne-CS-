/**
 * Signs: every SignDef of a map becomes a textured quad (signage, posters, street plates,
 * shop fascias, screens, banners, floor markings).
 *
 * Each distinct sign (same style / text / colours / icon / proportions) is drawn once on
 * a 2D canvas, the canvases are packed into a few atlas pages, and all the quads of a page
 * are merged into ONE mesh: a whole map of signs costs one or two draw calls.
 *
 * Quads sit 5 mm in front of their wall and use polygonOffset; the material is alpha-tested
 * (rounded corners, floor paint) and unlit: the vertex colour carries the baked light of
 * the sign's position, or full white for self-illuminated signs (`lit`, and screens by default).
 */
import { BRAND_COLORS, BRAND_MONOGRAM } from '../core/brand';
import * as THREE from 'three';
import { BRAND } from '../../shared/identity';
import type { SignDef, SignStyle } from '../../shared/maps/types';
import { hash3, mulberry32 } from '../../shared/math/rng';
import type { Quality } from '../core/settings';
import type { SurfaceShader } from './world/lighting';

// =================================================================================
// Small canvas helpers
// =================================================================================

type Ctx = CanvasRenderingContext2D;

const SANS = '"Inter", "Segoe UI", "Helvetica Neue", Arial, "Liberation Sans", "DejaVu Sans", sans-serif';
const SERIF = 'Georgia, "Times New Roman", "DejaVu Serif", "Liberation Serif", serif';

const css = (hex: number, alpha = 1): string =>
  `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${alpha})`;

/** Scale a colour toward black (k < 1) or toward white (k > 1). */
function tone(hex: number, k: number): number {
  let r = (hex >> 16) & 255;
  let g = (hex >> 8) & 255;
  let b = hex & 255;
  if (k <= 1) {
    r *= k;
    g *= k;
    b *= k;
  } else {
    const t = Math.min(1, k - 1);
    r += (255 - r) * t;
    g += (255 - g) * t;
    b += (255 - b) * t;
  }
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

/** Perceived brightness 0..1 of a colour. */
const luma = (hex: number): number =>
  (0.299 * ((hex >> 16) & 255) + 0.587 * ((hex >> 8) & 255) + 0.114 * (hex & 255)) / 255;

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

interface FontSpec {
  weight: number | string;
  family: string;
  italic?: boolean;
}

const fontCss = (f: FontSpec, size: number): string => `${f.italic ? 'italic ' : ''}${f.weight} ${size}px ${f.family}`;

/** Widest line of `lines` at 100 px, to derive a fitted size. */
function widthAt100(ctx: Ctx, lines: readonly string[], font: FontSpec): number {
  ctx.font = fontCss(font, 100);
  let w = 1;
  for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
  return w;
}

/** Line height as a multiple of the font size (room for accented capitals). */
const LINE = 1.16;

/** Largest font size at which `lines` fit in a maxW × maxH box. */
function fitSize(ctx: Ctx, lines: readonly string[], font: FontSpec, maxW: number, maxH: number): number {
  const byWidth = (100 * maxW) / widthAt100(ctx, lines, font);
  const byHeight = maxH / (lines.length * LINE);
  return Math.max(4, Math.min(byWidth, byHeight));
}

/**
 * Best layout of a short label on 1..maxLines lines (split at spaces):
 * returns the split that allows the largest font.
 */
function fitLabel(
  ctx: Ctx,
  text: string,
  font: FontSpec,
  maxW: number,
  maxH: number,
  maxLines = 2,
): { lines: string[]; size: number } {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  let best = { lines: [text], size: fitSize(ctx, [text], font, maxW, maxH) };
  if (maxLines >= 2 && words.length >= 2) {
    for (let cut = 1; cut < words.length; cut++) {
      const lines = [words.slice(0, cut).join(' '), words.slice(cut).join(' ')];
      const size = fitSize(ctx, lines, font, maxW, maxH);
      if (size > best.size * 1.05) best = { lines, size };
    }
  }
  if (maxLines >= 3 && words.length >= 3) {
    for (let a = 1; a < words.length - 1; a++) {
      for (let b = a + 1; b < words.length; b++) {
        const lines = [words.slice(0, a).join(' '), words.slice(a, b).join(' '), words.slice(b).join(' ')];
        const size = fitSize(ctx, lines, font, maxW, maxH);
        if (size > best.size * 1.12) best = { lines, size };
      }
    }
  }
  return best;
}

/** Draw centred lines around (cx, cy). */
function drawLines(ctx: Ctx, lines: readonly string[], font: FontSpec, size: number, cx: number, cy: number): void {
  ctx.font = fontCss(font, size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const step = size * LINE;
  let y = cy - ((lines.length - 1) * step) / 2 + size * 0.04;
  for (const l of lines) {
    ctx.fillText(l, cx, y);
    y += step;
  }
}

/** Greedy word wrap at the current ctx.font. */
function wrap(ctx: Ctx, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      const probe = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(probe).width > maxW) {
        out.push(line);
        line = word;
      } else {
        line = probe;
      }
    }
    out.push(line);
  }
  return out;
}

/** Wrapped paragraph fitted in a box: largest size (≤ maxSize) whose wrapping fits. */
function drawParagraph(
  ctx: Ctx,
  text: string,
  font: FontSpec,
  x: number,
  y: number,
  w: number,
  h: number,
  maxSize: number,
): void {
  let size = maxSize;
  let lines: string[] = [];
  for (let i = 0; i < 24; i++) {
    ctx.font = fontCss(font, size);
    lines = wrap(ctx, text, w);
    let widest = 0;
    for (const l of lines) widest = Math.max(widest, ctx.measureText(l).width);
    if (lines.length * size * 1.25 <= h && widest <= w) break;
    size *= 0.9;
    if (size < 5) break;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const step = size * 1.25;
  let ly = y + h / 2 - ((lines.length - 1) * step) / 2;
  for (const l of lines) {
    ctx.fillText(l, x + w / 2, ly);
    ly += step;
  }
}

// =================================================================================
// Pictograms (drawn in a square of side `s` centred on (cx, cy))
// =================================================================================

function dropPath(ctx: Ctx, cx: number, cy: number, h: number): void {
  // Pointed top, round bottom; `h` = total height.
  const r = h * 0.36;
  const by = cy + h / 2 - r;
  ctx.beginPath();
  ctx.moveTo(cx, cy - h / 2);
  ctx.bezierCurveTo(cx + r * 0.35, cy - h * 0.18, cx + r, by - r * 0.75, cx + r, by);
  ctx.arc(cx, by, r, 0, Math.PI, false);
  ctx.bezierCurveTo(cx - r, by - r * 0.75, cx - r * 0.35, cy - h * 0.18, cx, cy - h / 2);
  ctx.closePath();
}

function drawDrop(ctx: Ctx, cx: number, cy: number, h: number, outline: string | null): void {
  dropPath(ctx, cx, cy, h);
  ctx.fillStyle = css(BRAND.red);
  ctx.fill();
  if (outline) {
    ctx.lineWidth = Math.max(1, h * 0.06);
    ctx.strokeStyle = outline;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(cx - h * 0.1, cy + h * 0.12, h * 0.045, h * 0.1, 0.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fill();
}

/** Original BioArd'Aisne-style mark: a blood drop in a sighting ring. */
function drawLogo(ctx: Ctx, cx: number, cy: number, s: number): void {
  // Official "ba" monogram of the laboratory (vector outline from core/brand.ts).
  const m = BRAND_MONOGRAM;
  const k = (s * 0.95) / Math.max(m.width, m.height);
  ctx.save();
  ctx.translate(cx - (m.width * k) / 2, cy - (m.height * k) / 2);
  ctx.scale(k, k);
  ctx.translate(-m.minX, -m.minY);
  ctx.fillStyle = BRAND_COLORS.red;
  ctx.fill(monogramPath());
  ctx.restore();
}

let monogram: Path2D | null = null;
function monogramPath(): Path2D {
  if (!monogram) monogram = new Path2D(BRAND_MONOGRAM.path);
  return monogram;
}

function drawCross(ctx: Ctx, cx: number, cy: number, s: number, fg: string): void {
  const a = s * 0.15;
  const l = s * 0.42;
  ctx.fillStyle = fg;
  roundRect(ctx, cx - a, cy - l, a * 2, l * 2, s * 0.03);
  ctx.fill();
  roundRect(ctx, cx - l, cy - a, l * 2, a * 2, s * 0.03);
  ctx.fill();
}

function drawBiohazard(ctx: Ctx, cx: number, cy: number, s: number): void {
  const yellow = '#f6c915';
  const black = '#1a1a1a';
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.48, 0, Math.PI * 2);
  ctx.fillStyle = yellow;
  ctx.fill();
  ctx.lineWidth = s * 0.045;
  ctx.strokeStyle = black;
  ctx.stroke();
  // Three open rings around the centre.
  const d = s * 0.165;
  const r = s * 0.15;
  ctx.lineWidth = s * 0.07;
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + (k * Math.PI * 2) / 3;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, a + 0.55, a + Math.PI * 2 - 0.55);
    ctx.stroke();
  }
  // Central ring, then the yellow cuts that separate the three blades.
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.105, 0, Math.PI * 2);
  ctx.lineWidth = s * 0.05;
  ctx.stroke();
  ctx.strokeStyle = yellow;
  ctx.lineWidth = s * 0.028;
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + (k * Math.PI * 2) / 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * s * 0.26, cy + Math.sin(a) * s * 0.26);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.045, 0, Math.PI * 2);
  ctx.fillStyle = yellow;
  ctx.fill();
  ctx.restore();
}

/** Arrow pointing right, rotated by `angle` (radians, canvas orientation). */
function drawArrow(ctx: Ctx, cx: number, cy: number, s: number, fg: string, angle: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.moveTo(-s * 0.44, -s * 0.11);
  ctx.lineTo(s * 0.04, -s * 0.11);
  ctx.lineTo(s * 0.04, -s * 0.33);
  ctx.lineTo(s * 0.46, 0);
  ctx.lineTo(s * 0.04, s * 0.33);
  ctx.lineTo(s * 0.04, s * 0.11);
  ctx.lineTo(-s * 0.44, s * 0.11);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawWc(ctx: Ctx, cx: number, cy: number, s: number, fg: string): void {
  ctx.fillStyle = fg;
  const head = s * 0.085;
  const top = cy - s * 0.4;
  // Man (left)
  const mx = cx - s * 0.24;
  ctx.beginPath();
  ctx.arc(mx, top + head, head, 0, Math.PI * 2);
  ctx.fill();
  roundRect(ctx, mx - s * 0.12, top + head * 2.3, s * 0.24, s * 0.3, s * 0.04);
  ctx.fill();
  ctx.fillRect(mx - s * 0.085, top + head * 2.3 + s * 0.26, s * 0.075, s * 0.34);
  ctx.fillRect(mx + s * 0.01, top + head * 2.3 + s * 0.26, s * 0.075, s * 0.34);
  // Woman (right)
  const wx = cx + s * 0.24;
  ctx.beginPath();
  ctx.arc(wx, top + head, head, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(wx - s * 0.075, top + head * 2.3);
  ctx.lineTo(wx + s * 0.075, top + head * 2.3);
  ctx.lineTo(wx + s * 0.18, top + head * 2.3 + s * 0.4);
  ctx.lineTo(wx - s * 0.18, top + head * 2.3 + s * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(wx - s * 0.075, top + head * 2.3 + s * 0.38, s * 0.06, s * 0.22);
  ctx.fillRect(wx + s * 0.015, top + head * 2.3 + s * 0.38, s * 0.06, s * 0.22);
  // Divider
  ctx.fillRect(cx - s * 0.012, cy - s * 0.4, s * 0.024, s * 0.8);
}

function drawExit(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.save();
  roundRect(ctx, cx - s * 0.48, cy - s * 0.48, s * 0.96, s * 0.96, s * 0.08);
  ctx.fillStyle = '#12924a';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  // Doorway
  ctx.fillRect(cx + s * 0.14, cy - s * 0.36, s * 0.24, s * 0.72);
  // Running figure
  ctx.beginPath();
  ctx.arc(cx - s * 0.06, cy - s * 0.27, s * 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = s * 0.075;
  const line = (pts: number[]): void => {
    ctx.beginPath();
    ctx.moveTo(cx + pts[0]! * s, cy + pts[1]! * s);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(cx + pts[i]! * s, cy + pts[i + 1]! * s);
    ctx.stroke();
  };
  line([-0.1, -0.15, -0.19, 0.06]); // torso
  line([-0.19, 0.06, -0.05, 0.19, -0.09, 0.36]); // front leg
  line([-0.19, 0.06, -0.31, 0.17, -0.41, 0.27]); // back leg
  line([-0.11, -0.12, 0.02, -0.05, 0.09, -0.15]); // front arm
  line([-0.11, -0.12, -0.26, -0.1, -0.33, 0.01]); // back arm
  ctx.restore();
}

function drawTube(ctx: Ctx, cx: number, cy: number, s: number, fg: string): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(0.38);
  const w = s * 0.22;
  const top = -s * 0.36;
  const bottom = s * 0.42;
  const body = (): void => {
    ctx.beginPath();
    ctx.moveTo(-w / 2, top);
    ctx.lineTo(-w / 2, bottom - w / 2);
    ctx.arc(0, bottom - w / 2, w / 2, Math.PI, 0, true);
    ctx.lineTo(w / 2, top);
    ctx.closePath();
  };
  body();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fill();
  // Liquid
  ctx.save();
  body();
  ctx.clip();
  ctx.fillStyle = css(BRAND.red);
  ctx.fillRect(-w, top + (bottom - top) * 0.42, w * 2, bottom - top);
  ctx.restore();
  body();
  ctx.lineWidth = s * 0.04;
  ctx.strokeStyle = fg;
  ctx.stroke();
  // Cap
  roundRect(ctx, -w * 0.72, top - s * 0.1, w * 1.44, s * 0.13, s * 0.025);
  ctx.fillStyle = '#8a4fb5';
  ctx.fill();
  ctx.restore();
}

function drawIcon(ctx: Ctx, icon: string, cx: number, cy: number, s: number, fg: string): void {
  switch (icon) {
    case 'logo':
      drawLogo(ctx, cx, cy, s);
      break;
    case 'cross':
      drawCross(ctx, cx, cy, s, fg);
      break;
    case 'biohazard':
      drawBiohazard(ctx, cx, cy, s);
      break;
    case 'arrow_right':
      drawArrow(ctx, cx, cy, s, fg, 0);
      break;
    case 'arrow_left':
      drawArrow(ctx, cx, cy, s, fg, Math.PI);
      break;
    case 'arrow_up':
      drawArrow(ctx, cx, cy, s, fg, -Math.PI / 2);
      break;
    case 'wc':
      drawWc(ctx, cx, cy, s, fg);
      break;
    case 'exit':
      drawExit(ctx, cx, cy, s);
      break;
    case 'tube':
      drawTube(ctx, cx, cy, s, fg);
      break;
    case 'drop':
      drawDrop(ctx, cx, cy, s * 0.86, 'rgba(255,255,255,0.9)');
      break;
    default:
      break; // unknown pictogram: text only
  }
}

// =================================================================================
// Sign styles
// =================================================================================

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ContentStyle {
  font: FontSpec;
  subFont: FontSpec;
  color: string;
  subColor: string;
  /** Pictogram colour for monochrome icons. */
  iconColor: string;
  upper?: boolean;
  subUpper?: boolean;
  maxLines?: number;
  /** Upper bound of the title size, as a fraction of the content height (default: none). */
  maxSize?: number;
  /** Shadow / glow behind the lettering. */
  shadow?: { color: string; blur: number; dx: number; dy: number };
}

const upperFr = (s: string): string => s.toLocaleUpperCase('fr-FR');

/**
 * Standard content block: optional pictogram on the left, title (+ subtitle) centred in
 * the remaining space. With no text at all the pictogram fills the box.
 */
function drawContent(ctx: Ctx, def: SignDef, area: Box, st: ContentStyle): void {
  const text = st.upper ? upperFr(def.text) : def.text;
  const sub = def.sub ? (st.subUpper ? upperFr(def.sub) : def.sub) : '';
  const hasText = text.trim().length > 0 || sub.length > 0;
  let tx = area.x;
  let tw = area.w;

  if (def.icon) {
    if (!hasText) {
      const s = Math.min(area.w, area.h);
      drawIcon(ctx, def.icon, area.x + area.w / 2, area.y + area.h / 2, s, st.iconColor);
      return;
    }
    const s = Math.min(area.h, area.w * 0.36);
    drawIcon(ctx, def.icon, area.x + s / 2, area.y + area.h / 2, s, st.iconColor);
    const gap = s * 0.16;
    tx += s + gap;
    tw -= s + gap;
  }
  if (!hasText) return;

  ctx.save();
  if (st.shadow) {
    ctx.shadowColor = st.shadow.color;
    ctx.shadowBlur = st.shadow.blur;
    ctx.shadowOffsetX = st.shadow.dx;
    ctx.shadowOffsetY = st.shadow.dy;
  }
  const cx = tx + tw / 2;
  if (sub && text.trim()) {
    const mainH = area.h * 0.6;
    const subH = area.h * 0.3;
    const main = fitLabel(ctx, text, st.font, tw, mainH, st.maxLines ?? 1);
    if (st.maxSize) main.size = Math.min(main.size, area.h * st.maxSize);
    const subSize = Math.min(fitSize(ctx, [sub], st.subFont, tw, subH), main.size * 0.62);
    const total = main.lines.length * main.size * LINE + subSize * LINE * 1.08;
    const top = area.y + (area.h - total) / 2;
    ctx.fillStyle = st.color;
    drawLines(ctx, main.lines, st.font, main.size, cx, top + (main.lines.length * main.size * LINE) / 2);
    ctx.fillStyle = st.subColor;
    drawLines(ctx, [sub], st.subFont, subSize, cx, top + total - (subSize * LINE) / 2);
  } else {
    const only = text.trim() ? text : sub;
    const font = text.trim() ? st.font : st.subFont;
    const fit = fitLabel(ctx, only, font, tw, area.h * 0.84, st.maxLines ?? 2);
    if (st.maxSize) fit.size = Math.min(fit.size, area.h * st.maxSize);
    ctx.fillStyle = st.color;
    drawLines(ctx, fit.lines, font, fit.size, cx, area.y + area.h / 2);
  }
  ctx.restore();
}

function screw(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#d5dae0';
  ctx.fill();
  ctx.lineWidth = Math.max(0.75, r * 0.3);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - r * 0.6, y - r * 0.3);
  ctx.lineTo(x + r * 0.6, y + r * 0.3);
  ctx.stroke();
}

function drawPlaque(ctx: Ctx, def: SignDef, W: number, H: number): void {
  const m = Math.min(W, H);
  const bg = def.bg ?? BRAND.blueDark;
  const fg = def.color ?? 0xffffff;
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, css(tone(bg, 1.16)));
  grad.addColorStop(0.5, css(bg));
  grad.addColorStop(1, css(tone(bg, 0.78)));
  roundRect(ctx, 0, 0, W, H, m * 0.1);
  ctx.fillStyle = grad;
  ctx.fill();
  // Bevel
  roundRect(ctx, m * 0.02, m * 0.02, W - m * 0.04, H - m * 0.04, m * 0.085);
  ctx.lineWidth = Math.max(1, m * 0.025);
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.stroke();
  // Engraved inner line
  roundRect(ctx, m * 0.085, m * 0.085, W - m * 0.17, H - m * 0.17, m * 0.05);
  ctx.lineWidth = Math.max(1, m * 0.016);
  ctx.strokeStyle = css(fg, 0.6);
  ctx.stroke();
  const sr = m * 0.032;
  const so = m * 0.175;
  if (m >= 56 && W > m * 1.6) {
    screw(ctx, so, H / 2, sr);
    screw(ctx, W - so, H / 2, sr);
  }
  const padX = W > m * 1.6 ? m * 0.3 : m * 0.16;
  drawContent(
    ctx,
    def,
    { x: padX, y: m * 0.15, w: W - padX * 2, h: H - m * 0.3 },
    {
      font: { weight: 700, family: SANS },
      subFont: { weight: 500, family: SANS },
      color: css(fg),
      subColor: css(fg, 0.86),
      iconColor: css(fg),
      subUpper: true,
      shadow: { color: 'rgba(0,0,0,0.5)', blur: 0, dx: 0, dy: Math.max(1, m * 0.012) },
    },
  );
}

function drawDoor(ctx: Ctx, def: SignDef, W: number, H: number): void {
  const m = Math.min(W, H);
  const bg = def.bg ?? 0xf6f7f8;
  const fg = def.color ?? BRAND.grey;
  roundRect(ctx, 0, 0, W, H, m * 0.12);
  ctx.fillStyle = css(bg);
  ctx.fill();
  const hasText = def.text.trim().length > 0 || !!def.sub;
  if (!hasText && def.icon) {
    // Pictogram-only label: the whole panel is the accent colour.
    roundRect(ctx, 0, 0, W, H, m * 0.12);
    ctx.fillStyle = css(BRAND.blue);
    ctx.fill();
    roundRect(ctx, m * 0.05, m * 0.05, W - m * 0.1, H - m * 0.1, m * 0.08);
    ctx.lineWidth = Math.max(1, m * 0.02);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.stroke();
    drawIcon(ctx, def.icon, W / 2, H / 2, m * 0.76, '#ffffff');
    return;
  }
  ctx.save();
  roundRect(ctx, 0, 0, W, H, m * 0.12);
  ctx.clip();
  // Accent band on the left (holds the pictogram when there is one).
  const band = def.icon ? Math.min(H, W * 0.3) : Math.max(m * 0.1, W * 0.035);
  ctx.fillStyle = css(BRAND.blue);
  ctx.fillRect(0, 0, band, H);
  ctx.fillStyle = css(BRAND.red);
  ctx.fillRect(band, H - Math.max(2, m * 0.06), W - band, Math.max(2, m * 0.06));
  ctx.restore();
  roundRect(ctx, 0.5, 0.5, W - 1, H - 1, m * 0.12);
  ctx.lineWidth = Math.max(1, m * 0.02);
  ctx.strokeStyle = 'rgba(60,70,80,0.55)';
  ctx.stroke();
  if (def.icon) drawIcon(ctx, def.icon, band / 2, H / 2, Math.min(band, H) * 0.74, '#ffffff');
  const pad = m * 0.1;
  drawContent(
    ctx,
    { ...def, icon: undefined },
    { x: band + pad, y: pad, w: W - band - pad * 2, h: H - pad * 2 - m * 0.05 },
    {
      font: { weight: 700, family: SANS },
      subFont: { weight: 500, family: SANS },
      color: css(fg),
      subColor: css(fg, 0.75),
      iconColor: css(fg),
      maxLines: 2,
      maxSize: 0.52,
    },
  );
}

function drawPoster(ctx: Ctx, def: SignDef, W: number, H: number, rng: () => number): void {
  const m = Math.min(W, H);
  const paper = def.bg ?? 0xfbf9f1;
  const accent = def.color ?? BRAND.blue;
  ctx.fillStyle = css(paper);
  ctx.fillRect(0, 0, W, H);
  // Paper grain and a faint fold.
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(90,80,60,${0.015 + rng() * 0.03})`;
    ctx.fillRect(rng() * W, rng() * H, 1 + rng() * 2, 1 + rng() * 2);
  }
  const fold = ctx.createLinearGradient(0, H * 0.48, 0, H * 0.52);
  fold.addColorStop(0, 'rgba(0,0,0,0)');
  fold.addColorStop(0.5, 'rgba(0,0,0,0.045)');
  fold.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fold;
  ctx.fillRect(0, H * 0.46, W, H * 0.08);

  const pad = m * 0.07;
  const hasBody = !!def.sub || !!def.icon;
  const bandH = hasBody ? Math.max(H * 0.2, m * 0.2) : H;
  // Title band
  ctx.fillStyle = css(accent);
  if (hasBody) ctx.fillRect(0, 0, W, bandH);
  const titleColor = hasBody ? (luma(accent) > 0.62 ? css(BRAND.grey) : '#ffffff') : css(accent);
  const title = fitLabel(ctx, def.text, { weight: 800, family: SANS }, W - pad * 2, bandH - pad * (hasBody ? 0.9 : 2), 3);
  ctx.fillStyle = titleColor;
  drawLines(ctx, title.lines, { weight: 800, family: SANS }, title.size, W / 2, bandH / 2);

  if (hasBody) {
    let y = bandH + pad;
    const bottom = H - pad * 1.6;
    if (def.icon) {
      const s = Math.min(W - pad * 2, (bottom - y) * (def.sub ? 0.5 : 0.92));
      drawIcon(ctx, def.icon, W / 2, y + s / 2, s, css(accent));
      y += s + pad * 0.6;
    }
    if (def.sub && bottom - y > 6) {
      ctx.fillStyle = css(BRAND.grey);
      drawParagraph(ctx, def.sub, { weight: 500, family: SANS }, pad, y, W - pad * 2, bottom - y, m * 0.11);
    }
    // Footer rule
    ctx.fillStyle = css(accent);
    ctx.fillRect(pad, H - pad * 1.05, W - pad * 2, Math.max(1.5, m * 0.012));
  }
  // Edge shading + sticky tape at the top corners.
  ctx.lineWidth = Math.max(1, m * 0.012);
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  const tape = (x: number, a: number): void => {
    ctx.save();
    ctx.translate(x, m * 0.035);
    ctx.rotate(a);
    ctx.fillStyle = 'rgba(232,222,170,0.82)';
    ctx.fillRect(-m * 0.085, -m * 0.03, m * 0.17, m * 0.06);
    ctx.restore();
  };
  tape(m * 0.09, -0.6);
  tape(W - m * 0.09, 0.6);
}

function drawStreet(ctx: Ctx, def: SignDef, W: number, H: number): void {
  const m = Math.min(W, H);
  const bg = def.bg ?? 0x1b3d8f;
  const fg = def.color ?? 0xffffff;
  roundRect(ctx, 0, 0, W, H, m * 0.11);
  ctx.fillStyle = css(bg);
  ctx.fill();
  // Enamel gloss
  ctx.save();
  roundRect(ctx, 0, 0, W, H, m * 0.11);
  ctx.clip();
  const gloss = ctx.createLinearGradient(0, 0, W * 0.4, H);
  gloss.addColorStop(0, 'rgba(255,255,255,0.2)');
  gloss.addColorStop(0.45, 'rgba(255,255,255,0.03)');
  gloss.addColorStop(1, 'rgba(0,0,0,0.2)');
  ctx.fillStyle = gloss;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  // White border line
  const inset = m * 0.085;
  roundRect(ctx, inset, inset, W - inset * 2, H - inset * 2, m * 0.06);
  ctx.lineWidth = Math.max(1.5, m * 0.035);
  ctx.strokeStyle = css(fg);
  ctx.stroke();
  // Fixing holes
  if (m >= 48) {
    for (const x of [inset + m * 0.13, W - inset - m * 0.13]) {
      ctx.beginPath();
      ctx.arc(x, H / 2, m * 0.028, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10,15,30,0.75)';
      ctx.fill();
    }
  }
  const padX = inset + m * 0.26;
  const padY = inset + m * 0.08;
  drawContent(
    ctx,
    def,
    { x: padX, y: padY, w: W - padX * 2, h: H - padY * 2 },
    {
      font: { weight: 700, family: SANS },
      subFont: { weight: 500, family: SANS },
      color: css(fg),
      subColor: css(fg, 0.9),
      iconColor: css(fg),
      upper: true,
      maxLines: 2,
    },
  );
}

function drawShop(ctx: Ctx, def: SignDef, W: number, H: number, lit: boolean): void {
  const m = Math.min(W, H);
  const bg = def.bg ?? 0x23343c;
  const fg = def.color ?? 0xf3e4bd;
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, css(tone(bg, 1.1)));
  grad.addColorStop(1, css(tone(bg, 0.82)));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  // Moulding: double line frame
  ctx.strokeStyle = css(fg, 0.85);
  ctx.lineWidth = Math.max(1, m * 0.022);
  ctx.strokeRect(m * 0.07, m * 0.07, W - m * 0.14, H - m * 0.14);
  ctx.lineWidth = Math.max(0.75, m * 0.008);
  ctx.strokeRect(m * 0.115, m * 0.115, W - m * 0.23, H - m * 0.23);
  const padX = m * 0.24;
  const padY = m * 0.16;
  drawContent(
    ctx,
    def,
    { x: padX, y: padY, w: W - padX * 2, h: H - padY * 2 },
    {
      font: { weight: 700, family: SERIF },
      subFont: { weight: 600, family: SANS },
      color: css(fg),
      subColor: css(fg, 0.88),
      iconColor: css(fg),
      subUpper: true,
      shadow: lit
        ? { color: css(fg, 0.9), blur: m * 0.09, dx: 0, dy: 0 }
        : { color: 'rgba(0,0,0,0.45)', blur: 0, dx: 0, dy: Math.max(1, m * 0.014) },
    },
  );
}

function drawScreen(ctx: Ctx, def: SignDef, W: number, H: number): void {
  const m = Math.min(W, H);
  const bg = def.bg ?? 0x06203a;
  const fg = def.color ?? 0x9fe4ff;
  ctx.fillStyle = '#05070a';
  ctx.fillRect(0, 0, W, H);
  const bz = Math.max(2, m * 0.035);
  const grad = ctx.createRadialGradient(W / 2, H / 2, m * 0.1, W / 2, H / 2, Math.max(W, H) * 0.7);
  grad.addColorStop(0, css(tone(bg, 1.22)));
  grad.addColorStop(1, css(tone(bg, 0.7)));
  ctx.fillStyle = grad;
  ctx.fillRect(bz, bz, W - bz * 2, H - bz * 2);
  // Header strip with status dots
  const bar = Math.max(4, (H - bz * 2) * 0.13);
  ctx.fillStyle = css(BRAND.blue);
  ctx.fillRect(bz, bz, W - bz * 2, bar);
  const dots = [0x4dff7a, 0xffd34d, 0xff5a5a];
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(W - bz - bar * (0.7 + i * 0.8), bz + bar / 2, bar * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = css(dots[i]!);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(bz + bar * 0.5, bz + bar * 0.36, Math.min(W * 0.25, bar * 5), bar * 0.28);
  const pad = m * 0.09;
  drawContent(
    ctx,
    def,
    { x: bz + pad, y: bz + bar + pad * 0.6, w: W - bz * 2 - pad * 2, h: H - bz * 2 - bar - pad * 1.2 },
    {
      font: { weight: 700, family: SANS },
      subFont: { weight: 500, family: SANS },
      color: css(fg),
      subColor: 'rgba(240,248,255,0.9)',
      iconColor: css(fg),
      maxLines: 2,
      shadow: { color: css(fg, 0.85), blur: m * 0.07, dx: 0, dy: 0 },
    },
  );
  // Scanlines
  ctx.fillStyle = 'rgba(0,0,0,0.13)';
  const stepY = Math.max(2, Math.round(H / 90));
  for (let y = bz; y < H - bz; y += stepY * 2) ctx.fillRect(bz, y, W - bz * 2, stepY * 0.6);
}

function drawBanner(ctx: Ctx, def: SignDef, W: number, H: number): void {
  const m = Math.min(W, H);
  const bg = def.bg ?? BRAND.blue;
  const fg = def.color ?? 0xffffff;
  ctx.fillStyle = css(bg);
  ctx.fillRect(0, 0, W, H);
  // Cloth folds
  const folds = Math.max(3, Math.round(W / (m * 0.9)));
  for (let i = 0; i < folds; i++) {
    const x0 = (i / folds) * W;
    const g = ctx.createLinearGradient(x0, 0, x0 + W / folds, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.09)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.07)');
    g.addColorStop(1, 'rgba(0,0,0,0.09)');
    ctx.fillStyle = g;
    ctx.fillRect(x0, 0, W / folds + 1, H);
  }
  // Hems and eyelets
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fillRect(0, 0, W, m * 0.055);
  ctx.fillRect(0, H - m * 0.055, W, m * 0.055);
  for (const [x, y] of [
    [m * 0.09, m * 0.1],
    [W - m * 0.09, m * 0.1],
    [m * 0.09, H - m * 0.1],
    [W - m * 0.09, H - m * 0.1],
  ] as const) {
    ctx.beginPath();
    ctx.arc(x, y, m * 0.035, 0, Math.PI * 2);
    ctx.fillStyle = '#c9ced3';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, m * 0.016, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20,20,25,0.85)';
    ctx.fill();
  }
  const padX = m * 0.22;
  const padY = m * 0.13;
  drawContent(
    ctx,
    def,
    { x: padX, y: padY, w: W - padX * 2, h: H - padY * 2 },
    {
      font: { weight: 800, family: SANS },
      subFont: { weight: 600, family: SANS },
      color: css(fg),
      subColor: css(fg, 0.9),
      iconColor: css(fg),
      shadow: { color: 'rgba(0,0,0,0.3)', blur: 0, dx: 0, dy: Math.max(1, m * 0.012) },
    },
  );
}

function drawFloor(ctx: Ctx, def: SignDef, W: number, H: number, rng: () => number): void {
  const m = Math.min(W, H);
  const fg = def.color ?? 0xf3f1e6;
  if (def.bg !== undefined) {
    roundRect(ctx, 0, 0, W, H, m * 0.04);
    ctx.fillStyle = css(def.bg);
    ctx.fill();
  }
  const pad = m * 0.06;
  drawContent(
    ctx,
    def,
    { x: pad, y: pad, w: W - pad * 2, h: H - pad * 2 },
    {
      font: { weight: 900, family: SANS },
      subFont: { weight: 700, family: SANS },
      color: css(fg),
      subColor: css(fg),
      iconColor: css(fg),
      upper: true,
      subUpper: true,
      maxLines: 2,
    },
  );
  // Worn paint: punch small holes and a few scuffs.
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  const specks = Math.round((W * H) / 420);
  for (let i = 0; i < specks; i++) {
    const r = 0.6 + rng() * rng() * m * 0.012;
    ctx.beginPath();
    ctx.arc(rng() * W, rng() * H, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const x = rng() * W;
    const y = rng() * H;
    const a = rng() * Math.PI;
    const l = m * (0.05 + rng() * 0.16);
    ctx.lineWidth = 1 + rng() * m * 0.01;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  ctx.restore();
}

const isLit = (def: SignDef): boolean => def.lit ?? def.style === 'screen';

/** Draw one sign on a new canvas of `width` × `height` pixels. */
export function drawSignCanvas(def: SignDef, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(8, Math.round(width));
  canvas.height = Math.max(8, Math.round(height));
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  const rng = mulberry32(hash3(def.text.length * 31 + (def.sub?.length ?? 0), W, H) ^ 0x51a9);
  const style: SignStyle = def.style;
  switch (style) {
    case 'plaque':
      drawPlaque(ctx, def, W, H);
      break;
    case 'door':
      drawDoor(ctx, def, W, H);
      break;
    case 'poster':
      drawPoster(ctx, def, W, H, rng);
      break;
    case 'street':
      drawStreet(ctx, def, W, H);
      break;
    case 'shop':
      drawShop(ctx, def, W, H, isLit(def));
      break;
    case 'screen':
      drawScreen(ctx, def, W, H);
      break;
    case 'banner':
      drawBanner(ctx, def, W, H);
      break;
    case 'floor':
      drawFloor(ctx, def, W, H, rng);
      break;
  }
  return canvas;
}

// =================================================================================
// Atlas + merged quads
// =================================================================================

const PX_PER_METRE: Record<Quality, number> = { low: 160, medium: 256, high: 384 };
const MAX_SIGN_PX: Record<Quality, number> = { low: 512, medium: 768, high: 1024 };
const MIN_LONG_SIDE_PX: Record<Quality, number> = { low: 128, medium: 192, high: 256 };
const PAGE_SIZE: Record<Quality, number> = { low: 1024, medium: 2048, high: 2048 };
const ANISOTROPY: Record<Quality, number> = { low: 2, medium: 4, high: 8 };
/** Gutter (px) around each sign in the atlas, filled with stretched edge colours. */
const PAD = 6;
/** Distance (m) between a sign and the surface it is fixed on. */
const WALL_OFFSET = 0.005;

export interface SignBuildOptions {
  quality: Quality;
  /** Light at the sign position (unlit signs). Without it signs are drawn at full brightness. */
  shader?: SurfaceShader;
  /** The renderer has MSAA: use alpha-to-coverage for smooth cut-out edges. */
  antialias?: boolean;
}

export interface Signs {
  /** Add to the world scene. Named 'bas-signs'. */
  readonly group: THREE.Group;
  readonly count: number;
  dispose(): void;
}

interface Slot {
  canvas: HTMLCanvasElement;
  page: number;
  x: number;
  y: number;
}

/** Right / up unit vectors of a sign by `facing` (right × up = normal). */
const FACING: readonly { n: readonly number[]; r: readonly number[]; u: readonly number[] }[] = [
  { n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0] }, // 0: +Z
  { n: [1, 0, 0], r: [0, 0, -1], u: [0, 1, 0] }, // 1: +X
  { n: [0, 0, -1], r: [-1, 0, 0], u: [0, 1, 0] }, // 2: -Z
  { n: [-1, 0, 0], r: [0, 0, 1], u: [0, 1, 0] }, // 3: -X
  { n: [0, 1, 0], r: [1, 0, 0], u: [0, 0, -1] }, // 4: up (text reads when looking toward -Z)
  { n: [0, -1, 0], r: [1, 0, 0], u: [0, 0, 1] }, // 5: down
];

/** Build the sign meshes of a map. */
export function buildSigns(defs: readonly SignDef[], opts: SignBuildOptions): Signs {
  const group = new THREE.Group();
  group.name = 'bas-signs';
  const q = opts.quality;
  const page = PAGE_SIZE[q];
  const disposables: { dispose(): void }[] = [];

  // --- 1. Draw each distinct sign once ---
  const slots = new Map<string, Slot>();
  const slotOf: Slot[] = [];
  for (const def of defs) {
    const w = Math.max(def.w, 0.02);
    const h = Math.max(def.h, 0.02);
    let ppm = PX_PER_METRE[q];
    const long = Math.max(w, h);
    if (long * ppm < MIN_LONG_SIDE_PX[q]) ppm = MIN_LONG_SIDE_PX[q] / long;
    const limit = Math.min(MAX_SIGN_PX[q], page - PAD * 2);
    if (long * ppm > limit) ppm = limit / long;
    const pw = Math.max(8, Math.round(w * ppm));
    const ph = Math.max(8, Math.round(h * ppm));
    const key = JSON.stringify([def.style, def.text, def.sub ?? '', def.color ?? -1, def.bg ?? -1, def.icon ?? '', isLit(def), pw, ph]);
    let slot = slots.get(key);
    if (!slot) {
      slot = { canvas: drawSignCanvas(def, pw, ph), page: 0, x: 0, y: 0 };
      slots.set(key, slot);
    }
    slotOf.push(slot);
  }

  // --- 2. Shelf-pack the canvases into atlas pages ---
  const order = [...slots.values()].sort((a, b) => b.canvas.height - a.canvas.height);
  const pageHeights: number[] = [];
  let cx = 0;
  let cy = 0;
  let shelf = 0;
  let cur = 0;
  for (const s of order) {
    const w = s.canvas.width + PAD * 2;
    const h = s.canvas.height + PAD * 2;
    if (cx + w > page) {
      cx = 0;
      cy += shelf;
      shelf = 0;
    }
    if (cy + h > page) {
      pageHeights[cur] = cy + shelf;
      cur++;
      cx = 0;
      cy = 0;
      shelf = 0;
    }
    s.page = cur;
    s.x = cx + PAD;
    s.y = cy + PAD;
    cx += w;
    shelf = Math.max(shelf, h);
    pageHeights[cur] = cy + shelf;
  }

  const pageCount = order.length ? cur + 1 : 0;
  const atlases: HTMLCanvasElement[] = [];
  for (let p = 0; p < pageCount; p++) {
    const c = document.createElement('canvas');
    c.width = page;
    c.height = Math.min(page, Math.max(64, Math.ceil((pageHeights[p] ?? 64) / 64) * 64));
    atlases.push(c);
  }
  for (const s of order) {
    const ctx = atlases[s.page]!.getContext('2d')!;
    const { width, height } = s.canvas;
    // Gutter: a stretched copy underneath keeps the edge colours in the lower mip levels.
    ctx.drawImage(s.canvas, s.x - PAD, s.y - PAD, width + PAD * 2, height + PAD * 2);
    ctx.clearRect(s.x, s.y, width, height);
    ctx.drawImage(s.canvas, s.x, s.y);
  }

  // --- 3. One merged mesh per page ---
  const light = new Float32Array(3);
  for (let p = 0; p < pageCount; p++) {
    const atlas = atlases[p]!;
    const members: number[] = [];
    for (let i = 0; i < defs.length; i++) if (slotOf[i]!.page === p) members.push(i);
    if (!members.length) continue;

    const pos = new Float32Array(members.length * 12);
    const uv = new Float32Array(members.length * 8);
    const col = new Float32Array(members.length * 12);
    const idx = members.length * 4 > 65535 ? new Uint32Array(members.length * 6) : new Uint16Array(members.length * 6);

    for (let k = 0; k < members.length; k++) {
      const def = defs[members[k]!]!;
      const slot = slotOf[members[k]!]!;
      const f = FACING[def.facing] ?? FACING[0]!;
      let rx = f.r[0]!;
      let ry = f.r[1]!;
      let rz = f.r[2]!;
      let ux = f.u[0]!;
      let uy = f.u[1]!;
      let uz = f.u[2]!;
      if (def.style === 'poster') {
        // Posters hang slightly askew (stable pseudo-random angle, about ±2°).
        const h = hash3(Math.round(def.pos.x * 100), Math.round(def.pos.y * 100), Math.round(def.pos.z * 100));
        const a = ((h % 1000) / 1000 - 0.5) * 0.075;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const nrx = rx * c + ux * s;
        const nry = ry * c + uy * s;
        const nrz = rz * c + uz * s;
        ux = ux * c - rx * s;
        uy = uy * c - ry * s;
        uz = uz * c - rz * s;
        rx = nrx;
        ry = nry;
        rz = nrz;
      }
      const hw = def.w / 2;
      const hh = def.h / 2;
      const ox = def.pos.x + f.n[0]! * WALL_OFFSET;
      const oy = def.pos.y + f.n[1]! * WALL_OFFSET;
      const oz = def.pos.z + f.n[2]! * WALL_OFFSET;

      let lr = 1;
      let lg = 1;
      let lb = 1;
      if (!isLit(def) && opts.shader) {
        opts.shader.shade(ox, oy, oz, f.n[0]!, f.n[1]!, f.n[2]!, light);
        // Printed matter stays readable: never darker than a dim room, never blown out.
        lr = Math.min(1.08, Math.max(0.42, light[0]!));
        lg = Math.min(1.08, Math.max(0.42, light[1]!));
        lb = Math.min(1.08, Math.max(0.42, light[2]!));
      }

      const u0 = slot.x / atlas.width;
      const u1 = (slot.x + slot.canvas.width) / atlas.width;
      const v1 = 1 - slot.y / atlas.height;
      const v0 = 1 - (slot.y + slot.canvas.height) / atlas.height;
      // bottom-left, bottom-right, top-right, top-left
      const sx = [-1, 1, 1, -1];
      const sy = [-1, -1, 1, 1];
      for (let c = 0; c < 4; c++) {
        const o = (k * 4 + c) * 3;
        pos[o] = ox + rx * hw * sx[c]! + ux * hh * sy[c]!;
        pos[o + 1] = oy + ry * hw * sx[c]! + uy * hh * sy[c]!;
        pos[o + 2] = oz + rz * hw * sx[c]! + uz * hh * sy[c]!;
        col[o] = lr;
        col[o + 1] = lg;
        col[o + 2] = lb;
        const t = (k * 4 + c) * 2;
        uv[t] = sx[c]! < 0 ? u0 : u1;
        uv[t + 1] = sy[c]! < 0 ? v0 : v1;
      }
      const b = k * 4;
      idx.set([b, b + 1, b + 2, b, b + 2, b + 3], k * 6);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geometry.setIndex(new THREE.BufferAttribute(idx, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const texture = new THREE.CanvasTexture(atlas);
    texture.name = `signs:${p}`;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = ANISOTROPY[q];

    const material = new THREE.MeshBasicMaterial({
      name: 'bas-signs',
      map: texture,
      vertexColors: true,
      alphaTest: 0.4,
      alphaToCoverage: opts.antialias === true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `signs:${p}`;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
    disposables.push(geometry, texture, material);
  }

  return {
    group,
    count: defs.length,
    dispose(): void {
      group.removeFromParent();
      group.clear();
      for (const d of disposables) d.dispose();
      disposables.length = 0;
    },
  };
}
