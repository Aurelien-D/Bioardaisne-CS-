/**
 * GPU side of the baked lighting: wraps the atlas produced by bake.ts in a texture.
 *
 * The atlas is stored sRGB-encoded (far better precision in the dark than linear bytes)
 * and decoded by the GPU before filtering. MeshBasicMaterial computes
 *   texture × vertexColour × lightMapTexel × lightMapIntensity / PI
 * with the lightmap sampled through the `uv1` attribute (texture.channel = 1), so
 * `baked.intensity` (= LIGHTMAP_RANGE × PI) restores the baked light value, over-bright
 * included.
 */
import * as THREE from 'three';
import type { BakeResult } from './bake';

export function createLightmapTexture(baked: BakeResult): THREE.DataTexture {
  const texture = new THREE.DataTexture(baked.data, baked.width, baked.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = 'bas-lightmap';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.channel = 1;
  texture.needsUpdate = true;
  return texture;
}
