/** Third-person player model: procedural low-poly humanoid with team outfit and animations. */
import * as THREE from 'three';
import type { TeamId } from '../../../shared/constants';
import { hashStr } from '../util';
import type { Vec3 } from '../../../shared/math/vec3';
import { WEAPONS, type WeaponId } from '../../../shared/weapons/defs';
import type { AvatarFrame, IAvatar } from '../../core/contracts';
import { getWeaponAsset } from '../weapons/assets';
import { createWeaponModel, type WeaponModel } from '../weapons/models';
import { preloadSoldier, SoldierAvatar, soldierReady } from './soldier';

const SKIN = [0xf1c9a5, 0xe0ac7e, 0xc68642, 0x8d5524, 0xf6d7bd];
const HAIR = [0x2b1b12, 0x5a3a1e, 0x111111, 0xb88a4a, 0x7a7a7a, 0x8a3b1e];

const blobTex = ((): (() => THREE.Texture) => {
  let t: THREE.Texture | null = null;
  return () => {
    if (!t) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d')!;
      const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
      gr.addColorStop(0, 'rgba(0,0,0,0.55)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
      t = new THREE.CanvasTexture(c);
    }
    return t;
  };
})();

class Avatar implements IAvatar {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private hips = new THREE.Group();
  private chest = new THREE.Group();
  private head: THREE.Mesh;
  private legL: THREE.Group;
  private legR: THREE.Group;
  private shinL: THREE.Group;
  private shinR: THREE.Group;
  private arms = new THREE.Group();
  private weaponHolder = new THREE.Group();
  private weapon: WeaponModel | null = null;
  private weaponId: WeaponId | null = null;
  private blob: THREE.Mesh;
  private mats: THREE.MeshLambertMaterial[] = [];
  private base: THREE.Color[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private phase = 0;
  private recoil = 0;
  private dead = false;
  private deathT = 0;
  private deathDir = 1;
  private deathYaw = 0;
  private scale: number;

  constructor(team: TeamId, name: string) {
    const h = hashStr(name);
    const skin = SKIN[h % SKIN.length]!;
    const hair = HAIR[(h >> 4) % HAIR.length]!;
    this.scale = 0.98 + ((h >> 8) % 5) * 0.01;
    const labo = team === 0;
    const coat = labo ? 0xf4f5f2 : 0x35383d;
    const trousers = labo ? 0x2f6fb5 : 0x2a2c30;
    const accent = labo ? 0x3182ce : 0xe7343f;
    const shoes = labo ? 0xf0f0f0 : 0x16161a;
    const gloves = labo ? 0x3a8fe0 : skin;

    const m = (c: number): THREE.MeshLambertMaterial => {
      const mm = new THREE.MeshLambertMaterial({ color: c });
      this.mats.push(mm);
      this.base.push(new THREE.Color(c));
      return mm;
    };
    const box = (parent: THREE.Object3D, w: number, hh: number, d: number, x: number, y: number, z: number, mat: THREE.Material): THREE.Mesh => {
      const g = new THREE.BoxGeometry(w, hh, d);
      this.geos.push(g);
      const mesh = new THREE.Mesh(g, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const mCoat = m(coat);
    const mTr = m(trousers);
    const mSkin = m(skin);
    const mAcc = m(accent);
    const mShoe = m(shoes);
    const mHair = m(hair);
    const mGlove = m(gloves);
    const mShirt = m(labo ? 0x2f6fb5 : 0xf2f2f2);

    this.root.add(this.body);
    this.body.add(this.hips);
    this.hips.position.y = 0.92;
    // Legs (pivot at the hip)
    const leg = (x: number): [THREE.Group, THREE.Group] => {
      const thigh = new THREE.Group();
      thigh.position.set(x, 0, 0);
      this.hips.add(thigh);
      box(thigh, 0.16, 0.46, 0.18, 0, -0.23, 0, mTr);
      const shin = new THREE.Group();
      shin.position.set(0, -0.46, 0);
      thigh.add(shin);
      box(shin, 0.14, 0.42, 0.16, 0, -0.21, 0, mTr);
      box(shin, 0.15, 0.08, 0.27, 0, -0.42, -0.04, mShoe);
      return [thigh, shin];
    };
    [this.legL, this.shinL] = leg(-0.1);
    [this.legR, this.shinR] = leg(0.1);
    box(this.hips, 0.38, 0.2, 0.22, 0, 0.06, 0, mTr);
    // Torso
    this.hips.add(this.chest);
    this.chest.position.y = 0.14;
    box(this.chest, 0.44, 0.52, 0.24, 0, 0.27, 0, mCoat);
    box(this.chest, 0.12, 0.3, 0.02, 0, 0.36, -0.125, mShirt); // shirt / scrubs showing
    if (labo) {
      box(this.chest, 0.46, 0.34, 0.26, 0, -0.1, 0, mCoat); // long coat tail
      box(this.chest, 0.07, 0.05, 0.01, 0.12, 0.36, -0.126, mAcc); // badge
    } else {
      box(this.chest, 0.045, 0.26, 0.01, 0, 0.33, -0.137, mAcc); // red tie
      box(this.chest, 0.1, 0.07, 0.02, 0.23, 0.36, 0, mAcc); // armband
      box(this.chest, 0.2, 0.28, 0.02, -0.02, 0.16, 0.135, m(0x8a6a3a)); // clipboard on the back
    }
    // Head
    box(this.chest, 0.1, 0.08, 0.1, 0, 0.54, 0, mSkin);
    this.head = box(this.chest, 0.22, 0.24, 0.23, 0, 0.65, 0, mSkin);
    box(this.head, 0.235, 0.09, 0.245, 0, 0.09, 0.005, mHair);
    box(this.head, 0.235, 0.14, 0.06, 0, 0.0, 0.095, mHair);
    if (labo && h % 3 === 0) box(this.head, 0.24, 0.05, 0.25, 0, 0.115, 0, mAcc); // surgical cap
    if (h % 4 === 1 || !labo) box(this.head, 0.2, 0.035, 0.01, 0, 0.02, -0.12, m(0x111111)); // glasses
    // Arms + weapon (aim with pitch)
    this.chest.add(this.arms);
    this.arms.position.set(0, 0.44, 0);
    const armR = box(this.arms, 0.11, 0.11, 0.5, 0.2, -0.05, -0.2, mCoat);
    armR.rotation.y = 0.25;
    const armL = box(this.arms, 0.11, 0.11, 0.56, -0.17, -0.07, -0.26, mCoat);
    armL.rotation.y = -0.5;
    box(this.arms, 0.1, 0.1, 0.1, 0.13, -0.06, -0.44, mGlove);
    box(this.arms, 0.1, 0.1, 0.1, -0.03, -0.08, -0.52, mGlove);
    this.arms.add(this.weaponHolder);
    this.weaponHolder.position.set(0.1, -0.02, -0.42);

    const bg = new THREE.PlaneGeometry(1.1, 1.1);
    bg.rotateX(-Math.PI / 2);
    this.geos.push(bg);
    this.blob = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ map: blobTex(), transparent: true, depthWrite: false }));
    this.blob.position.y = 0.02;
    this.blob.renderOrder = 1;
    this.root.add(this.blob);
    this.root.scale.setScalar(this.scale);
  }

  private setWeapon(id: WeaponId): void {
    // Rebuilt when the weapon changes, or when its real model has arrived since (slow download).
    if (id === this.weaponId && !(this.weapon && !this.weapon.detailed && getWeaponAsset(id))) return;
    if (this.weapon) {
      this.weaponHolder.remove(this.weapon.root);
      this.weapon.dispose();
    }
    this.weaponId = id;
    this.weapon = createWeaponModel(id, 'world');
    this.weaponHolder.add(this.weapon.root);
  }

  update(f: AvatarFrame): void {
    const dt = Math.min(0.05, f.dt);
    if (this.dead) {
      // Collapse: fall over, settle on the ground.
      this.deathT = Math.min(1, this.deathT + dt * 1.6);
      const k = 1 - (1 - this.deathT) * (1 - this.deathT);
      this.body.rotation.x = this.deathDir * k * 1.5;
      this.body.position.y = -k * 0.72;
      this.hips.rotation.y = this.deathYaw * k;
      this.legL.rotation.x = -k * 0.3;
      this.legR.rotation.x = k * 0.25;
      this.arms.rotation.x = k * 1.0 * this.deathDir;
      return;
    }
    this.setWeapon(f.weapon);
    this.root.position.set(f.pos.x, f.pos.y, f.pos.z);
    this.root.rotation.y = f.yaw;
    // Locomotion
    const run = f.onGround ? Math.min(1, f.speed / 5) : 0;
    this.phase += dt * (2 + f.speed * 1.9);
    const sw = Math.sin(this.phase) * 0.85 * run;
    const c = f.crouch;
    const air = f.onGround ? 0 : 1;
    this.legL.rotation.x = sw - c * 1.15 - air * 0.35;
    this.legR.rotation.x = -sw - c * 1.15 - air * 0.15;
    this.shinL.rotation.x = Math.max(0, -Math.sin(this.phase + 0.6)) * 1.1 * run + c * 2.0 + air * 0.6;
    this.shinR.rotation.x = Math.max(0, Math.sin(this.phase + 0.6)) * 1.1 * run + c * 2.0 + air * 0.4;
    // Crouch lowers the hips so the head top matches the crouched hull (1.3 m).
    this.hips.position.y = 0.92 - c * 0.44 + Math.abs(Math.cos(this.phase)) * 0.03 * run;
    this.chest.rotation.x = -c * 0.25 - run * 0.08 + Math.sin(this.phase * 0.5) * 0.01;
    this.chest.rotation.y = Math.sin(this.phase) * 0.06 * run;
    // Aim
    this.recoil *= Math.exp(-dt * 14);
    const reload = f.reloading ? 0.5 + Math.sin(this.phase * 0.5 + performance.now() * 0.006) * 0.12 : 0;
    this.arms.rotation.x = f.pitch * 0.85 + c * 0.25 + this.recoil * 0.12 - reload;
    this.head.rotation.x = f.pitch * 0.5;
    const cat = WEAPONS[f.weapon].category;
    this.weaponHolder.position.z = cat === 'pistol' || cat === 'melee' ? -0.5 : -0.38;
    // Light tint + spawn protection glow.
    const l = f.light;
    const pulse = f.protected ? 0.25 + Math.sin(performance.now() * 0.012) * 0.15 : 0;
    for (let i = 0; i < this.mats.length; i++) {
      const b = this.base[i]!;
      const mm = this.mats[i]!;
      mm.color.setRGB(b.r * l.r, b.g * l.g, b.b * l.b);
      mm.emissive.setRGB(pulse * 0.2, pulse * 0.5, pulse);
    }
    (this.blob.material as THREE.MeshBasicMaterial).opacity = f.onGround ? 1 : 0.35;
  }

  onFire(): void {
    this.recoil = 1;
  }

  die(impulse: Vec3): void {
    if (this.dead) return;
    this.dead = true;
    this.deathT = 0;
    // Fall away from the shot, relative to the facing direction.
    const fx = -Math.sin(this.root.rotation.y);
    const fz = -Math.cos(this.root.rotation.y);
    this.deathDir = impulse.x * fx + impulse.z * fz > 0 ? -1 : 1;
    this.deathYaw = (Math.random() - 0.5) * 0.8;
    this.blob.visible = false;
    for (const mm of this.mats) mm.emissive.setRGB(0, 0, 0);
  }

  getMuzzle(out: THREE.Vector3): THREE.Vector3 {
    if (this.weapon) {
      this.root.updateMatrixWorld(true);
      return this.weapon.muzzle.getWorldPosition(out);
    }
    return out.set(this.root.position.x, this.root.position.y + 1.4, this.root.position.z);
  }

  getHead(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.root.position.x, this.root.position.y + this.hips.position.y + 1.05, this.root.position.z);
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const g of this.geos) g.dispose();
    for (const mm of this.mats) mm.dispose();
    this.weapon?.dispose();
  }
}

/** Realistic rigged soldier when the model is loaded, procedural silhouette otherwise. */
export function createAvatar(team: TeamId, name: string): IAvatar {
  return soldierReady() ? new SoldierAvatar(team) : new Avatar(team, name);
}

/** True for a simple stand-in whose real character model has arrived since (slow download): replace it. */
export function avatarOutdated(avatar: IAvatar): boolean {
  return avatar instanceof Avatar && soldierReady();
}

export { preloadSoldier as preloadAvatarAssets };
