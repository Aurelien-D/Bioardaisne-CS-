/**
 * First-person weapon effects that live in view space: muzzle smoke and ejected brass.
 * Both are small fixed pools (no allocation after construction). The overlay scene moves
 * with the camera, so the particles are turned against the view rotation each frame: once
 * emitted they stay where they are in the world while the player looks around.
 */
import * as THREE from 'three';

const MAX_SMOKE = 40;
const MAX_CASINGS = 14;

function smokeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = 'lighter';
  // A lumpy puff: a soft disc plus a few off-centre lobes (deterministic).
  let s = 12345;
  const rnd = (): number => ((s = (s * 16807) % 2147483647) & 0xffff) / 0xffff;
  const lobe = (x: number, y: number, r: number, a: number): void => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(255,255,255,${a})`);
    gr.addColorStop(0.55, `rgba(255,255,255,${a * 0.42})`);
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  lobe(64, 64, 60, 0.5);
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2;
    const d = 10 + rnd() * 24;
    lobe(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 16 + rnd() * 18, 0.22);
  }
  return new THREE.CanvasTexture(c);
}

const SMOKE_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iColor;
attribute vec2 iSizeRot;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4( iPos, 1.0 );
  float c = cos( iSizeRot.y ), s = sin( iSizeRot.y );
  mv.xy += vec2( c * position.x - s * position.y, s * position.x + c * position.y ) * iSizeRot.x;
  vUv = uv;
  vColor = iColor;
  gl_Position = projectionMatrix * mv;
}`;

const SMOKE_FRAG = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  float a = texture2D( map, vUv ).r * vColor.a;
  if ( a < 0.003 ) discard;
  gl_FragColor = vec4( vColor.rgb, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Cartridge case: 1 long along +Z, radius 1 — scaled per calibre. */
function casingGeometry(): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(1.02, 0),
    new THREE.Vector2(1.02, 0.045),
    new THREE.Vector2(0.86, 0.06),
    new THREE.Vector2(0.86, 0.085),
    new THREE.Vector2(1, 0.11),
    new THREE.Vector2(0.97, 0.99),
    new THREE.Vector2(0.84, 1),
    new THREE.Vector2(0, 0.82),
  ];
  const g = new THREE.LatheGeometry(pts, 10);
  g.rotateX(Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

export type CasingKind = 'pistol' | 'magnum' | 'rifle' | 'shell' | 'long';

/** [radius, length] in metres and tint. */
const CASINGS: Record<CasingKind, { r: number; l: number; color: [number, number, number] }> = {
  pistol: { r: 0.0048, l: 0.019, color: [1, 1, 1] },
  magnum: { r: 0.0066, l: 0.03, color: [1, 1, 1] },
  rifle: { r: 0.0046, l: 0.037, color: [1, 1, 1] },
  long: { r: 0.0058, l: 0.048, color: [1, 1, 1] },
  shell: { r: 0.0098, l: 0.06, color: [1.05, 0.16, 0.12] },
};

export class ViewFx {
  readonly group = new THREE.Group();

  // Smoke
  private smoke: THREE.Mesh;
  private sGeo = new THREE.InstancedBufferGeometry();
  private sPos = new Float32Array(MAX_SMOKE * 3);
  private sCol = new Float32Array(MAX_SMOKE * 4);
  private sSize = new Float32Array(MAX_SMOKE * 2);
  private sVel = new Float32Array(MAX_SMOKE * 3);
  private sLife = new Float32Array(MAX_SMOKE);
  private sMax = new Float32Array(MAX_SMOKE);
  private sGrow = new Float32Array(MAX_SMOKE * 2); // start size, end size
  private sAlpha = new Float32Array(MAX_SMOKE);
  private sSpin = new Float32Array(MAX_SMOKE);
  private sNext = 0;
  private sLive = 0;
  private sTex: THREE.Texture;

  // Brass
  private casings: THREE.InstancedMesh;
  private cPos = new Float32Array(MAX_CASINGS * 3);
  private cVel = new Float32Array(MAX_CASINGS * 3);
  private cQuat = new Float32Array(MAX_CASINGS * 4);
  private cSpin = new Float32Array(MAX_CASINGS * 4); // axis xyz, speed
  private cScale = new Float32Array(MAX_CASINGS * 2);
  private cLife = new Float32Array(MAX_CASINGS);
  private cNext = 0;
  private cLive = 0;
  private brass: THREE.MeshStandardMaterial;

  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private col = new THREE.Color();

  constructor() {
    this.group.name = 'vm-fx';
    // --- Smoke: instanced camera-facing quads.
    const quad = new THREE.PlaneGeometry(1, 1);
    this.sGeo.index = quad.index;
    this.sGeo.setAttribute('position', quad.getAttribute('position'));
    this.sGeo.setAttribute('uv', quad.getAttribute('uv'));
    const dyn = (arr: Float32Array, n: number): THREE.InstancedBufferAttribute => {
      const a = new THREE.InstancedBufferAttribute(arr, n);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.sGeo.setAttribute('iPos', dyn(this.sPos, 3));
    this.sGeo.setAttribute('iColor', dyn(this.sCol, 4));
    this.sGeo.setAttribute('iSizeRot', dyn(this.sSize, 2));
    this.sGeo.instanceCount = MAX_SMOKE;
    this.sTex = smokeTexture();
    const sMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.sTex } },
      vertexShader: SMOKE_VERT,
      fragmentShader: SMOKE_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.smoke = new THREE.Mesh(this.sGeo, sMat);
    this.smoke.frustumCulled = false;
    this.smoke.renderOrder = 8;
    this.smoke.visible = false;

    // --- Brass.
    this.brass = new THREE.MeshStandardMaterial({ color: 0xd9b064, metalness: 1, roughness: 0.3 });
    this.casings = new THREE.InstancedMesh(casingGeometry(), this.brass, MAX_CASINGS);
    this.casings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.casings.frustumCulled = false;
    this.casings.castShadow = false;
    this.m4.makeScale(0, 0, 0);
    for (let i = 0; i < MAX_CASINGS; i++) {
      this.casings.setMatrixAt(i, this.m4);
      this.casings.setColorAt(i, this.col.setRGB(1, 1, 1));
    }
    this.casings.visible = false;
    this.group.add(this.casings, this.smoke);
  }

  /** The brass reflects the same environment as the weapon. */
  setEnvironment(env: THREE.Texture | null, intensity: number, rotationY: number): void {
    if (this.brass.envMap !== env) this.brass.envMap = env;
    this.brass.envMapIntensity = intensity;
    this.brass.envMapRotation.y = rotationY;
  }

  /**
   * One puff of smoke at `p` (view space). `vx, vy, vz` initial velocity (m/s), sizes in metres,
   * `alpha` peak opacity, `grey` brightness.
   */
  puff(p: THREE.Vector3, vx: number, vy: number, vz: number, size0: number, size1: number, life: number, alpha: number, grey: number): void {
    const i = this.sNext;
    this.sNext = (this.sNext + 1) % MAX_SMOKE;
    this.sPos[i * 3] = p.x;
    this.sPos[i * 3 + 1] = p.y;
    this.sPos[i * 3 + 2] = p.z;
    this.sVel[i * 3] = vx;
    this.sVel[i * 3 + 1] = vy;
    this.sVel[i * 3 + 2] = vz;
    this.sGrow[i * 2] = size0;
    this.sGrow[i * 2 + 1] = size1;
    this.sLife[i] = this.sMax[i] = life;
    this.sAlpha[i] = alpha;
    this.sCol[i * 4] = grey;
    this.sCol[i * 4 + 1] = grey;
    this.sCol[i * 4 + 2] = grey * 1.03;
    this.sSize[i * 2 + 1] = Math.random() * Math.PI * 2;
    this.sSpin[i] = (Math.random() - 0.5) * 1.6;
    this.sLive = Math.max(this.sLive, life);
    this.smoke.visible = true;
  }

  /** Eject a case from `p` (view space) with velocity `v` (m/s). */
  eject(p: THREE.Vector3, v: THREE.Vector3, kind: CasingKind): void {
    const i = this.cNext;
    this.cNext = (this.cNext + 1) % MAX_CASINGS;
    const c = CASINGS[kind];
    this.cPos[i * 3] = p.x;
    this.cPos[i * 3 + 1] = p.y;
    this.cPos[i * 3 + 2] = p.z;
    this.cVel[i * 3] = v.x;
    this.cVel[i * 3 + 1] = v.y;
    this.cVel[i * 3 + 2] = v.z;
    // Starts lying along the barrel, then tumbles about a random axis.
    this.cQuat[i * 4] = 0;
    this.cQuat[i * 4 + 1] = 0;
    this.cQuat[i * 4 + 2] = 0;
    this.cQuat[i * 4 + 3] = 1;
    this.v.set(Math.random() - 0.5, Math.random() * 0.6 + 0.4, Math.random() - 0.5).normalize();
    this.cSpin[i * 4] = this.v.x;
    this.cSpin[i * 4 + 1] = this.v.y;
    this.cSpin[i * 4 + 2] = this.v.z;
    this.cSpin[i * 4 + 3] = 18 + Math.random() * 26;
    this.cScale[i * 2] = c.r;
    this.cScale[i * 2 + 1] = c.l;
    this.cLife[i] = 0.9;
    this.casings.setColorAt(i, this.col.setRGB(c.color[0], c.color[1], c.color[2]));
    if (this.casings.instanceColor) this.casings.instanceColor.needsUpdate = true;
    this.cLive = 0.9;
    this.casings.visible = true;
  }

  /**
   * `dyaw`, `dpitch`: view rotation of this frame (radians) — the particles are turned the other
   * way so they stay put in the world. `light`: local light level (smoke brightness).
   */
  update(dt: number, dyaw: number, dpitch: number, light: number): void {
    const cy = Math.cos(-dyaw);
    const sy = Math.sin(-dyaw);
    const cp = Math.cos(-dpitch);
    const sp = Math.sin(-dpitch);
    // Rotation about Y (yaw) then X (pitch), applied to positions and velocities alike.
    const turn = (a: Float32Array, o: number): void => {
      const x = a[o]! * cy + a[o + 2]! * sy;
      const z0 = -a[o]! * sy + a[o + 2]! * cy;
      const y = a[o + 1]! * cp - z0 * sp;
      const z = a[o + 1]! * sp + z0 * cp;
      a[o] = x;
      a[o + 1] = y;
      a[o + 2] = z;
    };
    const turning = dyaw !== 0 || dpitch !== 0;

    if (this.sLive > 0) {
      this.sLive -= dt;
      const drag = Math.exp(-dt * 3.2);
      for (let i = 0; i < MAX_SMOKE; i++) {
        if (this.sLife[i]! <= 0) continue;
        this.sLife[i]! -= dt;
        if (this.sLife[i]! <= 0) {
          this.sSize[i * 2] = 0;
          this.sCol[i * 4 + 3] = 0;
          continue;
        }
        const o = i * 3;
        if (turning) {
          turn(this.sPos, o);
          turn(this.sVel, o);
        }
        this.sVel[o]! *= drag;
        this.sVel[o + 2]! *= drag;
        this.sVel[o + 1] = this.sVel[o + 1]! * drag + 0.34 * dt; // hot gas rises
        this.sPos[o]! += this.sVel[o]! * dt;
        this.sPos[o + 1]! += this.sVel[o + 1]! * dt;
        this.sPos[o + 2]! += this.sVel[o + 2]! * dt;
        const k = 1 - this.sLife[i]! / this.sMax[i]!; // 0 → 1
        const grow = 1 - (1 - k) * (1 - k);
        this.sSize[i * 2] = this.sGrow[i * 2]! + (this.sGrow[i * 2 + 1]! - this.sGrow[i * 2]!) * grow;
        this.sSize[i * 2 + 1]! += this.sSpin[i]! * dt;
        // Quick fade in, long fade out.
        this.sCol[i * 4 + 3] = this.sAlpha[i]! * Math.min(1, k * 9) * (1 - k) * (1 - k) * Math.min(1.1, 0.35 + light * 0.75);
      }
      this.sGeo.attributes.iPos!.needsUpdate = true;
      this.sGeo.attributes.iColor!.needsUpdate = true;
      this.sGeo.attributes.iSizeRot!.needsUpdate = true;
      if (this.sLive <= 0) this.smoke.visible = false;
    }

    if (this.cLive > 0) {
      this.cLive -= dt;
      for (let i = 0; i < MAX_CASINGS; i++) {
        if (this.cLife[i]! <= 0) continue;
        this.cLife[i]! -= dt;
        const o = i * 3;
        if (this.cLife[i]! <= 0) {
          this.m4.makeScale(0, 0, 0);
          this.casings.setMatrixAt(i, this.m4);
          continue;
        }
        if (turning) {
          turn(this.cPos, o);
          turn(this.cVel, o);
        }
        this.cVel[o + 1]! -= 9.81 * dt;
        this.cPos[o]! += this.cVel[o]! * dt;
        this.cPos[o + 1]! += this.cVel[o + 1]! * dt;
        this.cPos[o + 2]! += this.cVel[o + 2]! * dt;
        const s = i * 4;
        this.q.set(this.cQuat[s]!, this.cQuat[s + 1]!, this.cQuat[s + 2]!, this.cQuat[s + 3]!);
        this.q2.setFromAxisAngle(this.v.set(this.cSpin[s]!, this.cSpin[s + 1]!, this.cSpin[s + 2]!), this.cSpin[s + 3]! * dt);
        this.q.premultiply(this.q2);
        this.cQuat[s] = this.q.x;
        this.cQuat[s + 1] = this.q.y;
        this.cQuat[s + 2] = this.q.z;
        this.cQuat[s + 3] = this.q.w;
        this.m4.compose(this.v.set(this.cPos[o]!, this.cPos[o + 1]!, this.cPos[o + 2]!), this.q, this.sc.set(this.cScale[i * 2]!, this.cScale[i * 2]!, this.cScale[i * 2 + 1]!));
        this.casings.setMatrixAt(i, this.m4);
      }
      this.casings.instanceMatrix.needsUpdate = true;
      if (this.cLive <= 0) this.casings.visible = false;
    }
  }

  clear(): void {
    this.sLife.fill(0);
    this.cLife.fill(0);
    this.sSize.fill(0);
    this.sLive = this.cLive = 0;
    this.smoke.visible = this.casings.visible = false;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.sGeo.dispose();
    (this.smoke.material as THREE.Material).dispose();
    this.sTex.dispose();
    this.casings.geometry.dispose();
    this.brass.dispose();
  }
}
