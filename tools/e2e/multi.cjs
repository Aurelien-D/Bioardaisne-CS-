/**
 * End-to-end multiplayer test: two browsers join the same private room, see each other,
 * and one eliminates the other.
 *
 *   npm run build && node tools/e2e/multi.cjs [--port 8091]
 *       through the real game server (WebSocket);
 *   BAS_BASE=./ BAS_STATIC=1 npx vite build --outDir dist/static && node tools/e2e/multi.cjs --p2p
 *       without a game server: the first browser hosts the match, the second connects to it
 *       over WebRTC (static build served as plain files, local PeerJS broker for the handshake).
 */
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const PORT = Number(arg('port', 8091));
const P2P = process.argv.includes('--p2p');
/** With --p2p: go through the public PeerJS cloud instead of a local broker (needs Internet access). */
const PUBLIC_BROKER = process.argv.includes('--public-broker');
const BROKER_PORT = Number(arg('broker', 9077));
const OUT = path.resolve(__dirname, '../out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = (page) => page.evaluate(() => window.__bas.state());

async function open(browser, name, query) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  await page.addInitScript((n) => localStorage.setItem('bas.settings.v1', JSON.stringify({ playerName: n, quality: 'low' })), name);
  await page.goto(`http://localhost:${PORT}/?debug=1${P2P && !PUBLIC_BROKER ? `&peer=localhost:${BROKER_PORT}` : ''}${query}`);
  await page.waitForFunction(() => window.__bas && window.__bas.state().menu === 'main', null, { timeout: 20000 });
  return page;
}

(async () => {
  require('node:fs').mkdirSync(OUT, { recursive: true });
  const root = path.resolve(__dirname, '../..');
  let server;
  let broker = null;
  if (P2P) {
    // Plain file server for the static build + a local broker: no game server anywhere.
    const serve = `const http=require('http'),fs=require('fs'),path=require('path');const dir=path.join(${JSON.stringify(root)},'dist/static');const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};http.createServer((q,r)=>{let f=path.join(dir,decodeURIComponent(q.url.split('?')[0]));if(f.endsWith(path.sep)||f===dir)f=path.join(f,'index.html');fs.readFile(f,(e,b)=>{if(e){r.writeHead(404);r.end();return;}r.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'});r.end(b);});}).listen(${PORT});`;
    server = spawn('node', ['-e', serve], { cwd: root, stdio: 'inherit' });
    if (!PUBLIC_BROKER) broker = spawn('node', ['-e', `require('peer').PeerServer({port:${BROKER_PORT},path:'/',host:'127.0.0.1'})`], { cwd: root, stdio: 'inherit' });
    console.log(`Mode sans serveur de jeu : fichiers statiques sur ${PORT}, ${PUBLIC_BROKER ? 'courtier PeerJS public' : `courtier PeerJS local sur ${BROKER_PORT}`}`);
  } else {
    server = spawn('node', ['dist/server/index.js'], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: 'inherit' });
  }
  await sleep(P2P ? 1500 : 700);
  // Headless test machines have no mDNS: let WebRTC use plain local addresses.
  // Behind an outbound proxy (CI containers), the browser needs it to reach the public broker.
  const proxy = PUBLIC_BROKER && process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
  const browser = await chromium.launch({ args: P2P ? ['--disable-features=WebRtcHideLocalIpsWithMdns', ...(proxy ? ['--ignore-certificate-errors'] : [])] : [], proxy });
  let failed = false;
  const check = (name, ok, info = '') => {
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${info}`);
    if (!ok) failed = true;
  };
  try {
    // --- Alice creates a private room ---
    const a = await open(browser, 'Alice', '');
    await a.getByText('Créer un salon privé', { exact: false }).first().click();
    await sleep(400);
    await a.getByText('Créer le salon', { exact: false }).first().click();
    await a.waitForFunction(() => window.__bas.state().mode === 'playing', null, { timeout: 240000 });
    const code = (await st(a)).room;
    check('room created with a 5-character code', typeof code === 'string' && code.length === 5, code);
    // Host: no bots, no freeze time, long round (test conditions).
    // The open test arena keeps the scripted duel deterministic.
    await a.evaluate(() => window.__bas.send({ t: 'config', patch: { mapId: 'dev_test', botFill: 0, freezeTime: 0, killLimit: 0, roundTime: 600, respawnDelay: 2 }, restart: true }));
    await a.waitForFunction(() => window.__bas.state().match.mapId === 'dev_test' && window.__bas.state().mode === 'playing', null, { timeout: 120000 });

    // --- Bob joins with the invitation link ---
    const b = await open(browser, 'Bob', `&room=${code}`);
    await b.getByRole('button', { name: 'Rejoindre', exact: true }).click();
    await b.waitForFunction(() => window.__bas.state().mode === 'playing', null, { timeout: 240000 });
    await a.evaluate(() => window.__bas.fakeLock(true));
    await b.evaluate(() => window.__bas.fakeLock(true));
    try {
      await a.waitForFunction(() => window.__bas.state().me && window.__bas.state().remotes.some((r) => r.alive), null, { timeout: 30000 });
      await b.waitForFunction(() => window.__bas.state().me && window.__bas.state().remotes.some((r) => r.alive), null, { timeout: 30000 });
    } catch (err) {
      // Diagnostic: what each side knows when the two players never see each other.
      for (const [who, page] of [['Alice', a], ['Bob', b]]) {
        const s = await st(page);
        console.log(who, JSON.stringify({ mode: s.mode, menu: s.menu, room: s.room, roster: s.roster.map((p) => `${p.name}/${p.team}`), me: !!s.me, remotes: s.remotes.map((r) => `${r.id}:${r.alive}`), errors: page.errors.slice(0, 2) }));
      }
      throw err;
    }
    let sa = await st(a);
    let sb = await st(b);
    check('both players in the same room', sb.room === code && sa.roster.length === 2 && sb.roster.length === 2, `roster ${sa.roster.map((p) => p.name).join(', ')}`);
    check('opposite teams', sa.team !== sb.team && sa.team !== 2 && sb.team !== 2, `Alice ${sa.team} / Bob ${sb.team}`);

    // --- Positions are synchronised: Bob sees Alice where she is ---
    await a.evaluate(() => window.__bas.key('KeyD', true));
    await sleep(1200);
    await a.evaluate(() => window.__bas.key('KeyD', false));
    await sleep(1500);
    sa = await st(a);
    sb = await st(b);
    const aSeenByB = sb.remotes.find((r) => r.id === sa.myId);
    const dSync = aSeenByB ? Math.hypot(aSeenByB.pos.x - sa.me.pos.x, aSeenByB.pos.z - sa.me.pos.z) : 99;
    check('Bob sees Alice at her real position', dSync < 0.6, `${dSync.toFixed(2)} m apart`);

    // --- Alice hunts Bob: walk until she sees him, then shoot ---
    const bobId = sb.myId;
    let killed = false;
    let hurt = false;
    for (let i = 0; i < 300 && !killed; i++) {
      const see = await a.evaluate((id) => {
        const d = window.__bas;
        const ok = d.aimAt(id, 1.15);
        const visible = ok && d.canSee(id);
        d.key('Mouse0', visible);
        d.key('KeyW', !visible);
        d.key('KeyD', !visible && Math.floor(performance.now() / 1500) % 2 === 0);
        return visible;
      }, bobId);
      await sleep(100);
      sb = await st(b);
      if (sb.me && sb.me.health < 100) hurt = true;
      const bobInfo = (await st(a)).roster.find((p) => p.id === bobId);
      if (bobInfo && bobInfo.deaths > 0) killed = true;
      if (i === 40 && see) await b.screenshot({ path: path.join(OUT, 'e2e-multi-bob-under-fire.png') });
    }
    await a.evaluate(() => {
      window.__bas.key('Mouse0', false);
      window.__bas.key('KeyW', false);
      window.__bas.key('KeyD', false);
    });
    check('Bob took damage from Alice (server-authoritative)', hurt || killed);
    check('Alice eliminated Bob', killed);
    sa = await st(a);
    const aliceInfo = sa.roster.find((p) => p.id === sa.myId);
    check('scoreboard updated on both clients', aliceInfo.kills >= 1 && (await st(b)).roster.find((p) => p.id === sa.myId).kills >= 1, `Alice ${aliceInfo.kills} élimination(s)`);
    await a.screenshot({ path: path.join(OUT, 'e2e-multi-alice.png') });
    // --- Bob respawns ---
    await b.waitForFunction(() => window.__bas.state().me && window.__bas.state().me.health === 100, null, { timeout: 15000 });
    check('Bob respawned', true);
    // --- Chat ---
    await a.evaluate(() => window.__bas.send({ t: 'chat', text: 'Bien joué, on refait une série ?', team: false }));
    await sleep(500);
    const chatSeen = await b.evaluate(() => document.body.innerText.includes('Bien joué, on refait une série'));
    check('chat message delivered to Bob', chatSeen);
    check('no page errors', a.errors.length === 0 && b.errors.length === 0, [...a.errors, ...b.errors].slice(0, 4).join(' | '));
  } catch (e) {
    console.error(e);
    failed = true;
  } finally {
    await browser.close();
    server.kill();
    if (broker) broker.kill();
  }
  process.exit(failed ? 1 : 0);
})();
