#!/usr/bin/env node
/**
 * Map screenshot tool (level design / visual review).
 *
 *   node tools/shot.cjs --map <id> [--pose "x,y,z,yawDeg,pitchDeg"]... [--top] [--cut 2.6]
 *                       [--size 960x540] [--out tools/out] [--port 5311] [--name prefix]
 *                       [--quality low|medium|high] [--markers] [--uv] [--hud]
 *                       [--wait ms] [--timeout seconds]
 *
 * Opens the dev map viewer (/dev/viewer.html) in headless Chromium and saves one PNG per
 * --pose (camera position in metres, yaw / pitch in degrees; yaw 0 looks toward -Z, positive
 * yaw turns left, positive pitch looks up) and/or a top-down orthographic view framed on the
 * map bounds (--top; --cut hides everything above that height so interiors are visible).
 * With neither --pose nor --top, one picture is taken from the viewer's default pose.
 *
 * A Vite dev server is started on the port if none is listening there (and stopped at the
 * end). Prints the path of every file written. Exits with a non-zero code and a message on
 * failure (unknown map, page error, timeout…). "gallery" is a built-in render test scene.
 */
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function fail(message) {
  const err = new Error(message);
  err.expected = true;
  return err;
}

function parseArgs(argv) {
  const opts = {
    map: null,
    poses: [],
    top: false,
    cut: null,
    width: 960,
    height: 540,
    out: 'tools/out',
    port: 5311,
    name: null,
    quality: null,
    markers: false,
    uv: false,
    hud: false,
    wait: 0,
    timeout: 180,
  };
  const need = (i, flag) => {
    if (i + 1 >= argv.length) throw fail(`Missing value after ${flag}`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--map':
        opts.map = need(i++, a);
        break;
      case '--pose': {
        const raw = need(i++, a);
        const p = raw.split(',').map((s) => Number(s.trim()));
        if (p.length < 3 || p.length > 5 || p.some((n) => !Number.isFinite(n))) {
          throw fail(`Invalid --pose "${raw}" (expected "x,y,z,yawDeg,pitchDeg")`);
        }
        while (p.length < 5) p.push(0);
        opts.poses.push(p);
        break;
      }
      case '--top':
        opts.top = true;
        break;
      case '--cut':
        opts.cut = Number(need(i++, a));
        if (!Number.isFinite(opts.cut)) throw fail('Invalid --cut value');
        break;
      case '--size': {
        const m = /^(\d+)x(\d+)$/.exec(need(i++, a));
        if (!m) throw fail('Invalid --size (expected WIDTHxHEIGHT, e.g. 960x540)');
        opts.width = Number(m[1]);
        opts.height = Number(m[2]);
        break;
      }
      case '--out':
        opts.out = need(i++, a);
        break;
      case '--port':
        opts.port = Number(need(i++, a));
        if (!Number.isInteger(opts.port) || opts.port <= 0) throw fail('Invalid --port');
        break;
      case '--name':
        opts.name = need(i++, a);
        break;
      case '--quality':
        opts.quality = need(i++, a);
        if (!['low', 'medium', 'high'].includes(opts.quality)) throw fail('Invalid --quality (low | medium | high)');
        break;
      case '--markers':
        opts.markers = true;
        break;
      case '--uv':
        opts.uv = true;
        break;
      case '--hud':
        opts.hud = true;
        break;
      case '--wait':
        opts.wait = Number(need(i++, a));
        break;
      case '--timeout':
        opts.timeout = Number(need(i++, a));
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        throw fail(`Unknown argument: ${a}`);
    }
  }
  return opts;
}

const USAGE =
  'Usage: node tools/shot.cjs --map <id> [--pose "x,y,z,yawDeg,pitchDeg"]... [--top] [--cut 2.6]\n' +
  '                           [--size 960x540] [--out tools/out] [--port 5311] [--name prefix]\n' +
  '                           [--quality low|medium|high] [--markers] [--uv] [--hud] [--wait ms] [--timeout s]';

/** Resolve true if something answers HTTP on the viewer URL. */
function probe(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/dev/viewer.html', timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Start Vite on the port; resolves with the child process once the viewer page is served. */
async function startServer(port) {
  const child = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, BAS_VITE_CACHE: `node_modules/.vite-${port}` },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let log = '';
  let exited = null;
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  child.on('exit', (code) => (exited = code ?? -1));
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (exited !== null) throw fail(`The Vite dev server stopped at start-up (code ${exited}):\n${log.trim()}`);
    if (await probe(port)) return child;
    await sleep(250);
  }
  stopServer(child);
  throw fail(`The Vite dev server did not answer on port ${port} within 60 s:\n${log.trim()}`);
}

function stopServer(child) {
  if (!child || child.killed) return;
  try {
    process.kill(-child.pid, 'SIGTERM'); // whole process group (npx + vite)
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    /* fall through: look in the global npm root */
  }
  try {
    const globalRoot = require('node:child_process').execSync('npm root -g', { encoding: 'utf8' }).trim();
    return require(path.join(globalRoot, 'playwright'));
  } catch {
    throw fail('Playwright is not available (npm i -g playwright, then: npx playwright install chromium).');
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  if (!opts.map) throw fail(`--map <id> is required.\n${USAGE}`);
  const prefix = opts.name || opts.map;
  const outDir = path.resolve(ROOT, opts.out);
  fs.mkdirSync(outDir, { recursive: true });

  let server = null;
  let browser = null;
  try {
    if (!(await probe(opts.port))) {
      console.error(`[shot] starting a Vite dev server on port ${opts.port}…`);
      server = await startServer(opts.port);
    }

    const { chromium } = loadPlaywright();
    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: opts.width, height: opts.height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.error(`[page console error] ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
      console.error(`[page error] ${err.stack || err.message}`);
    });

    const params = new URLSearchParams({ map: opts.map });
    if (opts.quality) params.set('quality', opts.quality);
    if (opts.markers) params.set('markers', '1');
    if (opts.uv) params.set('uv', '1');
    params.set('fx', '1'); // keep GPU-only effects on under software rendering
    const url = `http://localhost:${opts.port}/dev/viewer.html?${params}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeout * 1000 });

    try {
      await page.waitForFunction(() => window.__viewer && (window.__viewer.ready || window.__viewer.error), null, {
        timeout: opts.timeout * 1000,
      });
    } catch {
      if (pageErrors.length) throw fail(`The viewer crashed while loading "${opts.map}": ${pageErrors[0]}`);
      throw fail(`Timeout: the viewer did not become ready within ${opts.timeout} s (map "${opts.map}").`);
    }
    const loadError = await page.evaluate(() => window.__viewer.error);
    if (loadError) {
      if (/inconnue/i.test(loadError)) throw fail(`Unknown map "${opts.map}" (not registered in src/shared/maps/index.ts).`);
      throw fail(`The viewer could not load "${opts.map}": ${loadError}`);
    }
    if (!opts.hud) await page.addStyleTag({ content: '.panel { display: none !important; }' });

    /** Wait for a few freshly rendered frames (software rendering can be slow). */
    const settle = async () => {
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            const target = window.__viewer.frame + 3;
            const tick = () => (window.__viewer.frame >= target ? resolve() : requestAnimationFrame(tick));
            tick();
          }),
      );
      if (opts.wait > 0) await sleep(opts.wait);
    };
    const describe = async () => {
      const s = await page.evaluate(() => window.__viewer.stats());
      return `${s.drawCalls} draw calls, ${s.triangles} triangles`;
    };

    const shots = [];
    const poses = opts.poses.length || opts.top ? opts.poses : [null];
    for (let i = 0; i < poses.length; i++) {
      const pose = poses[i];
      if (pose) await page.evaluate((p) => window.__viewer.setPose(p[0], p[1], p[2], p[3], p[4]), pose);
      await settle();
      const file = path.join(outDir, `${prefix}_${String(i + 1).padStart(2, '0')}.png`);
      await page.screenshot({ path: file });
      shots.push(file);
      console.log(`${path.relative(process.cwd(), file)}  (${pose ? `pose ${pose.join(',')}` : 'default pose'} · ${await describe()})`);
    }
    if (opts.top) {
      await page.evaluate((cut) => window.__viewer.setTop(true, cut), opts.cut);
      await settle();
      const file = path.join(outDir, `${prefix}_top.png`);
      await page.screenshot({ path: file });
      shots.push(file);
      console.log(`${path.relative(process.cwd(), file)}  (top view${opts.cut === null ? '' : `, cut at ${opts.cut} m`} · ${await describe()})`);
    }
    if (pageErrors.length) throw fail(`The page reported ${pageErrors.length} error(s): ${pageErrors[0]}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    stopServer(server);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err && err.expected ? `[shot] ${err.message}` : `[shot] ${err && err.stack ? err.stack : err}`);
    process.exit(1);
  },
);
