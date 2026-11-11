/**
 * Map viewer (development page, /dev/viewer.html).
 *
 *   ?map=<id>            map to load (default dev_test; "gallery" = built-in render test scene)
 *   ?x=&y=&z=&yaw=&pitch=   initial camera pose (metres / degrees)
 *   ?top=1&cut=2.5       top-down orthographic view; geometry above the cut height is hidden
 *   ?quality=low|medium|high   override the quality setting (not saved)
 *   ?markers=1           show spawns, lights, zones and points
 *   ?uv=1                replace the world textures with a UV test pattern
 *   ?overlay=1           put a placeholder weapon in the first-person overlay scene
 *
 * Controls: click to capture the mouse, WASD / ZQSD (physical keys) to fly, Space / Shift
 * up / down, Ctrl = faster, wheel = speed, T = top-down view, M = markers, U = UV test pattern.
 *
 * Automation: window.__viewer = { ready, error, frame, setPose(), setTop(), stats(), engine }.
 */
import * as THREE from 'three';
import { BRAND } from '../../shared/identity';
import { MapBuilder } from '../../shared/maps/builder';
import { getMap, hasMap } from '../../shared/maps/index';
import { MATERIAL_IDS, materialInfo } from '../../shared/maps/materials';
import type { MapData } from '../../shared/maps/types';
import { CollisionWorld } from '../../shared/physics/world';
import type { IEngine } from '../core/contracts';
import { SettingsStore, type Quality } from '../core/settings';
import { createEngine } from '../render/engine';

interface ViewerStats {
  map: string;
  fps: number;
  drawCalls: number;
  triangles: number;
  frame: number;
  top: boolean;
  pose: { x: number; y: number; z: number; yaw: number; pitch: number };
  bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null;
}

interface ViewerApi {
  /** True after the first rendered frame of the loaded map. */
  ready: boolean;
  /** Set when the map could not be loaded. */
  error: string | null;
  /** Number of frames rendered since the map was loaded. */
  frame: number;
  setPose(x: number, y: number, z: number, yawDeg: number, pitchDeg: number): void;
  /** Top-down orthographic view framed on the map bounds; `cutY` hides everything above that height. */
  setTop(enabled: boolean, cutY?: number | null): void;
  stats(): ViewerStats;
  /** The engine under test (debugging / automated checks). */
  engine: IEngine;
}

declare global {
  interface Window {
    __viewer: ViewerApi;
  }
}

// =================================================================================
// Built-in render test scene ("gallery"): every material, primitive, sign style and icon.
// =================================================================================

function buildGallery(): MapData {
  const b = new MapBuilder({
    id: 'gallery',
    name: 'Galerie de rendu',
    description: 'Scène de test du moteur : matériaux, primitives, panneaux, vitrages, eau.',
    modes: ['tdm'],
    players: [2, 2],
  });

  // Ground
  b.box(-32, -0.5, -26, 32, 0, 26, 'paving_stone');
  b.box(-32, 0, 19, 32, 0.02, 26, 'asphalt', { solid: false });
  b.box(-31, 0, 1, -25, 0.03, 7, 'grass', { solid: false });

  // --- Material swatches: one slab per MaterialId, labelled ---
  const cols = 16;
  MATERIAL_IDS.forEach((id, i) => {
    const cx = -24 + (i % cols) * 3.2;
    const cz = -23 + Math.floor(i / cols) * 2.8;
    b.box(cx - 0.8, 0, cz - 0.25, cx + 0.8, 1.8, cz + 0.25, id);
    b.sign({ x: cx, y: 0.13, z: cz + 0.26, facing: 0, w: 1.3, h: 0.2, text: id, style: 'door' });
  });

  // --- Primitives ---
  b.at(-5, 0, -3, 0, (m) => {
    const px = (i: number): number => -22 + i * 3.4;
    m.prim('box', px(0), 0.9, 0, 1.4, 1.4, 1.4, 'cardboard', { rot: { x: 0.3, y: 0.6, z: 0 } });
    m.prim('cyl', px(1), 0.9, 0, 1.2, 1.8, 1.2, 'metal_blue', { seg: 16 });
    m.prim('cyl', px(2), 0.5, 0, 1.0, 2.4, 1.0, 'concrete', { rot: { x: 0, y: 0.4, z: Math.PI / 2 }, seg: 14 });
    m.prim('sphere', px(3), 0.9, 0, 1.8, 1.8, 1.8, 'plastic_red', { seg: 16 });
    m.prim('sphere', px(4), 0.6, 0, 2.2, 1.2, 1.6, 'stone_grey');
    m.prim('cone', px(5), 0.9, 0, 1.4, 1.8, 1.4, 'plastic_orange', { seg: 16 });
    // Small house: box + gable roof (prism)
    m.box(px(6) - 1.2, 0, -1, px(6) + 1.2, 1.6, 1, 'facade_cream');
    m.prim('prism', px(6), 2.15, 0, 2.8, 1.1, 2.4, 'slate_roof');
    // Kiosk: box + hip roof (pyramid)
    m.box(px(7) - 1, 0, -1, px(7) + 1, 1.6, 1, 'stone_yellow');
    m.prim('pyramid', px(7), 2.1, 0, 2.6, 1.0, 2.6, 'roof_tile_red');
    m.prim('wedge', px(8), 0.5, 0, 2, 1, 3, 'wood_planks');
    m.prim('wedge', px(9), 0.4, 0, 1.6, 0.8, 2, 'metal_yellow', { rot: { x: 0, y: Math.PI / 2, z: 0 } });
  });
  // Tree and street lamp
  b.prim('cyl', -28, 1.2, 4, 0.35, 2.4, 0.35, 'bark', { seg: 8 });
  b.prim('sphere', -28, 3.3, 4, 2.6, 2.4, 2.6, 'foliage', { seg: 10 });
  b.prim('cyl', -26, 1.6, 2, 0.12, 3.2, 0.12, 'metal_green', { seg: 8 });
  b.prim('sphere', -26, 3.35, 2, 0.4, 0.4, 0.4, 'light_warm', { seg: 10 });
  b.light(-26, 3.3, 2, 0xffd9a0, 1.2, 9);

  // --- Lab pavilion: interior lighting, glass, emissive panels, coloured lights ---
  const ax = 8;
  const az = -6;
  b.at(ax, 0, az, 0, (m) => {
    m.box(0, 0, 0, 12, 0.03, 10, 'tile_white', { solid: false });
    m.box(0, 3, 0, 12, 3.2, 10, 'ceiling_tile');
    m.box(0, 0, 0, 12, 3, 0.2, 'wall_lab_panel'); // north wall
    m.box(0, 0, 0.2, 0.2, 3, 10, 'plaster_blue'); // west wall
    m.box(11.8, 0, 0.2, 12, 3, 10, 'plaster_green'); // east wall
    // South wall: doorway (x 1..2.4), then a glass front with a low wall
    m.box(0.2, 0, 9.8, 1, 3, 10, 'plaster_white');
    m.box(1, 2.2, 9.8, 2.4, 3, 10, 'plaster_white');
    m.box(2.4, 0, 9.8, 11.8, 0.9, 10, 'plaster_white');
    m.box(2.4, 2.5, 9.8, 11.8, 3, 10, 'plaster_white');
    m.box(2.4, 0.9, 9.86, 7, 2.5, 9.94, 'glass');
    m.box(7, 0.9, 9.86, 11.8, 2.5, 9.94, 'glass_frosted');
    m.box(6.95, 0.9, 9.82, 7.05, 2.5, 9.98, 'metal_brushed', { detail: true });
    // Ceiling light panels
    for (const [lx, lz] of [
      [3, 3],
      [9, 3],
      [3, 7],
      [9, 7],
    ] as const) {
      m.box(lx - 0.6, 2.97, lz - 0.3, lx + 0.6, 3, lz + 0.3, 'light_panel', { solid: false });
      m.light(lx, 2.8, lz, 0xffffff, 1, 7);
    }
    m.light(0.9, 1.2, 1, 0xff4040, 0.9, 4);
    m.light(11, 1.2, 1, 0x4aa8ff, 0.9, 4);
    // Bench with a screen and status LEDs
    m.box(3, 0, 0.3, 9, 0.9, 1.1, 'laminate_white');
    m.box(4, 0.9, 0.5, 4.7, 1.4, 0.56, 'plastic_black', { faces: { pz: 'screen_on' }, detail: true });
    m.box(5.2, 0.9, 0.4, 6.4, 1.6, 1.0, 'metal_white', { detail: true });
    m.box(5.3, 1.45, 1.0, 5.36, 1.51, 1.01, 'led_green', { solid: false, detail: true });
    m.box(5.45, 1.45, 1.0, 5.51, 1.51, 1.01, 'led_red', { solid: false, detail: true });
    m.box(5.6, 1.45, 1.0, 5.66, 1.51, 1.01, 'led_blue', { solid: false, detail: true });
    m.box(7.2, 0.9, 0.5, 7.6, 1.3, 0.9, 'plastic_yellow', { detail: true });
    m.sign({ x: 6, y: 2.3, z: 0.21, facing: 0, w: 2.4, h: 0.5, text: 'Plateau technique', sub: 'Hématologie · Biochimie', style: 'plaque', icon: 'logo' });
    m.sign({ x: 10.2, y: 1.7, z: 0.21, facing: 0, w: 1.4, h: 0.8, text: 'Série en cours', sub: 'Résultats sous 24 h', style: 'screen', icon: 'tube' });
    m.sign({ x: 0.21, y: 1.6, z: 5, facing: 1, w: 0.7, h: 1.0, text: 'Lavage des mains', sub: 'Trente secondes, même quand la série est urgente.', style: 'poster', icon: 'drop' });
    m.sign({ x: 6, y: 0.035, z: 6, facing: 4, w: 3, h: 1.2, text: 'Zone stérile', style: 'floor', color: 0xf0c81e });
    m.sign({ x: 1.7, y: 0.035, z: 8.6, facing: 4, w: 0.9, h: 0.9, text: '', style: 'floor', icon: 'arrow_up' });
    m.sign({ x: 1.7, y: 2.5, z: 10.01, facing: 0, w: 1.2, h: 0.3, text: 'Prélèvements', style: 'door', icon: 'drop' });
  });

  // --- Water basin ---
  b.at(22, 0, -1, 0, (m) => {
    m.box(0, 0, -4, 8, 0.5, -3.6, 'stone_grey');
    m.box(0, 0, 3.6, 8, 0.5, 4, 'stone_grey');
    m.box(0, 0, -3.6, 0.4, 0.5, 3.6, 'stone_grey');
    m.box(7.6, 0, -3.6, 8, 0.5, 3.6, 'stone_grey');
    m.box(0.4, 0, -3.6, 7.6, 0.05, 3.6, 'concrete_dark', { solid: false });
    m.box(0.4, 0.05, -3.6, 7.6, 0.38, 3.6, 'water', { solid: false });
    // Two adjacent glass blocks: their shared inner faces must not show.
    m.box(1.5, 0.5, -3.95, 3, 2, -3.65, 'glass');
    m.box(3, 0.5, -3.95, 4.5, 2, -3.65, 'glass');
  });

  // --- Street façade (faces +Z): doors, windows, shutters, shop ---
  b.at(-24, 0, 9, 0, (m) => {
    m.box(0, 0, 0, 24, 6.4, 0.5, 'facade_cream');
    m.box(0, 0, 0.5, 24, 0.5, 0.56, 'stone_grey', { solid: false });
    m.prim('prism', 12, 7.1, 0.25, 1.9, 1.4, 24.6, 'slate_roof', { rot: { x: 0, y: Math.PI / 2, z: 0 } });
    m.box(1.2, 0, 0.5, 2.1, 2.1, 0.55, 'door_wood', { solid: false });
    m.box(3.2, 0, 0.5, 4.2, 2.1, 0.55, 'door_white', { solid: false });
    m.box(5.2, 0, 0.5, 6.2, 2.1, 0.55, 'door_metal', { solid: false });
    for (let i = 0; i < 4; i++) {
      const x0 = 1 + i * 2.6;
      m.box(x0, 3.4, 0.5, x0 + 1.2, 5, 0.55, i === 2 ? 'window_lit' : 'window_facade', { solid: false });
      m.box(x0 - 0.5, 3.4, 0.5, x0 - 0.02, 5, 0.54, 'shutter', { solid: false });
      m.box(x0 + 1.22, 3.4, 0.5, x0 + 1.7, 5, 0.54, 'shutter', { solid: false, tint: 0xd8b0a0 });
    }
    m.box(7.5, 0.9, 0.5, 8.7, 2.4, 0.55, 'window_facade', { solid: false });
    m.box(12, 3.4, 0.5, 23, 5, 0.55, 'window_facade', { solid: false }); // row of windows
    m.box(12.5, 0.4, 0.5, 22.5, 2.5, 0.56, 'shopfront', { solid: false });
    m.sign({ x: 17.5, y: 2.95, z: 0.57, facing: 0, w: 9, h: 0.7, text: 'Boulangerie Pâtisserie', sub: 'Maison fondée à côté du labo', style: 'shop', lit: true });
    m.sign({ x: 10.2, y: 2.9, z: 0.51, facing: 0, w: 1.3, h: 0.55, text: 'Rue de la République', style: 'street' });
    m.sign({ x: 10.2, y: 2.2, z: 0.51, facing: 0, w: 1.1, h: 0.42, text: 'Place Ducale', sub: 'Charleville-Mézières', style: 'street' });
    m.sign({ x: 10.2, y: 1.2, z: 0.51, facing: 0, w: 0.8, h: 1.1, text: 'Fête de la série urgente', sub: 'Samedi à 20 h, salle des automates. Venez nombreux, les tubes sont offerts.', style: 'poster', color: BRAND.red });
    m.light(17.5, 2.2, 2.5, 0xffe2b0, 0.9, 7);
  });

  // --- Sign wall (faces +Z): every style and every pictogram ---
  b.at(3, 0, 9, 0, (m) => {
    m.box(0, 0, 0, 26, 3.6, 0.3, 'plaster_white');
    const z = 0.31;
    m.sign({ x: 2.2, y: 2.9, z, facing: 0, w: 3.6, h: 0.8, text: "BioArd'Aisne", sub: 'Laboratoire de biologie médicale', style: 'plaque', icon: 'logo' });
    m.sign({ x: 5.6, y: 2.9, z, facing: 0, w: 2.4, h: 0.5, text: 'Sérothèque', style: 'plaque' });
    m.sign({ x: 8.6, y: 2.9, z, facing: 0, w: 2.8, h: 0.6, text: 'Accès réservé', sub: 'Personnel habilité', style: 'plaque', bg: BRAND.navy, icon: 'biohazard' });
    const icons = ['logo', 'cross', 'biohazard', 'arrow_left', 'arrow_right', 'arrow_up', 'wc', 'exit', 'tube', 'drop'];
    const labels = ['Accueil', 'Infirmerie', 'Bactériologie', 'Secrétariat', 'Salle d’attente', 'Étage', 'Toilettes', 'Sortie', 'Biochimie', 'Hématologie'];
    icons.forEach((icon, i) => {
      m.sign({ x: 0.9 + (i % 5) * 1.5, y: 1.9 - Math.floor(i / 5) * 0.55, z, facing: 0, w: 1.3, h: 0.4, text: labels[i]!, style: 'door', icon });
    });
    m.sign({ x: 0.9, y: 0.75, z, facing: 0, w: 1.3, h: 0.3, text: 'Où sont passés les tubes ?', style: 'door' });
    m.sign({ x: 2.6, y: 0.75, z, facing: 0, w: 0.5, h: 0.5, text: '', style: 'door', icon: 'exit' });
    m.sign({ x: 9.4, y: 1.4, z, facing: 0, w: 1.0, h: 1.4, text: 'Audit surprise', sub: 'Souriez, vos enregistrements qualité sont à jour. Enfin, on l’espère.', style: 'poster', icon: 'biohazard' });
    m.sign({ x: 10.8, y: 1.4, z, facing: 0, w: 1.0, h: 1.4, text: 'Don du sang', sub: 'Jeudi de 9 h à 17 h', style: 'poster', color: BRAND.red, icon: 'drop' });
    m.sign({ x: 12.4, y: 1.5, z, facing: 0, w: 1.4, h: 1.0, text: 'Pas de tube, pas de résultat', style: 'poster', color: BRAND.navy });
    m.sign({ x: 12.2, y: 2.95, z, facing: 0, w: 3, h: 0.9, text: 'Avenue de l’Hôtel de Ville', sub: '08000', style: 'street' });
    m.sign({ x: 15.6, y: 2.95, z, facing: 0, w: 2.6, h: 0.7, text: 'Pharmacie du Théâtre', style: 'shop', bg: 0x14532d, color: 0xffffff, icon: 'cross', lit: true });
    m.sign({ x: 15.2, y: 1.6, z, facing: 0, w: 2.2, h: 1.2, text: 'File d’attente', sub: 'Ticket n° 042 — guichet 3', style: 'screen', icon: 'arrow_right' });
    m.sign({ x: 17.8, y: 1.6, z, facing: 0, w: 2.0, h: 1.2, text: 'Écart critique', sub: 'Délai : 40 s', style: 'screen', color: 0xff7a6e, bg: 0x2a0a0a, icon: 'biohazard' });
    m.sign({ x: 22, y: 2.6, z, facing: 0, w: 7, h: 1.1, text: 'Journées portes ouvertes', sub: 'Venez visiter le plateau technique', style: 'banner', icon: 'logo' });
    m.sign({ x: 22, y: 1.2, z, facing: 0, w: 5, h: 0.9, text: 'Équipe Labo, à vos pipettes !', style: 'banner', bg: BRAND.red });
    m.sign({ x: 20, y: 0.4, z, facing: 0, w: 1.6, h: 0.5, text: 'Café des Arcades', sub: 'Ouvert dès 7 h', style: 'shop' });
    // Floor markings in front of the wall
    m.sign({ x: 3, y: 0.01, z: 3, facing: 4, w: 2, h: 2, text: '', style: 'floor', icon: 'arrow_up' });
    m.sign({ x: 7, y: 0.01, z: 3, facing: 4, w: 4, h: 1.2, text: 'Livraisons', sub: 'Glacières uniquement', style: 'floor' });
    m.sign({ x: 12, y: 0.01, z: 3, facing: 4, w: 2, h: 2, text: '', style: 'floor', icon: 'biohazard' });
    m.sign({ x: 16, y: 0.01, z: 3, facing: 4, w: 3, h: 1.6, text: 'Dépôt des échantillons', style: 'floor', color: 0xffffff, bg: BRAND.blue });
    m.sign({ x: 20.5, y: 0.01, z: 3, facing: 4, w: 2.4, h: 1.2, text: '', style: 'floor', icon: 'arrow_left', color: 0xf0c81e });
  });

  b.spawn(0, 0, 0, 16, 0);
  b.spawn(1, 0, 0, -8, 180);
  return b.build();
}

// =================================================================================
// Page
// =================================================================================

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view');
const overlay = $('overlay');
const help = $('help');
const loading = $('loading');
const loadingLabel = $('loading-label');
const loadingFill = $('loading-fill');

const query = new URLSearchParams(location.search);
const num = (key: string): number | null => {
  const v = query.get(key);
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const DEG = Math.PI / 180;

const state = {
  mapId: query.get('map') || 'dev_test',
  x: 0,
  y: 1.7,
  z: 0,
  yaw: 0,
  pitch: 0,
  speed: 6,
  top: false,
  cutY: null as number | null,
  topZoom: 1,
  topX: 0,
  topZ: 0,
  fps: 0,
  drawCalls: 0,
  triangles: 0,
  markers: query.get('markers') === '1',
  uvTest: query.get('uv') === '1',
};

const api: Omit<ViewerApi, 'engine'> & { engine?: IEngine } = {
  ready: false,
  error: null,
  frame: 0,
  setPose(x, y, z, yawDeg, pitchDeg) {
    state.x = x;
    state.y = y;
    state.z = z;
    state.yaw = yawDeg * DEG;
    state.pitch = Math.max(-89.9, Math.min(89.9, pitchDeg)) * DEG;
  },
  setTop(enabled, cutY) {
    state.top = enabled;
    state.cutY = cutY === undefined || cutY === null || !Number.isFinite(cutY) ? null : cutY;
    if (enabled) resetTopView();
  },
  stats() {
    return {
      map: state.mapId,
      fps: Math.round(state.fps * 10) / 10,
      drawCalls: state.drawCalls,
      triangles: state.triangles,
      frame: api.frame,
      top: state.top,
      pose: { x: state.x, y: state.y, z: state.z, yaw: state.yaw / DEG, pitch: state.pitch / DEG },
      bounds: mapData ? mapData.bounds : null,
    };
  },
};

let mapData: MapData | null = null;

// Settings: read the saved ones, optionally override the quality in memory only.
const settings = new SettingsStore();
const qualityParam = query.get('quality');
if (qualityParam === 'low' || qualityParam === 'medium' || qualityParam === 'high') {
  (settings.value as { quality: Quality }).quality = qualityParam;
}

const engine = createEngine(canvas, settings);
const renderer = engine.renderer;
api.engine = engine;
window.__viewer = api as ViewerApi;

// ?overlay=1: a placeholder "weapon" in the first-person overlay scene (checks the second
// pass: fixed FOV, cleared depth, light rig).
if (query.get('overlay') === '1') {
  const gun = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.11, 0.5),
    new THREE.MeshLambertMaterial({ color: 0x3a3d42 }),
  );
  gun.position.set(0.2, -0.17, -0.55);
  gun.rotation.set(0.04, 0.12, 0);
  const glove = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshLambertMaterial({ color: BRAND.blue }));
  glove.position.set(0.2, -0.24, -0.38);
  engine.viewScene.add(gun, glove);
}

// --- Top-down view ----------------------------------------------------------------

const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
ortho.up.set(0, 0, -1);
const cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
const cutPlanes = [cutPlane];
const noPlanes: THREE.Plane[] = [];
const savedClear = new THREE.Color();
const TOP_BACKGROUND = new THREE.Color(0x0e141b);

function resetTopView(): void {
  state.topZoom = 1;
  if (mapData) {
    state.topX = (mapData.bounds.min.x + mapData.bounds.max.x) / 2;
    state.topZ = (mapData.bounds.min.z + mapData.bounds.max.z) / 2;
  }
}

function updateOrtho(): void {
  const bounds = mapData?.bounds ?? { min: { x: -10, y: 0, z: -10 }, max: { x: 10, y: 5, z: 10 } };
  const w = canvas.clientWidth || 1;
  const h = canvas.clientHeight || 1;
  const aspect = w / h;
  const sx = (bounds.max.x - bounds.min.x) * 1.06;
  const sz = (bounds.max.z - bounds.min.z) * 1.06;
  let halfH = Math.max(sz / 2, sx / 2 / aspect) / state.topZoom;
  if (!(halfH > 0)) halfH = 10;
  ortho.left = -halfH * aspect;
  ortho.right = halfH * aspect;
  ortho.top = halfH;
  ortho.bottom = -halfH;
  ortho.near = 0.1;
  ortho.far = bounds.max.y - bounds.min.y + 220;
  ortho.position.set(state.topX, bounds.max.y + 100, state.topZ);
  ortho.lookAt(state.topX, bounds.min.y, state.topZ);
  ortho.updateProjectionMatrix();
  ortho.updateMatrixWorld();
}

/**
 * Section fill for the cut view: every box crossed by the cut plane gets a flat quad at
 * the cut height (darkened material colour), so walls read as solid strokes on the plan.
 */
let capMesh: THREE.Mesh | null = null;
let capCut: number | null = null;

function updateCaps(): void {
  if (capMesh && capCut === state.cutY) return;
  if (capMesh) {
    capMesh.removeFromParent();
    capMesh.geometry.dispose();
    (capMesh.material as THREE.Material).dispose();
    capMesh = null;
  }
  capCut = state.cutY;
  const cut = state.cutY;
  if (cut === null || !mapData) return;
  const crossed = mapData.boxes.filter((b) => b.min.y < cut - 1e-4 && b.max.y > cut + 1e-4);
  if (!crossed.length) return;
  const pos = new Float32Array(crossed.length * 12);
  const col = new Float32Array(crossed.length * 12);
  const idx = new Uint32Array(crossed.length * 6);
  const c = new THREE.Color();
  const y = cut - 0.002;
  crossed.forEach((b, k) => {
    c.setHex(materialInfo(b.mat).color).multiplyScalar(0.42);
    const corners = [b.min.x, b.max.z, b.max.x, b.max.z, b.max.x, b.min.z, b.min.x, b.min.z];
    for (let v = 0; v < 4; v++) {
      const o = (k * 4 + v) * 3;
      pos[o] = corners[v * 2]!;
      pos[o + 1] = y;
      pos[o + 2] = corners[v * 2 + 1]!;
      col[o] = c.r;
      col[o + 1] = c.g;
      col[o + 2] = c.b;
    }
    idx.set([k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3], k * 6);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geometry.setIndex(new THREE.BufferAttribute(idx, 1));
  capMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  capMesh.name = 'viewer-cut-caps';
  capMesh.visible = false;
  engine.scene.add(capMesh);
}

function renderTop(): void {
  updateOrtho();
  updateCaps();
  if (capMesh) capMesh.visible = true;
  const sky = engine.scene.getObjectByName('bas-sky');
  const fog = engine.scene.fog;
  const skyVisible = sky ? sky.visible : true;
  if (sky) sky.visible = false;
  engine.scene.fog = null;
  renderer.getClearColor(savedClear);
  renderer.setClearColor(TOP_BACKGROUND, 1);
  if (state.cutY !== null) {
    cutPlane.constant = state.cutY;
    renderer.clippingPlanes = cutPlanes;
  }
  renderer.info.reset();
  renderer.clear();
  renderer.render(engine.scene, ortho);
  renderer.clippingPlanes = noPlanes;
  if (capMesh) capMesh.visible = false;
  renderer.setClearColor(savedClear, 1);
  engine.scene.fog = fog;
  if (sky) sky.visible = skyVisible;
}

// --- Markers (spawns, lights, zones, points) -----------------------------------------

const markers = new THREE.Group();
markers.name = 'viewer-markers';
markers.visible = state.markers;

function buildMarkers(map: MapData): void {
  const teamColors = [BRAND.blue, BRAND.red];
  const cone = new THREE.ConeGeometry(0.28, 0.9, 10);
  cone.rotateX(-Math.PI / 2); // point along -Z (yaw 0)
  for (const s of map.spawns) {
    const mesh = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ color: teamColors[s.team], fog: false }));
    mesh.position.set(s.pos.x, s.pos.y + 0.9, s.pos.z);
    mesh.rotation.y = s.yaw;
    markers.add(mesh);
  }
  const bulb = new THREE.OctahedronGeometry(0.16);
  for (const l of map.lights) {
    const mesh = new THREE.Mesh(bulb, new THREE.MeshBasicMaterial({ color: l.color, fog: false }));
    mesh.position.set(l.pos.x, l.pos.y, l.pos.z);
    markers.add(mesh);
  }
  for (const z of map.zones) {
    const box = new THREE.Box3(new THREE.Vector3(z.min.x, z.min.y, z.min.z), new THREE.Vector3(z.max.x, z.max.y, z.max.z));
    markers.add(new THREE.Box3Helper(box, z.kind === 'site' ? 0xffc21a : z.kind === 'extract' ? 0x3ddc84 : 0xffffff));
  }
  const dot = new THREE.SphereGeometry(0.14, 10, 8);
  for (const p of map.points) {
    const mesh = new THREE.Mesh(dot, new THREE.MeshBasicMaterial({ color: p.kind === 'sample' ? 0x3ddc84 : 0xffffff, fog: false }));
    mesh.position.set(p.pos.x, p.pos.y + 0.2, p.pos.z);
    markers.add(mesh);
  }
  engine.scene.add(markers);
}

// --- UV test pattern -----------------------------------------------------------------

let uvTexture: THREE.CanvasTexture | null = null;
const originalMaps = new Map<THREE.MeshBasicMaterial, THREE.Texture | null>();

function makeUvTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const colors = ['#f4f4f4', '#9fc3e8', '#f0c9a0', '#bfe3c3'];
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      g.fillStyle = colors[j * 2 + i]!;
      g.fillRect(i * 128, j * 128, 128, 128);
    }
  }
  g.strokeStyle = '#1d2733';
  g.lineWidth = 4;
  g.strokeRect(2, 2, 252, 252);
  g.fillStyle = '#1d2733';
  g.font = 'bold 150px Arial, "Liberation Sans", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('F', 128, 136);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function applyUvTest(enabled: boolean): void {
  const world = engine.scene.getObjectByName('bas-world');
  if (!world) return;
  uvTexture ??= makeUvTexture();
  world.traverse((obj) => {
    const mat = (obj as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
    if (!mat || !('map' in mat)) return;
    if (enabled) {
      if (!originalMaps.has(mat)) originalMaps.set(mat, mat.map);
      mat.map = uvTexture;
    } else if (originalMaps.has(mat)) {
      mat.map = originalMaps.get(mat) ?? null;
    }
    mat.needsUpdate = true;
  });
}

// --- Input ------------------------------------------------------------------------------

const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyT') {
    api.setTop(!state.top, state.cutY ?? num('cut'));
  } else if (e.code === 'KeyM') {
    state.markers = !state.markers;
    markers.visible = state.markers;
  } else if (e.code === 'KeyU') {
    state.uvTest = !state.uvTest;
    applyUvTest(state.uvTest);
  }
  keys.add(e.code);
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
canvas.addEventListener('click', () => {
  if (document.pointerLockElement !== canvas) void canvas.requestPointerLock();
});
window.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas || state.top) return;
  state.yaw -= e.movementX * 0.0022;
  state.pitch = Math.max(-1.55, Math.min(1.55, state.pitch - e.movementY * 0.0022));
});
window.addEventListener(
  'wheel',
  (e) => {
    const k = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    if (state.top) state.topZoom = Math.max(0.5, Math.min(40, state.topZoom * k));
    else state.speed = Math.max(0.5, Math.min(80, state.speed * k));
  },
  { passive: true },
);
window.addEventListener('resize', () => engine.resize());

function updateCamera(dt: number): void {
  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const r = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const u = (keys.has('Space') ? 1 : 0) - (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1 : 0);
  if (state.top) {
    const pan = ((ortho.top - ortho.bottom) * 0.6 * dt) / 1;
    state.topX += r * pan;
    state.topZ -= f * pan;
    return;
  }
  const boost = keys.has('ControlLeft') ? 3 : 1;
  const step = state.speed * boost * dt;
  const cp = Math.cos(state.pitch);
  // Forward follows the view direction; strafing stays horizontal (shared/math/vec3 conventions).
  state.x += (-Math.sin(state.yaw) * cp * f + Math.cos(state.yaw) * r) * step;
  state.y += (Math.sin(state.pitch) * f + u) * step;
  state.z += (-Math.cos(state.yaw) * cp * f - Math.sin(state.yaw) * r) * step;
}

// --- Loop -------------------------------------------------------------------------------

let last = performance.now();
let fpsFrames = 0;
let fpsTime = 0;
let overlayTime = 0;
let loaded = false;

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  updateCamera(dt);

  if (state.top) {
    renderTop();
  } else {
    engine.camera.position.set(state.x, state.y, state.z);
    engine.camera.rotation.set(state.pitch, state.yaw, 0, 'YXZ');
    engine.render();
  }
  state.drawCalls = renderer.info.render.calls;
  state.triangles = renderer.info.render.triangles;

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    state.fps = fpsFrames / fpsTime;
    fpsFrames = 0;
    fpsTime = 0;
  }
  if (loaded) {
    api.frame++;
    if (!api.ready) api.ready = true;
  }
  overlayTime += dt;
  if (overlayTime >= 0.2) {
    overlayTime = 0;
    const name = mapData ? `${mapData.meta.name} (${mapData.meta.id})` : state.mapId;
    const view = state.top
      ? `Vue de dessus · coupe ${state.cutY === null ? 'aucune' : `${state.cutY.toFixed(2)} m`} · zoom ×${state.topZoom.toFixed(2)}`
      : `Position : x ${state.x.toFixed(2)}  y ${state.y.toFixed(2)}  z ${state.z.toFixed(2)} · cap ${(state.yaw / DEG).toFixed(1)}° · site ${(state.pitch / DEG).toFixed(1)}°\nVitesse : ${state.speed.toFixed(1)} m/s`;
    overlay.textContent = `Carte : ${name}\n${state.fps.toFixed(0)} images/s · ${state.drawCalls} appels de dessin · ${state.triangles.toLocaleString('fr-FR')} triangles\n${view}`;
  }
}

help.textContent =
  'Clic : capturer la souris · ZQSD / WASD : se déplacer · Espace / Maj : monter / descendre\nMolette : vitesse · Ctrl : accélérer · T : vue de dessus · M : repères · U : mire UV · Échap : libérer la souris';

async function start(): Promise<void> {
  let map: MapData;
  if (state.mapId === 'gallery') map = buildGallery();
  else if (hasMap(state.mapId)) map = getMap(state.mapId);
  else throw new Error(`Carte inconnue : « ${state.mapId} »`);
  mapData = map;

  // The collision world is optional here: the renderer does not need it for phase-1 lighting.
  let world: CollisionWorld | null = null;
  try {
    world = new CollisionWorld(map.solids);
  } catch (err) {
    console.warn('CollisionWorld indisponible :', (err as Error).message);
  }

  await engine.loadMap(map, world as CollisionWorld, (fraction, label) => {
    loadingLabel.textContent = label;
    loadingFill.style.width = `${Math.round(fraction * 100)}%`;
  });

  // Initial pose: query string, else the first spawn, else the middle of the map.
  const spawn = map.spawns[0];
  const cx = (map.bounds.min.x + map.bounds.max.x) / 2;
  const cz = (map.bounds.min.z + map.bounds.max.z) / 2;
  api.setPose(
    num('x') ?? spawn?.pos.x ?? cx,
    num('y') ?? (spawn ? spawn.pos.y + 1.64 : map.bounds.min.y + 2),
    num('z') ?? spawn?.pos.z ?? cz,
    num('yaw') ?? (spawn ? spawn.yaw / DEG : 0),
    num('pitch') ?? 0,
  );
  buildMarkers(map);
  if (state.uvTest) applyUvTest(true);
  resetTopView();
  if (query.get('top') === '1') api.setTop(true, num('cut'));

  loading.classList.add('hidden');
  loaded = true;
}

requestAnimationFrame(frame);
start().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  api.error = message;
  loading.classList.add('error');
  loadingLabel.textContent = `Échec du chargement : ${message}`;
  console.error(err);
});
