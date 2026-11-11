/**
 * Photographic PBR textures (CC0, Poly Haven and ambientCG) for the most visible surfaces:
 * albedo + normal + roughness at 1k, served from /media/tex. They replace the
 * procedural canvases when they could be loaded; otherwise the procedural texture is kept.
 */
import * as THREE from 'three';
import { MATERIALS, type MaterialId } from '../../../shared/maps/materials';

interface PhotoDef {
  set: string;
  /** Metres covered by one repeat of the photo. */
  size: number;
  /** 'match' = recolour a neutral photo to the material's reference colour; number = brightness factor. */
  tint?: 'match' | number;
}

const PLASTER: PhotoDef = { set: 'plastered_wall_04', size: 3, tint: 'match' };
const FACADE: PhotoDef = { set: 'beige_wall_001', size: 3, tint: 'match' };
const TERRAZZO: PhotoDef = { set: 'Terrazzo013', size: 1.0, tint: 'match' };
const CARPET: PhotoDef = { set: 'Carpet016', size: 1.2, tint: 'match' };
const PHOTO: Partial<Record<MaterialId, PhotoDef>> = {
  asphalt: { set: 'asphalt_02', size: 3.2, tint: 0.85 },
  sidewalk: { set: 'concrete_pavement', size: 2.4 },
  concrete_floor: { set: 'concrete_floor_02', size: 3.2, tint: 1.1 },
  concrete: { set: 'concrete_wall_008', size: 2.6 },
  concrete_dark: { set: 'concrete_wall_008', size: 2.6, tint: 0.6 },
  brick_red: { set: 'brick_wall_001', size: 1.7, tint: 1.25 },
  brick_brown: { set: 'brick_wall_001', size: 1.7 },
  tile_beige: { set: 'interior_tiles', size: 2.4, tint: 1.2 },
  shutter: { set: 'painted_metal_shutter', size: 2, tint: 'match' },
  tile_white: { set: 'large_floor_tiles_02', size: 2.4, tint: 1.7 },
  gravel: { set: 'gravel_floor_02', size: 2.2 },
  // ambientCG (CC0)
  ceiling_tile: { set: 'OfficeCeiling001', size: 3 },
  lino_grey: TERRAZZO,
  lino_green: TERRAZZO,
  lino_blue: TERRAZZO,
  carpet_grey: CARPET,
  carpet_blue: CARPET,
  metal_brushed: { set: 'Metal009', size: 1.2 },
  metal_grey: { set: 'Metal009', size: 1.2, tint: 'match' },
  metal_dark: { set: 'Metal009', size: 1.2, tint: 'match' },
  wood_dark: { set: 'Wood051', size: 1.5, tint: 1.3 },
  metal_red: { set: 'PaintedMetal004', size: 1.5, tint: 0.8 },
  plaster_white: PLASTER,
  plaster_cream: PLASTER,
  plaster_blue: PLASTER,
  plaster_grey: PLASTER,
  plaster_green: PLASTER,
  facade_cream: FACADE,
  facade_grey: FACADE,
  facade_white: FACADE,
  facade_pink: FACADE,
};
/** Average colour of the neutral photos (to recolour them). */
const AVERAGE: Record<string, number> = { plastered_wall_04: 0x8c8a87, beige_wall_001: 0x9e8c78, painted_metal_shutter: 0x808386, Terrazzo013: 0xd1ccc7, Carpet016: 0xbcb093, Metal009: 0x929598 };

interface Loaded {
  map: THREE.Texture;
  nor: THREE.Texture;
  rough: THREE.Texture;
}
const sets = new Map<string, Loaded | null>();
const pending = new Map<string, Promise<void>>();

const base = (): string => new URL('media/tex/', document.baseURI).href;

async function loadSet(name: string, anisotropy: number): Promise<void> {
  const loader = new THREE.TextureLoader();
  const one = async (suffix: string, srgb: boolean): Promise<THREE.Texture> => {
    const t = await loader.loadAsync(`${base()}${name}_${suffix}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = anisotropy;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  try {
    const [map, nor, rough] = await Promise.all([one('diff', true), one('nor', false), one('rough', false)]);
    sets.set(name, { map, nor, rough });
  } catch {
    sets.set(name, null); // offline / missing file: the procedural texture stays
  }
}

/** Load (once) the photo sets needed by these materials. Never rejects. */
export async function preloadPhotoTextures(ids: Iterable<MaterialId>, anisotropy = 8): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const id of ids) {
    const def = PHOTO[id];
    if (!def || sets.has(def.set)) continue;
    let p = pending.get(def.set);
    if (!p) pending.set(def.set, (p = loadSet(def.set, anisotropy)));
    jobs.push(p);
  }
  const timeout = new Promise<void>((r) => setTimeout(r, 20000));
  await Promise.race([Promise.all(jobs).then(() => undefined), timeout]);
}

export interface PhotoSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  color: THREE.Color;
}

const perMaterial = new Map<MaterialId, PhotoSet>();

/** Photo textures for a material (clones scaled to the material's UV tiling), or null. */
export function photoSet(id: MaterialId): PhotoSet | null {
  const hit = perMaterial.get(id);
  if (hit) return hit;
  const def = PHOTO[id];
  const src = def ? sets.get(def.set) : null;
  if (!def || !src) return null;
  // World UVs repeat every `tile` metres: rescale so the photo covers `size` metres.
  const k = (MATERIALS[id].tile ?? 1) / def.size;
  const clone = (t: THREE.Texture): THREE.Texture => {
    const c = t.clone();
    c.repeat.set(k, k);
    c.needsUpdate = true;
    return c;
  };
  const color = new THREE.Color(1, 1, 1);
  if (def.tint === 'match') {
    const want = new THREE.Color(MATERIALS[id].color);
    const avg = new THREE.Color(AVERAGE[def.set] ?? 0x999999);
    color.setRGB(Math.min(2.4, want.r / avg.r), Math.min(2.4, want.g / avg.g), Math.min(2.4, want.b / avg.b));
  } else if (typeof def.tint === 'number') color.setScalar(def.tint);
  const set: PhotoSet = { map: clone(src.map), normalMap: clone(src.nor), roughnessMap: clone(src.rough), color };
  perMaterial.set(id, set);
  return set;
}
