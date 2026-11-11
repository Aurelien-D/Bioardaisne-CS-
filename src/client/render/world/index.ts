/**
 * World builder: MapData -> a handful of merged, statically lit meshes.
 *
 * Pipeline (each step is synchronous; the engine yields to the event loop between them):
 *   const builder = new WorldBuilder(map, { shader });
 *   builder.collectFaces();   // box faces -> BoxFace records (hidden parts removed)
 *   builder.emitFaces();      // records -> watertight triangles, lighting baked per vertex
 *   builder.emitPrims();      // decorative primitives
 *   const world = builder.finish(materials);   // merged meshes in world.group
 *
 * Geometry is grouped by material. Materials with a lot of triangles are split into
 * spatial chunks (CHUNK_SIZE metres on XZ) so frustum culling can skip what is off-screen;
 * small materials stay in one mesh to keep the number of draw calls low. Transparent
 * materials always get one mesh per chunk (sorted back to front by the renderer).
 *
 * Baked lighting (see bake.ts): the baker lists the faces itself and sets `face.lm` on the
 * light-mapped records, so the engine hands them over instead of calling collectFaces():
 *   const baked = await bakeLightmapAsync(map, world, { quality }, onProgress);
 *   const builder = new WorldBuilder(map, { shader: baked.shader, lightmapUv1: true,
 *                                           neutralLightmapUv: baked.neutralUv });
 *   builder.faces = baked.faces;          // records with their atlas rectangles
 *   builder.emitFaces(); builder.emitPrims(); const world = builder.finish(materials);
 *   materials.setLightMap(createLightmapTexture(baked), baked.intensity);
 * Records without `lm` (emissive, transparent, `detail` boxes) and prims are lit per vertex
 * by `shader` and get `neutralLightmapUv`. See faces.ts for the BoxFace record.
 */
import * as THREE from 'three';
import { materialInfo, type MaterialId } from '../../../shared/maps/materials';
import type { MapData } from '../../../shared/maps/types';
import { collectBoxFaces, emitBoxFaces, type BoxFace, type FaceEmitOptions } from './faces';
import { GeometryWriter, writersToGeometry } from './geom';
import type { SurfaceShader } from './lighting';
import type { WorldMaterials } from './materials';
import { emitPrim } from './prims';

export { collectBoxFaces, emitBoxFaces, faceNormal, faceParamS, faceParamT, facePoint, isFittedMaterial } from './faces';
export type { BoxFace, FaceUvMode, LightmapRect } from './faces';
export { MapLighting } from './lighting';
export { hexToLinear, pointFalloff } from './lightmath';
export type { SurfaceShader } from './lightmath';
export { WorldMaterials } from './materials';
export { LIGHTMAP_RANGE, VertexShader, bakeLightmap, bakeLightmapAsync, clearBakeCache, findFaceRecord, lightmapLightAt } from './bake';
export type { BakeOptions, BakeQuality, BakeResult, BakeStats } from './bake';
export { LightModel } from './lightmodel';
export { createLightmapTexture } from './lightmap';

/** Size (m) of the spatial chunks on the XZ plane. */
export const CHUNK_SIZE = 40;
/** Materials with fewer triangles than this stay in a single mesh. */
const SPLIT_TRIANGLES = 4000;
/** Chunks smaller than this are merged into one "rest" mesh of their material. */
const MIN_CHUNK_TRIANGLES = 800;
/** Default size (m) of the quads lit faces are cut into (vertex-lighting resolution). */
export const DEFAULT_SUBDIVISION = 2;

export interface WorldBuildOptions {
  /** Vertex lighting provider. */
  shader: SurfaceShader;
  /** Quad size (m) for vertex-lit box faces; 0 disables the subdivision. */
  subdivide?: number;
  /** Write a second UV set (uv1) for a lightmap atlas. */
  lightmapUv1?: boolean;
  /** uv1 of everything that is not light-mapped (a neutral texel of the atlas). */
  neutralLightmapUv?: readonly [number, number];
}

export interface WorldStats {
  boxes: number;
  /** Face records drawn (a clipped face counts once per visible rectangle). */
  faces: number;
  /** Box faces not drawn at all (overridden with `null` or completely buried). */
  facesCulled: number;
  prims: number;
  meshes: number;
  triangles: number;
  vertices: number;
}

interface Bucket {
  mat: MaterialId;
  writer: GeometryWriter;
}

/** Result of a build: add `group` to the scene, call dispose() when the map is unloaded. */
export class World {
  readonly group: THREE.Group;
  readonly faces: readonly BoxFace[];
  readonly stats: WorldStats;

  constructor(group: THREE.Group, faces: readonly BoxFace[], stats: WorldStats) {
    this.group = group;
    this.faces = faces;
    this.stats = stats;
  }

  /** Free the geometries (materials and textures are owned by WorldMaterials / the texture provider). */
  dispose(): void {
    this.group.removeFromParent();
    for (const child of this.group.children) {
      if ((child as THREE.Mesh).isMesh) (child as THREE.Mesh).geometry.dispose();
    }
    this.group.clear();
  }
}

export class WorldBuilder {
  /** Visible box faces (available after collectFaces()). */
  faces: BoxFace[] = [];

  private readonly map: MapData;
  private readonly opts: WorldBuildOptions;
  private readonly buckets = new Map<string, Bucket>();
  private primCount = 0;

  constructor(map: MapData, opts: WorldBuildOptions) {
    this.map = map;
    this.opts = opts;
  }

  private writerFor(mat: MaterialId, x: number, z: number): GeometryWriter {
    const key = `${mat}|${Math.floor(x / CHUNK_SIZE)}|${Math.floor(z / CHUNK_SIZE)}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { mat, writer: new GeometryWriter(this.opts.lightmapUv1 === true) };
      this.buckets.set(key, bucket);
    }
    return bucket.writer;
  }

  /** Step 1: list the visible faces of the map boxes. */
  collectFaces(): BoxFace[] {
    this.faces = collectBoxFaces(this.map.boxes);
    return this.faces;
  }

  /** Step 2: triangulate the faces (bakes the vertex lighting). */
  emitFaces(): void {
    const emit: FaceEmitOptions = {
      shader: this.opts.shader,
      subdivide: this.opts.subdivide ?? DEFAULT_SUBDIVISION,
      neutralLightmapUv: this.opts.neutralLightmapUv,
    };
    emitBoxFaces(this.faces, emit, (face) => {
      const cu = (face.u0 + face.u1) * 0.5;
      const cv = (face.v0 + face.v1) * 0.5;
      const x = face.axis === 0 ? face.plane : face.uAxis === 0 ? cu : cv;
      const z = face.axis === 2 ? face.plane : face.uAxis === 2 ? cu : cv;
      return this.writerFor(face.mat, x, z);
    });
  }

  /** Step 3: decorative primitives. */
  emitPrims(): void {
    for (const prim of this.map.prims) {
      emitPrim(this.writerFor(prim.mat, prim.pos.x, prim.pos.z), prim, this.opts.shader, this.opts.neutralLightmapUv);
      this.primCount++;
    }
  }

  /** Step 4: merge the buckets into meshes. */
  finish(materials: WorldMaterials): World {
    const byMat = new Map<MaterialId, GeometryWriter[]>();
    for (const b of this.buckets.values()) {
      if (b.writer.indexCount === 0) continue;
      let list = byMat.get(b.mat);
      if (!list) byMat.set(b.mat, (list = []));
      list.push(b.writer);
    }
    this.buckets.clear();

    const group = new THREE.Group();
    group.name = 'bas-world';
    let triangles = 0;
    let vertices = 0;
    let meshes = 0;

    for (const [mat, writers] of byMat) {
      const transparent = materialInfo(mat).transparent === true;
      let total = 0;
      for (const w of writers) total += w.triangleCount;

      let sets: GeometryWriter[][];
      if (transparent) {
        sets = writers.map((w) => [w]);
      } else if (total <= SPLIT_TRIANGLES) {
        sets = [writers];
      } else {
        sets = [];
        const rest: GeometryWriter[] = [];
        for (const w of writers) {
          if (w.triangleCount >= MIN_CHUNK_TRIANGLES) sets.push([w]);
          else rest.push(w);
        }
        if (rest.length) sets.push(rest);
      }

      const material = materials.get(mat);
      for (const set of sets) {
        const geometry = writersToGeometry(set);
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `world:${mat}`;
        mesh.receiveShadow = true;
        mesh.castShadow = !material.transparent;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        group.add(mesh);
        meshes++;
        triangles += geometry.index!.count / 3;
        vertices += geometry.getAttribute('position').count;
      }
    }

    const drawn = new Set<string>();
    for (const f of this.faces) drawn.add(`${f.box}${f.name}`);
    return new World(group, this.faces, {
      boxes: this.map.boxes.length,
      faces: this.faces.length,
      facesCulled: this.map.boxes.length * 6 - drawn.size,
      prims: this.primCount,
      meshes,
      triangles,
      vertices,
    });
  }
}
