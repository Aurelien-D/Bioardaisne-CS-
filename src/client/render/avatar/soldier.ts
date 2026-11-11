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
import { createWeaponModel, type WeaponModel } from '../weapons/models';

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
      .loadAsync(new URL('media/models/soldier.glb', document.baseURI).href)
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
  0: [0.42, 0.68, 1.5], // Équipe Labo: blue
  1: [1.5, 0.45, 0.4], // Auditeurs: red
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
  private mats: THREE.MeshStandardMaterial[] = [];
  private base: THREE.Color[] = [];
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
    // Crouch: the whole body is compressed (no dedicated animation in the model).
    const t = template!;
    this.pivot.scale.set(t.scale, t.scale * (1 - f.crouch * 0.28), t.scale);
    // Lean the torso with the aim.
    if (this.spine) this.spine.rotation.x += -f.pitch * 0.55 + f.crouch * 0.25;
    // Weapon: carried at the right hand, always pointing where the player aims.
    this.recoil *= Math.exp(-dt * 14);
    this.root.updateMatrixWorld(true);
    if (this.hand) {
      this.hand.getWorldPosition(this.tmp);
      this.root.worldToLocal(this.tmp);
      this.weaponHolder.position.set(this.tmp.x * 0.35 + 0.12, Math.max(this.tmp.y, 1.05 - f.crouch * 0.35) + 0.12, this.tmp.z * 0.35 - 0.28 + this.recoil * 0.05);
    } else this.weaponHolder.position.set(0.15, 1.25, -0.3);
    this.weaponHolder.rotation.set(f.pitch + this.recoil * 0.1, 0, 0);
    // Darken in dark places, glow while protected.
    const l = f.light;
    const pulse = f.protected ? 0.25 + Math.sin(performance.now() * 0.012) * 0.15 : 0;
    for (let i = 0; i < this.mats.length; i++) {
      const b = this.base[i]!;
      const m = this.mats[i]!;
      const s = 0.55 + 0.45 * Math.min(1.2, (l.r + l.g + l.b) / 3);
      m.color.setRGB(b.r * s, b.g * s, b.b * s);
      m.emissive.setRGB(pulse * 0.15, pulse * 0.4, pulse * 0.8);
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
    for (const m of this.mats) m.emissive.setRGB(0, 0, 0);
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
