/**
 * Realistic third-person player: a rigged, animated soldier (glTF, idle / walk / run)
 * cloned per player and tinted by team. Falls back to the procedural avatar when the
 * model could not be loaded.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { TeamId } from '../../../shared/constants';
import type { Vec3 } from '../../../shared/math/vec3';
import type { WeaponId } from '../../../shared/weapons/defs';
import type { AvatarFrame, IAvatar } from '../../core/contracts';
import { WEAPONS } from '../../../shared/weapons/defs';
import { createWeaponModel, type WeaponModel } from '../weapons/models';
import { setWorldQuaternion, solveTwoBone } from './ik';

interface Template {
  scene: THREE.Object3D;
  clips: Record<string, THREE.AnimationClip>;
  /** Uniform scale bringing the model to 1.8 m. */
  scale: number;
  /** Rotation that makes the model face -Z. */
  yaw: number;
}

let template: Template | null = null;
let loading: Promise<void> | null = null;

/** Load the character model once (never rejects). */
export function preloadSoldier(): Promise<void> {
  if (!loading) {
    loading = new GLTFLoader()
      .loadAsync(new URL('media/models/soldier.json', document.baseURI).href)
      .then((gltf) => {
        const scene = gltf.scene;
        scene.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(scene);
        const height = Math.max(0.1, box.max.y - box.min.y);
        // Facing direction from the feet: heel -> toes.
        const foot = scene.getObjectByName('mixamorigLeftFoot');
        const toe = scene.getObjectByName('mixamorigLeftToeBase');
        let yaw = Math.PI;
        if (foot && toe) {
          const a = foot.getWorldPosition(new THREE.Vector3());
          const b = toe.getWorldPosition(new THREE.Vector3());
          yaw = Math.atan2(b.z - a.z, b.x - a.x) + Math.PI / 2;
        }
        const clips: Record<string, THREE.AnimationClip> = {};
        for (const c of gltf.animations) clips[c.name] = c;
        template = { scene, clips, scale: 1.8 / height, yaw };
      })
      .catch((err) => {
        console.warn('[avatar] modèle de personnage indisponible, silhouette procédurale utilisée :', err);
      });
  }
  return loading;
}

export const soldierReady = (): boolean => template !== null;

const TEAM_TINT: Record<number, [number, number, number]> = {
  // Kept well below 1: bright armour under the sun would otherwise wash out to white.
  0: [0.05, 0.17, 0.55], // Équipe Labo: blue
  1: [0.55, 0.09, 0.07], // Auditeurs: red
};

export class SoldierAvatar implements IAvatar {
  readonly root = new THREE.Group();
  private pivot = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private idle: THREE.AnimationAction;
  private walk: THREE.AnimationAction;
  private run: THREE.AnimationAction;
  private spine: THREE.Object3D | null;
  private hand: THREE.Object3D | null;
  private head: THREE.Object3D | null;
  private hips: THREE.Object3D | null;
  private bones: Record<string, THREE.Object3D | null> = {};
  private t1 = new THREE.Vector3();
  private t2 = new THREE.Vector3();
  private pole = new THREE.Vector3();
  private footL = new THREE.Vector3();
  private footR = new THREE.Vector3();
  private footQL = new THREE.Quaternion();
  private footQR = new THREE.Quaternion();
  private mats: THREE.MeshStandardMaterial[] = [];
  private base: THREE.Color[] = [];
  private glow: THREE.Color[] = [];
  private weaponHolder = new THREE.Group();
  private weapon: WeaponModel | null = null;
  private weaponId: WeaponId | null = null;
  private wIdle = 1;
  private wWalk = 0;
  private wRun = 0;
  private recoil = 0;
  private dead = false;
  private deathT = 0;
  private deathDir = 1;
  private tmp = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;

  constructor(team: TeamId) {
    const t = template!;
    const model = cloneSkinned(t.scene);
    const tint = TEAM_TINT[team] ?? [1, 1, 1];
    model.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      const m = (mesh.material as THREE.MeshStandardMaterial).clone();
      m.color.setRGB(m.color.r * tint[0], m.color.g * tint[1], m.color.b * tint[2]);
      m.envMapIntensity = 0.6;
      // Team colour that stays readable in any lighting: a faint self-lit tint following the texture.
      m.emissiveMap = m.map;
      m.emissive.setRGB(tint[0] > 0.5 ? 0.1 : 0.0, 0.01, tint[2] > 0.5 ? 0.12 : 0.0);
      this.glow.push(m.emissive.clone());
      mesh.material = m;
      this.mats.push(m);
      this.base.push(m.color.clone());
    });
    this.pivot.rotation.y = t.yaw;
    this.pivot.scale.setScalar(t.scale);
    this.pivot.add(model);
    this.root.add(this.pivot, this.weaponHolder);
    this.mixer = new THREE.AnimationMixer(model);
    const act = (name: string): THREE.AnimationAction => {
      const a = this.mixer.clipAction(t.clips[name] ?? t.clips.Idle!);
      a.play();
      return a;
    };
    this.idle = act('Idle');
    this.walk = act('Walk');
    this.run = act('Run');
    this.walk.setEffectiveWeight(0);
    this.run.setEffectiveWeight(0);
    this.spine = model.getObjectByName('mixamorigSpine1') ?? null;
    this.hand = model.getObjectByName('mixamorigRightHand') ?? null;
    this.head = model.getObjectByName('mixamorigHead') ?? null;
    this.hips = model.getObjectByName('mixamorigHips') ?? null;
    for (const n of ['RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightUpLeg', 'RightLeg', 'RightFoot', 'LeftUpLeg', 'LeftLeg', 'LeftFoot']) {
      this.bones[n] = model.getObjectByName(`mixamorig${n}`) ?? null;
    }
  }

  private setWeapon(id: WeaponId): void {
    if (id === this.weaponId) return;
    if (this.weapon) {
      this.weaponHolder.remove(this.weapon.root);
      this.weapon.dispose();
    }
    this.weaponId = id;
    this.weapon = createWeaponModel(id, 'world');
    this.weapon.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.weaponHolder.add(this.weapon.root);
  }

  update(f: AvatarFrame): void {
    const dt = Math.min(0.05, f.dt);
    if (this.dead) {
      this.deathT = Math.min(1, this.deathT + dt * 1.5);
      const k = 1 - (1 - this.deathT) * (1 - this.deathT);
      this.pivot.rotation.x = this.deathDir * k * 1.45;
      this.pivot.position.y = k * 0.12;
      this.mixer.update(dt * (1 - k));
      return;
    }
    this.setWeapon(f.weapon);
    this.root.position.set(f.pos.x, f.pos.y, f.pos.z);
    this.root.rotation.y = f.yaw;
    this.yaw = f.yaw;
    this.pitch = f.pitch;
    // Locomotion blend.
    const sp = f.onGround ? f.speed : f.speed * 0.5;
    const tIdle = sp < 0.4 ? 1 : 0;
    const tRun = sp > 3.6 ? 1 : 0;
    const tWalk = 1 - tIdle - tRun;
    const k = Math.min(1, dt * 9);
    this.wIdle += (tIdle - this.wIdle) * k;
    this.wWalk += (tWalk - this.wWalk) * k;
    this.wRun += (tRun - this.wRun) * k;
    this.idle.setEffectiveWeight(this.wIdle);
    this.walk.setEffectiveWeight(this.wWalk);
    this.run.setEffectiveWeight(this.wRun);
    this.walk.timeScale = Math.max(0.5, sp / 1.7);
    this.run.timeScale = Math.max(0.7, sp / 5.2);
    this.mixer.update(dt);
    const B = this.bones;
    this.root.updateMatrixWorld(true);
    // --- Crouch: lower the hips and bend the knees so the feet stay planted (leg IK). ---
    if (f.crouch > 0.01 && this.hips && B.LeftFoot && B.RightFoot && B.LeftUpLeg && B.RightUpLeg && B.LeftLeg && B.RightLeg) {
      B.LeftFoot.getWorldPosition(this.footL);
      B.RightFoot.getWorldPosition(this.footR);
      B.LeftFoot.getWorldQuaternion(this.footQL);
      B.RightFoot.getWorldQuaternion(this.footQR);
      // Lower the hips in world space (the rig's own units are not metres).
      this.hips.getWorldPosition(this.t1);
      this.t1.y -= f.crouch * 0.46;
      if (this.hips.parent) this.hips.parent.worldToLocal(this.t1);
      this.hips.position.copy(this.t1);
      this.hips.updateMatrixWorld(true);
      // Knees bend forward (the way the player faces).
      this.pole.set(-Math.sin(f.yaw), 0.15, -Math.cos(f.yaw));
      solveTwoBone(B.LeftUpLeg, B.LeftLeg, B.LeftFoot, this.footL, this.pole);
      solveTwoBone(B.RightUpLeg, B.RightLeg, B.RightFoot, this.footR, this.pole);
      setWorldQuaternion(B.LeftFoot, this.footQL);
      setWorldQuaternion(B.RightFoot, this.footQR);
    }
    // --- Torso follows the aim. ---
    if (this.spine) {
      this.spine.rotation.x += -f.pitch * 0.5 + f.crouch * 0.3;
      this.spine.updateMatrixWorld(true);
    }
    // --- Weapon shouldered, pointing where the player aims. ---
    this.recoil *= Math.exp(-dt * 14);
    const cat = WEAPONS[f.weapon].category;
    const shoulderY = 1.44 - f.crouch * 0.47;
    const reach = cat === 'pistol' ? 0.5 : cat === 'melee' ? 0.42 : 0.3;
    const cp = Math.cos(f.pitch);
    const sp2 = Math.sin(f.pitch);
    // Pivot at the right shoulder; the grip sits `reach` metres in front of it along the aim line.
    this.weaponHolder.position.set(0.13, shoulderY - 0.09 + sp2 * reach, -(cp * reach) + this.recoil * 0.04);
    this.weaponHolder.rotation.set(f.pitch + this.recoil * 0.08, 0, 0);
    this.weaponHolder.updateMatrixWorld(true);
    // --- Arms: both hands on the weapon (arm IK). ---
    if (this.weapon && B.RightArm && B.RightForeArm && B.RightHand && B.LeftArm && B.LeftForeArm && B.LeftHand) {
      // Wrist targets sit slightly behind / below the grips.
      this.weapon.gripRight.getWorldPosition(this.t1);
      this.weapon.gripLeft.getWorldPosition(this.t2);
      const fx = -Math.sin(f.yaw);
      const fz = -Math.cos(f.yaw);
      const rx = Math.cos(f.yaw);
      const rz = -Math.sin(f.yaw);
      this.t1.x -= fx * 0.05;
      this.t1.z -= fz * 0.05;
      this.t1.y -= 0.01;
      this.pole.set(rx * 0.7 - fx * 0.2, -0.75, rz * 0.7 - fz * 0.2);
      solveTwoBone(B.RightArm, B.RightForeArm, B.RightHand, this.t1, this.pole);
      if (cat !== 'melee') {
        this.t2.y -= 0.035;
        this.pole.set(-rx * 0.6 - fx * 0.1, -0.8, -rz * 0.6 - fz * 0.1);
        solveTwoBone(B.LeftArm, B.LeftForeArm, B.LeftHand, this.t2, this.pole);
      }
    }
    // Darken in dark places, glow while protected.
    const l = f.light;
    const pulse = f.protected ? 0.25 + Math.sin(performance.now() * 0.012) * 0.15 : 0;
    for (let i = 0; i < this.mats.length; i++) {
      const b = this.base[i]!;
      const m = this.mats[i]!;
      const s = 0.55 + 0.45 * Math.min(1.2, (l.r + l.g + l.b) / 3);
      m.color.setRGB(b.r * s, b.g * s, b.b * s);
      const g = this.glow[i]!;
      m.emissive.setRGB(g.r + pulse * 0.15, g.g + pulse * 0.4, g.b + pulse * 0.8);
    }
  }

  onFire(): void {
    this.recoil = 1;
  }

  die(impulse: Vec3): void {
    if (this.dead) return;
    this.dead = true;
    this.deathT = 0;
    const fx = -Math.sin(this.root.rotation.y);
    const fz = -Math.cos(this.root.rotation.y);
    // The pivot is turned to face -Z: positive X rotation there tips the body backwards.
    this.deathDir = impulse.x * fx + impulse.z * fz > 0 ? 1 : -1;
    this.weaponHolder.visible = false;
    for (let i = 0; i < this.mats.length; i++) this.mats[i]!.emissive.copy(this.glow[i]!);
  }

  getMuzzle(out: THREE.Vector3): THREE.Vector3 {
    if (this.weapon) {
      this.root.updateMatrixWorld(true);
      return this.weapon.muzzle.getWorldPosition(out);
    }
    return out.set(this.root.position.x, this.root.position.y + 1.4, this.root.position.z);
  }

  getHead(out: THREE.Vector3): THREE.Vector3 {
    if (this.head) return this.head.getWorldPosition(out).add(this.tmp.set(0, 0.3, 0));
    return out.set(this.root.position.x, this.root.position.y + 1.95, this.root.position.z);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.mixer.stopAllAction();
    for (const m of this.mats) m.dispose();
    this.weapon?.dispose();
    void this.yaw;
    void this.pitch;
  }
}

// ---------------------------------------------------------------------------------
// First-person arms: the same character, with everything but the arms discarded in
// the shader, posed by IK so the hands hold the weapon.
// ---------------------------------------------------------------------------------

export interface FirstPersonArms {
  root: THREE.Group;
  /** Wrist targets in the root's parent space (view space). `gripL` null = one-handed. */
  update(gripR: THREE.Vector3, gripL: THREE.Vector3 | null, light: number): void;
  dispose(): void;
}

/** Tunable pose constants (radians / metres), adjusted against screenshots. */
const FP = {
  scale: 1.0,
  /** Where the character's feet go so that its eyes sit at the camera. */
  y: -1.82,
  z: -0.02,
  x: 0.05,
  curl: 1.15,
};

export function createFirstPersonArms(team: number): FirstPersonArms | null {
  const t = template;
  if (!t) return null;
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  const model = cloneSkinned(t.scene);
  pivot.rotation.y = t.yaw;
  pivot.scale.setScalar(t.scale * FP.scale);
  pivot.position.set(FP.x, FP.y * FP.scale, FP.z);
  pivot.add(model);
  root.add(pivot);
  const tint = TEAM_TINT[team] ?? [0.3, 0.3, 0.3];
  const mats: THREE.MeshStandardMaterial[] = [];
  const base: THREE.Color[] = [];
  model.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    mesh.frustumCulled = false;
    const mask = new Float32Array(128);
    mesh.skeleton.bones.forEach((b, i) => {
      if (i < 128 && /(Left|Right)(Arm|ForeArm|Hand)/.test(b.name)) mask[i] = 1;
    });
    const m = (mesh.material as THREE.MeshStandardMaterial).clone();
    m.color.setRGB(m.color.r * tint[0], m.color.g * tint[1], m.color.b * tint[2]);
    m.onBeforeCompile = (shader) => {
      shader.uniforms.basArm = { value: mask };
      shader.vertexShader = shader.vertexShader
        .replace('#include <skinning_pars_vertex>', '#include <skinning_pars_vertex>\nuniform float basArm[128];\nvarying float vBasArm;')
        .replace(
          '#include <skinbase_vertex>',
          '#include <skinbase_vertex>\nvBasArm = dot( skinWeight, vec4( basArm[ int( skinIndex.x ) ], basArm[ int( skinIndex.y ) ], basArm[ int( skinIndex.z ) ], basArm[ int( skinIndex.w ) ] ) );',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vBasArm;')
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif ( vBasArm < 0.5 ) discard;');
    };
    m.customProgramCacheKey = () => 'bas-fp-arms';
    mesh.material = m;
    mats.push(m);
    base.push(m.color.clone());
  });
  const bone = (n: string): THREE.Object3D | null => model.getObjectByName(`mixamorig${n}`) ?? null;
  const chain = {
    ra: bone('RightArm'),
    rf: bone('RightForeArm'),
    rh: bone('RightHand'),
    la: bone('LeftArm'),
    lf: bone('LeftForeArm'),
    lh: bone('LeftHand'),
  };
  // Rest pose of the arm bones (IK starts from it every frame) and curled fingers.
  const rest = new Map<THREE.Object3D, THREE.Quaternion>();
  for (const b of Object.values(chain)) if (b) rest.set(b, b.quaternion.clone());
  model.traverse((o) => {
    const m = /^mixamorig(Left|Right)Hand(Index|Middle|Ring|Pinky)([123])$/.exec(o.name);
    if (m) o.rotateZ((m[1] === 'Right' ? -1 : 1) * FP.curl * (m[3] === '1' ? 0.75 : 1));
  });
  const pole = new THREE.Vector3();
  const tgt = new THREE.Vector3();
  return {
    root,
    update(gripR, gripL, light) {
      for (const [b, q] of rest) b.quaternion.copy(q);
      root.updateMatrixWorld(true);
      if (chain.ra && chain.rf && chain.rh) {
        root.localToWorld(tgt.copy(gripR));
        solveTwoBone(chain.ra, chain.rf, chain.rh, tgt, pole.set(0.75, -0.65, 0.1));
      }
      if (chain.la && chain.lf && chain.lh) {
        if (gripL) {
          root.localToWorld(tgt.copy(gripL));
          solveTwoBone(chain.la, chain.lf, chain.lh, tgt, pole.set(-0.75, -0.65, 0.1));
        } else {
          // Free hand: tucked low, out of view.
          root.localToWorld(tgt.set(-0.25, -0.6, -0.05));
          solveTwoBone(chain.la, chain.lf, chain.lh, tgt, pole.set(-0.75, -0.65, 0.1));
        }
      }
      const s = 0.5 + 0.5 * Math.min(1.2, light);
      for (let i = 0; i < mats.length; i++) mats[i]!.color.setRGB(base[i]!.r * s, base[i]!.g * s, base[i]!.b * s);
    },
    dispose() {
      root.removeFromParent();
      for (const m of mats) m.dispose();
    },
  };
}
