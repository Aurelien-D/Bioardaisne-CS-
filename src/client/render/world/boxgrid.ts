/**
 * Uniform XZ grid of axis-aligned boxes (cheap spatial hash) used at load time by the
 * hidden-face test, the "is there something overhead" lighting query and the light baker
 * (map boxes, collision solids…: anything with a `min` / `max` corner pair).
 */
import type { Vec3 } from '../../../shared/math/vec3';

/** Anything with an axis-aligned bounding box. */
export interface Aabb {
  min: Vec3;
  max: Vec3;
}

const EMPTY: readonly number[] = [];

export class BoxGrid<T extends Aabb = Aabb> {
  readonly boxes: readonly T[];
  private readonly cell: number;
  private readonly minX: number;
  private readonly minZ: number;
  private readonly nx: number;
  private readonly nz: number;
  private readonly cells: (number[] | undefined)[];
  private readonly seen: Int32Array;
  private stamp = 0;

  /** `include` selects which boxes are indexed (e.g. opaque occluders only). */
  constructor(boxes: readonly T[], include: (box: T, index: number) => boolean, cell = 4) {
    this.boxes = boxes;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    const picked: number[] = [];
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i]!;
      if (!include(b, i)) continue;
      picked.push(i);
      if (b.min.x < minX) minX = b.min.x;
      if (b.min.z < minZ) minZ = b.min.z;
      if (b.max.x > maxX) maxX = b.max.x;
      if (b.max.z > maxZ) maxZ = b.max.z;
    }
    if (!picked.length) {
      minX = minZ = 0;
      maxX = maxZ = 1;
    }
    // Keep the grid small even for maps with a very large ground plane.
    const extent = Math.max(maxX - minX, maxZ - minZ, 1);
    this.cell = Math.max(cell, extent / 192);
    this.minX = minX;
    this.minZ = minZ;
    this.nx = Math.max(1, Math.ceil((maxX - minX) / this.cell));
    this.nz = Math.max(1, Math.ceil((maxZ - minZ) / this.cell));
    this.cells = new Array<number[] | undefined>(this.nx * this.nz);
    this.seen = new Int32Array(boxes.length);
    for (const i of picked) {
      const b = boxes[i]!;
      const x0 = this.clampX(Math.floor((b.min.x - minX) / this.cell));
      const x1 = this.clampX(Math.floor((b.max.x - minX) / this.cell));
      const z0 = this.clampZ(Math.floor((b.min.z - minZ) / this.cell));
      const z1 = this.clampZ(Math.floor((b.max.z - minZ) / this.cell));
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          const k = cz * this.nx + cx;
          (this.cells[k] ??= []).push(i);
        }
      }
    }
  }

  private clampX(c: number): number {
    return c < 0 ? 0 : c >= this.nx ? this.nx - 1 : c;
  }

  private clampZ(c: number): number {
    return c < 0 ? 0 : c >= this.nz ? this.nz - 1 : c;
  }

  /**
   * Collect into `out` (cleared first) the indexed boxes whose cells intersect the XZ
   * rectangle; each box appears once. Candidates only: callers test the exact overlap.
   */
  queryRect(x0: number, z0: number, x1: number, z1: number, out: number[]): number[] {
    out.length = 0;
    const cx0 = this.clampX(Math.floor((x0 - this.minX) / this.cell));
    const cx1 = this.clampX(Math.floor((x1 - this.minX) / this.cell));
    const cz0 = this.clampZ(Math.floor((z0 - this.minZ) / this.cell));
    const cz1 = this.clampZ(Math.floor((z1 - this.minZ) / this.cell));
    if (cx0 === cx1 && cz0 === cz1) {
      const list = this.cells[cz0 * this.nx + cx0];
      if (list) for (let i = 0; i < list.length; i++) out.push(list[i]!);
      return out;
    }
    const stamp = ++this.stamp;
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const list = this.cells[cz * this.nx + cx];
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const b = list[i]!;
          if (this.seen[b] === stamp) continue;
          this.seen[b] = stamp;
          out.push(b);
        }
      }
    }
    return out;
  }

  /** Indices of the indexed boxes whose footprint touches the cell containing (x, z). */
  query(x: number, z: number): readonly number[] {
    const cx = Math.floor((x - this.minX) / this.cell);
    const cz = Math.floor((z - this.minZ) / this.cell);
    if (cx < 0 || cz < 0 || cx >= this.nx || cz >= this.nz) return EMPTY;
    return this.cells[cz * this.nx + cx] ?? EMPTY;
  }
}
