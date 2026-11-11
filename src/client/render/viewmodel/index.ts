/** First-person weapon: procedural models, arms with blue nitrile gloves and animations. */
import * as THREE from 'three';
import { WEAPONS, type WeaponId } from '../../../shared/weapons/defs';
import type { IViewModel, ViewModelFrame } from '../../core/contracts';
import { createWeaponModel, type WeaponModel } from '../weapons/models';

const HIP: Record<string, [number, number, number]> = {
  melee: [0.17, -0.17, -0.4],
  pistol: [0.14, -0.14, -0.42],
  smg: [0.15, -0.16, -0.36],
  rifle: [0.15, -0.165, -0.34],
  shotgun: [0.15, -0.165, -0.35],
  sniper: [0.15, -0.165, -0.33],
};

class ViewModel implements IViewModel {
  readonly root = new THREE.Group();
  private holder = new THREE.Group();
  private models = new Map<WeaponId, WeaponModel>();
  private model: WeaponModel | null = null;
  private id: WeaponId | null = null;
  private armR: THREE.Group;
  private armL: THREE.Group;
  private flash: THREE.Mesh;
  private flashLight: THREE.PointLight;
  private mats: THREE.MeshStandardMaterial[] = [];

  private t = 0;
  private bob = 0;
  private bobAmp = 0;
  private kick = 0;
  private kickRot = 0;
  private swayX = 0;
  private swayY = 0;
  private drawT = 0;
  private drawDur = 0;
  private reloadT = 0;
  private reloadDur = 0;
  private flashT = 0;
  private slideT = 0;
  private dry = 0;
  private slash = 0;
  private slashSide = 1;
  private landDip = 0;
  private wasGround = true;

  constructor() {
    this.root.add(this.holder);
    this.holder.scale.setScalar(0.8);
    this.armR = this.makeArm();
    this.armL = this.makeArm();
    this.holder.add(this.armR, this.armL);
    const fg = new THREE.PlaneGeometry(0.22, 0.22);
    const tex = ViewModel.flashTexture();
    this.flash = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    this.flash.visible = false;
    this.flash.renderOrder = 10;
    this.holder.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffc878, 0, 3);
    this.holder.add(this.flashLight);
  }

  private static flashTexture(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255,255,240,1)');
    grad.addColorStop(0.25, 'rgba(255,210,120,0.9)');
    grad.addColorStop(1, 'rgba(255,120,20,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(255,240,200,0.9)';
    g.lineWidth = 5;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      g.beginPath();
      g.moveTo(64, 64);
      g.lineTo(64 + Math.cos(a) * 60, 64 + Math.sin(a) * 60);
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /** Forearm (white lab-coat sleeve) + blue nitrile glove; origin at the hand. */
  private makeArm(): THREE.Group {
    const g = new THREE.Group();
    const sleeve = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.9 });
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

  setWeapon(id: WeaponId | null): void {
    if (id === this.id) return;
    if (this.model) this.holder.remove(this.model.root);
    this.id = id;
    this.model = null;
    this.reloadT = this.reloadDur = 0;
    if (!id) {
      this.armR.visible = this.armL.visible = false;
      return;
    }
    let m = this.models.get(id);
    if (!m) {
      m = createWeaponModel(id, 'view');
      this.models.set(id, m);
    }
    this.model = m;
    this.holder.add(m.root);
    const cat = WEAPONS[id].category;
    this.armR.visible = true;
    this.armL.visible = cat !== 'melee';
    // Right hand on the grip, left hand on the fore-end (or under the magazine for pistols).
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

  onFire(): void {
    if (!this.id) return;
    const d = WEAPONS[this.id];
    if (d.kind === 'melee') {
      this.slash = 1;
      this.slashSide = -this.slashSide;
      return;
    }
    const power = Math.min(1.6, 0.35 + d.recoilUp * 14);
    this.kick = Math.min(1.5, this.kick + power);
    this.kickRot = Math.min(1.5, this.kickRot + power);
    this.flashT = 0.045;
    this.slideT = d.category === 'sniper' || d.category === 'shotgun' ? d.fireInterval * 0.8 : 0.07;
    this.flash.rotation.z = Math.random() * Math.PI;
    const s = d.category === 'pistol' ? 0.8 : d.category === 'sniper' || d.category === 'shotgun' ? 1.6 : 1.1;
    this.flash.scale.setScalar(s * (0.85 + Math.random() * 0.3));
  }

  onDryFire(): void {
    this.dry = 1;
  }

  onReload(duration: number): void {
    this.reloadDur = duration;
    this.reloadT = duration;
  }

  onDraw(duration: number): void {
    this.drawDur = Math.max(0.05, duration);
    this.drawT = this.drawDur;
  }

  cancelReload(): void {
    this.reloadT = 0;
  }

  update(f: ViewModelFrame): void {
    const dt = Math.min(0.05, f.dt);
    this.t += dt;
    const cat = this.id ? WEAPONS[this.id].category : 'rifle';
    const hip = HIP[cat] ?? HIP.rifle!;
    this.root.visible = f.zoom === 0 && this.id !== null;

    // Bob
    const moving = f.onGround ? Math.min(1, f.speed / 5.5) : 0;
    this.bobAmp += (moving - this.bobAmp) * Math.min(1, dt * 8);
    this.bob += dt * (4 + f.speed * 1.75);
    const bx = Math.cos(this.bob) * 0.012 * this.bobAmp;
    const by = -Math.abs(Math.sin(this.bob)) * 0.014 * this.bobAmp;
    // Landing dip
    if (f.onGround && !this.wasGround) this.landDip = 1;
    this.wasGround = f.onGround;
    this.landDip *= Math.exp(-dt * 9);
    // Sway (weapon lags behind the view)
    this.swayX += (clampN(-f.lookDeltaYaw * 1.6, -0.05, 0.05) - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (clampN(f.lookDeltaPitch * 1.6, -0.05, 0.05) - this.swayY) * Math.min(1, dt * 10);
    // Kick
    this.kick *= Math.exp(-dt * 16);
    this.kickRot *= Math.exp(-dt * 12);
    this.dry *= Math.exp(-dt * 20);
    this.slash = Math.max(0, this.slash - dt * 3.4);

    let x = hip[0] + bx - this.swayX * 0.4;
    let y = hip[1] + by + this.swayY * 0.3 - this.landDip * 0.035 - f.crouch * 0.012 + Math.sin(this.t * 1.6) * 0.0025;
    let z = hip[2] + this.kick * 0.045;
    let rx = this.kickRot * 0.09 + f.punchPitch * 0.5 + this.swayY * 0.6 - this.dry * 0.02;
    let ry = -this.swayX * 0.9 + f.punchYaw * 0.5;
    let rz = -this.swayX * 0.5 + bx * 1.2;

    // Draw: raise from below.
    if (this.drawT > 0) {
      this.drawT -= dt;
      const k = Math.max(0, this.drawT / this.drawDur);
      const e = k * k;
      y -= e * 0.28;
      rx -= e * 0.9;
    }
    // Reload: dip and tilt, magazine drops and comes back.
    const mag = this.model?.parts.magazine;
    const pump = this.model?.parts.pump;
    const bolt = this.model?.parts.bolt;
    if (mag) mag.position.y = mag.userData.y0 ?? (mag.userData.y0 = mag.position.y);
    if (this.reloadT > 0 && this.reloadDur > 0) {
      this.reloadT -= dt;
      const p = 1 - Math.max(0, this.reloadT) / this.reloadDur; // 0..1
      const inOut = Math.sin(Math.min(1, p / 0.15) * Math.PI * 0.5) * (1 - smooth((p - 0.82) / 0.18));
      y -= inOut * 0.06;
      rx += inOut * 0.35;
      rz += inOut * 0.5;
      x -= inOut * 0.03;
      if (mag) {
        const out = smooth((p - 0.15) / 0.15) * (1 - smooth((p - 0.55) / 0.15));
        mag.position.y = (mag.userData.y0 as number) - out * 0.22;
      }
      if (pump) pump.position.z = -0.36 + Math.max(0, Math.sin(p * Math.PI * 6)) * 0.07 * (p > 0.2 && p < 0.85 ? 1 : 0);
      this.armL.position.y = (this.model?.gripLeft.position.y ?? 0) - 0.04 - inOut * 0.12;
    } else if (this.model && cat !== 'pistol') {
      this.armL.position.y = this.model.gripLeft.position.y - 0.04;
    }
    // Slide / bolt / pump cycling after a shot.
    if (this.slideT > 0) this.slideT -= dt;
    const cyc = this.slideT > 0 ? Math.sin(Math.min(1, this.slideT / 0.07) * Math.PI) : 0;
    const slide = this.model?.parts.slide;
    if (slide) slide.position.z = (slide.userData.z0 ?? (slide.userData.z0 = slide.position.z)) + cyc * 0.035;
    if (bolt) {
      const z0 = bolt.userData.z0 ?? (bolt.userData.z0 = bolt.position.z);
      const long = cat === 'sniper' && this.slideT > 0 ? Math.sin((1 - this.slideT / (WEAPONS.sniper.fireInterval * 0.8)) * Math.PI) : cyc;
      bolt.position.z = (z0 as number) + Math.max(0, long) * (cat === 'sniper' ? 0.07 : 0.03);
    }
    if (pump && this.reloadT <= 0) {
      const d = WEAPONS.shotgun.fireInterval * 0.8;
      const ph = this.slideT > 0 ? 1 - this.slideT / d : 1;
      pump.position.z = -0.36 + (ph > 0.3 && ph < 0.8 ? Math.sin(((ph - 0.3) / 0.5) * Math.PI) * 0.09 : 0);
    }
    // Knife slash.
    if (cat === 'melee' && this.slash > 0) {
      const s = Math.sin((1 - this.slash) * Math.PI);
      x -= s * 0.2 * this.slashSide;
      z -= s * 0.12;
      ry += s * 0.9 * this.slashSide;
      rz += s * 0.6 * this.slashSide;
    }
    this.holder.position.set(x, y, z);
    this.holder.rotation.set(rx, ry, rz);

    // Muzzle flash.
    if (this.flashT > 0 && this.model) {
      this.flashT -= dt;
      this.flash.visible = true;
      this.flash.position.copy(this.model.muzzle.position);
      this.flash.position.z -= 0.06;
      this.flashLight.position.copy(this.flash.position);
      this.flashLight.intensity = 2.5;
    } else {
      this.flash.visible = false;
      this.flashLight.intensity = 0;
    }
    // Darken the arms in dark places.
    const l = Math.min(1.2, Math.max(0.35, (f.light.r + f.light.g + f.light.b) / 3));
    this.mats[0]!.color.setRGB(0.95 * l, 0.95 * l, 0.93 * l);
    this.mats[1]!.color.setRGB(0.23 * l, 0.56 * l, 0.88 * l);
    this.mats[2]!.color.copy(this.mats[0]!.color);
    this.mats[3]!.color.copy(this.mats[1]!.color);
  }

  getMuzzle(out: THREE.Vector3): THREE.Vector3 {
    if (!this.model) return out.set(0.15, -0.12, -0.6);
    this.root.updateMatrixWorld(true);
    return this.model.muzzle.getWorldPosition(out);
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  dispose(): void {
    for (const m of this.models.values()) m.dispose();
    this.models.clear();
  }
}

const clampN = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const smooth = (t: number): number => {
  const c = clampN(t, 0, 1);
  return c * c * (3 - 2 * c);
};

export function createViewModel(): IViewModel {
  return new ViewModel();
}
