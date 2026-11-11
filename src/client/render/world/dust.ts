/**
 * Dust motes drifting in the air around the camera: a small field of soft specks that wraps
 * around the viewer (the same few hundred points wherever the player goes). They give the
 * air some depth, indoors and in the low sun outside.
 */
import * as THREE from 'three';

const COUNT = 420;
/** Size of the wrapping volume around the camera (m). */
const BOX = new THREE.Vector3(14, 7, 14);

export interface Dust {
  readonly points: THREE.Points;
  update(time: number, camera: THREE.Vector3): void;
  dispose(): void;
}

export function createDust(): Dust {
  const seeds = new Float32Array(COUNT * 3);
  const phase = new Float32Array(COUNT);
  // Deterministic scatter (no Math.random: identical on every run).
  let s = 1234567;
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < COUNT; i++) {
    seeds[i * 3] = rnd();
    seeds[i * 3 + 1] = rnd();
    seeds[i * 3 + 2] = rnd();
    phase[i] = rnd();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(seeds, 3));
  geometry.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6); // follows the camera: never culled
  const material = new THREE.ShaderMaterial({
    uniforms: {
      basTime: { value: 0 },
      basCam: { value: new THREE.Vector3() },
      basBox: { value: BOX },
      basScale: { value: 300 },
    },
    vertexShader: /* glsl */ `
      attribute float phase;
      uniform float basTime; uniform vec3 basCam; uniform vec3 basBox; uniform float basScale;
      varying float vAlpha;
      void main() {
        // Slow drift, each mote on its own little orbit; the field wraps around the camera.
        vec3 drift = vec3( basTime * 0.006, - basTime * 0.004, basTime * 0.005 )
                   + 0.012 * vec3( sin( basTime * 0.31 + phase * 40.0 ), sin( basTime * 0.23 + phase * 71.0 ), cos( basTime * 0.27 + phase * 53.0 ) );
        vec3 world = basCam + ( fract( position + drift - basCam / basBox ) - 0.5 ) * basBox;
        vec4 mv = viewMatrix * vec4( world, 1.0 );
        float d = - mv.z;
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp( basScale * ( 0.006 + 0.008 * phase ) / max( d, 0.1 ), 1.0, 5.0 );
        // Invisible right in front of the lens and far away; a slow twinkle.
        vAlpha = smoothstep( 0.5, 1.6, d ) * ( 1.0 - smoothstep( 4.5, 7.0, d ) ) * ( 0.55 + 0.45 * sin( basTime * 0.9 + phase * 31.0 ) );
      }`,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a = smoothstep( 0.5, 0.05, length( c ) ) * vAlpha * 0.16;
        if ( a < 0.004 ) discard;
        gl_FragColor = vec4( vec3( 1.0, 0.93, 0.82 ) * a, a );
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'bas-dust';
  points.frustumCulled = false;
  points.renderOrder = 5;
  return {
    points,
    update(time, camera) {
      material.uniforms.basTime!.value = time % 3600;
      (material.uniforms.basCam!.value as THREE.Vector3).copy(camera);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
