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
  // Kitchenette (sink, hob, oven); the coffee maker is a separate bench prop.
  kitchen_counter: { asset: 'kitchen_counter' },
  coffee_machine: { asset: 'coffee_machine' },
  microwave: { asset: 'microwave' },
  binder_shelf: { asset: 'binder_shelf' },
  coat_rack: { asset: 'coat_stand' },
  // Wall fittings: the model's origin is its lowest point, the prop's origin is the floor.
  fire_extinguisher: { asset: 'fire_extinguisher', y: 0.45 },
  radiator: { asset: 'radiator', y: 0.15 },
  wall_clock: { asset: 'wall_clock', y: 2.12 },
  // These wall props have their mounting height baked into the model (origin on the floor).
  whiteboard: { asset: 'whiteboard' },
  // --- Accueil et salle d'attente
  waiting_chairs_3: { asset: 'waiting_bench_3' },
  waiting_chairs_4: { asset: 'waiting_bench_4' },
  coffee_table: { asset: 'coffee_table' },
  water_dispenser: { asset: 'water_dispenser' },
  plant_small: { asset: 'plant_small' },
  plant_large: { asset: 'plant_large' },
  ticket_kiosk: { asset: 'ticket_kiosk' },
  call_screen: { asset: 'call_screen' },
  magazine_rack: { asset: 'magazine_rack' },
  privacy_screen: { asset: 'privacy_screen' },
  // --- Salles de prélèvement
  stool: { asset: 'stool' },
  exam_couch: { asset: 'exam_couch' },
  sampling_trolley: { asset: 'sampling_trolley' },
  wash_basin: { asset: 'wash_basin' },
  wall_cabinet: { asset: 'wall_cabinet' },
  // --- Laboratoire
  microscope: { asset: 'microscope' },
  analyser_bench: { asset: 'pcr_machine' },
  lab_fridge: { asset: 'lab_fridge' },
  freezer: { asset: 'freezer' },
  storage_shelf: { asset: 'storage_shelf' },
  trolley: { asset: 'medical_cart' },
  lab_bench: { asset: 'lab_bench' },
  lab_bench_sink: { asset: 'lab_bench_sink' },
  lab_bench_shelf: { asset: 'lab_bench_shelf' },
  island_bench: { asset: 'island_bench' },
  fume_hood: { asset: 'biosafety_cabinet' },
  reagent_cabinet: { asset: 'safety_cabinet' },
  clinical_waste_bin: { asset: 'clinical_waste_bin' },
  gas_cylinder: { asset: 'gas_cylinder' },
  sample_cooler: { asset: 'sample_cooler' },
  // --- Logistique
  carton_stack: { asset: 'carton_stack' },
  pallet: { asset: 'pallet' },
  pallet_loaded: { asset: 'pallet_loaded' },
  pallet_jack: { asset: 'pallet_jack' },
  transport_crate: { asset: 'transport_crate' },
  crate_stack: { asset: 'crate_stack' },
};
