/**
 * Visual check: starts a solo game without bots and saves first-person screenshots
 * (hip, aiming down sights, firing). Usage: npm run build && node tools/e2e/look.cjs [--port 8092] [--weapon 1]
 */
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const PORT = Number(arg('port', 8092));
const OUT = path.resolve(__dirname, '../out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  require('node:fs').mkdirSync(OUT, { recursive: true });
  const server = spawn('node', ['dist/server/index.js'], { cwd: path.resolve(__dirname, '../..'), env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (e) => console.log('PAGE ERROR', String(e)));
    await page.goto(`http://localhost:${PORT}/?debug=1`);
    await page.waitForFunction(() => window.__bas && window.__bas.state().menu === 'main', null, { timeout: 20000 });
    await page.getByText('Jouer en solo', { exact: false }).first().click();
    await sleep(400);
    await page.getByText('Lancer la partie', { exact: false }).first().click();
    await page.waitForFunction(() => window.__bas.state().mode === 'playing', null, { timeout: 120000 });
    await page.evaluate(() => {
      window.__bas.fakeLock(true);
    });
    const primary = arg('primary', '');
    if (primary) await page.evaluate((p) => window.__bas.send({ t: 'loadout', primary: p, secondary: 'pistol' }), primary);
    await page.evaluate(() => window.__bas.send({ t: 'config', patch: { botFill: 0, freezeTime: 0, roundTime: 900 }, restart: true }));
    await sleep(1500);
    await page.waitForFunction(() => window.__bas.state().me !== null, null, { timeout: 20000 });
    const team = (await page.evaluate(() => window.__bas.state())).team;
    await page.evaluate((t) => window.__bas.look(t === 0 ? Math.PI * 0.9 : 0.35, -0.02), team);
    const slot = arg('weapon', '');
    if (slot) {
      await page.evaluate((c) => window.__bas.key(c, true), `Digit${slot}`);
      await sleep(100);
      await page.evaluate((c) => window.__bas.key(c, false), `Digit${slot}`);
    }
    await sleep(2500);
    await page.screenshot({ path: path.join(OUT, 'look-hip.png') });
    await page.evaluate(() => window.__bas.key('Mouse2', true));
    await sleep(1500);
    await page.screenshot({ path: path.join(OUT, 'look-ads.png') });
    await page.evaluate(() => window.__bas.key('Mouse0', true));
    await sleep(350);
    await page.screenshot({ path: path.join(OUT, 'look-fire.png') });
    await page.evaluate(() => {
      window.__bas.key('Mouse0', false);
      window.__bas.key('Mouse2', false);
    });
    console.log('saved look-hip.png, look-ads.png, look-fire.png — team', team);
  } catch (e) {
    console.error(e);
  } finally {
    await browser.close();
    server.kill();
  }
})();
