/**
 * First-person weapon: the weapon model held by the character's own arms (IK), procedural
 * animation (recoil springs, sway, bob, landing, draw / holster, reload, action cycling),
 * aiming down the sights, muzzle flash with its light pulse, smoke and ejected brass.
 *
 * Everything lives in view space: the camera of the overlay scene sits at the origin and
 * looks down -Z, so the centre of the screen — where the bullets go — is the -Z axis.
 */
import * as THREE from 'three';
import { WEAPONS, type WeaponId } from '../../../shared/weapons/defs';
import type { IViewModel, ViewModelFrame } from '../../core/contracts';
import { createFirstPersonArms, soldierReady, type FirstPersonArms, type HandTarget } from '../avatar/soldier';
import { flashClass, MuzzleFlash } from '../effects/flash';
import { getWeaponAsset } from '../weapons/assets';
import { createWeaponModel, type WeaponModel } from '../weapons/models';
import { ViewFx, type CasingKind } from './fx';

type Cat = 'melee' | 'pistol' | 'smg' | 'rifle' | 'shotgun' | 'sniper';

/** Hip position of the grip (view space, metres). */
const HIP: Record<Cat, [number, number, number]> = {
  melee: [0.14, -0.12, -0.3],
  pistol: [0.1, -0.105, -0.33],
  smg: [0.1, -0.115, -0.27],
  rifle: [0.1, -0.12, -0.25],
  shotgun: [0.1, -0.12, -0.26],
  sniper: [0.1, -0.12, -0.25],
};

/** Scale of the weapon in view space. */
const SCALE = 0.88;

/** Recoil of one shot: peak travel, then a damped spring brings the weapon back. */
interface Feel {
  /** Back (m), up (m), muzzle climb (rad), roll (rad), yaw (rad). */
  back: number;
  rise: number;
  pitch: number;
  roll: number;
  yaw: number;
  /** Spring: natural frequency (rad/s) and damping ratio — heavy weapons settle slowly. */
  w: number;
  z: number;
  casing: CasingKind | null;
  /** Smoke per shot (opacity) and barrel heat per shot (the wisp after a burst). */
  smoke: number;
  heat: number;
}

const FEEL: Record<WeaponId, Feel> = {
  knife: { back: 0, rise: 0, pitch: 0, roll: 0, yaw: 0, w: 20, z: 0.7, casing: null, smoke: 0, heat: 0 },
  pistol: { back: 0.02, rise: 0.005, pitch: 0.075, roll: 0.02, yaw: 0.012, w: 27, z: 0.5, casing: 'pistol', smoke: 0.2, heat: 0.3 },
  deagle: { back: 0.036, rise: 0.012, pitch: 0.19, roll: 0.035, yaw: 0.02, w: 19, z: 0.5, casing: 'magnum', smoke: 0.32, heat: 0.6 },
  smg: { back: 0.009, rise: 0.002, pitch: 0.016, roll: 0.012, yaw: 0.008, w: 30, z: 0.6, casing: 'pistol', smoke: 0.14, heat: 0.14 },
  rifle_ak: { back: 0.018, rise: 0.003, pitch: 0.03, roll: 0.018, yaw: 0.012, w: 24, z: 0.55, casing: 'rifle', smoke: 0.19, heat: 0.2 },
  rifle_m4: { back: 0.014, rise: 0.0025, pitch: 0.022, roll: 0.014, yaw: 0.009, w: 26, z: 0.58, casing: 'rifle', smoke: 0.17, heat: 0.18 },
  shotgun: { back: 0.055, rise: 0.014, pitch: 0.16, roll: 0.03, yaw: 0.02, w: 15, z: 0.6, casing: 'shell', smoke: 0.42, heat: 0.7 },
  sniper: { back: 0.065, rise: 0.012, pitch: 0.12, roll: 0.025, yaw: 0.015, w: 13, z: 0.62, casing: 'long', smoke: 0.42, heat: 0.8 },
};

/** Damped spring toward zero (or a target), driven by impulses. */
class Spring {
  x = 0;
  v = 0;
  private k: number;
  private c: number;
  constructor(w: number, z: number) {
    this.k = w * w;
    this.c = 2 * z * w;
  }
  tune(w: number, z: number): void {
    this.k = w * w;
    this.c = 2 * z * w;
  }
  step(dt: number, target = 0): number {
    // Sub-steps keep the integration stable and frame-rate independent enough.
    const n = dt > 0.008 ? Math.ceil(dt / 0.008) : 1;
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += ((target - this.x) * this.k - this.v * this.c) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
  reset(): void {
    this.x = this.v = 0;
  }
}

/** Velocity that makes a spring (w, z) peak at `peak`. */
function impulse(peak: number, w: number, z: number): number {
  const s = Math.sqrt(Math.max(1e-4, 1 - z * z));
  return (peak * w) / Math.exp((-z * Math.atan2(s, z)) / s);
}

/**
 * Recoil impulse of one shot on a spring. Capped: at a low frame rate several shots land in
 * the same frame, and they must not add up to a kick the weapon never has.
 */
function kick(spring: Spring, peak: number, f: Feel, scale: number): void {
  const v = impulse(peak, f.w, f.z);
  spring.v = clampN(spring.v + v * scale, -2.2 * v, 2.2 * v);
}

const clampN = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const seg = (p: number, a: number, b: number): number => clampN((p - a) / (b - a), 0, 1);
const smooth = (t: number): number => {
  const c = clampN(t, 0, 1);
  return c * c * (3 - 2 * c);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** True on the frame where a timeline goes past `at`. */
const hit = (prev: number, now: number, at: number): boolean => prev < at && now >= at;

const newHand = (): HandTarget => ({ pos: new THREE.Vector3(), fingers: new THREE.Vector3(), palm: new THREE.Vector3() });

/** Offsets added to the hip pose (metres / radians). */
interface PoseOffset {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}

class ViewModel implements IViewModel {
  readonly root = new THREE.Group();
  private holder = new THREE.Group();
  private models = new Map<WeaponId, WeaponModel>();
  private model: WeaponModel | null = null;
  private id: WeaponId | null = null;
  /** Weapon waiting for the current one to be lowered (undefined = no switch in progress). */
  private pending: WeaponId | null | undefined = undefined;
  private holsterT = 0;
  private armR: THREE.Group;
  private armL: THREE.Group;
  private mats: THREE.MeshStandardMaterial[] = [];

  private flash = new MuzzleFlash(true);
  private flashLight = new THREE.PointLight(0xffb468, 0, 2.6, 2);
  private rim = new THREE.DirectionalLight(0xc4d6ff, 0);
  private fill = new THREE.DirectionalLight(0xffe2c4, 0);
  private fx = new ViewFx();

  private t = 0;
  private bob = 0;
  private bobAmp = 0;
  // Recoil
  private kBack = new Spring(24, 0.55);
  private kRise = new Spring(24, 0.55);
  private kPitch = new Spring(24, 0.55);
  private kRoll = new Spring(24, 0.55);
  private kYaw = new Spring(24, 0.55);
  // Sway (the weapon lags behind the view) and vertical inertia (jump / landing)
  private swayYaw = new Spring(11, 0.62);
  private swayPitch = new Spring(11, 0.62);
  private drop = new Spring(13, 0.5);
  // Reload jolts (magazine out / in, bolt)
  private jolt = new Spring(22, 0.45);
  private joltRoll = new Spring(20, 0.45);
  private wasGround = true;
  private airT = 0;
  private drawT = 0;
  private drawDur = 0;
  private reloadT = 0;
  private reloadDur = 0;
  private reloadP = 0;
  private actionT = 0;
  private actionDur = 0;
  private ejectT = 0;
  private dry = 0;
  private slash = 0;
  private slashSide = 1;
  private zoomK = 0;
  private adsK = 0;
  private heat = 0;
  private sinceShot = 10;
  private wisp = 0;
  private lightK = 1;
  private yaw = 0;
  private env: THREE.Texture | null = null;
  private envSeen = false;
  /** Offsets applied to moving parts this frame (weapon frame). */
  private pumpZ = 0;
  private boltHand = 0;
  private boltLift = 0;
  private boltZ = 0;

  /** Realistic arms (the player model's own), once the character is loaded. */
  private fp: FirstPersonArms | null = null;
  private fpTeam = -1;
  private handR = newHand();
  private handL = newHand();
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private e1 = new THREE.Euler();
  private q1 = new THREE.Quaternion();
  private tint = new THREE.Color();

  constructor() {
    this.root.add(this.holder, this.fx.group);
    this.holder.scale.setScalar(SCALE);
    this.armR = this.makeArm();
    this.armL = this.makeArm();
    this.holder.add(this.armR, this.armL);
    this.holder.add(this.flash.group, this.flashLight);
    // Soft rim from the front-left and a warm fill from behind the right shoulder: they keep
    // the silhouette of the weapon readable whatever the direction of the sun.
    this.rim.position.set(-1.1, 0.9, -1.6);
    this.fill.position.set(0.9, 0.35, 1.2);
    this.rim.target.position.set(0.05, -0.08, -0.4);
    this.fill.target.position.set(0.05, -0.08, -0.4);
    this.root.add(this.rim, this.rim.target, this.fill, this.fill.target);
  }

  /** Fallback arm (the character model is not loaded): sleeve + glove; origin at the hand. */
  private makeArm(): THREE.Group {
    const g = new THREE.Group();
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x1f2b40, roughness: 0.95 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x3a8fe0, roughness: 0.55 });
    this.mats.push(sleeve, glove);
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.34), sleeve);
    fore.position.set(0, 0, 0.22);
    const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.085, 0.03), sleeve);
    cuff.position.set(0, 0, 0.06);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.085, 0.09), glove);
    hand.position.set(0, 0, 0);
    const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.04, 0.05), glove);
    fingers.position.set(0, -0.035, -0.055);
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.03, 0.06), glove);
    thumb.position.set(-0.04, 0.02, -0.03);
    g.add(fore, cuff, hand, fingers, thumb);
    return g;
  }

  // --- Weapon switching ----------------------------------------------------------

  setWeapon(id: WeaponId | null): void {
    const target = this.pending !== undefined ? this.pending : this.id;
    if (id === target) return;
    this.reloadT = this.reloadDur = 0;
    // A weapon in hand and on screen is lowered first; the new one comes up afterwards.
    if (this.id !== null && this.root.visible && this.model) {
      this.pending = id;
      if (this.holsterT <= 0) this.holsterT = HOLSTER;
      return;
    }
    this.swap(id);
  }

  private swap(id: WeaponId | null): void {
    this.resetParts();
    if (this.model) this.holder.remove(this.model.root);
    this.pending = undefined;
    this.holsterT = 0;
    this.id = id;
    this.model = null;
    this.reloadT = this.reloadDur = 0;
    this.actionT = this.ejectT = 0;
    this.heat = 0;
    this.kBack.reset();
    this.kRise.reset();
    this.kPitch.reset();
    this.kRoll.reset();
    this.kYaw.reset();
    this.jolt.reset();
    this.joltRoll.reset();
    if (!id) {
      this.armR.visible = this.armL.visible = false;
      return;
    }
    let m = this.models.get(id);
    // A procedural stand-in is replaced once the real model has been loaded.
    if (m && !m.detailed && getWeaponAsset(id)) {
      m.dispose();
      m = undefined;
    }
    if (!m) {
      m = createWeaponModel(id, 'view');
      this.models.set(id, m);
      for (const mat of m.materials) {
        mat.userData.base = mat.color.clone();
        mat.envMap = this.env;
      }
    }
    this.model = m;
    this.holder.add(m.root);
    const f = FEEL[id];
    for (const s of [this.kBack, this.kRise, this.kPitch, this.kRoll, this.kYaw]) s.tune(f.w, f.z);
    const cat = WEAPONS[id].category;
    this.armR.visible = true;
    this.armL.visible = cat !== 'melee';
    // Fallback arms: right hand on the grip, left hand on the fore-end (or under the magazine for pistols).
    this.armR.position.set(0.012, -0.06, 0.03);
    this.armR.rotation.set(0.5, -0.12, -0.25);
    const l = m.gripLeft.position;
    if (cat === 'pistol') {
      this.armL.position.set(-0.03, l.y - 0.03, l.z + 0.01);
      this.armL.rotation.set(0.45, 0.7, 0.5);
    } else {
      this.armL.position.set(-0.01, l.y - 0.04, l.z);
      this.armL.rotation.set(0.25, 0.95, 0.9);
    }
  }

  /** Put every moving part back at its rest position. */
  private resetParts(): void {
    const parts = this.model?.parts;
    if (!parts) return;
    for (const name in parts) {
      const part = parts[name]!;
      const rest = part.userData.rest as THREE.Vector3 | undefined;
      if (rest) part.position.copy(rest);
      part.quaternion.identity();
      part.visible = true;
    }
  }

  private part(name: string): THREE.Object3D | null {
    const part = this.model?.parts[name];
    if (!part) return null;
    if (!part.userData.rest) part.userData.rest = part.position.clone();
    return part;
  }

  // --- Events ------------------------------------------------------------------------

  onFire(): void {
    if (!this.id || !this.model || this.pending !== undefined) return;
    const d = WEAPONS[this.id];
    if (d.kind === 'melee') {
      this.slash = 1;
      this.slashSide = -this.slashSide;
      return;
    }
    const f = FEEL[this.id];
    const cat = d.category as Cat;
    kick(this.kBack, f.back, f, 1);
    kick(this.kRise, f.rise, f, 1);
    kick(this.kPitch, f.pitch, f, 1);
    kick(this.kRoll, f.roll, f, (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5));
    kick(this.kYaw, f.yaw, f, Math.random() * 2 - 1);
    // Aiming, the glare of the flash is kept off the sight picture.
    this.flash.fire(flashClass(cat), this.id === 'deagle' ? 1.35 : 1, 1 - this.adsK * 0.65);
    this.sinceShot = 0;
    this.heat = Math.min(1, this.heat + f.heat);
    // Action: self-loaders cycle at once, the pump and the bolt are worked by hand afterwards.
    if (cat === 'shotgun') {
      this.actionDur = Math.min(0.62, d.fireInterval * 0.72);
      this.ejectT = this.actionDur * 0.5;
    } else if (cat === 'sniper') {
      this.actionDur = Math.min(1.05, d.fireInterval * 0.74);
      this.ejectT = this.actionDur * 0.42;
    } else {
      this.actionDur = 0.075;
      this.ejectT = 1e-4;
    }
    this.actionT = this.actionDur;
    // Smoke leaving the muzzle with the shot.
    this.holder.updateMatrix();
    const mz = this.v1.copy(this.model.muzzle.position).applyMatrix4(this.holder.matrix);
    const dir = this.v2.set(0, 0, -1).applyQuaternion(this.holder.quaternion);
    const grey = 0.5 + Math.random() * 0.14;
    for (let i = 0; i < 2; i++) {
      const sp = 0.9 + i * 1.6 + Math.random() * 0.8;
      this.fx.puff(
        mz,
        dir.x * sp + (Math.random() - 0.5) * 0.25,
        dir.y * sp + 0.1 + Math.random() * 0.2,
        dir.z * sp,
        0.035,
        0.2 + Math.random() * 0.14 + i * 0.08,
        0.5 + Math.random() * 0.35,
        f.smoke,
        grey,
      );
    }
  }

  onDryFire(): void {
    this.dry = 1;
  }

  onReload(duration: number): void {
    this.reloadDur = duration;
    this.reloadT = duration;
    this.reloadP = 0;
  }

  onDraw(duration: number): void {
    // While the previous weapon is being lowered, the raise takes what is left of the time.
    const lowering = this.pending !== undefined ? this.holsterT : 0;
    this.drawDur = Math.max(0.12, duration - lowering);
    this.drawT = this.drawDur;
  }

  cancelReload(): void {
    this.reloadT = 0;
    this.resetParts();
  }

  // --- Frame -------------------------------------------------------------------------

  update(f: ViewModelFrame): void {
    const dt = clampN(f.dt, 0, 0.05);
    this.t += dt;

    // Holster the previous weapon, then bring up the new one.
    if (this.pending !== undefined) {
      this.holsterT -= dt;
      if (this.holsterT <= 0) this.swap(this.pending);
    }
    const id = this.id;
    const model = this.model;
    const cat: Cat = id ? (WEAPONS[id].category as Cat) : 'rifle';
    const hip = HIP[cat];

    // Scoped rifle: it comes up to the eye while the scope picture fades in, then hides.
    const zoomed = cat === 'sniper' && f.zoom > 0;
    this.zoomK = clampN(this.zoomK + (zoomed ? dt / 0.09 : -dt / 0.17), 0, 1);
    if (cat !== 'sniper') this.zoomK = 0;
    this.root.visible = id !== null && this.zoomK < 1;
    const adsIn = cat === 'melee' ? 0 : cat === 'sniper' ? this.zoomK : f.ads;
    const ads = smooth(adsIn);
    this.adsK = ads;
    const steady = 1 - ads * 0.86;

    this.light(f, dt);

    // --- Motion sources ---
    // Bob: stride tied to the speed, a flattened figure of eight.
    const moving = f.onGround ? Math.min(1, f.speed / 5.5) : 0;
    this.bobAmp += (moving - this.bobAmp) * Math.min(1, dt * 8);
    this.bob += dt * (3.4 + f.speed * 1.5);
    const bobX = Math.sin(this.bob) * 0.0105 * this.bobAmp;
    const bobY = (Math.cos(this.bob * 2) - 1) * 0.0058 * this.bobAmp;
    // Vertical inertia: the weapon sinks when the player takes off or lands.
    if (f.onGround && !this.wasGround) this.drop.v -= 0.5 + Math.min(1, this.airT / 0.6) * 0.75;
    if (!f.onGround && this.wasGround) this.drop.v -= 0.32;
    this.airT = f.onGround ? 0 : this.airT + dt;
    this.wasGround = f.onGround;
    this.drop.step(dt, f.onGround ? 0 : 0.006);
    // Sway: turning speed of the view → the weapon trails behind.
    const inv = dt > 1e-4 ? 1 / dt : 0;
    this.swayYaw.step(dt, clampN(f.lookDeltaYaw * inv * 0.009, -0.075, 0.075));
    this.swayPitch.step(dt, clampN(f.lookDeltaPitch * inv * 0.009, -0.06, 0.06));
    this.yaw += f.lookDeltaYaw;
    const sy = this.swayYaw.x;
    const sp = this.swayPitch.x;
    // Recoil
    this.kBack.step(dt);
    this.kRise.step(dt);
    this.kPitch.step(dt);
    this.kRoll.step(dt);
    this.kYaw.step(dt);
    this.jolt.step(dt);
    this.joltRoll.step(dt);
    this.dry *= Math.exp(-dt * 20);
    this.slash = Math.max(0, this.slash - dt * 3.4);
    const breathe = Math.sin(this.t * 1.35);
    const breathe2 = Math.sin(this.t * 0.83 + 1.3);

    // --- Hip pose ---
    let x = hip[0] + (bobX + sy * 0.26 + breathe2 * 0.0012) * steady;
    let y = hip[1] + (bobY - sp * 0.2 + breathe * 0.0019 - this.bobAmp * 0.004) * steady + this.drop.x * 0.42 * (1 - ads * 0.7) - f.crouch * 0.012 * (1 - ads);
    let z = hip[2] + this.kBack.x + this.bobAmp * 0.006 * steady;
    y += this.kRise.x + this.jolt.x * 0.02;
    let rx = this.kPitch.x + f.punchPitch * 0.35 - sp * 0.85 + this.drop.x * 0.6 - this.dry * 0.02 + breathe * 0.0035 + this.jolt.x * 0.05;
    let ry = -sy * 1.05 + f.punchYaw * 0.35 + this.kYaw.x + breathe2 * 0.002;
    let rz = sy * 0.55 + bobX * 1.6 + this.kRoll.x + this.joltRoll.x + f.crouch * 0.045;

    // Draw (raise from below, muzzle first) and holster (drop).
    if (this.drawT > 0 && this.pending === undefined) {
      this.drawT -= dt;
      const k = clampN(this.drawT / this.drawDur, 0, 1);
      // Most of the travel happens early; the weapon then settles into the shoulder.
      const e = k * k * k;
      const settle = Math.sin(k * Math.PI) * k;
      y -= e * 0.3 + settle * 0.012;
      x += e * 0.07;
      rx -= e * 0.95 - settle * 0.06;
      rz -= e * 0.5 + settle * 0.05;
      ry += e * 0.25;
    }
    if (this.pending !== undefined) {
      const k = smooth(1 - clampN(this.holsterT / HOLSTER, 0, 1));
      y -= k * 0.24;
      rx -= k * 0.55;
      rz += k * 0.2;
    }

    // Reload and action cycling move the parts and set the pose offsets.
    this.pumpZ = this.boltZ = this.boltLift = this.boltHand = 0;
    let reloading = false; // true: the support hand is on its reload path (handL is set, weapon frame)
    if (model && id) {
      const pose = this.reload(dt, cat, model);
      if (pose) {
        x += pose.x;
        y += pose.y;
        z += pose.z;
        rx += pose.rx;
        ry += pose.ry;
        rz += pose.rz;
        reloading = true;
      }
      const act = this.action(dt, cat, id, model);
      rz += act;
    }

    // Knife slash.
    if (cat === 'melee' && this.slash > 0) {
      const s = Math.sin((1 - this.slash) * Math.PI);
      const wind = Math.sin(Math.min(1, (1 - this.slash) * 3) * Math.PI) * 0.15;
      x -= s * 0.2 * this.slashSide;
      y += wind * 0.1 - s * 0.03;
      z -= s * 0.13;
      ry += s * 0.95 * this.slashSide;
      rz += s * 0.65 * this.slashSide;
      rx -= s * 0.25;
    }

    // --- Aim down the sights: the sight line comes onto the view axis ---
    if (ads > 0 && model) {
      // Residual motion while aiming, and the tilt that lines the two sights up with the screen centre.
      let ax = 0;
      let ay = 0;
      const sf = model.sightFront;
      if (sf) {
        const s0 = model.sight.position;
        const dz = s0.z - sf.position.z;
        ax = Math.atan2(s0.y - sf.position.y, dz);
        ay = Math.atan2(sf.position.x - s0.x, dz);
      }
      rx = lerp(rx, rx * 0.32 + ax, ads);
      ry = lerp(ry, ry * 0.3 + ay, ads);
      rz = lerp(rz, rz * 0.4, ads);
      // The weapon turns about the sight: whatever the rotation, the sight stays on the axis.
      this.q1.setFromEuler(this.e1.set(rx, ry, rz));
      const s = this.v1.copy(model.sight.position).multiplyScalar(SCALE).applyQuaternion(this.q1);
      const dist = Math.max(model.view.adsDist * 0.62, model.view.adsDist - this.kBack.x * 0.75);
      const tx = -s.x + (bobX * 0.1 + sy * 0.02) + breathe2 * 0.00035;
      const ty = -s.y + (bobY * 0.1 - sp * 0.02) + breathe * 0.0005 + this.kRise.x * 0.25 + this.drop.x * 0.02;
      const tz = -dist - s.z;
      x = lerp(x, tx, ads);
      y = lerp(y, ty, ads);
      z = lerp(z, tz, ads);
    }
    this.holder.position.set(x, y, z);
    this.holder.rotation.set(rx, ry, rz);
    this.holder.updateMatrix();

    // --- Arms ---
    if (model && id) this.arms(f, cat, model, reloading);

    // --- Flash, light pulse, smoke, brass ---
    if (model && id) this.effects(dt, id, model);
    else this.flashLight.intensity = 0;
    this.fx.update(dt, f.lookDeltaYaw, f.lookDeltaPitch, this.lightK);
  }

  /** Lighting of the view model: follows the light around the player. */
  private light(f: ViewModelFrame, dt: number): void {
    const lum = (f.light.r + f.light.g + f.light.b) / 3;
    this.lightK += (lum - this.lightK) * Math.min(1, dt * 5);
    const L = clampN(this.lightK, 0.2, 1.4);
    // Reflection environment of the overlay scene, taken per material so that its strength can
    // follow the local light (a sunny sky must not shine on the weapon in a dim corridor) and
    // turn with the view.
    const scene = this.root.parent as THREE.Scene | null;
    const env = scene && scene.isScene ? scene.environment : null;
    if (env !== this.env || !this.envSeen) {
      this.env = env;
      this.envSeen = true;
      for (const m of this.models.values()) for (const mat of m.materials) mat.envMap = env;
    }
    const envK = clampN(0.42 + 0.58 * L, 0.5, 1);
    this.fx.setEnvironment(env, envK, -this.yaw);
    this.rim.intensity = 1.5 * (0.3 + 0.7 * L);
    this.fill.intensity = 0.7 * (0.6 + 0.4 * L);
    const model = this.model;
    if (model) {
      // Albedo: never pitch black, never washed out; a hint of the colour of the local light.
      const a = clampN(0.72 + 0.3 * L, 0.8, 1.02);
      const k = lum > 1e-3 ? 0.4 / lum : 0;
      this.tint.setRGB(a * (0.6 + f.light.r * k), a * (0.6 + f.light.g * k), a * (0.6 + f.light.b * k));
      for (const mat of model.materials) {
        const base = mat.userData.base as THREE.Color;
        mat.color.setRGB(base.r * this.tint.r, base.g * this.tint.g, base.b * this.tint.b);
        mat.envMapIntensity = ENV_BOOST * envK;
        mat.envMapRotation.y = -this.yaw;
      }
      for (const lens of model.lenses) lens.setLight(L);
    }
    // Fallback arms follow the light too.
    const l = clampN(lum, 0.35, 1.2);
    this.mats[0]!.color.setRGB(0.12 * l, 0.17 * l, 0.25 * l);
    this.mats[1]!.color.setRGB(0.23 * l, 0.56 * l, 0.88 * l);
    this.mats[2]!.color.copy(this.mats[0]!.color);
    this.mats[3]!.color.copy(this.mats[1]!.color);
  }

  private pose: PoseOffset = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };

  /**
   * Reload: the weapon comes up and cants, the support hand leaves the fore-end, takes the
   * magazine out, brings a fresh one and returns. Sets `handL` (weapon frame → view space is
   * done by arms()) and returns the pose offsets, or null when no reload is playing.
   */
  private reload(dt: number, cat: Cat, model: WeaponModel): PoseOffset | null {
    const mag = this.part('magazine');
    if (this.reloadT <= 0 || this.reloadDur <= 0) {
      if (mag) {
        mag.position.copy(mag.userData.rest as THREE.Vector3);
        mag.visible = true;
      }
      return null;
    }
    const prev = this.reloadP;
    this.reloadT -= dt;
    const p = clampN(1 - this.reloadT / this.reloadDur, 0, 1);
    this.reloadP = p;
    const o = this.pose;
    const L = this.handL;
    // Support-hand stations, in the weapon frame.
    const S = this.supportLocal(cat, model, this.v1);
    const m = model.view.mag ?? [0, -0.1, -0.1];

    if (cat === 'shotgun') {
      // Shells are fed one by one through the loading port, then the action is racked.
      const tilt = smooth(seg(p, 0, 0.1)) * (1 - smooth(seg(p, 0.76, 0.88)));
      o.x = -0.02 * tilt;
      o.y = 0.035 * tilt;
      o.z = 0.03 * tilt;
      o.rx = 0.2 * tilt;
      o.ry = 0.16 * tilt;
      o.rz = -0.8 * tilt;
      const n = 4;
      const span = (0.74 - 0.12) / n;
      const c = p < 0.12 || p >= 0.74 ? -1 : ((p - 0.12) % span) / span;
      const port = this.v2.set(m[0] - 0.02, m[1] - 0.05, m[2] + 0.02);
      const away = this.v3.set(m[0] - 0.16, m[1] - 0.2, m[2] + 0.16);
      if (c < 0) {
        const k = p < 0.12 ? smooth(seg(p, 0.03, 0.12)) : 1 - smooth(seg(p, 0.74, 0.84));
        L.pos.lerpVectors(S, away, k);
      } else {
        const k = c < 0.55 ? smooth(c / 0.55) : c < 0.68 ? 1 : 1 - smooth((c - 0.68) / 0.32);
        L.pos.lerpVectors(away, port, k);
        const at = 0.12 + Math.floor((p - 0.12) / span) * span + span * 0.58;
        if (hit(prev, p, at)) {
          this.jolt.v += 1.6;
          this.joltRoll.v -= 0.5;
        }
      }
      // Rack the action at the end (the hand is back on the fore-end).
      const rack = Math.sin(seg(p, 0.87, 0.98) * Math.PI);
      this.pumpZ = Math.max(this.pumpZ, rack * PUMP_TRAVEL);
      if (hit(prev, p, 0.925)) this.jolt.v -= 1.4;
      L.fingers.set(1, 0.15, -0.35);
      L.palm.set(0.3, 1, 0.2);
      return o;
    }

    if (cat === 'sniper') {
      // Bolt open, rounds pressed in from the top, bolt closed.
      const tilt = smooth(seg(p, 0, 0.1)) * (1 - smooth(seg(p, 0.88, 1)));
      // The open action is turned toward the support hand.
      o.x = -0.025 * tilt;
      o.y = -0.012 * tilt;
      o.z = 0.04 * tilt;
      o.rx = 0.12 * tilt;
      o.ry = 0.14 * tilt;
      o.rz = 0.34 * tilt;
      this.boltLift = Math.max(this.boltLift, smooth(seg(p, 0.08, 0.14)) * (1 - smooth(seg(p, 0.8, 0.86))));
      this.boltZ = Math.max(this.boltZ, smooth(seg(p, 0.14, 0.22)) * (1 - smooth(seg(p, 0.72, 0.8))) * BOLT_TRAVEL);
      if (hit(prev, p, 0.22)) this.jolt.v -= 1.2;
      if (hit(prev, p, 0.8)) this.jolt.v += 1.5;
      const n = 3;
      const span = (0.68 - 0.28) / n;
      const c = p < 0.28 || p >= 0.68 ? -1 : ((p - 0.28) % span) / span;
      const top = this.v2.set(m[0] - 0.075, m[1] - 0.005, m[2] + 0.03);
      const away = this.v3.set(m[0] - 0.2, m[1] - 0.2, m[2] + 0.12);
      let k: number;
      if (c < 0) {
        k = p < 0.28 ? smooth(seg(p, 0.2, 0.28)) : 1 - smooth(seg(p, 0.68, 0.78));
        L.pos.lerpVectors(S, away, k);
        k = 0;
      } else {
        k = c < 0.5 ? smooth(c / 0.5) : c < 0.7 ? 1 : 1 - smooth((c - 0.7) / 0.3);
        L.pos.lerpVectors(away, top, k);
        const at = 0.28 + Math.floor((p - 0.28) / span) * span + span * 0.6;
        if (hit(prev, p, at)) this.jolt.v -= 1.3;
      }
      // The hand turns its palm toward the receiver as it presses the rounds in.
      L.fingers.set(1, 0.15 + k * 0.25, -0.35);
      L.palm.set(0.3 + k * 0.5, 1 - k * 0.7, 0.2);
      return o;
    }

    // Detachable magazine (pistols, sub-machine gun, rifles).
    const pistol = cat === 'pistol';
    const tilt = smooth(seg(p, 0, 0.13)) * (1 - smooth(seg(p, 0.84, 1)));
    o.x = (pistol ? -0.035 : -0.03) * tilt;
    o.y = (pistol ? 0.05 : 0.055) * tilt;
    o.z = (pistol ? 0.03 : 0.02) * tilt;
    o.rx = (pistol ? 0.5 : 0.4) * tilt;
    o.ry = (pistol ? 0.2 : 0.3) * tilt;
    o.rz = (pistol ? -0.38 : -0.42) * tilt;
    const reach = smooth(seg(p, 0.07, 0.23));
    const out = smooth(seg(p, 0.27, 0.4));
    const u = seg(p, 0.5, 0.66);
    const back = u * u * (2 - u); // accelerates into the well, then seats
    const home = smooth(seg(p, 0.7, 0.86));
    const grab = this.v2.set(m[0] - 0.075, m[1] - 0.045, m[2] + 0.03);
    const away = this.v3.set(m[0] - 0.12, m[1] - 0.25, m[2] + 0.1);
    if (p < 0.27) L.pos.lerpVectors(S, grab, reach);
    else if (p < 0.5) L.pos.lerpVectors(grab, away, out);
    else if (p < 0.7) L.pos.lerpVectors(away, grab, back);
    else L.pos.lerpVectors(grab, S, home);
    if (pistol) {
      L.fingers.set(0.4, 0.35, -1);
      L.palm.set(1, 0.15, 0);
    } else {
      L.fingers.set(1, 0.15, -0.35);
      L.palm.set(0.3, 1, 0.2);
    }
    if (mag) {
      // The magazine leaves in the hand and a fresh one comes back in it.
      const rest = mag.userData.rest as THREE.Vector3;
      const travel = p < 0.27 ? 0 : p < 0.5 ? out : p < 0.7 ? 1 - back : 0;
      mag.position.set(rest.x + (away.x - grab.x) * travel, rest.y + (away.y - grab.y) * travel, rest.z + (away.z - grab.z) * travel);
      mag.visible = travel < 0.97;
    }
    if (hit(prev, p, 0.27)) {
      this.jolt.v -= 1.3;
      this.joltRoll.v += 0.5;
    }
    if (hit(prev, p, 0.655)) {
      this.jolt.v += 2.4;
      this.joltRoll.v -= 0.9;
    }
    // Chamber a round: slide / bolt back and forth once the magazine is seated.
    const rack = Math.sin(seg(p, 0.76, 0.86) * Math.PI);
    if (rack > 0) this.boltZ = Math.max(this.boltZ, rack * (pistol ? 0.032 : 0.05));
    if (hit(prev, p, 0.81)) {
      this.jolt.v -= 1.2;
      this.joltRoll.v += 0.4;
    }
    return o;
  }

  /**
   * Action cycling after a shot: slide and bolt of the self-loaders, pump of the shotgun,
   * bolt of the precision rifle (worked by the firing hand). Returns a roll offset.
   */
  private action(dt: number, cat: Cat, id: WeaponId, model: WeaponModel): number {
    let roll = 0;
    let u = -1;
    if (this.actionT > 0) {
      this.actionT -= dt;
      u = 1 - clampN(this.actionT / this.actionDur, 0, 1);
    }
    if (u >= 0) {
      if (cat === 'shotgun') {
        // Pump back, then forward.
        this.pumpZ = Math.max(this.pumpZ, Math.sin(seg(u, 0.28, 0.9) * Math.PI) * PUMP_TRAVEL);
        roll = -Math.sin(seg(u, 0.2, 1) * Math.PI) * 0.09;
      } else if (cat === 'sniper') {
        this.boltHand = Math.max(this.boltHand, smooth(seg(u, 0.04, 0.2)) * (1 - smooth(seg(u, 0.84, 1))));
        this.boltLift = Math.max(this.boltLift, smooth(seg(u, 0.2, 0.32)) * (1 - smooth(seg(u, 0.72, 0.84))));
        this.boltZ = Math.max(this.boltZ, smooth(seg(u, 0.3, 0.46)) * (1 - smooth(seg(u, 0.56, 0.72))) * BOLT_TRAVEL);
        roll = -Math.sin(seg(u, 0.05, 0.95) * Math.PI) * 0.16;
      } else {
        this.boltZ = Math.max(this.boltZ, Math.sin(u * Math.PI) * (cat === 'pistol' ? 0.03 : 0.045));
      }
    }
    // Apply to the parts.
    const slide = this.part('slide');
    if (slide) slide.position.z = (slide.userData.rest as THREE.Vector3).z + this.boltZ;
    const pump = this.part('pump');
    if (pump) pump.position.z = (pump.userData.rest as THREE.Vector3).z + this.pumpZ;
    const bolt = this.part('bolt');
    if (bolt) {
      const rest = bolt.userData.rest as THREE.Vector3;
      if (cat === 'sniper' && model.detailed) {
        // Turn-bolt: the handle is lifted about the bolt axis, then the bolt is drawn back.
        const a = this.boltLift * 1.05;
        bolt.rotation.set(0, 0, a);
        const c = Math.cos(a);
        const s = Math.sin(a);
        bolt.position.set(rest.x + BOLT_AXIS[0] - (BOLT_AXIS[0] * c - BOLT_AXIS[1] * s), rest.y + BOLT_AXIS[1] - (BOLT_AXIS[0] * s + BOLT_AXIS[1] * c), rest.z + this.boltZ);
      } else {
        bolt.position.z = rest.z + (cat === 'shotgun' ? this.pumpZ * 0.8 : this.boltZ);
      }
    }
    // Brass leaves when the action opens.
    if (this.ejectT > 0) {
      this.ejectT -= dt;
      if (this.ejectT <= 0) this.eject(id, model);
    }
    return roll;
  }

  private eject(id: WeaponId, model: WeaponModel): void {
    const kind = FEEL[id].casing;
    const port = model.view.eject;
    if (!kind || !port) return;
    const p = this.v1.set(port[0], port[1], port[2]).applyMatrix4(this.holder.matrix);
    const slow = kind === 'shell' || kind === 'long' ? 0.6 : 1;
    // Out to the right, up and back, with the weapon's own orientation.
    const v = this.v2
      .set((1.15 + Math.random() * 0.7) * slow, (1.35 + Math.random() * 0.7) * slow, (0.25 + Math.random() * 0.6) * slow)
      .applyQuaternion(this.holder.quaternion);
    this.fx.eject(p, v, kind);
    // A whiff of smoke from the open breech.
    this.fx.puff(p, v.x * 0.15, 0.15, v.z * 0.1, 0.012, 0.06, 0.4, 0.1, 0.6);
  }

  /** Rest position of the support hand's wrist, weapon frame. */
  private supportLocal(cat: Cat, model: WeaponModel, out: THREE.Vector3): THREE.Vector3 {
    const g = model.gripRight.position;
    if (cat === 'pistol') return out.set(g.x - 0.0398, g.y - 0.0568, g.z + 0.0795);
    out.lerpVectors(g, model.gripLeft.position, 0.8);
    out.x -= 0.0795;
    out.y -= 0.0568;
    out.z += 0.0227 + this.pumpZ;
    return out;
  }

  /** Pose the character's own arms on the weapon (falls back to the simple sleeves). */
  private arms(f: ViewModelFrame, cat: Cat, model: WeaponModel, reloading: boolean): void {
    const team = f.team ?? 0;
    if (soldierReady() && (!this.fp || this.fpTeam !== team)) {
      this.fp?.dispose();
      this.fp = createFirstPersonArms(team);
      this.fpTeam = team;
      if (this.fp) {
        this.root.add(this.fp.root);
        fabric(this.fp.root);
      }
    }
    if (!this.fp) {
      // Fallback sleeves: the left one follows the reload roughly.
      this.armL.position.y = model.gripLeft.position.y - 0.04 - (this.reloadT > 0 ? Math.sin(this.reloadP * Math.PI) * 0.1 : 0);
      this.armL.position.z = model.gripLeft.position.z + this.pumpZ;
      return;
    }
    this.armR.visible = this.armL.visible = false;
    const R = this.handR;
    const L = this.handL;
    const M = this.holder.matrix;
    const Q = this.holder.quaternion;
    // Firing hand: wraps the grip from behind, palm against its right side.
    const g = model.gripRight.position;
    R.pos.set(g.x + 0.025, g.y - 0.0341, g.z + 0.0852);
    R.fingers.set(-0.12, 0.42, -1);
    R.palm.set(-1, 0.1, 0);
    if (this.boltHand > 0) {
      // … or goes to the bolt handle (it follows the handle as it is lifted and drawn back).
      const a = this.boltLift * 1.05;
      const kx = BOLT_KNOB[0] - BOLT_AXIS[0];
      const ky = BOLT_KNOB[1] - BOLT_AXIS[1];
      const bx = BOLT_AXIS[0] + kx * Math.cos(a) - ky * Math.sin(a);
      const by = BOLT_AXIS[1] + kx * Math.sin(a) + ky * Math.cos(a);
      const k = this.boltHand;
      R.pos.lerp(this.v2.set(bx + 0.04, by + 0.025, BOLT_KNOB[2] + this.boltZ + 0.085), k);
      R.fingers.lerp(this.v2.set(-0.3, 0.05, -1), k).normalize();
      R.palm.lerp(this.v2.set(-0.55, -0.83, 0), k).normalize();
    }
    R.pos.applyMatrix4(M);
    R.fingers.applyQuaternion(Q);
    R.palm.applyQuaternion(Q);
    let left: HandTarget | null = null;
    if (cat !== 'melee') {
      if (!reloading) {
        this.supportLocal(cat, model, L.pos);
        if (cat === 'pistol') {
          // Support hand cups the firing hand.
          L.fingers.set(0.4, 0.35, -1);
          L.palm.set(1, 0.15, 0);
        } else {
          // Support hand under the fore-end, palm up.
          L.fingers.set(1, 0.15, -0.35);
          L.palm.set(0.3, 1, 0.2);
        }
      }
      L.pos.applyMatrix4(M);
      L.fingers.applyQuaternion(Q);
      L.palm.applyQuaternion(Q);
      left = L;
    }
    this.fp.update(R, left, this.lightK);
  }

  /** Muzzle flash and its light, smoke wisp of a hot barrel. */
  private effects(dt: number, id: WeaponId, model: WeaponModel): void {
    const feel = FEEL[id];
    this.flash.group.position.copy(model.muzzle.position);
    if (this.flash.update(dt)) {
      // The pulse sits above the muzzle, far enough from any surface not to burn it out: it
      // rakes the top of the weapon, the optic and the hands.
      const m = model.muzzle.position;
      this.flashLight.position.set(m.x + 0.03, m.y + 0.14, m.z - 0.05);
      this.flashLight.intensity = FLASH_LIGHT * this.flash.level * (0.6 + feel.back * 18) * (1 - this.adsK * 0.6);
    } else {
      this.flashLight.intensity = 0;
    }
    // After a burst the barrel smokes for a moment: a thin wisp rising from the muzzle.
    this.sinceShot += dt;
    this.heat = Math.max(0, this.heat - dt * (this.sinceShot > 0.25 ? 0.42 : 0.05));
    if (this.heat > 0.12 && this.sinceShot > 0.09 && this.root.visible) {
      this.wisp += dt * 34 * Math.min(1, this.heat * 1.4);
      if (this.wisp >= 1) {
        this.wisp = 0;
        const mz = this.v1.copy(model.muzzle.position).applyMatrix4(this.holder.matrix);
        const drift = Math.sin(this.t * 2.3) * 0.05;
        this.fx.puff(mz, drift + (Math.random() - 0.5) * 0.05, 0.16 + Math.random() * 0.08, (Math.random() - 0.5) * 0.05, 0.012, 0.075 + Math.random() * 0.04, 1 + Math.random() * 0.5, 0.2 * Math.min(1, this.heat * 1.5), 0.62);
      }
    }
  }

  getMuzzle(out: THREE.Vector3): THREE.Vector3 {
    if (!this.model) return out.set(0.15, -0.12, -0.6);
    this.root.updateMatrixWorld(true);
    return this.model.muzzle.getWorldPosition(out);
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
    if (!visible) {
      // Out of sight: a pending switch completes at once, transient effects are dropped.
      if (this.pending !== undefined) this.swap(this.pending);
      this.fx.clear();
      this.flashLight.intensity = 0;
    }
  }

  dispose(): void {
    for (const m of this.models.values()) m.dispose();
    this.models.clear();
    this.fp?.dispose();
    this.flash.dispose();
    this.fx.dispose();
    for (const m of this.mats) m.dispose();
  }
}

/** Seconds to lower the weapon being put away. */
const HOLSTER = 0.13;
/** Travel of the pump and of the bolt (m, weapon frame). */
const PUMP_TRAVEL = 0.085;
const BOLT_TRAVEL = 0.085;
/** Precision rifle: bolt axis (x, y) and handle knob (x, y, z), weapon frame. */
const BOLT_AXIS: [number, number] = [0, 0.0505];
const BOLT_KNOB: [number, number, number] = [0.036, 0.018, 0.0];
/** Reflections of the weapon relative to the scene default, and peak of the flash light. */
const ENV_BOOST = 0.75;
const FLASH_LIGHT = 2.8;

/**
 * Sleeves and gloves read as cloth: a fine weave breaks up the shading and the albedo, and a
 * soft sheen lights the grazing angles (the fuzz of a fabric) instead of a plastic highlight.
 */
function fabric(arms: THREE.Object3D): void {
  arms.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = mesh.material as THREE.MeshStandardMaterial;
    if (!m.isMeshStandardMaterial || m.userData.fabric) return;
    m.userData.fabric = true;
    m.roughness = 1;
    m.metalness = 0;
    const inner = m.onBeforeCompile;
    m.onBeforeCompile = (shader, renderer) => {
      inner.call(m, shader, renderer);
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          float basWeave( vec2 uv, out float fade ) {
            vec2 w = uv * 300.0;
            vec2 fw = fwidth( w );
            fade = 1.0 - smoothstep( 0.1, 0.27, max( fw.x, fw.y ) );
            // Over-and-under threads of a plain weave, as a smooth height field.
            return 0.5 + 0.5 * sin( w.x * 6.2832 ) * sin( w.y * 6.2832 );
          }`,
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          float basFade = 0.0;
          float basH = 0.5;
          #ifdef USE_MAP
            basH = basWeave( vMapUv, basFade );
            diffuseColor.rgb *= 1.0 - 0.16 * basFade * ( 1.0 - basH );
          #endif`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          {
            // Bump from the weave height (screen-space derivatives, no tangents needed).
            vec3 sx = dFdx( - vViewPosition ), sy = dFdy( - vViewPosition );
            vec3 r1 = cross( sy, normal ), r2 = cross( normal, sx );
            float det = dot( sx, r1 );
            vec2 dh = vec2( dFdx( basH ), dFdy( basH ) ) * 0.00028 * basFade;
            normal = normalize( abs( det ) * normal - sign( det ) * ( dh.x * r1 + dh.y * r2 ) );
          }`,
        )
        .replace(
          '#include <opaque_fragment>',
          `{
            float basRim = pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 3.0 );
            outgoingLight += ( reflectedLight.indirectDiffuse + reflectedLight.directDiffuse * 0.35 ) * basRim * 0.9;
          }
          #include <opaque_fragment>`,
        );
    };
    m.customProgramCacheKey = () => 'bas-fp-arms-fabric';
    m.needsUpdate = true;
  });
}

export function createViewModel(): IViewModel {
  return new ViewModel();
}
