/**
 * Packs the built client (dist/client) into ONE self-contained HTML page (scripts,
 * styles and brand images inlined) for single-file hosting, e.g. a Claude artifact.
 * The page is solo-only: there is no game server behind it.
 * Usage: npm run build:client && node tools/make-artifact.mjs <output.html>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist/client');
const out = resolve(process.argv[2] ?? join(root, 'dist/bioardaisne-strike.html'));
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const jsPath = /<script[^>]+src="([^"]+)"/.exec(html)?.[1];
const cssPath = /<link rel="stylesheet"[^>]+href="([^"]+)"/.exec(html)?.[1];
if (!jsPath || !cssPath) throw new Error('dist/client/index.html : bundle introuvable (lancez npm run build:client)');
let js = readFileSync(join(dist, jsPath), 'utf8');
let css = readFileSync(join(dist, cssPath), 'utf8');

// Inline the brand images (referenced as "brand/…" in the scripts, "/brand/…" in the styles).
const dataUri = (file, mime) => `data:${mime};base64,${readFileSync(join(dist, file)).toString('base64')}`;
for (const [file, mime] of [
  ['brand/logo-horizontal-dark.png', 'image/png'],
  ['brand/logo-horizontal.png', 'image/png'],
  ['brand/logo-vertical-dark.png', 'image/png'],
  ['brand/logo-vertical.png', 'image/png'],
  ['brand/monogram-red.png', 'image/png'],
  ['brand/monogram.svg', 'image/svg+xml'],
]) {
  const uri = dataUri(file, mime);
  const rx = new RegExp(`(?:\\.?/)?${file.replace(/[.]/g, '\\.')}`, 'g');
  js = js.replace(rx, () => uri);
  css = css.replace(rx, () => uri);
}
js = js.replace(/<\/script/gi, '<\\/script');
css = css.replace(/<\/style/gi, '<\\/style');

const page = `<title>BioArd'Aisne Strike</title>
<style>
/* One-screen game: a single dark look, canvas edge to edge, HUD and menus layered on top. */
:root { --bas-page-bg: #071726; --bas-page-fg: #eaf6fe; color-scheme: dark; }
html, body { height: 100%; }
body { background: var(--bas-page-bg); color: var(--bas-page-fg); }
${css}
</style>
<canvas id="game" aria-label="BioArd'Aisne Strike"></canvas>
<div id="hud"></div>
<div id="menus"></div>
<script>window.__BAS_STANDALONE__ = true;</script>
<script type="module">
${js}
</script>
`;
writeFileSync(out, page);
console.log(`${out} — ${(page.length / 1024 / 1024).toFixed(2)} Mo`);
