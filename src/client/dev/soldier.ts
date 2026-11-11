/**
 * Avatar test bench: /dev/soldier.html?weapon=rifle_m4&crouch=0&pitch=0&speed=0&view=front|side|back|three
 * Renders one player model in a neutral studio so poses can be checked.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { WeaponId } from '../../shared/weapons/defs';
import { createAvatar, preloadAvatarAssets } from '../render/avatar';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (q.has(k) ? Number(q.get(k)) : d);
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
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x59616b, roughness: 0.9 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground, new THREE.GridHelper(10, 20, 0x8899aa, 0x44505c));
// Hull outline: 0.7 × 1.8 m (1.3 m crouched).
const crouch = num('crouch', 0);
const hull = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.8 - crouch * 0.5, 0.7), new THREE.MeshBasicMaterial({ color: 0x33ff88, wireframe: true }));
hull.position.y = (1.8 - crouch * 0.5) / 2;
scene.add(hull);

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 100);
const view = q.get('view') ?? 'three';
const pos: Record<string, [number, number, number]> = { front: [0, 1.2, -4.2], side: [4.2, 1.2, 0], back: [0, 1.4, 4.2], three: [2.6, 1.6, -3.4] };
camera.position.set(...(pos[view] ?? pos.three!));
camera.lookAt(0, 1.0, 0);

const light = new THREE.Color(1, 1, 1);
void (async () => {
  await preloadAvatarAssets();
  const av = createAvatar((num('team', 0) as 0 | 1), 'Test');
  scene.add(av.root);
  if (q.has('debugmat')) {
    av.root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m) console.log(o.type, o.name, m.type, 'color', m.color?.getHexString(), 'emissive', m.emissive?.getHexString(), 'map', !!m.map, 'metal', m.metalness, 'vc', m.vertexColors, 'emMap', !!m.emissiveMap);
    });
  }
  const frame = {
    dt: 1 / 60,
    pos: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: (num('pitch', 0) * Math.PI) / 180,
    crouch,
    speed: num('speed', 0),
    onGround: true,
    weapon: (q.get('weapon') ?? 'rifle_m4') as WeaponId,
    reloading: false,
    carrying: false,
    protected: false,
    light,
  };
  let n = 0;
  const loop = (): void => {
    av.update(frame);
    renderer.render(scene, camera);
    if (++n === 40) (window as unknown as { __s: unknown }).__s = { ready: true };
    requestAnimationFrame(loop);
  };
  loop();
})();
