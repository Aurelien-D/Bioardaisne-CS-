/**
 * Procedural props replaced by a real 3D model: the prop keeps its colliders, the
 * model provides the visuals. Leave a prop out to keep its procedural look.
 *
 * Every model is baked in the prop frame (metres, origin at the centre of the footprint
 * on the floor, front toward +Z) and already scaled to the prop's footprint, so most
 * entries need nothing but the asset id. Composite props (workstation, meeting table,
 * pallet of cartons, shelving…) are single assets assembled at conversion time.
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

export const PROP_MODELS: Record<string, PropModel> = {
  // --- Bureaux et espaces communs
  office_chair: { asset: 'office_chair' },
  visitor_chair: { asset: 'visitor_chair' },
  desk: { asset: 'desk' },
  corner_desk: { asset: 'corner_desk' },
  workstation: { asset: 'workstation' },
  computer_set: { asset: 'computer_set' },
  meeting_table: { asset: 'meeting_table' },
  sofa: { asset: 'sofa' },
  office_cupboard: { asset: 'office_cupboard' },
  lockers: { asset: 'lockers' },
  photocopier: { asset: 'photocopier' },
  kitchen_fridge: { asset: 'kitchen_fridge' },
  // Wall fittings: the model's origin is its lowest point, the prop's origin is the floor.
  fire_extinguisher: { asset: 'fire_extinguisher', y: 0.45 },
  radiator: { asset: 'radiator', y: 0.15 },
  wall_clock: { asset: 'wall_clock', y: 2.12 },
  // --- Accueil et salle d'attente
  waiting_chairs_3: { asset: 'waiting_bench_3' },
  waiting_chairs_4: { asset: 'waiting_bench_4' },
  coffee_table: { asset: 'coffee_table' },
  water_dispenser: { asset: 'water_dispenser' },
  plant_small: { asset: 'plant_small' },
  plant_large: { asset: 'plant_large' },
  // --- Laboratoire
  microscope: { asset: 'microscope' },
  analyser_bench: { asset: 'pcr_machine' },
  lab_fridge: { asset: 'lab_fridge' },
  freezer: { asset: 'freezer' },
  storage_shelf: { asset: 'storage_shelf' },
  trolley: { asset: 'medical_cart' },
  // --- Logistique
  carton_stack: { asset: 'carton_stack' },
  pallet: { asset: 'pallet' },
  pallet_loaded: { asset: 'pallet_loaded' },
  pallet_jack: { asset: 'pallet_jack' },
};
