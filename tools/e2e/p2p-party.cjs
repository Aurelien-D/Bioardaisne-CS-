/**
 * Browser-hosted multiplayer with several guests (no game server): one host + N guests join
 * the same room through a local PeerJS broker, then the host leaves and every guest must be
 * sent back to the menu.
 * Usage: BAS_BASE=./ BAS_STATIC=1 npx vite build --outDir dist/static && node tools/e2e/p2p-party.cjs [--guests 3]
 */
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const PORT = Number(arg('port', 8095));
const BROKER_PORT = Number(arg('broker', 9078));
const GUESTS = Number(arg('guests', 3));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = (page) => page.evaluate(() => window.__bas.state());

(async () => {
  const root = path.resolve(__dirname, '../..');
  const serve = `const http=require('http'),fs=require('fs'),path=require('path');const dir=path.join(${JSON.stringify(root)},'dist/static');const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};http.createServer((q,r)=>{let f=path.join(dir,decodeURIComponent(q.url.split('?')[0]));if(f.endsWith(path.sep)||f===dir)f=path.join(f,'index.html');fs.readFile(f,(e,b)=>{if(e){r.writeHead(404);r.end();return;}r.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'});r.end(b);});}).listen(${PORT});`;
  const server = spawn('node', ['-e', serve], { cwd: root, stdio: 'inherit' });
  const broker = spawn('node', ['-e', `require('peer').PeerServer({port:${BROKER_PORT},path:'/',host:'127.0.0.1'})`], { cwd: root, stdio: 'inherit' });
  await sleep(1500);
  const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  let failed = false;
  const check = (name, ok, info = '') => {
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${info}`);
    if (!ok) failed = true;
  };
  const open = async (name, query) => {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(String(e)));
    await page.addInitScript((n) => localStorage.setItem('bas.settings.v1', JSON.stringify({ playerName: n, quality: 'low' })), name);
    await page.goto(`http://localhost:${PORT}/?debug=1&peer=localhost:${BROKER_PORT}${query}`);
    await page.waitForFunction(() => window.__bas && window.__bas.state().menu === 'main', null, { timeout: 30000 });
    return page;
  };
  try {
    const host = await open('Hote', '');
    await host.getByText('Créer un salon privé', { exact: false }).first().click();
    await sleep(400);
    await host.getByText('Créer le salon', { exact: false }).first().click();
    await host.waitForFunction(() => window.__bas.state().mode === 'playing', null, { timeout: 240000 });
    const code = (await st(host)).room;
    check('host opened a room', typeof code === 'string' && code.length === 5, code);
    await host.evaluate(() => window.__bas.send({ t: 'config', patch: { mapId: 'dev_test', botFill: 0, freezeTime: 0, killLimit: 0, roundTime: 600 }, restart: true }));
    await host.waitForFunction(() => window.__bas.state().match.mapId === 'dev_test' && window.__bas.state().mode === 'playing', null, { timeout: 120000 });

    const guests = [];
    for (let i = 0; i < GUESTS; i++) {
      const g = await open(`Invite${i + 1}`, `&room=${code}`);
      await g.getByRole('button', { name: 'Rejoindre', exact: true }).click();
      guests.push(g);
      // One at a time: several maps loading at once would crawl under software rendering.
      await g.waitForFunction(() => window.__bas.state().mode !== 'menu', null, { timeout: 30000 });
      await g.waitForFunction(() => window.__bas.state().mode === 'playing' || window.__bas.state().mode === 'menu', null, { timeout: 300000 }).catch(() => undefined);
    }
    try {
      for (const g of guests) await g.waitForFunction(() => window.__bas.state().mode === 'playing', null, { timeout: 300000 });
    } catch (err) {
      for (const [i, g] of guests.entries()) {
        const s = await st(g);
        console.log(`Invite${i + 1}`, JSON.stringify({ mode: s.mode, menu: s.menu, room: s.room, roster: s.roster.length, errors: g.errors.slice(0, 2) }));
      }
      const hs = await st(host);
      console.log('Hote', JSON.stringify({ mode: hs.mode, roster: hs.roster.map((p) => p.name) }));
      throw err;
    }
    await sleep(3000);
    const all = [host, ...guests];
    const rosters = [];
    for (const p of all) rosters.push((await st(p)).roster.filter((x) => !x.bot).length);
    check(`every player sees the ${GUESTS + 1} humans`, rosters.every((n) => n === GUESTS + 1), rosters.join(' / '));
    const teams = (await st(host)).roster.filter((x) => !x.bot).map((x) => x.team);
    const t0 = teams.filter((t) => t === 0).length;
    const t1 = teams.filter((t) => t === 1).length;
    check('teams are balanced', Math.abs(t0 - t1) <= 1, `${t0} contre ${t1}`);
    // Snapshots keep flowing to every guest: the host walks, each guest sees it move.
    const hostId = (await st(host)).myId;
    const seen = async () => Promise.all(guests.map(async (g) => (await st(g)).remotes.find((r) => r.id === hostId)?.pos ?? null));
    await host.evaluate(() => window.__bas.fakeLock(true));
    const before = await seen();
    await host.evaluate(() => window.__bas.key('KeyD', true));
    await sleep(2500);
    await host.evaluate(() => window.__bas.key('KeyD', false));
    await sleep(1500);
    const after = await seen();
    const moved = before.map((b, i) => (b && after[i] ? Math.hypot(after[i].x - b.x, after[i].z - b.z) : 0));
    check('every guest sees the host move', moved.every((d) => d > 0.5), moved.map((d) => d.toFixed(1) + ' m').join(' / '));

    // The host leaves: the match ends for everyone.
    await host.close();
    for (const g of guests) await g.waitForFunction(() => window.__bas.state().mode === 'menu', null, { timeout: 60000 });
    check('guests are back in the menu after the host left', true);
    check('no page errors', guests.every((g) => g.errors.length === 0), guests.flatMap((g) => g.errors).slice(0, 2).join(' | '));
  } catch (err) {
    console.error(err);
    failed = true;
  } finally {
    await browser.close();
    server.kill();
    broker.kill();
  }
  process.exit(failed ? 1 : 0);
})();
