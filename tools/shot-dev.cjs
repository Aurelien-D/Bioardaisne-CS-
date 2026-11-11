/**
 * Screenshot a dev page: node tools/shot-dev.cjs <path-and-query> <out.png> [--port 5341] [--ready __s] [--size 900x700]
 * Starts a Vite dev server on the port if none is listening.
 */
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const PORT = Number(arg('port', 5341));
const [w, h] = arg('size', '900x700').split('x').map(Number);
const ready = arg('ready', '__s');
const listening = () => new Promise((r) => { const s = net.connect(PORT, '127.0.0.1').on('connect', () => { s.destroy(); r(true); }).on('error', () => r(false)); });
(async () => {
  let server = null;
  if (!(await listening())) {
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, BAS_VITE_CACHE: `node_modules/.vite-${PORT}` }, stdio: 'ignore' });
    for (let i = 0; i < 60 && !(await listening()); i++) await new Promise((r) => setTimeout(r, 250));
  }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', (e) => console.log('PAGE ERROR', String(e)));
  await page.goto(`http://localhost:${PORT}${process.argv[2]}`);
  await page.waitForFunction((k) => window[k] && window[k].ready, ready, { timeout: 120000 });
  await page.screenshot({ path: process.argv[3] });
  await browser.close();
  if (server) server.kill();
  console.log(process.argv[3]);
})().catch((e) => { console.error(e); process.exit(1); });
