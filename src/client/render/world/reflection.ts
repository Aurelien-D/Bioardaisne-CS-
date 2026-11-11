/**
 * Planar floor reflections: the scene is rendered once more from a camera mirrored
 * about the floor plane, into an HDR target with a mip chain; glossy floor materials
 * (see materials.ts, BAS_REFLECT) sample it — sharper mips for polished vinyl, blurrier
 * ones for damp asphalt — instead of the static reflection probe.
 */
import * as THREE from 'three';

/** Uniforms shared by every reflective floor material. */
export interface ReflectionUniforms {
  basRefl: { value: THREE.Texture | null };
  basReflMatrix: { value: THREE.Matrix4 };
  basReflPlane: { value: number };
  basReflOn: { value: number };
}

export class FloorReflection {
  readonly uniforms: ReflectionUniforms;
  private readonly target: THREE.WebGLRenderTarget;
  private readonly blank: THREE.DataTexture;
  private readonly camera = new THREE.PerspectiveCamera();
  private readonly normal = new THREE.Vector3(0, 1, 0);
  private readonly origin = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private readonly view = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private readonly rot = new THREE.Matrix4();
  private readonly plane = new THREE.Plane();
  private readonly clip = new THREE.Vector4();
  private readonly q = new THREE.Vector4();

  constructor(width: number, height: number) {
    this.target = new THREE.WebGLRenderTarget(Math.max(2, width), Math.max(2, height), {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
    this.target.texture.name = 'bas-floor-reflection';
    this.blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.blank.needsUpdate = true;
    this.uniforms = {
      basRefl: { value: this.blank },
      basReflMatrix: { value: new THREE.Matrix4() },
      basReflPlane: { value: 0 },
      basReflOn: { value: 0 },
    };
  }

  setSize(width: number, height: number): void {
    this.target.setSize(Math.max(2, Math.round(width)), Math.max(2, Math.round(height)));
  }

  /** Disable the effect until the next render() (materials fall back to the reflection probe). */
  off(): void {
    this.uniforms.basReflOn.value = 0;
    this.uniforms.basRefl.value = this.blank;
  }

  /**
   * Render the mirrored view for the floor at height `planeY`. Must be called before the
   * main render of the frame; the caller keeps its own render target / state.
   */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, planeY: number): void {
    const u = this.uniforms;
    this.camPos.setFromMatrixPosition(camera.matrixWorld);
    if (this.camPos.y <= planeY + 0.05) {
      this.off();
      return;
    }
    this.origin.set(0, planeY, 0);
    // Mirror the camera position and its aim point about the plane (same construction as three's Reflector).
    this.view.subVectors(this.origin, this.camPos).reflect(this.normal).negate().add(this.origin);
    this.rot.extractRotation(camera.matrixWorld);
    this.look.set(0, 0, -1).applyMatrix4(this.rot).add(this.camPos);
    this.aim.subVectors(this.origin, this.look).reflect(this.normal).negate().add(this.origin);
    const cam = this.camera;
    cam.position.copy(this.view);
    cam.up.set(0, 1, 0).applyMatrix4(this.rot).reflect(this.normal);
    cam.lookAt(this.aim);
    cam.near = camera.near;
    cam.far = camera.far;
    cam.updateMatrixWorld();
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    cam.projectionMatrix.copy(camera.projectionMatrix);
    cam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);

    // World position → reflection texture coordinates.
    u.basReflMatrix.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    u.basReflPlane.value = planeY;

    // Oblique near plane: nothing below the floor is drawn (http://www.terathon.com/code/oblique.html).
    this.plane.setFromNormalAndCoplanarPoint(this.normal, this.origin).applyMatrix4(cam.matrixWorldInverse);
    this.clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const p = cam.projectionMatrix.elements;
    this.q.set((Math.sign(this.clip.x) + p[8]!) / p[0]!, (Math.sign(this.clip.y) + p[9]!) / p[5]!, -1, (1 + p[10]!) / p[14]!);
    this.clip.multiplyScalar(2 / this.clip.dot(this.q));
    p[2] = this.clip.x;
    p[6] = this.clip.y;
    p[10] = this.clip.z + 1 - 0.003;
    p[14] = this.clip.w;

    // The floors must not sample the target while it is being drawn.
    u.basReflOn.value = 0;
    u.basRefl.value = this.blank;
    const prevTarget = renderer.getRenderTarget();
    const prevXr = renderer.xr.enabled;
    renderer.xr.enabled = false;
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevTarget);
    renderer.xr.enabled = prevXr;
    u.basRefl.value = this.target.texture;
    u.basReflOn.value = 1;
  }

  dispose(): void {
    this.target.dispose();
    this.blank.dispose();
  }
}
