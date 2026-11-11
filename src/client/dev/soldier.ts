/**
 * Avatar test bench: one player model in a neutral studio, driven by a small scripted timeline
 * so that poses and motions can be checked frame by frame.
 *
 * /dev/soldier.html?view=three|side|front|back|top|low|close&weapon=rifle_m4&crouch=0|1&pitch=<deg>&speed=<m/s>&team=0|1
 *   dir=<deg>                 movement direction relative to the facing (0 forward, 90 right, 180 back, -90 left)
 *   at=<s>&dir2=&speed2=&crouch2=&pitch2=   change of movement / stance at time `at`
 *   yawRate=<deg/s>           turn on the spot
 *   jumpAt=<s>                jump with the game's physics (7 m/s, g = 20) · air=1 airborne throughout
 *   reloadAt=<s>              reload (lasts the weapon's reload time)
 *   fireAt=<s>&fireN=<n>      n shots at the weapon's rate of fire
 *   switchAt=<s>&weapon2=<id> weapon switch
 *   hitAt=<s>&hitFrom=<deg>   bullet coming from that bearing (0 front, 90 right, 180 behind)
 *   dieAt=<s>&dieFrom=<deg>   killing shot coming from that bearing
 *   seed=<n>                  deterministic randomness
 *   t=<s>                     simulate up to that time, then freeze (screenshots)
 *   sheet=<t0,t1,…> | frames=<n>&t0=<s>&t1=<s>    contact sheet, one tile per time
 *   views=three,side          contact sheet rows (one per camera)
 *   low=1                     the simple stand-in model
 *   still=1                   the model stays at the origin (default: it really moves, the camera follows)
 * Without `t` / `sheet` the timeline loops in real time.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MOVE } from '../../shared/constants';
import { WEAPONS, type WeaponId } from '../../shared/weapons/defs';
import type { AvatarFrame, IAvatar } from '../core/contracts';
import { createAvatar, preloadAvatarAssets } from '../render/avatar';
import { preloadWeaponAssets } from '../render/weapons/assets';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (q.has(k) ? Number(q.get(k)) : d);
const rad = (deg: number): number => (deg * Math.PI) / 180;

// Deterministic randomness (death variants, flinch) when asked.
if (q.has('seed') || q.has('sheet') || q.has('frames') || q.has('t')) {
  let s = (num('seed', 1) * 0x9e3779b1) >>> 0;
  Math.random = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a323c);
const pm = new THREE.PMREMGenerator(renderer);
scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(new THREE.HemisphereLight(0xffffff, 0x8f8a84, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.5);
sun.position.set(3, 6, 4);
sun.castShadow = true;
sun.shadow.camera.left = sun.shadow.camera.bottom = -3;
sun.shadow.camera.right = sun.shadow.camera.top = 3;
scene.add(sun, sun.target);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x59616b, roughness: 0.9 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground, new THREE.GridHelper(200, 400, 0x8899aa, 0x44505c));
// Hull outline: 0.7 × 1.8 m (1.3 m crouched).
const hull = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1, 0.7), new THREE.MeshBasicMaterial({ color: 0x33ff88, wireframe: true }));
hull.visible = !q.has('nohull');
scene.add(hull);

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 100);
const VIEWS: Record<string, [number, number, number, number]> = {
  // camera offset from the model (x, y, z) and height looked at
  front: [0, 1.2, -4.2, 1.0],
  side: [4.2, 1.2, 0, 1.0],
  left: [-4.2, 1.2, 0, 1.0],
  back: [0, 1.4, 4.2, 1.0],
  three: [2.6, 1.6, -3.4, 1.0],
  rear: [-2.4, 1.7, 3.4, 1.0],
  top: [0, 6.5, 0.01, 0],
  low: [2.6, 0.25, -2.6, 0.3],
  close: [0.9, 1.55, -1.5, 1.3],
};

const T = {
  speed: num('speed', 0),
  dir: rad(num('dir', 0)),
  crouch: num('crouch', 0),
  pitch: rad(num('pitch', 0)),
  at: num('at', Infinity),
  speed2: num('speed2', num('speed', 0)),
  dir2: rad(num('dir2', num('dir', 0))),
  crouch2: num('crouch2', num('crouch', 0)),
  pitch2: rad(num('pitch2', num('pitch', 0))),
  yawRate: rad(num('yawRate', 0)),
  jumpAt: num('jumpAt', Infinity),
  air: q.get('air') === '1',
  reloadAt: num('reloadAt', Infinity),
  fireAt: num('fireAt', Infinity),
  fireN: num('fireN', 1),
  switchAt: num('switchAt', Infinity),
  hitAt: num('hitAt', Infinity),
  hitFrom: rad(num('hitFrom', 0)),
  dieAt: num('dieAt', Infinity),
  dieFrom: rad(num('dieFrom', 0)),
};
const weapon1 = (q.get('weapon') ?? 'rifle_m4') as WeaponId;
const weapon2 = (q.get('weapon2') ?? 'pistol') as WeaponId;
const still = q.get('still') === '1';

/** The state of the scripted player, advanced at a fixed 60 Hz. */
class Sim {
  av: IAvatar;
  t = 0;
  pos = { x: 0, y: 0, z: 0 };
  yaw = rad(num('yaw', 0));
  vel = { x: 0, z: 0 };
  velY = 0;
  crouch = T.crouch;
  pitch = T.pitch;
  onGround = true;
  shots = 0;
  hit = false;
  dead = false;
  light = new THREE.Color(1, 1, 1);
  /** Foot sliding: horizontal distance travelled by planted feet / time planted. */
  slide = 0;
  planted = 0;
  private feet: THREE.Object3D[] = [];
  private last = [new THREE.Vector3(), new THREE.Vector3()];
  private cur = new THREE.Vector3();
  private frame: AvatarFrame;

  constructor() {
    this.av = createAvatar(num('team', 0) as 0 | 1, 'Test');
    scene.add(this.av.root);
    for (const n of ['mixamorigLeftToeBase', 'mixamorigRightToeBase']) {
      const o = this.av.root.getObjectByName(n);
      if (o) this.feet.push(o);
    }
    this.frame = { dt: 1 / 60, pos: this.pos, yaw: 0, pitch: 0, crouch: 0, speed: 0, velX: 0, velZ: 0, onGround: true, weapon: weapon1, reloading: false, carrying: false, protected: false, light: this.light };
  }

  step(dt: number): void {
    const t = (this.t += dt);
    const second = t >= T.at;
    const speed = second ? T.speed2 : T.speed;
    const dir = second ? T.dir2 : T.dir;
    this.yaw += T.yawRate * dt;
    // Same smoothing as the game applies to remote players' velocity.
    const a = this.yaw - dir; // dir is measured clockwise (to the right)
    const wx = -Math.sin(a) * speed;
    const wz = -Math.cos(a) * speed;
    const k = Math.min(1, dt * 10);
    this.vel.x += (wx - this.vel.x) * k;
    this.vel.z += (wz - this.vel.z) * k;
    if (!still) {
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
    }
    const ct = second ? T.crouch2 : T.crouch;
    this.crouch += Math.max(-dt / 0.18, Math.min(dt / 0.18, ct - this.crouch));
    const pt = second ? T.pitch2 : T.pitch;
    this.pitch += (pt - this.pitch) * Math.min(1, dt * 8);
    // Jump.
    if (this.onGround && t >= T.jumpAt && t - dt < T.jumpAt) {
      this.onGround = false;
      this.velY = MOVE.jumpSpeed;
    }
    if (T.air) {
      this.onGround = false;
      this.pos.y = 0.6;
    } else if (!this.onGround) {
      this.velY -= MOVE.gravity * dt;
      this.pos.y += this.velY * dt;
      if (this.pos.y <= 0) {
        this.pos.y = 0;
        this.velY = 0;
        this.onGround = true;
      }
    }
    const weapon = t >= T.switchAt ? weapon2 : weapon1;
    const def = WEAPONS[weapon];
    const f = this.frame;
    f.dt = dt;
    f.yaw = this.yaw;
    f.pitch = this.pitch;
    f.crouch = this.crouch;
    f.velX = this.vel.x;
    f.velZ = this.vel.z;
    f.speed = Math.hypot(this.vel.x, this.vel.z);
    f.onGround = this.onGround;
    f.weapon = weapon;
    f.reloading = t >= T.reloadAt && t < T.reloadAt + def.reloadTime;
    if (!this.dead) {
      while (this.shots < T.fireN && t >= T.fireAt + this.shots * def.fireInterval) {
        this.shots++;
        this.av.onFire();
      }
      if (!this.hit && t >= T.hitAt) {
        this.hit = true;
        const b = this.yaw - T.hitFrom;
        this.av.onHit?.({ x: Math.sin(b), y: 0, z: Math.cos(b) });
      }
      if (t >= T.dieAt) {
        this.dead = true;
        const b = this.yaw - T.dieFrom;
        // Like the game: victim position minus shooter position, not normalised.
        this.av.die({ x: Math.sin(b) * 9, y: 0, z: Math.cos(b) * 9 });
      }
    }
    this.av.update(f);
    // Foot sliding of the feet that are down.
    if (this.feet.length === 2 && !this.dead) {
      this.av.root.updateMatrixWorld(true);
      for (let i = 0; i < 2; i++) {
        this.feet[i]!.getWorldPosition(this.cur);
        const l = this.last[i]!;
        if (this.cur.y - this.pos.y < 0.035 && l.y - this.pos.y < 0.035 && this.onGround && t > 0.5) {
          this.slide += Math.hypot(this.cur.x - l.x, this.cur.z - l.z);
          this.planted += dt;
        }
        l.copy(this.cur);
      }
    }
    const h = 1.8 - this.crouch * 0.5;
    hull.scale.y = h;
    hull.position.set(this.pos.x, this.pos.y + h / 2, this.pos.z);
  }
}

function aim(view: string, sim: Sim): void {
  const v = VIEWS[view] ?? VIEWS.three!;
  // The camera follows the model on the ground plane, not its jumps.
  camera.position.set(sim.pos.x + v[0], v[1], sim.pos.z + v[2]);
  camera.lookAt(sim.pos.x, v[3], sim.pos.z);
  sun.position.set(sim.pos.x + 3, 6, sim.pos.z + 4);
  sun.target.position.set(sim.pos.x, 0, sim.pos.z);
  sun.target.updateMatrixWorld();
}

void (async () => {
  if (q.get('low') !== '1') await preloadAvatarAssets();
  await preloadWeaponAssets();
  const sim = new Sim();
  const views = (q.get('views') ?? q.get('view') ?? 'three').split(',');
  let times: number[] | null = null;
  if (q.has('sheet')) times = q.get('sheet')!.split(',').map(Number);
  else if (q.has('frames')) {
    const n = Math.max(2, num('frames', 8));
    const t0 = num('t0', 0);
    const t1 = num('t1', 1);
    times = Array.from({ length: n }, (_, i) => t0 + ((t1 - t0) * i) / (n - 1));
  } else if (q.has('t')) times = [num('t', 0)];
  const report = (): void => {
    (window as unknown as { __s: unknown }).__s = { ready: true, t: sim.t, slide: sim.planted > 0 ? sim.slide / sim.planted : 0, planted: sim.planted };
  };
  if (times) {
    // Contact sheet: every tile is the same simulation, a little later.
    const cols = Math.min(times.length, num('cols', times.length > 8 ? Math.ceil(times.length / 2) : times.length));
    const rowsPerView = Math.ceil(times.length / cols);
    const rows = rowsPerView * views.length;
    const w = Math.floor(innerWidth / cols);
    const h = Math.floor(innerHeight / rows);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setScissorTest(true);
    // Warm up (shader compilation, texture upload) before the tiles.
    sim.step(1 / 60);
    aim(views[0]!, sim);
    renderer.render(scene, camera);
    await new Promise((r) => setTimeout(r, 300));
    times.forEach((time, i) => {
      while (sim.t < time - 1e-6) sim.step(1 / 60);
      views.forEach((view, vi) => {
        const cx = (i % cols) * w;
        const row = vi * rowsPerView + Math.floor(i / cols);
        const cy = innerHeight - (row + 1) * h;
        renderer.setViewport(cx, cy, w, h);
        renderer.setScissor(cx, cy, w, h);
        aim(view, sim);
        renderer.render(scene, camera);
        if (times!.length > 1) {
          const label = document.createElement('div');
          label.textContent = `${time.toFixed(2)} s`;
          label.style.cssText = `position:absolute;left:${cx + 4}px;top:${row * h + 2}px;color:#dfe6ee;font:11px monospace;`;
          document.body.appendChild(label);
        }
      });
    });
    // Let the browser present the canvas before the page is declared ready.
    requestAnimationFrame(() => requestAnimationFrame(report));
    return;
  }
  // Live: the timeline loops.
  const period = num('loop', 0);
  let prev = performance.now();
  let acc = 0;
  let n = 0;
  let cur = sim;
  const loop = (): void => {
    const now = performance.now();
    acc += Math.min(0.1, (now - prev) / 1000);
    prev = now;
    while (acc >= 1 / 60) {
      cur.step(1 / 60);
      acc -= 1 / 60;
    }
    if (period > 0 && cur.t > period) {
      cur.av.dispose();
      cur = new Sim();
    }
    aim(views[0]!, cur);
    renderer.render(scene, camera);
    if (++n === 40) report();
    requestAnimationFrame(loop);
  };
  loop();
})();
