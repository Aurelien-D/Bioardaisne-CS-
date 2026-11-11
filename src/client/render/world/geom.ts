/**
 * Growable vertex / index buffers used to merge many faces into one BufferGeometry.
 *
 * Vertex layout: position (3), uv (2), colour (3, linear RGB — tint × baked light) and,
 * when enabled, uv1 (2, lightmap atlas coordinates).
 */
import * as THREE from 'three';

export class GeometryWriter {
  pos: Float32Array;
  uv: Float32Array;
  col: Float32Array;
  /** Second UV set (lightmap); null when the writer was created without it. */
  uv1: Float32Array | null;
  idx: Uint32Array;
  vertexCount = 0;
  indexCount = 0;

  constructor(withUv1 = false, vertexCapacity = 128) {
    this.pos = new Float32Array(vertexCapacity * 3);
    this.uv = new Float32Array(vertexCapacity * 2);
    this.col = new Float32Array(vertexCapacity * 3);
    this.uv1 = withUv1 ? new Float32Array(vertexCapacity * 2) : null;
    this.idx = new Uint32Array(vertexCapacity * 3);
  }

  get triangleCount(): number {
    return this.indexCount / 3;
  }

  /** Make room for `vertices` more vertices and `indices` more indices. */
  reserve(vertices: number, indices: number): void {
    const needV = this.vertexCount + vertices;
    if (needV * 3 > this.pos.length) {
      let cap = this.pos.length / 3;
      while (cap < needV) cap *= 2;
      this.pos = grow(this.pos, cap * 3);
      this.uv = grow(this.uv, cap * 2);
      this.col = grow(this.col, cap * 3);
      if (this.uv1) this.uv1 = grow(this.uv1, cap * 2);
    }
    const needI = this.indexCount + indices;
    if (needI > this.idx.length) {
      let cap = this.idx.length;
      while (cap < needI) cap *= 2;
      const next = new Uint32Array(cap);
      next.set(this.idx.subarray(0, this.indexCount));
      this.idx = next;
    }
  }

  /** Append a vertex (call reserve() first) and return its index. */
  vertex(x: number, y: number, z: number, u: number, v: number, r: number, g: number, b: number): number {
    const i = this.vertexCount++;
    const i3 = i * 3;
    const i2 = i * 2;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.uv[i2] = u;
    this.uv[i2 + 1] = v;
    this.col[i3] = r;
    this.col[i3 + 1] = g;
    this.col[i3 + 2] = b;
    return i;
  }

  /** Lightmap coordinates of vertex `i` (no-op when the writer has no uv1 set). */
  setUv1(i: number, u: number, v: number): void {
    if (!this.uv1) return;
    this.uv1[i * 2] = u;
    this.uv1[i * 2 + 1] = v;
  }

  tri(a: number, b: number, c: number): void {
    const n = this.indexCount;
    this.idx[n] = a;
    this.idx[n + 1] = b;
    this.idx[n + 2] = c;
    this.indexCount = n + 3;
  }

  /** Two triangles a-b-c, a-c-d (counter-clockwise = front). */
  quad(a: number, b: number, c: number, d: number): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
}

function grow(src: Float32Array, length: number): Float32Array {
  const next = new Float32Array(length);
  next.set(src);
  return next;
}

/** Concatenate writers into one indexed BufferGeometry with bounding volumes. */
export function writersToGeometry(writers: readonly GeometryWriter[]): THREE.BufferGeometry {
  let vertices = 0;
  let indices = 0;
  let hasUv1 = false;
  for (const w of writers) {
    vertices += w.vertexCount;
    indices += w.indexCount;
    if (w.uv1) hasUv1 = true;
  }
  const pos = new Float32Array(vertices * 3);
  const uv = new Float32Array(vertices * 2);
  const col = new Float32Array(vertices * 3);
  const uv1 = hasUv1 ? new Float32Array(vertices * 2) : null;
  const idx: Uint16Array | Uint32Array = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let vo = 0;
  let io = 0;
  for (const w of writers) {
    pos.set(w.pos.subarray(0, w.vertexCount * 3), vo * 3);
    uv.set(w.uv.subarray(0, w.vertexCount * 2), vo * 2);
    col.set(w.col.subarray(0, w.vertexCount * 3), vo * 3);
    if (uv1 && w.uv1) uv1.set(w.uv1.subarray(0, w.vertexCount * 2), vo * 2);
    const src = w.idx;
    for (let i = 0; i < w.indexCount; i++) idx[io + i] = src[i]! + vo;
    vo += w.vertexCount;
    io += w.indexCount;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (uv1) geo.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
