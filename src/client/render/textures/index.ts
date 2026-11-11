/**
 * Procedural material textures.
 *
 * Every MaterialId of shared/maps/materials.ts has a generator (see registry.ts) that
 * draws it on a canvas: seamless, deterministic (seeded by the material id), canvas 2D
 * only. Textures are generated lazily and cached per (id, quality). Public surface:
 *
 *   getMaterialTexture(id, quality): THREE.Texture   (cached)
 *   disposeMaterialTextures(): void
 *
 * Conventions the world renderer relies on:
 *  - RepeatWrapping on both axes, sRGB colour space, mipmaps, anisotropy by quality;
 *  - one texture repeat covers MATERIALS[id].tile metres (the world builder scales UVs),
 *    except "object" materials (doors, windows, screens, shutters, light panels) whose
 *    texture is stretched once over the face — see render/world/faces.ts;
 *  - textures are opaque RGB: the opacity of glass / water is set by the world material;
 *  - the world is drawn unlit as texture × baked light, so the mean colour of a surface
 *    texture is kept equal to MATERIALS[id].color.
 *
 * Resolution: 128 / 256 / 512 texels for low / medium / high quality, doubled for the
 * few materials whose repeat covers 4 m (registry.LARGE_TILE).
 */
import * as THREE from 'three';
import type { MaterialId } from '../../../shared/maps/materials';
import type { Quality } from '../../core/settings';
import { clearNoiseCache } from './noise';
import { Painter } from './painter';
import { GENERATORS, LARGE_TILE } from './registry';

const SIZE: Record<Quality, number> = { low: 128, medium: 256, high: 512 };
const ANISOTROPY: Record<Quality, number> = { low: 1, medium: 4, high: 8 };

const cache = new Map<string, THREE.CanvasTexture>();

function drawMaterial(id: MaterialId, quality: Quality): HTMLCanvasElement {
  const size = SIZE[quality] * (LARGE_TILE[id] ? 2 : 1);
  const painter = new Painter(id, size);
  GENERATORS[id](painter);
  painter.flush();
  return painter.canvas;
}

/** Texture of a material (created on first use, then cached per quality level). */
export function getMaterialTexture(id: MaterialId, quality: Quality): THREE.Texture {
  const key = `${id}|${quality}`;
  let tex = cache.get(key);
  if (!tex) {
    tex = new THREE.CanvasTexture(drawMaterial(id, quality));
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

/** Free every cached texture (GPU memory included) and the shared noise fields. */
export function disposeMaterialTextures(): void {
  for (const tex of cache.values()) tex.dispose();
  cache.clear();
  clearNoiseCache();
}
