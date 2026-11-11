/**
 * Catalogue of real 3D models (glTF) that can be placed in maps with `b.model(asset, …)`
 * or that replace procedural props (see props/modelmap.ts).
 *
 * Files live in public/media/models/props/<asset>/model.json (glTF JSON with embedded
 * buffers) with their textures next to it. A model's origin is the centre of its
 * footprint on the floor; its "front" faces +Z, like the procedural props.
 */
export interface ModelAsset {
  /** French label. */
  label: string;
  /** Real size in metres [width X, height Y, depth Z] once scaled. */
  size: [number, number, number];
  /** Author / source / licence line (also listed in public/media/credits-props.md). */
  credit: string;
}

export const MODEL_ASSETS: Record<string, ModelAsset> = {};
