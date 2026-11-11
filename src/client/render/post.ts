/**
 * Post-processing chain: HDR render (MSAA) → bloom → filmic tone mapping → final grade
 * (vignette, film grain, slight chromatic aberration). World first, then the
 * first-person weapon over a cleared depth buffer.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    aspect: { value: 1 },
  },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    varying vec2 vUv;
    uniform sampler2D tDiffuse; uniform float time; uniform float aspect;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + time * 37.0) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c * vec2(aspect, 1.0), c * vec2(aspect, 1.0));
      // Chromatic aberration grows toward the edges.
      vec2 off = c * r2 * 0.005;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      // Gentle contrast and a cool-shadow / warm-highlight grade.
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, 1.08);
      col = (col - 0.5) * 1.12 + 0.5;
      col += vec3(-0.012, 0.0, 0.018) * (1.0 - l) + vec3(0.02, 0.008, -0.012) * l;
      // Vignette and film grain.
      col *= 1.0 - smoothstep(0.18, 0.95, r2) * 0.42;
      col += (hash(gl_FragCoord.xy) - 0.5) * 0.028;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

export interface Post {
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
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.22, 0.6, 1.0);
  const output = new OutputPass();
  const grade = new ShaderPass(GradeShader);
  composer.addPass(world);
  composer.addPass(view);
  composer.addPass(bloom);
  composer.addPass(output);
  composer.addPass(grade);
  return {
    render(time) {
      grade.uniforms.time!.value = time % 100;
      composer.render();
    },
    setSize(width, height, pixelRatio) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
      grade.uniforms.aspect!.value = width / Math.max(1, height);
    },
    dispose() {
      composer.dispose();
      target.dispose();
    },
  };
}
