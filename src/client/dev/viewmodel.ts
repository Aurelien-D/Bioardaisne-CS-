/**
 * First-person weapon test bench: /dev/viewmodel.html?w=rifle_m4
 * Renders the view model (weapon + arms) over a small backdrop, the way the game does:
 * the "world" first, then the overlay scene on a cleared depth buffer.
 *
 *   w=<weaponId>           weapon (default rifle_m4)          team=0|1    colour of the arms
 *   ads=0..1               aim-down-sights blend              zoom=1|2    sniper scope level
 *   zoomt=<s> / unzoomt=<s> freeze <s> seconds after scoping in / out (sniper transition)
 *   speed=<m/s>            walking speed (bob)                crouch=0..1 air=1 (not on the ground)
 *   light=<0.3..1.35>      light level around the player (default 1); the backdrop follows
 *   sway=<yaw>,<pitch>     constant turn rate of the view (rad/s)
 *   fire=<s>               fire, then freeze the picture <s> seconds later (0 = flash frame)
 *   burst=<n>              with fire: number of shots (at the weapon's own rate) before freezing
 *   reload=<0..1>          freeze at that point of the reload
 *   draw=<0..1>            freeze at that point of the draw; from=<weaponId> switches from that weapon
 *   t=<s>                  freeze after <s> seconds of idle animation
 *   auto=fire|reload       loop the action (interactive use)
 *   q=low                  procedural models (assets not loaded), no character arms
 *   bg=0                   plain background                   fov=<deg>   world camera FOV
 *   post=1                 the game's filmic chain (bloom, tone mapping, grade)
 *   tp=1                   also fire three world-space flashes (other players' weapons): seen
 *                          from the side, from the front and from behind, 5 m away (use with fire=)
 *   cam=back|top|side      debug view of the rig (the game's camera sits at the origin, looking down -Z)
 *
 * Automation: window.__s = { ready: true } once the requested frame is on screen.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { WEAPONS, type WeaponId } from '../../shared/weapons/defs';
import type { IEngine } from '../core/contracts';
import { preloadAvatarAssets } from '../render/avatar';
import { createEffects } from '../render/effects';
import { createPost } from '../render/post';
import { createViewModel } from '../render/viewmodel';
import { preloadWeaponAssets } from '../render/weapons/assets';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (q.has(k) && q.get(k) !== '' ? Number(q.get(k)) : d);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: false });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.8;
renderer.autoClear = false;

const lightLevel = num('light', 1);
const id = (q.get('w') ?? 'rifle_m4') as WeaponId;
const def = WEAPONS[id];
const adsBlend = num('ads', 0);

// --- Overlay scene (the view model), lit like the game's.
const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;
scene.add(new THREE.HemisphereLight(0xffffff, 0x8f8a84, Math.PI * 0.62));
const sun = new THREE.DirectionalLight(0xffffff, Math.PI * 0.55);
sun.position.set(2, 4, 3);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(54, innerWidth / innerHeight, 0.01, 10);
scene.add(camera);
const cam = q.get('cam');
if (cam === 'back') camera.position.set(0, 0.25, 1.1);
else if (cam === 'top') camera.position.set(0, 1.6, -0.2);
else if (cam === 'side') camera.position.set(1.5, 0.0, -0.3);
if (cam) {
  camera.lookAt(0, -0.2, -0.35);
  scene.add(new THREE.AxesHelper(0.3));
}

// --- Backdrop: a yard with a brick wall, crates and a target, to judge glass and reticles.
const world = new THREE.Scene();
const zoomFov = id === 'sniper' && num('zoom', 0) > 0 ? (def.zoomFov?.[num('zoom', 0) - 1] ?? 70) : 0;
const adsFov = 1 - adsBlend * (def.category === 'pistol' || def.category === 'shotgun' ? 0.16 : def.category === 'sniper' || def.category === 'melee' ? 0 : 0.3);
const worldCam = new THREE.PerspectiveCamera(zoomFov || num('fov', 74) * adsFov, innerWidth / innerHeight, 0.05, 300);
worldCam.position.set(0, 1.6, 0);
world.add(worldCam);
function canvasTexture(size: number, paint: (g: CanvasRenderingContext2D, s: number) => void, repeat: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  paint(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}
if (q.get('bg') !== '0') {
  const k = Math.min(1.2, lightLevel);
  world.background = new THREE.Color(0.5 * k, 0.66 * k, 0.9 * k);
  const bricks = canvasTexture(
    256,
    (g, s) => {
      g.fillStyle = '#8f8a82';
      g.fillRect(0, 0, s, s);
      for (let r = 0; r < 8; r++) {
        for (let c = -1; c < 4; c++) {
          const v = 120 + ((r * 37 + c * 91) % 50);
          g.fillStyle = `rgb(${v + 40},${Math.round(v * 0.62)},${Math.round(v * 0.5)})`;
          g.fillRect(c * 64 + (r % 2) * 32 + 2, r * 32 + 2, 60, 28);
        }
      }
    },
    10,
  );
  const tiles = canvasTexture(
    256,
    (g, s) => {
      g.fillStyle = '#9a9a96';
      g.fillRect(0, 0, s, s);
      g.strokeStyle = '#6f6f6c';
      g.lineWidth = 3;
      g.strokeRect(0, 0, s, s);
      g.fillStyle = '#a6a6a0';
      g.fillRect(6, 6, s / 2 - 9, s / 2 - 9);
      g.fillRect(s / 2 + 3, s / 2 + 3, s / 2 - 9, s / 2 - 9);
    },
    40,
  );
  const lit = (map: THREE.Texture | null, color: number): THREE.MeshBasicMaterial => {
    const m = new THREE.MeshBasicMaterial({ map, color });
    m.color.multiplyScalar(0.85 * k);
    return m;
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), lit(tiles, 0xffffff));
  ground.rotation.x = -Math.PI / 2;
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 9), lit(bricks, 0xffffff));
  wall.position.set(0, 4.5, -16);
  world.add(ground, wall);
  const crate = (x: number, z: number, s: number, c: number): void => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), lit(null, c));
    m.position.set(x, s / 2, z);
    m.rotation.y = x;
    world.add(m);
  };
  crate(-2.6, -9, 1.2, 0x8a6a42);
  crate(-1.5, -9.6, 0.8, 0x70583a);
  crate(3.2, -11, 1.4, 0x4a6a8a);
  crate(2.2, -7, 0.7, 0x8a6a42);
  // Target: rings on a board, straight ahead at eye level.
  const target = new THREE.Mesh(
    new THREE.CircleGeometry(0.45, 40),
    lit(
      canvasTexture(
        256,
        (g, s) => {
          g.fillStyle = '#f2f0e8';
          g.fillRect(0, 0, s, s);
          for (let i = 5; i > 0; i--) {
            g.beginPath();
            g.arc(s / 2, s / 2, (s / 2) * (i / 5), 0, Math.PI * 2);
            g.fillStyle = i % 2 ? '#20242c' : '#f2f0e8';
            g.fill();
          }
          g.beginPath();
          g.arc(s / 2, s / 2, s * 0.035, 0, Math.PI * 2);
          g.fillStyle = '#d02820';
          g.fill();
        },
        1,
      ),
      0xffffff,
    ),
  );
  target.position.set(0, 1.6, -14);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.08), lit(null, 0x3a3a3a));
  post.position.set(0, 0.6, -14.02);
  world.add(target, post);
} else {
  world.background = new THREE.Color(0x6f7f8f);
}

const usePost = q.get('post') === '1';
const post = usePost ? createPost(renderer, world, worldCam, scene, camera, 'medium') : null;
post?.setSize(innerWidth, innerHeight, 1);

void (async () => {
  if (q.get('q') !== 'low') await Promise.all([preloadAvatarAssets(), preloadWeaponAssets()]);
  const vm = createViewModel();
  scene.add(vm.root);
  const from = q.get('from') as WeaponId | null;
  vm.setWeapon(from ?? id);
  const light = new THREE.Color(lightLevel, lightLevel, lightLevel);
  const sway = (q.get('sway') ?? '0,0').split(',').map(Number);
  const DT = 1 / 60;
  let time = 0;
  let zoom = q.has('zoomt') ? 0 : num('zoom', q.has('unzoomt') ? 1 : 0);
  const step = (dt: number): void => {
    time += dt;
    vm.update({
      dt,
      speed: num('speed', 0),
      onGround: q.get('air') !== '1',
      crouch: num('crouch', 0),
      lookDeltaYaw: (sway[0] ?? 0) * dt,
      lookDeltaPitch: (sway[1] ?? 0) * dt,
      punchPitch: 0,
      punchYaw: 0,
      zoom,
      ads: adsBlend,
      team: num('team', 0),
      light,
    });
  };
  const run = (seconds: number): void => {
    for (let t = 0; t < seconds - 1e-6; t += DT) step(Math.min(DT, seconds - t));
  };

  // Third-person effects (the world scene and camera are all they need from the engine).
  const effects = q.get('tp') === '1' ? createEffects({ scene: world, camera: worldCam } as unknown as IEngine) : null;

  // Settle, then play the requested action up to the frame to freeze.
  run(num('t', 0.8));
  let frozen = false;
  if (q.has('fire')) {
    const shots = Math.max(1, num('burst', 1));
    for (let i = 0; i < shots; i++) {
      vm.onFire();
      if (i < shots - 1) run(def.fireInterval);
    }
    if (effects) {
      effects.muzzleFlash({ x: -2.2, y: 1.5, z: -5 }, { x: 1, y: 0, z: 0 }, id);
      effects.muzzleFlash({ x: 0, y: 1.2, z: -5 }, { x: 0, y: 0, z: 1 }, id);
      effects.muzzleFlash({ x: 2.2, y: 1.5, z: -5 }, { x: 0.3, y: 0, z: -1 }, id);
      effects.update(1e-5);
      effects.update(num('fire', 0));
    }
    step(1e-5);
    run(num('fire', 0));
    frozen = true;
  } else if (q.has('reload')) {
    const dur = def.reloadTime || 2;
    vm.onReload(dur);
    run(dur * num('reload', 0.5));
    frozen = true;
  } else if (q.has('draw')) {
    const dur = def.drawTime || 0.5;
    if (from) vm.setWeapon(id);
    vm.onDraw(dur);
    run(dur * num('draw', 0.5));
    frozen = true;
  } else if (q.has('zoomt') || q.has('unzoomt')) {
    zoom = q.has('zoomt') ? 1 : 0;
    run(num(q.has('zoomt') ? 'zoomt' : 'unzoomt', 0.05));
    frozen = true;
  } else if (q.has('t') || q.has('sway') || q.has('speed')) {
    frozen = true;
  }

  const auto = q.get('auto');
  let next = 0;
  let n = 0;
  const loop = (): void => {
    if (auto && time >= next) {
      if (auto === 'fire') {
        vm.onFire();
        next = time + def.fireInterval;
      } else {
        vm.onReload(def.reloadTime || 2);
        next = time + (def.reloadTime || 2) + 1;
      }
    }
    step(frozen ? 0 : DT);
    if (post) post.render(time);
    else {
      renderer.clear();
      renderer.render(world, worldCam);
      renderer.clearDepth();
      renderer.render(scene, camera);
    }
    if (++n === 4) (window as unknown as { __s: unknown }).__s = { ready: true };
    requestAnimationFrame(loop);
  };
  loop();
})();
