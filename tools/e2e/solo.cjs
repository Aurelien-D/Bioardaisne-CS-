/**
 * End-to-end smoke test (solo): boots the built game in headless Chromium, starts
 * a solo match from the menu, moves, shoots and checks the game state.
 * Usage: npm run build && node tools/e2e/solo.cjs [--port 8090] [--shots]
 * Requires Playwright (globally installed in the dev container).
 */
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const PORT = Number(arg('port', 8090));
const OUT = path.resolve(__dirname, '../out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  require('node:fs').mkdirSync(OUT, { recursive: true });
  const server = spawn('node', ['dist/server/index.js'], { cwd: path.resolve(__dirname, '../..'), env: { ...process.env, PORT: String(PORT) }, stdio: 'inherit' });
  await sleep(700);
  const browser = await chromium.launch();
  let failed = false;
  const check = (name, ok, info = '') => {
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${info}`);
    if (!ok) failed = true;
  };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto(`http://localhost:${PORT}/?debug=1`);
    await page.waitForFunction(() => window.__bas && window.__bas.state().menu === 'main', null, { timeout: 20000 });
    await page.screenshot({ path: path.join(OUT, 'e2e-solo-menu.png') });
    await page.getByText('Jouer en solo', { exact: false }).first().click();
    await sleep(400);
    await page.getByText('Lancer la partie', { exact: false }).first().click();
    await page.waitForFunction(() => window.__bas.state().mode === 'playing', null, { timeout: 90000 });
    await page.evaluate(() => window.__bas.fakeLock(true));
    await page.waitForFunction(() => window.__bas.state().me !== null, null, { timeout: 20000 });
    await page.waitForFunction(() => window.__bas.state().match.phase === 'live', null, { timeout: 30000 });
    const s0 = await page.evaluate(() => window.__bas.state());
    check('spawned alive', s0.me.alive && s0.me.health === 100, `team ${s0.team}`);
    check('bots present', s0.roster.filter((p) => p.bot).length >= 3, `${s0.roster.length} players`);
    await page.evaluate(() => window.__bas.key('KeyW', true));
    await sleep(1500);
    await page.evaluate(() => window.__bas.key('KeyW', false));
    const s1 = await page.evaluate(() => window.__bas.state());
    const moved = Math.hypot(s1.me.pos.x - s0.me.pos.x, s1.me.pos.z - s0.me.pos.z);
    check('moved forward', moved > 2, `${moved.toFixed(2)} m`);
    await page.evaluate(() => window.__bas.key('Mouse0', true));
    await sleep(700);
    await page.evaluate(() => window.__bas.key('Mouse0', false));
    const s2 = await page.evaluate(() => window.__bas.state());
    check('fired', s2.me && s2.me.clip < s1.me.clip, `clip ${s1.me.clip} -> ${s2.me ? s2.me.clip : 'dead'}`);
    await page.screenshot({ path: path.join(OUT, 'e2e-solo-play.png') });
    await sleep(6000);
    const s3 = await page.evaluate(() => window.__bas.state());
    check('remote players visible', s3.remotes.filter((r) => r.alive).length >= 3, `${s3.remotes.length} remotes`);
    check('frame rate measured', s3.fps > 3, `${s3.fps.toFixed(1)} fps (software rendering)`);
    await page.screenshot({ path: path.join(OUT, 'e2e-solo-play2.png') });
    check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  } catch (e) {
    console.error(e);
    failed = true;
  } finally {
    await browser.close();
    server.kill();
  }
  process.exit(failed ? 1 : 0);
})();
