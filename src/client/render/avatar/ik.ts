/** Analytic two-bone inverse kinematics (shoulder–elbow–wrist, hip–knee–ankle). */
import * as THREE from 'three';

const a = new THREE.Vector3();
const b = new THREE.Vector3();
const c = new THREE.Vector3();
const ab = new THREE.Vector3();
const ac = new THREE.Vector3();
const cb = new THREE.Vector3();
const at = new THREE.Vector3();
const axis0 = new THREE.Vector3();
const axis1 = new THREE.Vector3();
const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const r0 = new THREE.Quaternion();
const r1 = new THREE.Quaternion();
const r2 = new THREE.Quaternion();
const v = new THREE.Vector3();

const clamp1 = (x: number): number => Math.min(1, Math.max(-1, x));

/**
 * Rotate `upper` and `lower` so that `end` reaches `target` (world space).
 * `pole` is the world-space direction the middle joint should bend toward.
 * World matrices must be up to date before the call; they are refreshed for the chain after it.
 */
export function solveTwoBone(upper: THREE.Object3D, lower: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3): void {
  upper.getWorldPosition(a);
  lower.getWorldPosition(b);
  end.getWorldPosition(c);
  const lab = a.distanceTo(b);
  const lcb = b.distanceTo(c);
  const lat = Math.min(Math.max(a.distanceTo(target), 0.02), lab + lcb - 0.002);
  ab.subVectors(b, a).normalize();
  ac.subVectors(c, a).normalize();
  cb.subVectors(b, c).normalize();
  at.subVectors(target, a).normalize();
  const acAb0 = Math.acos(clamp1(ac.dot(ab)));
  const baBc0 = Math.acos(clamp1(-ab.dot(v.copy(cb).negate())));
  const acAt0 = Math.acos(clamp1(ac.dot(at)));
  const acAb1 = Math.acos(clamp1((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat)));
  const baBc1 = Math.acos(clamp1((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb)));
  axis0.crossVectors(ac, pole);
  if (axis0.lengthSq() < 1e-8) axis0.crossVectors(ac, ab);
  axis0.normalize();
  axis1.crossVectors(ac, at);
  if (axis1.lengthSq() < 1e-10) axis1.copy(axis0);
  axis1.normalize();
  upper.getWorldQuaternion(qa).invert();
  lower.getWorldQuaternion(qb).invert();
  r0.setFromAxisAngle(v.copy(axis0).applyQuaternion(qa), acAb1 - acAb0);
  r1.setFromAxisAngle(v.copy(axis0).applyQuaternion(qb), baBc1 - baBc0);
  r2.setFromAxisAngle(v.copy(axis1).applyQuaternion(qa), acAt0);
  upper.quaternion.multiply(r0.multiply(r2));
  lower.quaternion.multiply(r1);
  upper.updateMatrixWorld(true);
}

const qp = new THREE.Quaternion();
/** Give `bone` a world orientation (its parent's world matrix must be current). */
export function setWorldQuaternion(bone: THREE.Object3D, world: THREE.Quaternion): void {
  if (bone.parent) {
    bone.parent.getWorldQuaternion(qp).invert();
    bone.quaternion.copy(qp).multiply(world);
  } else bone.quaternion.copy(world);
  bone.updateMatrixWorld(true);
}
