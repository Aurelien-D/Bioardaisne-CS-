/**
 * Finishing touches on the first-person arms (the character's own, posed by IK in
 * avatar/soldier.ts): the fingers open when a hand lets go of the weapon and close when it
 * grips, the index finger squeezes the trigger, and the roll of a wrist is shared with its
 * forearm so that turning the weapon over (inspection) twists the arm instead of the cuff.
 *
 * Built right after createFirstPersonArms(), while the arms are still in the rest pose.
 * Every bone is looked up by name: a character without them simply keeps its fixed grip.
 */
import * as THREE from 'three';

interface Finger {
  bone: THREE.Object3D;
  /** Pose given by the character module (fingers curled on a grip). */
  base: THREE.Quaternion;
  /** Knuckle axis in the bone's own frame: a positive angle curls the finger further. */
  axis: THREE.Vector3;
  /** 0 knuckle, 1 middle, 2 tip. */
  joint: number;
  index: boolean;
}

interface Wrist {
  fore: THREE.Object3D;
  hand: THREE.Object3D;
  /** Inverse of the hand's rest rotation (forearm frame) and the forearm axis (forearm frame). */
  restInv: THREE.Quaternion;
  axis: THREE.Vector3;
  /** Roll carried last frame (radians), to stay on the same turn. */
  roll: number;
}

/** How much of its curl each joint gives up when the hand is fully open (radians). */
const OPEN = [0.62, 0.86, 0.5];
/** Extra curl of the index finger on the trigger. */
const SQUEEZE = [0.05, 0.3, 0.2];
/** Share of the wrist roll taken by the forearm. */
const TWIST = 0.62;

const q = new THREE.Quaternion();
const d = new THREE.Quaternion();

export class HandRig {
  /** [right, left] */
  private fingers: Finger[][] = [[], []];
  private wrists: (Wrist | null)[] = [null, null];
  private open = [-1, -1];
  private squeeze = [-1, -1];

  constructor(root: THREE.Object3D) {
    root.updateMatrixWorld(true);
    const bone = (n: string): THREE.Object3D | null => root.getObjectByName(`mixamorig${n}`) ?? null;
    const sides = ['Right', 'Left'] as const;
    for (let s = 0; s < 2; s++) {
      const side = sides[s]!;
      const hand = bone(`${side}Hand`);
      const fore = bone(`${side}ForeArm`);
      const mid = bone(`${side}HandMiddle1`) ?? bone(`${side}HandIndex1`);
      const idx = bone(`${side}HandIndex1`);
      const far = bone(`${side}HandPinky1`) ?? bone(`${side}HandRing1`) ?? bone(`${side}HandMiddle1`);
      if (!hand || !fore || !mid) continue;
      if (hand.parent === fore && hand.position.lengthSq() > 1e-8) {
        this.wrists[s] = { fore, hand, restInv: hand.quaternion.clone().invert(), axis: hand.position.clone().normalize(), roll: 0 };
      }
      if (!idx || !far || idx === far) continue;
      // Same construction as the character module: the knuckle axis of the open hand.
      const hp = hand.getWorldPosition(new THREE.Vector3());
      const fW = mid.getWorldPosition(new THREE.Vector3()).sub(hp).normalize();
      const across = idx.getWorldPosition(new THREE.Vector3()).sub(far.getWorldPosition(new THREE.Vector3())).normalize();
      const nW = new THREE.Vector3().crossVectors(fW, across).normalize();
      if (nW.y > 0) nW.negate();
      const axisW = new THREE.Vector3().crossVectors(fW, nW).normalize();
      const re = new RegExp(`^mixamorig${side}Hand(Index|Middle|Ring|Pinky)([123])$`);
      root.traverse((o) => {
        const m = re.exec(o.name);
        if (!m) return;
        const inv = o.getWorldQuaternion(new THREE.Quaternion()).invert();
        this.fingers[s]!.push({ bone: o, base: o.quaternion.clone(), axis: axisW.clone().applyQuaternion(inv), joint: Number(m[2]) - 1, index: m[1] === 'Index' });
      });
    }
  }

  /**
   * Fingers of a hand (0 right, 1 left): `open` 0 = closed on a grip … 1 = open hand,
   * `squeeze` 0 … 1 = index finger pulling the trigger.
   */
  setFingers(side: number, open: number, squeeze: number): void {
    if (Math.abs(open - this.open[side]!) < 1e-3 && Math.abs(squeeze - this.squeeze[side]!) < 1e-3) return;
    this.open[side] = open;
    this.squeeze[side] = squeeze;
    const list = this.fingers[side]!;
    for (let i = 0; i < list.length; i++) {
      const f = list[i]!;
      // The index finger opens a little less: it stays the straightest of a relaxed hand anyway.
      const angle = -open * OPEN[f.joint]! + (f.index ? squeeze * SQUEEZE[f.joint]! : 0);
      f.bone.quaternion.copy(f.base).multiply(q.setFromAxisAngle(f.axis, angle));
    }
  }

  /** Share the roll of each wrist with its forearm. Call after the IK of the frame. */
  twist(amount = TWIST): void {
    for (let s = 0; s < 2; s++) {
      const w = this.wrists[s];
      if (!w) continue;
      // Rotation of the hand away from its rest pose, in the forearm frame, and its part about the forearm axis.
      d.copy(w.hand.quaternion).multiply(w.restInv);
      const a = w.axis;
      let roll = 2 * Math.atan2(d.x * a.x + d.y * a.y + d.z * a.z, d.w);
      // Stay on the turn of the previous frame (no flip when the roll goes past half a turn),
      // within what an arm can do.
      roll += Math.round((w.roll - roll) / (2 * Math.PI)) * 2 * Math.PI;
      if (roll > 4.4) roll -= 2 * Math.PI;
      else if (roll < -4.4) roll += 2 * Math.PI;
      w.roll = roll;
      q.setFromAxisAngle(a, roll * amount);
      w.fore.quaternion.multiply(q);
      w.hand.quaternion.premultiply(q.invert());
    }
  }
}
