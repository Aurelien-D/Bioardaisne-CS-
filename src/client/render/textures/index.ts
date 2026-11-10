/**
 * Procedural material textures — MINIMAL PROVIDER (phase 1).
 *
 * One canvas-generated texture per MaterialId: the reference colour of the material
 * with a subtle tileable grain. The full procedural texture set replaces the internals
 * of this file; the two exports below are the whole public surface and must be kept:
 *
 *   getMaterialTexture(id, quality): THREE.Texture   (cached)
 *   disposeMaterialTextures(): void
 *
 * Conventions the world renderer relies on:
 *  - RepeatWrapping on both axes, sRGB colour space, mipmaps, anisotropy by quality;
 *  - one texture repeat covers MATERIALS[id].tile metres (the world builder scales UVs),
 *    except "object" materials (doors, windows, screens, shutters, light panels) whose
 *    texture is stretched once over the face — see render/world/faces.ts;
 *  - textures are opaque RGB: the opacity of glass / water is set by the world material.
 */
import * as THREE from 'three';
import { MATERIALS, type MaterialId, type MaterialInfo } from '../../../shared/maps/materials';
import { mulberry32 } from '../../../shared/math/rng';
import type { Quality } from '../../core/settings';

const SIZE: Record<Quality, number> = { low: 64, medium: 128, high: 128 };
const ANISOTROPY: Record<Quality, number> = { low: 1, medium: 4, high: 8 };

const cache = new Map<string, THREE.CanvasTexture>();

function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Tileable value noise on a `cells` × `cells` lattice, bilinear with smoothstep, range 0..1. */
function makeLattice(cells: number, rng: () => number): (u: number, v: number) => number {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  return (u: number, v: number): number => {
    const x = u * cells;
    const y = v * cells;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    let fx = x - x0;
    let fy = y - y0;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const xa = ((x0 % cells) + cells) % cells;
    const ya = ((y0 % cells) + cells) % cells;
    const xb = (xa + 1) % cells;
    const yb = (ya + 1) % cells;
    const a = g[ya * cells + xa]!;
    const b = g[ya * cells + xb]!;
    const c = g[yb * cells + xa]!;
    const d = g[yb * cells + xb]!;
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

function drawMaterial(id: MaterialId, size: number): HTMLCanvasElement {
  const info: MaterialInfo = MATERIALS[id];
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const rng = mulberry32(hashString(id));
  const coarse = makeLattice(4, rng);
  const fine = makeLattice(16, rng);

  const r0 = (info.color >> 16) & 255;
  const g0 = (info.color >> 8) & 255;
  const b0 = info.color & 255;
  // Emissive surfaces stay clean; rough surfaces get a little more grain.
  const rough = info.surf === 'concrete' || info.surf === 'dirt' || info.surf === 'grass' || info.surf === 'gravel' || info.surf === 'foliage' || info.surf === 'carpet';
  const amp = info.emissive ? 0.012 : rough ? 0.075 : 0.035;
  const grain = info.emissive ? 0 : rough ? 0.05 : 0.02;

  let p = 0;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const n = (coarse(u, v) - 0.5) * 1.2 + (fine(u, v) - 0.5) * 0.8;
      const k = 1 + n * amp + (rng() - 0.5) * grain;
      data[p++] = Math.max(0, Math.min(255, r0 * k));
      data[p++] = Math.max(0, Math.min(255, g0 * k));
      data[p++] = Math.max(0, Math.min(255, b0 * k));
      data[p++] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Texture of a material (created on first use, then cached per quality level). */
export function getMaterialTexture(id: MaterialId, quality: Quality): THREE.Texture {
  const key = `${id}|${quality}`;
  let tex = cache.get(key);
  if (!tex) {
    tex = new THREE.CanvasTexture(drawMaterial(id, SIZE[quality]));
    tex.name = `mat:${id}`;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = ANISOTROPY[quality];
    tex.needsUpdate = true;
    cache.set(key, tex);
  }
  return tex;
}

/** Free every cached texture (GPU memory included). */
export function disposeMaterialTextures(): void {
  for (const tex of cache.values()) tex.dispose();
  cache.clear();
}
