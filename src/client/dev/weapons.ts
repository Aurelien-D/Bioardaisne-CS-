/**
 * Weapon model review (development page, /dev/weapons.html).
 *
 *   ?w=<weaponId>                  weapon to show (default rifle_ak)
 *   ?view=side|top|front|fp|orbit  (default side)
 *       side   orthographic, seen from the weapon's right-hand side (+X): barrel (-Z) to the
 *              right of the screen, top (+Y) up
 *       top    orthographic, seen from above (+Y): barrel to the right, right-hand side (+X) down
 *       front  orthographic, facing the muzzle (camera on -Z): right-hand side (+X) on the left
 *       fp     first person: perspective camera (54°) at the origin of a parent that holds the
 *              weapon at (0.15, -0.165, -0.34) scaled 0.8 — the pose used by the game
 *       orbit  perspective three-quarter view (drag to turn, wheel to zoom)
 *   ?markers=0                     hide the frame axes, the grid and the anchors
 *   ?labels=0                      keep the markers but hide their text labels
 *   ?move=<part>:<dx>,<dy>,<dz>    move a named part (metres, weapon axes) to check that it is
 *                                  separate, e.g. ?w=pistol&move=slide:0,0,0.03;magazine:0,-0.06,0
 *   ?src=<url>                     raw mode: any glTF / GLB as authored (no placement), fitted to
 *                                  the window, four views with the SOURCE axes — used to work out
 *                                  the placement of a new model
 *   ?src=<url>&pane=x|y|z|p        raw mode, one of the four views only (from +X, +Y, +Z, perspective)
 *
 * Markers: X red, Y green, Z blue (from the origin, positive side; 20 cm each, 10 cm for hand guns
 * and the knife), 10 cm grid (50 cm lines brighter),
 * spheres at the origin (white), muzzle (red), sight (green) and gripLeft (blue).
 *
 * Automation: window.__w = { ready, error, info }.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { WEAPONS, type WeaponId } from '../../shared/weapons/defs';
import { getWeaponAsset, preloadWeaponAssets, type WeaponAsset } from '../render/weapons/assets';

type View = 'side' | 'top' | 'front' | 'fp' | 'orbit';

interface WeaponInfo {
  id: string;
  view: string;
  triangles: number;
  meshes: number;
  materials: number;
  textures: number;
  /** Bounding box in the displayed frame (metres for a placed weapon, source units in raw mode). */
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
  /** Ids that have a loaded asset. */
  available: string[];
  /** Names of the movable parts of the displayed weapon. */
  parts: string[];
}

interface WeaponsApi {
  ready: boolean;
  error: string | null;
  info: WeaponInfo | null;
}

declare global {
  interface Window {
    __w: WeaponsApi;
  }
}

const api: WeaponsApi = { ready: false, error: null, info: null };
window.__w = api;

const VIEWS: View[] = ['side', 'top', 'front', 'fp', 'orbit'];
const IDS = Object.keys(WEAPONS) as WeaponId[];
/** Pose of the view model in the game (holder position and scale, rifle category). */
const FP_POSITION: [number, number, number] = [0.15, -0.165, -0.34];
const FP_SCALE = 0.8;
const FP_FOV = 54;

const params = new URLSearchParams(location.search);
const rawSrc = params.get('src');
const weaponId: WeaponId = IDS.includes(params.get('w') as WeaponId) ? (params.get('w') as WeaponId) : 'rifle_ak';
const view: View = VIEWS.includes(params.get('view') as View) ? (params.get('view') as View) : 'side';
const showMarkers = params.get('markers') !== '0';
const showLabels = params.get('labels') !== '0';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;
const nav = document.getElementById('nav') as HTMLDivElement;
const labels = document.getElementById('labels') as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Same output transform as the game (render/engine.ts).
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.86;
renderer.autoClear = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x6b7480);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;
scene.add(new THREE.HemisphereLight(0xffffff, 0x8f8a84, Math.PI * 0.62));
const sun = new THREE.DirectionalLight(0xffffff, Math.PI * 0.55);
sun.position.set(-1.2, 2.4, 1.6);
scene.add(sun);

/** Markers live in their own scene, drawn over the model without depth test. */
const markerScene = new THREE.Scene();

const fmt = (v: number, d = 3): string => (Math.abs(v) < 5e-4 ? 0 : v).toFixed(d);
const vec = (p: readonly number[], d = 3): string => `(${p.map((v) => fmt(v, d)).join(', ')})`;

function flat(color: number, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: opacity < 1, opacity, toneMapped: false });
}

/** Thin bar from a to b (WebGL lines are one pixel wide whatever the zoom). */
function bar(a: THREE.Vector3, b: THREE.Vector3, radius: number, color: number): THREE.Mesh {
  const len = a.distanceTo(b);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 8), flat(color));
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  mesh.renderOrder = 20;
  return mesh;
}

function ball(p: readonly number[], radius: number, color: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), flat(color));
  mesh.position.set(p[0]!, p[1]!, p[2]!);
  mesh.renderOrder = 30;
  return mesh;
}

/** Axes from the origin: X red, Y green, Z blue (positive direction only). */
function axes(length: number, radius: number): THREE.Group {
  const g = new THREE.Group();
  const o = new THREE.Vector3();
  g.add(bar(o, new THREE.Vector3(length, 0, 0), radius, 0xff3030));
  g.add(bar(o, new THREE.Vector3(0, length, 0), radius, 0x30d040));
  g.add(bar(o, new THREE.Vector3(0, 0, length), radius, 0x3878ff));
  return g;
}

/** Grid in the plane normal to `normal` ('x' | 'y' | 'z'), through the origin. */
function grid(normal: 'x' | 'y' | 'z', half: number, step: number, major: number): THREE.LineSegments {
  const pos: number[] = [];
  const col: number[] = [];
  const n = Math.round(half / step);
  const put = (u: number, v: number): void => {
    if (normal === 'x') pos.push(0, v, u);
    else if (normal === 'y') pos.push(v, 0, u);
    else pos.push(u, v, 0);
  };
  for (let i = -n; i <= n; i++) {
    const t = i * step;
    const strong = i % Math.round(major / step) === 0;
    const c = i === 0 ? 0.95 : strong ? 0.78 : 0.5;
    put(t, -half);
    put(t, half);
    put(-half, t);
    put(half, t);
    for (let k = 0; k < 4; k++) col.push(c, c, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const lines = new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false, toneMapped: false }),
  );
  lines.renderOrder = 5;
  return lines;
}

interface Pane {
  camera: THREE.Camera;
  /** Viewport in fractions of the canvas (x, y from the bottom-left corner, width, height). */
  rect: [number, number, number, number];
  /** Scene-space points labelled in this pane. */
  tags: { text: string; at: THREE.Vector3; color: string }[];
  title?: string;
  /** Extra marker objects only visible in this pane. */
  only?: THREE.Object3D[];
  /** Called before rendering with the pane's aspect ratio. */
  fit(aspect: number): void;
}

const panes: Pane[] = [];

/** Orthographic camera looking at `center` from `center + from * distance`, fitted on a box. */
function orthoPane(
  box: THREE.Box3,
  from: THREE.Vector3,
  up: THREE.Vector3,
  rect: [number, number, number, number],
  margin: number,
): Pane {
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() * 0.5 + 1;
  cam.position.copy(center).addScaledVector(from, radius * 2);
  cam.up.copy(up);
  cam.lookAt(center);
  cam.updateMatrixWorld(true);
  // Extent of the box on the screen axes.
  const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
  const upv = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
  let w = 0;
  let h = 0;
  for (let i = 0; i < 8; i++) {
    const c = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center);
    w = Math.max(w, Math.abs(c.dot(right)));
    h = Math.max(h, Math.abs(c.dot(upv)));
  }
  w += margin;
  h += margin;
  return {
    camera: cam,
    rect,
    tags: [],
    fit(aspect: number): void {
      const hh = Math.max(h, w / aspect);
      cam.left = -hh * aspect;
      cam.right = hh * aspect;
      cam.top = hh;
      cam.bottom = -hh;
      cam.near = 0.01;
      cam.far = radius * 4 + 10;
      cam.updateProjectionMatrix();
    },
  };
}

function perspPane(cam: THREE.PerspectiveCamera, rect: [number, number, number, number]): Pane {
  return {
    camera: cam,
    rect,
    tags: [],
    fit(aspect: number): void {
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    },
  };
}

function stats(root: THREE.Object3D): { triangles: number; meshes: number; materials: number; textures: number } {
  let triangles = 0;
  let meshes = 0;
  const mats = new Set<THREE.Material>();
  const texs = new Set<THREE.Texture>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshes++;
    const geo = mesh.geometry;
    triangles += (geo.index ? geo.index.count : geo.attributes.position!.count) / 3;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      mats.add(m);
      for (const value of Object.values(m)) if (value instanceof THREE.Texture) texs.add(value);
    }
  });
  return { triangles: Math.round(triangles), meshes, materials: mats.size, textures: texs.size };
}

function buildNav(available: string[]): void {
  const link = (text: string, w: string, v: string, on: boolean, missing = false): string =>
    // Absolute path: the page sets <base href="/"> so that media/ URLs resolve from the site root.
    `<a class="${on ? 'on' : ''}" style="${missing ? 'opacity:.45' : ''}" href="${location.pathname}?w=${w}&view=${v}">${text}</a>`;
  nav.innerHTML =
    IDS.map((id) => link(id, id, view, id === weaponId && !rawSrc, !available.includes(id))).join('') +
    '<br>' +
    VIEWS.map((v) => link(v, weaponId, v, v === view && !rawSrc)).join('');
}

/** Orbit control without dependencies: drag to turn, wheel to zoom. */
function orbit(cam: THREE.PerspectiveCamera, target: THREE.Vector3, distance: number, yaw: number, pitch: number): void {
  const place = (): void => {
    cam.position.set(
      target.x + distance * Math.cos(pitch) * Math.sin(yaw),
      target.y + distance * Math.sin(pitch),
      target.z + distance * Math.cos(pitch) * Math.cos(yaw),
    );
    cam.lookAt(target);
  };
  place();
  let drag = false;
  canvas.addEventListener('pointerdown', (e) => {
    drag = true;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', () => (drag = false));
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    yaw -= e.movementX * 0.008;
    pitch = Math.max(-1.5, Math.min(1.5, pitch + e.movementY * 0.008));
    place();
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      distance *= Math.exp(e.deltaY * 0.001);
      place();
    },
    { passive: false },
  );
}

// =================================================================================
// Placed weapon (through the loader)
// =================================================================================

function showWeapon(asset: WeaponAsset, available: string[]): void {
  const def = WEAPONS[weaponId];
  const model = asset.scene.clone();
  // The named parts are the children of the wrapped glTF scene.
  const parts = (model.children[0]?.children ?? []).map((o) => o.name).filter(Boolean);
  for (const item of (params.get('move') ?? '').split(';').filter(Boolean)) {
    const [name, offset] = item.split(':');
    const part = name ? model.getObjectByName(name) : undefined;
    const d = (offset ?? '').split(',').map(Number);
    if (!part || d.length !== 3 || d.some((v) => !Number.isFinite(v))) throw new Error(`Paramètre move invalide : « ${item} » (pièces : ${parts.join(', ')})`);
    part.position.set(d[0]!, d[1]!, d[2]!);
  }
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const s = stats(model);

  const anchors: { name: string; at: [number, number, number]; color: number; css: string }[] = [
    { name: 'origine', at: [0, 0, 0], color: 0xffffff, css: '#fff' },
    { name: 'muzzle', at: asset.muzzle, color: 0xff2020, css: '#ff8080' },
    { name: 'sight', at: asset.sight, color: 0x20e040, css: '#80ff90' },
    { name: 'gripLeft', at: asset.gripLeft, color: 0x2060ff, css: '#9fc0ff' },
  ];

  const holder = new THREE.Group();
  holder.add(model);
  scene.add(holder);
  const markerHolder = new THREE.Group();
  markerScene.add(markerHolder);

  if (view === 'fp') {
    holder.position.set(...FP_POSITION);
    holder.scale.setScalar(FP_SCALE);
    markerHolder.position.copy(holder.position);
    markerHolder.scale.copy(holder.scale);
    const cam = new THREE.PerspectiveCamera(FP_FOV, 1, 0.01, 10);
    panes.push(perspPane(cam, [0, 0, 1, 1]));
    if (showMarkers) for (const a of anchors) markerHolder.add(ball(a.at, 0.004, a.color));
  } else if (view === 'orbit') {
    const cam = new THREE.PerspectiveCamera(35, 1, 0.01, 50);
    const target = box.getCenter(new THREE.Vector3());
    orbit(cam, target, Math.max(size.length() * 1.5, 0.5), 0.9, 0.35);
    panes.push(perspPane(cam, [0, 0, 1, 1]));
    if (showMarkers) {
      markerHolder.add(axes(0.2, 0.0015));
      for (const a of anchors) markerHolder.add(ball(a.at, 0.005, a.color));
    }
  } else {
    // Frame the model, the origin and the anchors.
    const frame = box.clone();
    for (const a of anchors) frame.expandByPoint(new THREE.Vector3(...a.at));
    const from = view === 'side' ? new THREE.Vector3(1, 0, 0) : view === 'top' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, -1);
    const up = view === 'top' ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const span = frame.getSize(new THREE.Vector3()).length();
    const pane = orthoPane(frame, from, up, [0, 0, 1, 1], Math.max(0.02, span * 0.07));
    panes.push(pane);
    if (showMarkers) {
      const reach = Math.ceil((span + 0.4) * 10) / 10;
      markerHolder.add(grid(view === 'side' ? 'x' : view === 'top' ? 'y' : 'z', reach, 0.1, 0.5));
      const thin = Math.max(size.length() * 0.0016, 0.0006);
      // Axes: 20 cm for long guns, 10 cm for hand guns and the knife.
      const arm = size.length() > 0.45 ? 0.2 : 0.1;
      markerHolder.add(axes(arm, thin));
      for (const a of anchors) {
        markerHolder.add(ball(a.at, thin * 3.2, a.color));
        pane.tags.push({ text: `${a.name} ${vec(a.at)}`, at: new THREE.Vector3(...a.at), color: a.css });
      }
      pane.tags.push({ text: `+X ${arm * 100} cm`, at: new THREE.Vector3(arm, 0, 0), color: '#ff8080' });
      pane.tags.push({ text: `+Y ${arm * 100} cm`, at: new THREE.Vector3(0, arm, 0), color: '#80ff90' });
      pane.tags.push({ text: `+Z ${arm * 100} cm`, at: new THREE.Vector3(0, 0, arm), color: '#9fc0ff' });
    }
  }

  api.info = {
    id: weaponId,
    view,
    ...s,
    min: box.min.toArray() as [number, number, number],
    max: box.max.toArray() as [number, number, number],
    size: size.toArray() as [number, number, number],
    available,
    parts,
  };
  overlay.textContent = [
    `${weaponId} — ${def.name} (${def.category}) · vue ${view}`,
    `longueur ${fmt(size.z * 100, 1)} cm · hauteur ${fmt(size.y * 100, 1)} cm · épaisseur ${fmt(size.x * 100, 1)} cm`,
    `boîte  min ${vec(box.min.toArray())}  max ${vec(box.max.toArray())}`,
    `${s.triangles} triangles · ${s.meshes} maillages · ${s.materials} matériaux · ${s.textures} textures`,
    `pièces : ${parts.join(', ')}`,
    `muzzle ${vec(asset.muzzle)} · sight ${vec(asset.sight)} · gripLeft ${vec(asset.gripLeft)}`,
    asset.credit,
  ].join('\n');
}

// =================================================================================
// Raw mode: a glTF as authored, four views with the source axes
// =================================================================================

async function showRaw(url: string): Promise<void> {
  const gltf = await new GLTFLoader().loadAsync(new URL(url, document.baseURI).href);
  const model = gltf.scene;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const s = stats(model);
  scene.add(model);

  const reach = size.length();
  const thin = reach * 0.0025;
  const marks = new THREE.Group();
  marks.add(axes(reach * 0.25, thin));
  marks.add(ball([0, 0, 0], thin * 3, 0xffffff));
  if (showMarkers) markerScene.add(marks);

  const margin = reach * 0.04;
  const x = orthoPane(box, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), [0, 0.5, 0.5, 0.5], margin);
  x.title = 'vu depuis +X  (écran : droite = −Z, haut = +Y)';
  const z = orthoPane(box, new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), [0.5, 0.5, 0.5, 0.5], margin);
  z.title = 'vu depuis +Z  (écran : droite = +X, haut = +Y)';
  const y = orthoPane(box, new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), [0, 0, 0.5, 0.5], margin);
  y.title = 'vu depuis +Y  (écran : droite = +X, haut = −Z)';
  const cam = new THREE.PerspectiveCamera(30, 1, reach * 0.01, reach * 40);
  cam.position.copy(center).add(new THREE.Vector3(1, 0.55, 1).normalize().multiplyScalar(reach * 1.9));
  cam.lookAt(center);
  const p = perspPane(cam, [0.5, 0, 0.5, 0.5]);
  p.title = 'perspective depuis (+X, +Y, +Z)';
  const all: Record<string, Pane> = { x, y, z, p };
  const single = all[params.get('pane') ?? ''];
  if (single) {
    single.rect = [0, 0, 1, 1];
    panes.push(single);
  } else {
    panes.push(x, z, y, p);
  }
  for (const pane of panes) {
    pane.tags.push({ text: '+X', at: new THREE.Vector3(reach * 0.25, 0, 0), color: '#ff8080' });
    pane.tags.push({ text: '+Y', at: new THREE.Vector3(0, reach * 0.25, 0), color: '#80ff90' });
    pane.tags.push({ text: '+Z', at: new THREE.Vector3(0, 0, reach * 0.25), color: '#9fc0ff' });
  }

  api.info = {
    id: url,
    view: 'raw',
    ...s,
    min: box.min.toArray() as [number, number, number],
    max: box.max.toArray() as [number, number, number],
    size: size.toArray() as [number, number, number],
    available: [],
    parts: [],
  };
  overlay.textContent = [
    `brut : ${url}`,
    `taille ${vec(size.toArray())} (unités source)`,
    `boîte  min ${vec(box.min.toArray())}  max ${vec(box.max.toArray())}`,
    `${s.triangles} triangles · ${s.meshes} maillages · ${s.materials} matériaux · ${s.textures} textures`,
  ].join('\n');
}

// =================================================================================
// Rendering
// =================================================================================

const tagEls: HTMLSpanElement[] = [];

function render(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
  }
  renderer.setScissorTest(true);
  let used = 0;
  const tag = (text: string, x: number, y: number, color: string, cls = ''): void => {
    let el = tagEls[used];
    if (!el) {
      el = document.createElement('span');
      labels.appendChild(el);
      tagEls[used] = el;
    }
    used++;
    el.className = cls;
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.color = color;
    el.style.display = '';
  };
  const v = new THREE.Vector3();
  for (const pane of panes) {
    const [rx, ry, rw, rh] = pane.rect;
    const px = rx * w;
    const py = ry * h;
    const pw = rw * w;
    const ph = rh * h;
    renderer.setViewport(px, py, pw, ph);
    renderer.setScissor(px, py, pw, ph);
    pane.fit(pw / ph);
    pane.camera.updateMatrixWorld(true);
    renderer.clear();
    renderer.render(scene, pane.camera);
    renderer.clearDepth();
    renderer.render(markerScene, pane.camera);
    const top = h - py - ph;
    if (pane.title) tag(pane.title, px + 8, top + (panes.length > 1 && ry >= 0.5 && rx === 0 ? 96 : 8), '#eaf6fe', 'tag');
    const seen: [number, number][] = [];
    for (const t of pane.tags) {
      v.copy(t.at).project(pane.camera);
      if (v.z < -1 || v.z > 1) continue;
      const x = px + ((v.x + 1) / 2) * pw;
      let y = top + ((1 - v.y) / 2) * ph;
      // Labels of points that project onto the same pixel (an axis seen end-on) are stacked.
      while (seen.some(([sx, sy]) => Math.abs(sx - x) < 60 && Math.abs(sy - y) < 15)) y += 16;
      seen.push([x, y]);
      if (showLabels) tag(t.text, x, y, t.color, x > px + pw * 0.8 ? 'left' : '');
    }
  }
  for (let i = used; i < tagEls.length; i++) tagEls[i]!.style.display = 'none';
}

async function main(): Promise<void> {
  await preloadWeaponAssets();
  const available = IDS.filter((id) => getWeaponAsset(id) !== null);
  buildNav(available);
  if (rawSrc) {
    await showRaw(rawSrc);
  } else {
    const asset = getWeaponAsset(weaponId);
    if (!asset) throw new Error(`Aucun modèle chargé pour « ${weaponId} » (disponibles : ${available.join(', ') || 'aucun'})`);
    showWeapon(asset, available);
  }
  let frames = 0;
  const loop = (): void => {
    render();
    // Textures are uploaded during the first frames: wait a little before declaring the page ready.
    if (++frames === 4) api.ready = true;
    requestAnimationFrame(loop);
  };
  loop();
}

main().catch((err: unknown) => {
  api.error = err instanceof Error ? err.message : String(err);
  overlay.textContent = api.error;
  overlay.classList.add('error');
  console.error(err);
});
