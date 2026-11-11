/**
 * Prop library: every prop of the level-design kit, its catalogue and placement helpers.
 *
 * @example
 * import { labBench, analyserLarge, placeProp, PROPS } from './props';
 * b.at(4, 0, 2, 1, () => labBench(b, { variant: 'sink', width: 2.5 }));   // custom variant, front toward +X
 * placeProp(b, 'analyser_large', 10, 0, 3, 2);                             // catalogue default, front toward −Z
 * placeProp(b, 'lab_fridge', 10, 0, 0.1, 0, 'back');                       // its BACK touches the point (wall at z = 0.1)
 * const [w, d, h] = PROPS.lab_fridge.footprint;                            // sizes for layout maths
 */
import type { MapBuilder } from '../builder';
import type { PropFamily, PropInfo } from './kit';
import { LAB_PROPS } from './lab';
import { LOGISTICS_PROPS } from './logistics';
import { PROP_MODELS } from './modelmap';
import { OFFICE_PROPS } from './office';
import { OPENING_PROPS } from './openings';
import { RECEPTION_PROPS } from './reception';
import { SAMPLING_PROPS } from './sampling';

export * from './kit';
export * from './lab';
export * from './reception';
export * from './sampling';
export * from './office';
export * from './logistics';
export * from './openings';

/** Every prop, grouped by family, in display order. */
export const PROP_CATALOG: PropInfo[] = [
  ...LAB_PROPS,
  ...RECEPTION_PROPS,
  ...SAMPLING_PROPS,
  ...OFFICE_PROPS,
  ...LOGISTICS_PROPS,
  ...OPENING_PROPS,
];

/** French names of the prop families, in display order. */
export const PROP_FAMILIES: { id: PropFamily; label: string }[] = [
  { id: 'labo', label: 'Laboratoire' },
  { id: 'accueil', label: "Accueil et salle d'attente" },
  { id: 'prelevement', label: 'Salles de prélèvement' },
  { id: 'bureau', label: 'Bureaux et espaces communs' },
  { id: 'logistique', label: 'Logistique' },
  { id: 'ouvertures', label: 'Portes et fenêtres' },
];

/** Catalogue indexed by id. */
export const PROPS: Record<string, PropInfo> = Object.fromEntries(PROP_CATALOG.map((p) => [p.id, p]));

/**
 * Places the default variant of a catalogue prop.
 * @param q      quarter turns: the front of the prop faces 0 = +Z, 1 = +X, 2 = −Z, 3 = −X
 * @param anchor 'center' (default): (x, z) is the centre of the footprint;
 *               'back': (x, z) is the middle of the prop's back edge — handy against a wall.
 */
export function placeProp(b: MapBuilder, id: string, x: number, y: number, z: number, q = 0, anchor: 'center' | 'back' = 'center'): PropInfo {
  const info = PROPS[id];
  if (!info) throw new Error(`placeProp(): unknown prop "${id}"`);
  const off = anchor === 'back' ? info.footprint[1] / 2 : 0;
  const model = PROP_MODELS[id];
  if (model) {
    // A real 3D model draws this prop: keep only the colliders of the procedural version.
    b.at(x, y, z, q, () =>
      b.at(0, 0, off, 0, () => {
        b.withoutVisuals(() => info.build(b));
        b.model(model.asset, 0, model.y ?? 0, 0, model.rot ?? 0, model.scale ?? 1);
      }),
    );
    return info;
  }
  b.at(x, y, z, q, () => b.at(0, 0, off, 0, () => info.build(b)));
  return info;
}
