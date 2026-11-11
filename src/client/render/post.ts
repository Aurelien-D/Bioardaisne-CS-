/**
 * Post-processing chain: HDR render (MSAA) → ambient occlusion → light shafts → bloom →
 * filmic tone mapping → final grade (sharpening, vignette, film grain, a hint of chromatic
 * aberration). World first, then the first-person weapon over a cleared depth buffer.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/**
 * Light shafts ("god rays"): the brightest part of the picture (the sky around the sun, a
 * window in full sun) is smeared along rays leaving the sun's position on screen, so the
 * low sun visibly streams between buildings and through foliage.
 */
const ShaftsShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    sun: { value: new THREE.Vector2(0.5, 0.5) },
    strength: { value: 0 },
    tint: { value: new THREE.Color(1, 0.86, 0.68) },
    aspect: { value: 1 },
    time: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    varying vec2 vUv;
    uniform sampler2D tDiffuse; uniform vec2 sun; uniform float strength; uniform vec3 tint; uniform float aspect; uniform float time;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + time * 13.0) * 43758.5453); }
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (strength < 0.002) { gl_FragColor = base; return; }
      vec2 toSun = sun - vUv;
      float dist = length(toSun * vec2(aspect, 1.0));
      vec2 stepv = toSun * (0.9 / float(SHAFT_STEPS));
      vec2 uv = vUv + stepv * hash(gl_FragCoord.xy);
      float w = 1.0;
      float acc = 0.0;
      for (int i = 0; i < SHAFT_STEPS; i++) {
        vec3 c = texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).rgb;
        acc += min(max(dot(c, vec3(0.2126, 0.7152, 0.0722)) - 1.8, 0.0), 1.6) * w;
        w *= 0.965;
        uv += stepv;
      }
      acc /= float(SHAFT_STEPS);
      // Stronger close to the sun, fading across the screen.
      float fall = exp(-dist * 1.9);
      gl_FragColor = vec4(base.rgb + tint * (acc * strength * fall), base.a);
    }`,
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    aspect: { value: 1 },
    texel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
  },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    varying vec2 vUv;
    uniform sampler2D tDiffuse; uniform float time; uniform float aspect; uniform vec2 texel;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + time * 37.0) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c * vec2(aspect, 1.0), c * vec2(aspect, 1.0));
      // A hint of chromatic aberration, only in the far corners (a lens, not a filter).
      vec2 off = c * r2 * r2 * 0.006;
      vec3 mid = texture2D(tDiffuse, vUv).rgb;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, mid.g, texture2D(tDiffuse, vUv - off).b);
      // Sharpening (unsharp mask on a 4-tap cross): textures and edges stay crisp after bloom and AA.
      vec3 blur = (texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)).rgb
                 + texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, texel.y)).rgb) * 0.25;
      col += clamp(mid - blur, -0.08, 0.08) * 0.55;
      // Filmic contrast (soft S-curve) and a cool-shadow / warm-highlight grade.
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, 1.1);
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.34);
      col += vec3(-0.014, 0.0, 0.02) * (1.0 - l) + vec3(0.024, 0.008, -0.014) * l;
      // Vignette and film grain.
      col *= 1.0 - smoothstep(0.18, 0.95, r2) * 0.42;
      col += (hash(gl_FragCoord.xy) - 0.5) * 0.028;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

/** True when WebGL runs on the CPU (no graphics acceleration): the costliest effects are skipped. */
function softwareRenderer(renderer: THREE.WebGLRenderer): boolean {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    return /swiftshader|llvmpipe|software/i.test(name) && !new URLSearchParams(location.search).has('forceao');
  } catch {
    return false;
  }
}

export interface Post {
  /**
   * Light shafts for the next frames: `uv` = position of the sun on screen (may be outside
   * 0..1), `strength` 0 = off (sun behind the camera, interior map…).
   */
  setSun(u: number, v: number, strength: number, color: THREE.Color): void;
  render(time: number): void;
  setSize(width: number, height: number, pixelRatio: number): void;
  dispose(): void;
}

export function createPost(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  viewScene: THREE.Scene,
  viewCamera: THREE.Camera,
  quality: 'medium' | 'high',
): Post {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: quality === 'high' ? 4 : 2 });
  const composer = new EffectComposer(renderer, target);
  const world = new RenderPass(scene, camera);
  const view = new RenderPass(viewScene, viewCamera);
  view.clear = false;
  view.clearDepth = true;
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.16, 0.5, 1.05);
  const output = new OutputPass();
  const grade = new ShaderPass(GradeShader);
  const shafts = new ShaderPass(ShaftsShader);
  (shafts.material as THREE.ShaderMaterial).defines = { SHAFT_STEPS: quality === 'high' ? 40 : 24 };
  shafts.enabled = false;
  composer.addPass(world);
  // Ambient occlusion (contact shadows in corners and under furniture) on the best preset.
  let gtao: GTAOPass | null = null;
  if (quality === 'high' && !softwareRenderer(renderer)) {
    gtao = new GTAOPass(scene, camera, size.x, size.y);
    gtao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.4, thickness: 1.2, scale: 1.15, samples: 12 });
    gtao.blendIntensity = 0.9;
    composer.addPass(gtao);
  }
  composer.addPass(view);
  composer.addPass(shafts);
  composer.addPass(bloom);
  composer.addPass(output);
  composer.addPass(grade);
  return {
    setSun(u, v, strength, color) {
      shafts.enabled = strength > 0.002;
      shafts.uniforms.sun!.value.set(u, v);
      shafts.uniforms.strength!.value = strength;
      shafts.uniforms.tint!.value.copy(color);
    },
    render(time) {
      grade.uniforms.time!.value = time % 100;
      shafts.uniforms.time!.value = time % 100;
      composer.render();
    },
    setSize(width, height, pixelRatio) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
      grade.uniforms.aspect!.value = width / Math.max(1, height);
      grade.uniforms.texel!.value.set(1 / Math.max(1, width * pixelRatio), 1 / Math.max(1, height * pixelRatio));
      shafts.uniforms.aspect!.value = width / Math.max(1, height);
    },
    dispose() {
      composer.dispose();
      target.dispose();
    },
  };
}
