/**
 * Rendering engine: renderer, world scene + first-person overlay scene, map loading
 * (merged world meshes, baked lighting, signs, sky, fog) and per-frame drawing.
 *
 *   createEngine(canvas, settings): IEngine
 *
 * Frame: clear -> world scene (world camera) -> clear depth -> view scene (weapon camera).
 * The static world is unlit: texture × baked light. The light is baked at map load into
 * a lightmap atlas for box faces and into vertex colours for everything else
 * (world/bake.ts, with shadow rays through the CollisionWorld); if the bake cannot run,
 * the phase-1 per-vertex lighting (world/lighting.ts) takes over. Dynamic objects
 * (avatars, weapon) are lit by a neutral light rig present in both scenes — a
 * HemisphereLight ('bas-hemi') and a DirectionalLight ('bas-sun') aimed along the map's
 * sun direction — and are expected to multiply their colours by `sampleLight(pos)`, which
 * carries the local light colour and level (light probes, dark in dark corridors).
 */
import { createEnvironment, loadHdrSky, type HdrSky } from './env';
import { preloadPhotoTextures } from './textures/photo';
import type { MaterialId } from '../../shared/maps/materials';
import { createPost, type Post } from './post';
import { buildMapModels, type MapModels } from './world/models';
import * as THREE from 'three';
import { DEFAULT_ENV } from '../../shared/maps/builder';
import type { EnvDef, MapData } from '../../shared/maps/types';
import type { Vec3 } from '../../shared/math/vec3';
import type { CollisionWorld } from '../../shared/physics/world';
import type { IEngine } from '../core/contracts';
import type { Quality, SettingsStore } from '../core/settings';
import { buildSigns, type Signs } from './signs';
import { applyFog, createSky, type Sky } from './sky';
import { disposeMaterialTextures } from './textures';
import {
  MapLighting,
  World,
  WorldBuilder,
  WorldMaterials,
  bakeLightmapAsync,
  createLightmapTexture,
  type BakeResult,
  type SurfaceShader,
} from './world';

/** Upper bound of the device pixel ratio per quality level. */
const PIXEL_RATIO_CAP: Record<Quality, number> = { low: 1, medium: 1.5, high: 2 };

/** Neutral rig for dynamic objects: lit side ≈ 1.1 × albedo, shaded side ≈ 0.5 × albedo. */
const RIG_HEMI = Math.PI * 0.62;
const RIG_SUN = Math.PI * 0.55;

const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

class Engine implements IEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly viewScene = new THREE.Scene();
  readonly viewCamera: THREE.PerspectiveCamera;

  private readonly canvas: HTMLCanvasElement;
  private readonly settings: SettingsStore;
  private readonly sky: Sky;
  private readonly sun: THREE.DirectionalLight;
  private readonly viewSun: THREE.DirectionalLight;
  private readonly sunDir = new THREE.Vector3(0.45, 0.8, 0.4).normalize();
  private readonly antialias: boolean;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly startTime = performance.now();
  private readonly tmpQuat = new THREE.Quaternion();
  /** Number of objects the engine itself keeps in the overlay scene (camera + light rig). */
  private readonly viewRigSize: number;

  private quality: Quality;
  private world: World | null = null;
  private signs: Signs | null = null;
  private materials: WorldMaterials | null = null;
  /** Baked lighting of the current map (lightmap atlas, light probes)… */
  private baked: BakeResult | null = null;
  private lightmap: THREE.DataTexture | null = null;
  /** …or the phase-1 vertex lighting when the bake could not run. */
  private lighting: MapLighting | null = null;
  /** Incremented by every loadMap / unloadMap: a stale asynchronous load notices and stops. */
  private loadToken = 0;
  private sizeDirty = true;
  private post: Post | null = null;
  private envMap: THREE.Texture | null = null;
  private hdr: HdrSky | null = null;
  private models: MapModels | null = null;
  private width = 0;
  private height = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, settings: SettingsStore) {
    this.canvas = canvas;
    this.settings = settings;
    this.quality = settings.value.quality;
    this.antialias = this.quality !== 'low';

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.antialias,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.86;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false; // one frame = two render() calls: reset manually
    this.renderer.setClearColor(DEFAULT_ENV.skyHorizon, 1);

    this.camera = new THREE.PerspectiveCamera(settings.value.fov, 1, 0.05, 600);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.viewCamera = new THREE.PerspectiveCamera(54, 1, 0.01, 10);
    this.viewScene.add(this.viewCamera);

    // Light rig for dynamic objects (the static world is unlit).
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8f8a84, RIG_HEMI);
    hemi.name = 'bas-hemi';
    this.sun = new THREE.DirectionalLight(0xffffff, RIG_SUN);
    this.sun.name = 'bas-sun';
    this.sun.castShadow = true;
    const shadowSize = this.quality === 'high' ? 4096 : this.quality === 'medium' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(hemi, this.sun, this.sun.target);
    const viewHemi = hemi.clone();
    this.viewSun = new THREE.DirectionalLight(0xffffff, RIG_SUN);
    this.viewSun.name = 'bas-sun';
    this.viewScene.add(viewHemi, this.viewSun, this.viewSun.target);
    this.viewRigSize = this.viewScene.children.length;

    this.sky = createSky();
    this.scene.add(this.sky.mesh);
    this.applyEnv(DEFAULT_ENV);

    this.resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            this.sizeDirty = true;
          })
        : null;
    this.resizeObserver?.observe(canvas);
    this.resize();
  }

  // --- Map -----------------------------------------------------------------------

  async loadMap(
    map: MapData,
    world: CollisionWorld,
    onProgress?: (fraction: number, label: string) => void,
  ): Promise<void> {
    this.unloadMap();
    const token = this.loadToken;
    let builtWorld: World | null = null;
    let builtSigns: Signs | null = null;
    let materials: WorldMaterials | null = null;
    let lightmap: THREE.DataTexture | null = null;
    /** True once the new objects belong to the engine (unloadMap() owns their disposal). */
    let committed = false;

    const wanted = (): boolean => token === this.loadToken && !this.disposed;
    /** Report progress, let the browser breathe, and tell whether this load is still wanted. */
    const stage = async (fraction: number, label: string): Promise<boolean> => {
      onProgress?.(fraction, label);
      await nextTask();
      return wanted();
    };
    const abandon = (): void => {
      builtWorld?.dispose();
      builtSigns?.dispose();
      materials?.dispose();
      lightmap?.dispose();
    };

    try {
      if (!(await stage(0.02, 'Préparation des paillasses…'))) return abandon();
      if (this.quality !== 'low') {
        // Photographic textures and sky (kept procedural if they cannot be fetched).
        const used = new Set<MaterialId>();
        for (const b of map.boxes) {
          used.add(b.mat);
          if (b.faces) for (const f of Object.values(b.faces)) if (f) used.add(f);
        }
        for (const p of map.prims) used.add(p.mat);
        const [, sky] = await Promise.all([preloadPhotoTextures(used), map.env.sunIntensity > 0 ? loadHdrSky(this.renderer) : Promise.resolve(null)]);
        this.hdr = sky;
        if (!wanted()) return abandon();
      } else this.hdr = null;
      materials = new WorldMaterials(this.quality);

      // --- Baked lighting (time-sliced; instant when this map was baked before) ---
      const LIGHT_LABEL = 'Calcul de l’éclairage…';
      if (!(await stage(0.04, LIGHT_LABEL))) return abandon();
      let baked: BakeResult | null = null;
      let bakeFailed = false;
      try {
        // The sun is a real-time light (dynamic shadows): bake lamps, sky and bounce only.
        baked = await bakeLightmapAsync(
          { ...map, env: { ...map.env, sunIntensity: 0 } },
          world ?? null,
          { quality: this.quality, maxAtlasSize: this.renderer.capabilities.maxTextureSize },
          (fraction) => onProgress?.(0.04 + fraction * 0.5, LIGHT_LABEL),
          () => !wanted(),
        );
      } catch (err) {
        bakeFailed = true;
        console.warn('[engine] Calcul de l’éclairage impossible, éclairage simplifié utilisé :', err);
      }
      if (!wanted() || (!baked && !bakeFailed)) return abandon();
      if (baked) {
        const s = baked.stats;
        console.info(
          `[engine] éclairage de « ${map.meta.id} » : ${s.lightmapped} faces, ${s.luxels} luxels, ${s.rays} rayons, ` +
            `atlas ${baked.width}×${baked.height}, ${Math.round(s.ms)} ms`,
        );
      }

      let shader: SurfaceShader;
      let builder: WorldBuilder;
      let fallback: MapLighting | null = null;
      if (!(await stage(0.56, 'Construction du plateau technique…'))) return abandon();
      if (baked) {
        baked.shader.begin();
        shader = baked.shader;
        builder = new WorldBuilder(map, { shader, lightmapUv1: true, neutralLightmapUv: baked.neutralUv });
        builder.faces = baked.faces;
        lightmap = createLightmapTexture(baked);
        materials.setLightMap(lightmap, baked.intensity);
      } else {
        // Fallback: phase-1 lighting, evaluated per vertex without shadow rays.
        shader = fallback = new MapLighting(map);
        builder = new WorldBuilder(map, { shader });
        builder.collectFaces();
      }

      if (!(await stage(0.6, 'Calibration des automates…'))) return abandon();
      builder.emitFaces();

      if (!(await stage(0.7, 'Livraison des consommables…'))) return abandon();
      builder.emitPrims();

      if (!(await stage(0.78, 'Montage des salles et des couloirs…'))) return abandon();
      builtWorld = builder.finish(materials);

      if (!(await stage(0.84, 'Pose de la signalétique…'))) return abandon();
      builtSigns = buildSigns(map.signs, { quality: this.quality, shader, antialias: this.antialias });

      if (!(await stage(0.9, 'Réglage de la ventilation et de l’éclairage…'))) return abandon();
      this.world = builtWorld;
      this.signs = builtSigns;
      this.materials = materials;
      this.baked = baked;
      this.lightmap = lightmap;
      this.lighting = fallback;
      committed = true;
      this.scene.add(builtWorld.group, builtSigns.group);
      this.applyEnv(map.env);
      // Real 3D models (furniture, vehicles…), instanced and tinted by the baked light.
      if (map.models?.length) {
        const models = await buildMapModels(map, (pos, out) => this.sampleLight(pos, out));
        if (!wanted()) {
          models.dispose();
          return;
        }
        this.models = models;
        this.scene.add(models.group);
      }
      this.fitShadow(map);

      // Compile the shaders and upload the textures now rather than on the first frame.
      onProgress?.(0.95, 'Derniers contrôles qualité…');
      await nextTask();
      if (!wanted()) return; // unloadMap() already cleaned up
      this.warmUp();

      onProgress?.(1, 'Plateau technique opérationnel');
    } catch (err) {
      if (!committed) abandon();
      else if (token === this.loadToken) this.unloadMap();
      throw err;
    }
  }

  unloadMap(): void {
    this.loadToken++;
    this.world?.dispose();
    this.models?.dispose();
    this.models = null;
    this.signs?.dispose();
    this.materials?.dispose();
    this.lightmap?.dispose();
    this.world = null;
    this.signs = null;
    this.materials = null;
    this.baked = null;
    this.lightmap = null;
    this.lighting = null;
    this.applyEnv(DEFAULT_ENV);
  }

  /** Sky, fog, clear colour and light-rig direction from a map environment. */
  private applyEnv(env: EnvDef): void {
    this.sky.setEnv(env);
    applyFog(this.scene, env);
    this.renderer.setClearColor(env.fogFar > 0 ? env.fogColor : env.skyHorizon, 1);
    this.sunDir.set(env.sunDir.x, env.sunDir.y, env.sunDir.z);
    if (this.sunDir.lengthSq() < 1e-6) this.sunDir.set(0.45, 0.8, 0.4);
    this.sunDir.normalize();
    this.sun.position.copy(this.sunDir).multiplyScalar(50);
    this.sun.target.position.set(0, 0, 0);
    // Real-time sun: colour and strength of the map (interior-only maps have none).
    this.sun.color.set(env.sunColor);
    this.sun.intensity = env.sunIntensity > 0 ? Math.PI * 1.05 * env.sunIntensity : 0;
    this.viewSun.color.set(env.sunIntensity > 0 ? env.sunColor : 0xffffff);
    // Reflection environment shared by the world, the avatars' weapons and the view model.
    this.envMap?.dispose();
    this.envMap = null;
    const hdr = env.sunIntensity > 0 && this.world ? this.hdr : null;
    if (hdr) {
      // Real sky: rotate the picture so that its sun sits at the map's sun azimuth,
      // and use the picture's own sun elevation for the real-time light.
      const theta = Math.atan2(hdr.sunDir.z, hdr.sunDir.x) - Math.atan2(this.sunDir.z, this.sunDir.x);
      const flat = Math.hypot(this.sunDir.x, this.sunDir.z) || 1;
      // Keep the light high enough for readable shadows even with a sunset picture.
      const el = Math.max(0.42, Math.asin(Math.min(1, Math.max(-1, hdr.sunDir.y))));
      this.sunDir.set((this.sunDir.x / flat) * Math.cos(el), Math.sin(el), (this.sunDir.z / flat) * Math.cos(el)).normalize();
      this.sun.position.copy(this.sunDir).multiplyScalar(50);
      this.scene.background = hdr.background;
      this.scene.backgroundRotation.set(0, theta, 0);
      this.scene.environmentRotation.set(0, theta, 0);
      this.scene.backgroundIntensity = 1;
      this.scene.environment = hdr.env;
      this.viewScene.environment = hdr.env;
      this.sky.mesh.visible = false;
    } else {
      this.scene.background = null;
      this.sky.mesh.visible = true;
      this.envMap = createEnvironment(this.renderer, env);
      this.scene.environment = this.envMap;
      this.viewScene.environment = this.envMap;
    }
    this.viewScene.environmentIntensity = 0.5;
  }

  /** Fit the sun's shadow frustum around the whole map. */
  private fitShadow(map: MapData): void {
    const b = map.bounds;
    const cx = (b.min.x + b.max.x) / 2;
    const cy = (b.min.y + b.max.y) / 2;
    const cz = (b.min.z + b.max.z) / 2;
    const r = Math.hypot(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) / 2 + 2;
    this.sun.target.position.set(cx, cy, cz);
    this.sun.position.set(cx + this.sunDir.x * (r + 20), cy + this.sunDir.y * (r + 20), cz + this.sunDir.z * (r + 20));
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -r;
    cam.right = cam.top = r;
    cam.near = 1;
    cam.far = 2 * r + 40;
    cam.updateProjectionMatrix();
    this.sun.target.updateMatrixWorld();
  }

  private warmUp(): void {
    try {
      this.renderer.compile(this.scene, this.camera);
      this.scene.traverse((obj) => {
        const material = (obj as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
        const map = material?.map;
        if (map) this.renderer.initTexture(map);
      });
      if (this.lightmap) this.renderer.initTexture(this.lightmap);
    } catch {
      /* warm-up is an optimisation only */
    }
  }

  sampleLight(pos: Vec3, out: THREE.Color): THREE.Color {
    // Light probes of the baked lighting: a lazily filled lattice, shadowed like the map.
    if (this.baked) return this.baked.model.sample(pos, out);
    if (this.lighting) return this.lighting.sample(pos, out);
    return out.setRGB(1, 1, 1);
  }

  // --- Settings / size ------------------------------------------------------------

  setFov(vfovDeg: number): void {
    if (this.camera.fov === vfovDeg) return;
    this.camera.fov = vfovDeg;
    this.camera.updateProjectionMatrix();
  }

  applySettings(): void {
    const quality = this.settings.value.quality;
    if (quality !== this.quality) {
      this.quality = quality;
      // Antialiasing is fixed at context creation; textures and resolution follow at once.
      this.materials?.setQuality(quality);
    }
    this.sizeDirty = true;
    this.resize();
  }

  resize(): void {
    this.sizeDirty = false;
    const w = this.canvas.clientWidth || this.canvas.width;
    const h = this.canvas.clientHeight || this.canvas.height;
    if (w <= 0 || h <= 0) return;
    const scale = Math.min(1, Math.max(0.25, this.settings.value.resolutionScale || 1));
    const ratio = Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_CAP[this.quality]) * scale;
    if (w === this.width && h === this.height && ratio === this.renderer.getPixelRatio()) return;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.post?.setSize(w, h, ratio);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = w / h;
    this.viewCamera.updateProjectionMatrix();
  }

  // --- Frame ----------------------------------------------------------------------

  render(): void {
    if (this.disposed) return;
    if (this.sizeDirty) this.resize();
    const time = (performance.now() - this.startTime) / 1000;
    this.sky.update(time);
    this.materials?.update(time);

    const renderer = this.renderer;
    renderer.info.reset();
    this.tmpQuat.copy(this.camera.quaternion).invert();
    this.viewSun.position.copy(this.sunDir).applyQuaternion(this.tmpQuat).multiplyScalar(5);
    if (this.quality !== 'low') {
      // Filmic pipeline: HDR + bloom + tone mapping + grade.
      if (!this.post) {
        this.post = createPost(renderer, this.scene, this.camera, this.viewScene, this.viewCamera, this.quality);
        this.post.setSize(this.width, this.height, renderer.getPixelRatio());
      }
      this.post.render(time);
      return;
    }
    renderer.clear();
    renderer.render(this.scene, this.camera);

    // The overlay scene lives in camera space: bring the sun direction into it so the
    // weapon is lit consistently with the world as the player turns.
    // (Skipped while nothing but the light rig is in the overlay scene.)
    if (this.viewScene.children.length > this.viewRigSize) {
      this.tmpQuat.copy(this.camera.quaternion).invert();
      this.viewSun.position.copy(this.sunDir).applyQuaternion(this.tmpQuat).multiplyScalar(5);
      renderer.clearDepth();
      renderer.render(this.viewScene, this.viewCamera);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.unloadMap();
    this.disposed = true;
    this.resizeObserver?.disconnect();
    this.sky.dispose();
    this.post?.dispose();
    this.envMap?.dispose();
    disposeMaterialTextures();
    this.renderer.dispose();
  }
}

export function createEngine(canvas: HTMLCanvasElement, settings: SettingsStore): IEngine {
  return new Engine(canvas, settings);
}
