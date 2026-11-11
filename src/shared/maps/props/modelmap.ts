/**
 * Procedural props replaced by a real 3D model: the prop keeps its colliders, the
 * model provides the visuals. Leave a prop out to keep its procedural look.
 */
export interface PropModel {
  /** Asset id in maps/models.ts. */
  asset: string;
  /** Extra rotation in degrees so the model's front matches the prop's front (+Z). */
  rot?: number;
  scale?: number;
  /** Vertical offset in metres. */
  y?: number;
}

export const PROP_MODELS: Record<string, PropModel> = {};
