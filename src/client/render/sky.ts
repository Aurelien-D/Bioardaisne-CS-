/**
 * Sky: gradient dome (shader) from env.skyHorizon to env.skyTop, sun disc + glow in
 * env.sunDir, soft procedural clouds drifting slowly, and scene fog from the map env.
 *
 * The dome is a unit cube drawn around the camera with depth forced to the far plane
 * and drawn after the opaque world, so only the pixels left uncovered are shaded
 * (cheap on integrated GPUs). Clouds come from one small tileable noise texture.
 */
import * as THREE from 'three';
import type { EnvDef } from '../../shared/maps/types';
import { mulberry32 } from '../../shared/math/rng';

const VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
	vDir = position;
	vec4 p = projectionMatrix * vec4( mat3( viewMatrix ) * position, 1.0 );
	gl_Position = p.xyww; // depth = far plane
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uFog;
uniform float uFogBand;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSun;
uniform float uClouds;
uniform float uTime;
uniform sampler2D uNoise;
varying vec3 vDir;

void main() {
	vec3 d = normalize( vDir );
	float up = max( d.y, 0.0 );

	// Gradient: quick rise from the horizon colour to the zenith colour.
	vec3 col = mix( uHorizon, uTop, 1.0 - pow( 1.0 - up, 2.4 ) );

	// Sun: warm glow, tight halo and disc.
	float sd = max( dot( d, uSunDir ), 0.0 );
	float glow = pow( sd, 8.0 ) * 0.16 + pow( sd, 140.0 ) * 0.5;
	float disc = smoothstep( 0.99925, 0.99968, sd );
	col += uSunColor * uSun * ( glow + disc * 4.0 ) * step( -0.02, d.y );

	// Clouds: noise projected on a plane overhead, flattened toward the horizon.
	if ( uClouds > 0.0 && d.y > 0.015 ) {
		vec2 p = d.xz / ( d.y + 0.16 );
		vec2 wind = vec2( uTime * 0.0035, uTime * 0.0014 );
		float big = texture2D( uNoise, p * 0.085 + wind ).r;
		float small = texture2D( uNoise, p * 0.27 - wind * 1.8 + vec2( 0.37, 0.11 ) ).r;
		float dens = big * 0.7 + small * 0.3;
		float cover = smoothstep( 0.5, 0.76, dens );
		// Cheap self-shadowing: compare with the density a little further toward the sun.
		float toward = texture2D( uNoise, ( p + normalize( uSunDir.xz + vec2( 1e-4 ) ) * 0.55 ) * 0.085 + wind ).r;
		float lit = clamp( 0.62 + ( big - toward ) * 2.6, 0.0, 1.0 );
		vec3 bright = mix( vec3( 1.0 ), uSunColor, 0.25 ) * ( 0.82 + 0.3 * uSun );
		vec3 shade = mix( uHorizon, uTop, 0.45 ) * 0.78 + vec3( 0.06 );
		vec3 cloud = mix( shade, bright, lit );
		col = mix( col, cloud, cover * smoothstep( 0.015, 0.2, d.y ) * uClouds );
	}

	// Horizon band and lower hemisphere blend into the fog / haze colour.
	col = mix( col, uFog, uFogBand * ( 1.0 - smoothstep( 0.0, 0.07, d.y ) ) );
	if ( d.y < 0.0 ) col = mix( col, mix( uHorizon, uFog, uFogBand ) * 0.72, clamp( - d.y * 2.5, 0.0, 1.0 ) );

	gl_FragColor = vec4( col, 1.0 );
	#include <colorspace_fragment>
}
`;

/** Tileable fractal noise (R8, 0..255), a few octaves of periodic value noise. */
function makeCloudNoise(size: number): THREE.DataTexture {
  const rng = mulberry32(0xb10a2d);
  const data = new Uint8Array(size * size);
  const acc = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let cells = 4; cells <= 64; cells *= 2) {
    const lattice = new Float32Array(cells * cells);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rng();
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cells;
      const y0 = Math.floor(fy);
      let ty = fy - y0;
      ty = ty * ty * (3 - 2 * ty);
      const ya = y0 % cells;
      const yb = (y0 + 1) % cells;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells;
        const x0 = Math.floor(fx);
        let tx = fx - x0;
        tx = tx * tx * (3 - 2 * tx);
        const xa = x0 % cells;
        const xb = (x0 + 1) % cells;
        const a = lattice[ya * cells + xa]!;
        const b = lattice[ya * cells + xb]!;
        const c = lattice[yb * cells + xa]!;
        const d = lattice[yb * cells + xb]!;
        acc[y * size + x]! += (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < acc.length; i++) data[i] = Math.max(0, Math.min(255, Math.round((acc[i]! / total) * 255)));
  const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export interface Sky {
  /** Add to the world scene. Named 'bas-sky'. */
  readonly mesh: THREE.Mesh;
  /** Take the colours / sun of a map environment. */
  setEnv(env: EnvDef): void;
  /** Advance the cloud drift. */
  update(timeSeconds: number): void;
  dispose(): void;
}

export function createSky(): Sky {
  const noise = makeCloudNoise(256);
  const uniforms = {
    uTop: { value: new THREE.Color(0x5d8fc9) },
    uHorizon: { value: new THREE.Color(0xc9dcec) },
    uFog: { value: new THREE.Color(0xc9dcec) },
    uFogBand: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.45, 0.8, 0.4).normalize() },
    uSunColor: { value: new THREE.Color(0xfff1d6) },
    uSun: { value: 1 },
    uClouds: { value: 1 },
    uTime: { value: 0 },
    uNoise: { value: noise },
  };
  const material = new THREE.ShaderMaterial({
    name: 'bas-sky',
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'bas-sky';
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  // After every opaque mesh (depth-tested against them), before transparent ones.
  mesh.renderOrder = 1000;

  return {
    mesh,
    setEnv(env: EnvDef): void {
      uniforms.uTop.value.setHex(env.skyTop);
      uniforms.uHorizon.value.setHex(env.skyHorizon);
      const fog = env.fogFar > 0;
      uniforms.uFog.value.setHex(fog ? env.fogColor : env.skyHorizon);
      uniforms.uFogBand.value = fog ? 1 : 0;
      uniforms.uSunDir.value.set(env.sunDir.x, env.sunDir.y, env.sunDir.z);
      if (uniforms.uSunDir.value.lengthSq() < 1e-6) uniforms.uSunDir.value.set(0, 1, 0);
      uniforms.uSunDir.value.normalize();
      uniforms.uSunColor.value.setHex(env.sunColor);
      uniforms.uSun.value = Math.max(0, Math.min(1.5, env.sunIntensity));
    },
    update(timeSeconds: number): void {
      uniforms.uTime.value = timeSeconds;
    },
    dispose(): void {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
      noise.dispose();
    },
  };
}

/** Scene fog from a map environment (linear fog; disabled when fogFar <= 0). */
export function applyFog(scene: THREE.Scene, env: EnvDef | null): void {
  if (!env || env.fogFar <= 0) {
    scene.fog = null;
    return;
  }
  const near = Math.max(0, Math.min(env.fogNear, env.fogFar - 1));
  if (scene.fog instanceof THREE.Fog) {
    scene.fog.color.setHex(env.fogColor);
    scene.fog.near = near;
    scene.fog.far = env.fogFar;
  } else {
    scene.fog = new THREE.Fog(env.fogColor, near, env.fogFar);
  }
}
