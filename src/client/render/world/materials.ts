/**
 * World materials: one unlit THREE.MeshBasicMaterial per MaterialId
 * (texture × vertex colour, where the vertex colour carries tint × baked light).
 *
 *  - opaque materials: plain basic material;
 *  - transparent materials (MATERIALS[id].transparent): alpha blending, no depth write;
 *    the opacity comes from OPACITY below (textures are opaque RGB);
 *  - water: same, plus a gentle animated shimmer (shader patch driven by `update(time)`);
 *  - emissive materials need nothing special: their vertex colours are left full-bright.
 *
 * A lightmap can be attached to every material with `setLightMap()` (used by the
 * light-mapping pass together with the uv1 set written by faces.ts).
 */
import * as THREE from 'three';
import { materialInfo, type MaterialId } from '../../../shared/maps/materials';
import type { Quality } from '../../core/settings';
import { getMaterialTexture } from '../textures';

const OPACITY: Partial<Record<MaterialId, number>> = {
  glass: 0.32,
  glass_frosted: 0.72,
  water: 0.82,
};
const DEFAULT_OPACITY = 0.5;

const WATER_MAP_FRAGMENT = /* glsl */ `
#ifdef USE_MAP
	float basT = basTime;
	// Two layers of the texture drifting in different directions, gently wobbling.
	vec2 basWobble = vec2( sin( vMapUv.y * 6.2832 + basT * 0.7 ), cos( vMapUv.x * 6.2832 + basT * 0.6 ) ) * 0.02;
	vec4 basA = texture2D( map, vMapUv + basWobble + vec2( basT * 0.012, basT * 0.007 ) );
	vec4 basB = texture2D( map, vMapUv * 1.37 - basWobble + vec2( - basT * 0.009, basT * 0.011 ) );
	vec4 sampledDiffuseColor = mix( basA, basB, 0.5 );
	// Ripples: a slow swell plus a net of thin bright crests where wave trains cross.
	vec2 basP = vMapUv * 12.5664;
	float basSwell = sin( basP.x * 0.9 + basP.y * 0.5 + basT * 0.8 ) + sin( basP.y * 1.1 - basP.x * 0.4 - basT * 0.65 );
	float basC1 = 1.0 - abs( sin( basP.x * 1.15 + basP.y * 0.55 + basT * 0.45 ) );
	float basC2 = 1.0 - abs( sin( basP.y * 1.45 - basP.x * 0.35 - basT * 0.38 ) );
	float basC3 = 1.0 - abs( sin( ( basP.x - basP.y ) * 0.85 + basT * 0.3 ) );
	float basCrest = pow( basC1 * basC2 + 0.6 * basC2 * basC3, 3.0 );
	sampledDiffuseColor.rgb *= 1.0 + 0.045 * basSwell;
	sampledDiffuseColor.rgb += vec3( 0.45, 0.68, 0.74 ) * 0.11 * basCrest;
	diffuseColor *= sampledDiffuseColor;
	diffuseColor.a = clamp( diffuseColor.a + 0.03 * basSwell + 0.05 * basCrest, 0.0, 1.0 );
#endif
`;

export class WorldMaterials {
  private readonly materials = new Map<MaterialId, THREE.MeshBasicMaterial>();
  private readonly time = { value: 0 };
  private quality: Quality;
  private lightMap: THREE.Texture | null = null;
  private lightMapIntensity = 1;

  constructor(quality: Quality) {
    this.quality = quality;
  }

  /** Material for a MaterialId (created on first use). */
  get(id: MaterialId): THREE.MeshBasicMaterial {
    let m = this.materials.get(id);
    if (m) return m;
    const info = materialInfo(id);
    m = new THREE.MeshBasicMaterial({
      map: getMaterialTexture(id, this.quality),
      vertexColors: true,
    });
    m.name = `world:${id}`;
    if (info.transparent) {
      m.transparent = true;
      m.depthWrite = false;
      m.opacity = OPACITY[id] ?? DEFAULT_OPACITY;
    }
    if (info.surf === 'water') this.patchWater(m);
    if (this.lightMap) {
      m.lightMap = this.lightMap;
      m.lightMapIntensity = this.lightMapIntensity;
    }
    this.materials.set(id, m);
    return m;
  }

  private patchWater(m: THREE.MeshBasicMaterial): void {
    const time = this.time;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.basTime = time;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float basTime;')
        .replace('#include <map_fragment>', WATER_MAP_FRAGMENT);
    };
    m.customProgramCacheKey = () => 'bas-water';
  }

  /**
   * Attach a lightmap to every world material (existing and future). The geometry must
   * carry a `uv1` attribute (the texture is switched to UV channel 1 here).
   * MeshBasicMaterial computes texture × vertexColour × lightMapTexel × lightMapIntensity / PI,
   * so with the default intensity (PI) a texel of 1.0 leaves the colour unchanged.
   */
  setLightMap(texture: THREE.Texture | null, intensity = Math.PI): void {
    if (texture) texture.channel = 1; // sample with the uv1 attribute
    this.lightMap = texture;
    this.lightMapIntensity = intensity;
    for (const m of this.materials.values()) {
      m.lightMap = texture;
      m.lightMapIntensity = intensity;
      m.needsUpdate = true;
    }
  }

  /** Re-fetch the textures for another quality level. */
  setQuality(quality: Quality): void {
    if (quality === this.quality) return;
    this.quality = quality;
    for (const [id, m] of this.materials) {
      m.map = getMaterialTexture(id, quality);
      m.needsUpdate = true;
    }
  }

  /** Per-frame animation (water shimmer). */
  update(timeSeconds: number): void {
    this.time.value = timeSeconds;
  }

  /** Dispose the materials (the shared textures belong to the texture provider). */
  dispose(): void {
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
  }
}
