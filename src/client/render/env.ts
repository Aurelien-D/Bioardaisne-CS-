/**
 * Procedural reflection environment: a sky gradient with a sun glow and a few bright
 * ceiling-like panels, pre-filtered (PMREM) so that glossy floors, metal and weapons
 * pick up believable reflections without any HDR file.
 */
import * as THREE from 'three';
import type { EnvDef } from '../../shared/maps/types';

export function createEnvironment(renderer: THREE.WebGLRenderer, env: EnvDef): THREE.Texture {
  const scene = new THREE.Scene();
  const top = new THREE.Color(env.skyTop);
  const horizon = new THREE.Color(env.skyHorizon);
  const ground = new THREE.Color(env.ambientGround).multiplyScalar(0.55);
  const sun = new THREE.Color(env.sunColor);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        top: { value: top },
        horizon: { value: horizon },
        ground: { value: ground },
        sunColor: { value: sun },
        sunDir: { value: new THREE.Vector3(env.sunDir.x, env.sunDir.y, env.sunDir.z).normalize() },
        sunPower: { value: env.sunIntensity },
      },
      vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        varying vec3 vDir;
        uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunColor; uniform vec3 sunDir; uniform float sunPower;
        void main() {
          vec3 d = normalize(vDir);
          vec3 c = d.y > 0.0 ? mix(horizon, top, pow(d.y, 0.55)) : mix(horizon * 0.6, ground, pow(-d.y, 0.4));
          float s = max(dot(d, sunDir), 0.0);
          c += sunColor * (pow(s, 600.0) * 30.0 + pow(s, 12.0) * 0.9) * sunPower;
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  scene.add(dome);
  // Overhead light panels: what a glossy lab floor would mirror.
  const panelGeo = new THREE.PlaneGeometry(7, 3);
  const panelMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 5, 4.8), side: THREE.DoubleSide });
  for (let i = 0; i < 6; i++) {
    const p = new THREE.Mesh(panelGeo, panelMat);
    p.position.set(((i % 3) - 1) * 16, 30, (i < 3 ? -1 : 1) * 9);
    p.rotation.x = Math.PI / 2;
    scene.add(p);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.03);
  pmrem.dispose();
  dome.geometry.dispose();
  (dome.material as THREE.Material).dispose();
  panelGeo.dispose();
  panelMat.dispose();
  return target.texture;
}

// ---------------------------------------------------------------------------------
// Photographic sky (CC0 HDRI, Poly Haven): real sky dome and reflections.
// ---------------------------------------------------------------------------------

export interface HdrSky {
  /** Equirectangular HDR texture, usable as scene.background. */
  background: THREE.Texture;
  /** Pre-filtered reflection environment. */
  env: THREE.Texture;
  /** Direction to the sun in the picture's own frame (before any rotation). */
  sunDir: THREE.Vector3;
}

let hdrPromise: Promise<HdrSky | null> | null = null;

/** Sun position in media/hdr/sky.jpg (azimuth / elevation, radians), measured when the picture was converted. */
const SKY_SUN = { az: 0.6596, el: 0.0337 };
/** The JPG stores sqrt-encoded radiance: value = SKY_PEAK × (byte / 255)². */
const SKY_PEAK = 6;

/** Load the photographic sky once. Resolves to null if the file is missing (procedural sky is kept). */
export function loadHdrSky(renderer: THREE.WebGLRenderer): Promise<HdrSky | null> {
  if (!hdrPromise) {
    hdrPromise = (async () => {
      try {
        const img = await new THREE.ImageLoader().loadAsync(new URL('media/hdr/sky.jpg', document.baseURI).href);
        const w = img.width;
        const h = img.height;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        const src = ctx.getImageData(0, 0, w, h).data;
        // Decode to half-float radiance; rows are flipped so that v = 1 is the zenith.
        const lut = new Uint16Array(256);
        for (let i = 0; i < 256; i++) lut[i] = THREE.DataUtils.toHalfFloat(SKY_PEAK * (i / 255) * (i / 255));
        const one = THREE.DataUtils.toHalfFloat(1);
        const data = new Uint16Array(w * h * 4);
        for (let y = 0; y < h; y++) {
          const so = (h - 1 - y) * w * 4;
          const d = y * w * 4;
          for (let x = 0; x < w * 4; x += 4) {
            data[d + x] = lut[src[so + x]!]!;
            data[d + x + 1] = lut[src[so + x + 1]!]!;
            data[d + x + 2] = lut[src[so + x + 2]!]!;
            data[d + x + 3] = one;
          }
        }
        const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.colorSpace = THREE.LinearSRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.wrapS = THREE.RepeatWrapping;
        tex.needsUpdate = true;
        const sunDir = new THREE.Vector3(Math.cos(SKY_SUN.az) * Math.cos(SKY_SUN.el), Math.sin(SKY_SUN.el), Math.sin(SKY_SUN.az) * Math.cos(SKY_SUN.el));
        const pmrem = new THREE.PMREMGenerator(renderer);
        const env = pmrem.fromEquirectangular(tex).texture;
        pmrem.dispose();
        return { background: tex, env, sunDir };
      } catch (err) {
        console.warn('[env] ciel photographique indisponible, ciel procédural utilisé :', err);
        return null;
      }
    })();
  }
  return hdrPromise;
}
