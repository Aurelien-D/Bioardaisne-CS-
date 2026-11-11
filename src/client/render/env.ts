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
