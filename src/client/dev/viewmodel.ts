/**
 * First-person weapon test bench: /dev/viewmodel.html?w=rifle_m4&ads=0&team=0&speed=0
 * Renders the view model (weapon + arms) alone, as the game's overlay camera sees it.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { WeaponId } from '../../shared/weapons/defs';
import { preloadAvatarAssets } from '../render/avatar';
import { createViewModel } from '../render/viewmodel';
import { preloadWeaponAssets } from '../render/weapons/assets';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.8;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x6f7f8f);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;
scene.add(new THREE.HemisphereLight(0xffffff, 0x8f8a84, Math.PI * 0.62));
const sun = new THREE.DirectionalLight(0xffffff, Math.PI * 0.55);
sun.position.set(2, 4, 3);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(54, innerWidth / innerHeight, 0.01, 10);
scene.add(camera);
// Debug views of the arm rig: ?cam=back|top|side (the game's camera sits at the origin, looking down -Z).
const cam = q.get('cam');
if (cam === 'back') camera.position.set(0, 0.25, 1.1);
else if (cam === 'top') camera.position.set(0, 1.6, -0.2);
else if (cam === 'side') camera.position.set(1.5, 0.0, -0.3);
if (cam) {
  camera.lookAt(0, -0.2, -0.35);
  scene.add(new THREE.AxesHelper(0.3));
}

void (async () => {
  await Promise.all([preloadAvatarAssets(), preloadWeaponAssets()]);
  const vm = createViewModel();
  scene.add(vm.root);
  const id = (q.get('w') ?? 'rifle_m4') as WeaponId;
  vm.setWeapon(id);
  const light = new THREE.Color(1, 1, 1);
  let n = 0;
  const loop = (): void => {
    vm.update({
      dt: 1 / 60,
      speed: Number(q.get('speed') ?? 0),
      onGround: true,
      crouch: 0,
      lookDeltaYaw: 0,
      lookDeltaPitch: 0,
      punchPitch: 0,
      punchYaw: 0,
      zoom: 0,
      ads: Number(q.get('ads') ?? 0),
      team: Number(q.get('team') ?? 0),
      light,
    });
    renderer.render(scene, camera);
    if (++n === 50) (window as unknown as { __s: unknown }).__s = { ready: true };
    requestAnimationFrame(loop);
  };
  loop();
})();
