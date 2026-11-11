/**
 * World materials: one physically based THREE.MeshStandardMaterial per MaterialId.
 * Diffuse light is baked (lightmap for box faces, vertex colours for the rest); on top
 * of it the material receives the real-time sun (with shadows), a normal map derived
 * from the albedo texture, and environment reflections scaled by roughness / metalness.
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
import type { ReflectionUniforms } from './reflection';
import * as THREE from 'three';
import { materialInfo, type MaterialId } from '../../../shared/maps/materials';
import type { Quality } from '../../core/settings';
import { getMaterialTexture } from '../textures';
import { photoSet } from '../textures/photo';

const OPACITY: Partial<Record<MaterialId, number>> = {
  glass: 0.32,
  glass_frosted: 0.72,
  water: 0.82,
};
const DEFAULT_OPACITY = 0.5;

/** Roughness / metalness / relief strength per surface type. */
const SURFACE_PBR: Record<string, [rough: number, metal: number, bump: number]> = {
  concrete: [0.9, 0, 1.2],
  tile: [0.22, 0, 0.9],
  lino: [0.2, 0, 0.25],
  carpet: [1, 0, 0.9],
  wood: [0.55, 0, 0.7],
  metal: [0.38, 0.85, 0.5],
  glass: [0.06, 0, 0.1],
  plaster: [0.92, 0, 0.5],
  plastic: [0.42, 0, 0.3],
  fabric: [1, 0, 0.9],
  cardboard: [0.95, 0, 0.8],
  dirt: [1, 0, 1.4],
  grass: [1, 0, 1.4],
  gravel: [1, 0, 1.6],
  water: [0.05, 0, 0.3],
  foliage: [0.9, 0, 1.2],
};
const PBR_OVERRIDE: Partial<Record<MaterialId, [number, number, number]>> = {
  laminate_white: [0.3, 0, 0.2],
  laminate_grey: [0.35, 0, 0.2],
  metal_white: [0.35, 0.25, 0.2],
  metal_brushed: [0.3, 1, 0.5],
  asphalt: [0.85, 0, 1.6],
  cobble: [0.8, 0, 2.2],
  brick_red: [0.9, 0, 2.2],
  brick_brown: [0.9, 0, 2.2],
  ceiling_tile: [0.95, 0, 0.8],
  wall_lab_panel: [0.45, 0, 0.5],
  window_facade: [0.15, 0.2, 0.6],
  shopfront: [0.1, 0.3, 0.3],
};

/** Surfaces found outdoors: they keep the sky as reflection; everything else mirrors the interior probe. */
const EXTERIOR = new Set<string>([
  'asphalt', 'sidewalk', 'cobble', 'paving_stone', 'grass', 'dirt', 'gravel', 'water', 'brick_red', 'brick_brown',
  'stone_yellow', 'stone_grey', 'stone_white', 'facade_cream', 'facade_grey', 'facade_white', 'facade_pink', 'facade_blue',
  'slate_roof', 'roof_tile_red', 'window_facade', 'window_lit', 'shopfront', 'shutter', 'hedge', 'foliage', 'bark',
  'metal_green', 'metal_rust', 'metal_blue', 'metal_red', 'rubber_black',
]);

/** World shaders: no hemisphere / diffuse IBL (ambient is baked), reflections dimmed where the baked light is dark. */
const LIGHTS_BEGIN = THREE.ShaderChunk.lights_fragment_begin.replace(
  'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );',
  '',
);
const LIGHTS_MAPS =
  THREE.ShaderChunk.lights_fragment_maps
    .replace('iblIrradiance += getIBLIrradiance( geometryNormal );', '')
    .replace(
      'radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );',
      `radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#ifdef USE_LIGHTMAP
		radiance *= clamp( dot( lightMapTexel.rgb, vec3( 0.3333 ) ) * lightMapIntensity * 0.42, 0.04, 1.0 );
	#endif`,
    ) + '\n__BAS_REFLECT_APPLY__';

/**
 * Glossy floors: where a planar reflection of the scene is available (reflection.ts) and the
 * fragment lies on the mirrored floor, it replaces the static probe. Mip level = blur by roughness.
 */
const REFLECTIVE_SURF = new Set(['lino', 'tile']);
const REFLECTIVE_ID = new Set<string>(['asphalt', 'sidewalk', 'concrete_floor', 'paving_stone', 'cobble', 'parquet']);
const REFLECT_PARS = /* glsl */ `
#ifdef BAS_REFLECT
	uniform sampler2D basRefl;
	uniform mat4 basReflMatrix;
	uniform float basReflPlane;
	uniform float basReflOn;
#endif
`;
/** A glossy floor facing a low sun: keep the glare from bleaching the whole ground. */
const SPEC_CLAMP = /* glsl */ `
#ifdef BAS_REFLECT
	reflectedLight.directSpecular = min( reflectedLight.directSpecular, vec3( BAS_SPEC_MAX ) );
#endif
`;
const REFLECT_APPLY = /* glsl */ `
#if defined( BAS_REFLECT ) && defined( RE_IndirectSpecular )
	if ( basReflOn > 0.5 ) {
		vec3 basWp = ( vec4( - vViewPosition, 0.0 ) * viewMatrix ).xyz + cameraPosition;
		vec3 basWn = inverseTransformDirection( normal, viewMatrix );
		if ( abs( basWp.y - basReflPlane ) < 0.3 && basWn.y > 0.6 ) {
			vec4 basRc = basReflMatrix * vec4( basWp.x, basReflPlane, basWp.z, 1.0 );
			// The surface relief (normal map) ripples the mirror image.
			vec2 basRuv = basRc.xy / basRc.w + basWn.xz * 0.045;
			float basLod = clamp( material.roughness * 8.5 - 0.6, 0.0, 6.5 );
			radiance = textureLod( basRefl, clamp( basRuv, 0.002, 0.998 ), basLod ).rgb * BAS_REFLECT_GAIN;
		}
	}
#endif
`;

/**
 * Status lights and screens are not frozen: each lamp gets its own rhythm from its position
 * (breathing green "ready" LEDs, blinking red alarms, flickering blue activity lights, a
 * faint shimmer on screens).
 */
const BLINK: Partial<Record<MaterialId, string>> = {
  led_green: '0.72 + 0.28 * sin( basTime * 2.1 + basPh * 6.2832 )',
  led_red: '0.12 + 0.88 * step( 0.5, fract( basTime * 0.85 + basPh ) )',
  led_blue: '0.3 + 0.7 * step( 0.45, fract( sin( floor( basTime * 9.0 + basPh * 23.0 ) * 12.9898 ) * 43758.5453 ) )',
  screen_on: '0.95 + 0.05 * sin( basTime * 31.0 + basPh * 6.2832 )',
};
const blinkChunk = (expr: string): string => /* glsl */ `#include <emissivemap_fragment>
	{
		vec3 basLp = ( vec4( - vViewPosition, 0.0 ) * viewMatrix ).xyz + cameraPosition;
		float basPh = fract( sin( dot( floor( basLp * 2.5 ), vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 );
		totalEmissiveRadiance *= ${expr};
	}`;

const normalCache = new Map<string, THREE.CanvasTexture>();

/** Tangent-space normal map derived from the luminance of an albedo canvas (Sobel filter). */
function normalMapFor(id: MaterialId, quality: Quality, albedo: THREE.Texture, strength: number): THREE.Texture | null {
  const key = `${id}|${quality}`;
  const hit = normalCache.get(key);
  if (hit) return hit;
  const src = albedo.image as HTMLCanvasElement | undefined;
  if (!src || typeof src.getContext !== 'function' || strength <= 0) return null;
  const w = src.width;
  const h = src.height;
  const ctx = src.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const px = ctx.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = (px[i * 4]! * 0.3 + px[i * 4 + 1]! * 0.59 + px[i * 4 + 2]! * 0.11) / 255;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d')!;
  const img = octx.createImageData(w, h);
  const k = strength * 2.2;
  for (let y = 0; y < h; y++) {
    const ym = ((y - 1 + h) % h) * w;
    const yp = ((y + 1) % h) * w;
    const y0 = y * w;
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w;
      const xp = (x + 1) % w;
      const dx = (lum[ym + xp]! + 2 * lum[y0 + xp]! + lum[yp + xp]! - lum[ym + xm]! - 2 * lum[y0 + xm]! - lum[yp + xm]!) * k;
      const dy = (lum[yp + xm]! + 2 * lum[yp + x]! + lum[yp + xp]! - lum[ym + xm]! - 2 * lum[ym + x]! - lum[ym + xp]!) * k;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const o = (y0 + x) * 4;
      img.data[o] = (-dx * inv * 0.5 + 0.5) * 255;
      img.data[o + 1] = (dy * inv * 0.5 + 0.5) * 255;
      img.data[o + 2] = (inv * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(out);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = albedo.anisotropy;
  tex.needsUpdate = true;
  normalCache.set(key, tex);
  return tex;
}

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
  private readonly materials = new Map<MaterialId, THREE.MeshStandardMaterial>();
  private readonly time = { value: 0 };
  private quality: Quality;
  private lightMap: THREE.Texture | null = null;
  private lightMapIntensity = 1;
  private interiorEnv: THREE.Texture | null = null;
  private reflection: ReflectionUniforms | null = null;

  constructor(quality: Quality) {
    this.quality = quality;
  }

  /** Material for a MaterialId (created on first use). */
  get(id: MaterialId): THREE.MeshStandardMaterial {
    let m = this.materials.get(id);
    if (m) return m;
    const info = materialInfo(id);
    const map = getMaterialTexture(id, this.quality);
    const [rough, metal, bump] = PBR_OVERRIDE[id] ?? SURFACE_PBR[info.surf] ?? [0.8, 0, 0.5];
    m = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: rough, metalness: metal, envMapIntensity: 0.9 });
    m.name = `world:${id}`;
    if (info.emissive) {
      // Self-illuminated surfaces (light panels, screens): the texture glows and feeds the bloom.
      m.emissive = new THREE.Color(0xffffff);
      m.emissiveMap = map;
      m.emissiveIntensity = id === 'light_panel' || id === 'light_warm' ? 1.35 : 1.0;
      m.color.setScalar(0.2);
    } else if (this.quality !== 'low') {
      const photo = photoSet(id);
      if (photo) {
        // Photographic PBR set: albedo, normal and roughness maps.
        m.map = photo.map;
        m.normalMap = photo.normalMap;
        m.roughnessMap = photo.roughnessMap;
        m.roughness = 1;
        m.color.copy(photo.color);
      } else {
        const n = normalMapFor(id, this.quality, map, bump);
        if (n) {
          m.normalMap = n;
          m.normalScale.set(1, 1);
        }
      }
    }
    if (info.transparent) {
      m.transparent = true;
      m.depthWrite = false;
      m.opacity = OPACITY[id] ?? DEFAULT_OPACITY;
    }
    const water = info.surf === 'water';
    const time = this.time;
    const reflective = !info.transparent && !info.emissive && (REFLECTIVE_SURF.has(info.surf) || REFLECTIVE_ID.has(id));
    const blink = this.quality !== 'low' ? BLINK[id] : undefined;
    if (reflective) {
      // Outdoor ground is damp after a shower: smoother than the dry photo, so it mirrors the low sun.
      const outdoor = id === 'asphalt' || id === 'sidewalk' || id === 'paving_stone' || id === 'cobble';
      if (outdoor) m.roughness *= id === 'asphalt' ? 0.7 : 0.78;
      m.defines = { ...m.defines, BAS_REFLECT: '', BAS_REFLECT_GAIN: outdoor ? '0.9' : '1.0', BAS_SPEC_MAX: outdoor ? '0.55' : '2.5' };
    }
    m.onBeforeCompile = (shader) => {
      const refl = this.reflection;
      if (reflective && refl) {
        shader.uniforms.basRefl = refl.basRefl;
        shader.uniforms.basReflMatrix = refl.basReflMatrix;
        shader.uniforms.basReflPlane = refl.basReflPlane;
        shader.uniforms.basReflOn = refl.basReflOn;
      }
      const usesRefl = reflective && refl !== null;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', usesRefl ? `#include <common>\n${REFLECT_PARS}` : '#include <common>')
        .replace('#include <lights_fragment_begin>', LIGHTS_BEGIN)
        .replace('#include <lights_fragment_maps>', LIGHTS_MAPS.replace('__BAS_REFLECT_APPLY__', (reflective ? SPEC_CLAMP : '') + (usesRefl ? REFLECT_APPLY : '')));
      if (water) {
        shader.uniforms.basTime = time;
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float basTime;')
          .replace('#include <map_fragment>', WATER_MAP_FRAGMENT);
      }
      if (blink) {
        shader.uniforms.basTime = time;
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float basTime;')
          .replace('#include <emissivemap_fragment>', blinkChunk(blink));
      }
    };
    m.customProgramCacheKey = () => (water ? 'bas-world-water' : blink ? `bas-world-blink-${id}` : reflective ? (this.reflection ? 'bas-world-refl' : 'bas-world-gloss') : 'bas-world');
    if (this.lightMap) {
      m.lightMap = this.lightMap;
      m.lightMapIntensity = this.lightMapIntensity;
    }
    if (this.interiorEnv && !EXTERIOR.has(id)) {
      m.envMap = this.interiorEnv;
      m.envMapIntensity = 1.15;
    }
    this.materials.set(id, m);
    return m;
  }

  /**
   * Attach a lightmap to every world material (existing and future). The geometry must
   * carry a `uv1` attribute (the texture is switched to UV channel 1 here).
   * The material computes albedo × lightMapTexel × lightMapIntensity / PI for the baked
   * light, so with the default intensity (PI) a texel of 1.0 leaves the colour unchanged.
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
      if (m.roughnessMap) continue; // photographic set: independent of the quality level
      m.map = getMaterialTexture(id, quality);
      if (m.emissiveMap) m.emissiveMap = m.map;
      m.needsUpdate = true;
    }
  }

  /**
   * Reflection probe captured inside the building: glossy interior surfaces mirror the
   * room (ceiling lights, walls) instead of the sky.
   */
  setInteriorEnv(texture: THREE.Texture | null): void {
    this.interiorEnv = texture;
    for (const [id, m] of this.materials) {
      if (EXTERIOR.has(id)) continue;
      m.envMap = texture;
      m.envMapIntensity = texture ? 1.15 : 0.9;
      m.needsUpdate = true;
    }
  }

  /** Planar floor reflections (reflection.ts): glossy floors sample them from now on. null = static probe only. */
  setReflection(uniforms: ReflectionUniforms | null): void {
    if (uniforms === this.reflection) return;
    this.reflection = uniforms;
    for (const m of this.materials.values()) if (m.defines && 'BAS_REFLECT' in m.defines) m.needsUpdate = true;
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
