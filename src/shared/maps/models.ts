/**
 * Catalogue of real 3D models (glTF) that can be placed in maps with `b.model(asset, …)`
 * or that replace procedural props (see props/modelmap.ts).
 *
 * Files live in public/media/models/props/<asset>/model.json (glTF JSON with embedded
 * buffers) with their textures next to it. A model's origin is the centre of its
 * footprint on the floor; its "front" faces +Z, like the procedural props.
 * (Trees and lamp posts: the origin is under the trunk / the pole.)
 *
 * Sources and licences (CC0 or CC BY only): public/media/credits-props.md.
 */
export interface ModelAsset {
  /** French label. */
  label: string;
  /** Real size in metres [width X, height Y, depth Z] once scaled. */
  size: [number, number, number];
  /** Author / source / licence line (also listed in public/media/credits-props.md). */
  credit: string;
}

export const MODEL_ASSETS: Record<string, ModelAsset> = {
  office_chair: {
    label: 'Fauteuil de bureau',
    size: [0.67, 1.04, 0.72],
    credit: '« Office Chair » par FangedAnteater (CC BY 4.0) — sketchfab.com/3d-models/db03012c3c484314a480b4137da8eb30',
  },
  visitor_chair: {
    label: 'Chaise visiteur',
    size: [0.44, 0.84, 0.53],
    credit: '« Office Chair » par Kain Hunter (CC BY 4.0) — sketchfab.com/3d-models/ca6da55a27c649609408d9f559ba2a5b',
  },
  waiting_bench_3: {
    label: "Chaises d'attente sur poutre (3 places)",
    size: [1.65, 0.88, 0.6],
    credit: '« waiting chair banch » par azizcharfeddine1997 (CC BY 4.0) — sketchfab.com/3d-models/f64ddfc64db94f54a5e853a8d0c5feb8',
  },
  waiting_bench_4: {
    label: "Chaises d'attente sur poutre (4 places)",
    size: [2.2, 0.88, 0.6],
    credit: '« waiting chair banch » par azizcharfeddine1997 (CC BY 4.0) — sketchfab.com/3d-models/f64ddfc64db94f54a5e853a8d0c5feb8',
  },
  sofa: {
    label: 'Canapé deux places',
    size: [1.8, 0.82, 0.85],
    credit: '« Sofa » par katjagricishina (CC BY 4.0) — sketchfab.com/3d-models/03550a3529c24611a12aa158747374e0',
  },
  desk: {
    label: 'Bureau droit',
    size: [1.6, 0.74, 0.8],
    credit: '« Office Desk 140x60 » par AleixoAlonso (CC BY 4.0) — sketchfab.com/3d-models/9262f311271c4c4390341e526d3fe103',
  },
  computer_set: {
    label: 'Écran, clavier et souris',
    size: [0.7, 0.46, 0.46],
    credit: '« Desktop Computer » par Tytan (CC BY 4.0) — sketchfab.com/3d-models/561abc2fc95941609fc7bc6f232895c2',
  },
  workstation: {
    label: 'Poste de travail complet',
    size: [1.6, 1.2, 1.53],
    credit: '« Office Desk 140x60 » par AleixoAlonso (CC BY 4.0) — sketchfab.com/3d-models/9262f311271c4c4390341e526d3fe103 + « Desktop Computer » par Tytan (CC BY 4.0) — sketchfab.com/3d-models/561abc2fc95941609fc7bc6f232895c2 + « Office Chair » par FangedAnteater (CC BY 4.0) — sketchfab.com/3d-models/db03012c3c484314a480b4137da8eb30',
  },
  corner_desk: {
    label: "Bureau d'angle",
    size: [1.8, 0.74, 1.6],
    credit: '« Desk » par Cameron-Main (CC BY 4.0) — sketchfab.com/3d-models/cb35bf776c6844fb9564a439b01b7ecc',
  },
  meeting_table: {
    label: 'Table de réunion et six chaises',
    size: [2.4, 0.84, 2.25],
    credit: '« Office table » par Rzyas (CC BY 4.0) — sketchfab.com/3d-models/2a82a9f65e054aae9e7e596db4f5f535 + « Office Chair » par Kain Hunter (CC BY 4.0) — sketchfab.com/3d-models/ca6da55a27c649609408d9f559ba2a5b',
  },
  coffee_table: {
    label: 'Table basse',
    size: [1.0, 0.43, 0.6],
    credit: '« Modern Coffee Table 01 » par Amin (CC0 1.0) — polyhaven.com/a/modern_coffee_table_01',
  },
  lockers: {
    label: 'Casiers vestiaire',
    size: [0.9, 1.9, 0.5],
    credit: '« Locker » par neverfollow81 (CC BY 4.0) — sketchfab.com/3d-models/41f55ae53fca41c3b861cebe5244b5dd',
  },
  office_cupboard: {
    label: 'Armoire de bureau métallique',
    size: [1.0, 1.95, 0.45],
    credit: '« Metal Cabinet (Low Poly) » par Berk Gedik (CC BY 4.0) — sketchfab.com/3d-models/1053729ad9d24d71a578622251f76deb',
  },
  kitchen_fridge: {
    label: 'Réfrigérateur de cuisine',
    size: [0.62, 1.8, 0.66],
    credit: '« Refrigerator » par neeldesai2016 (CC BY 4.0) — sketchfab.com/3d-models/5adb3486557b46eaab0e1ab643709a9c',
  },
  lab_fridge: {
    label: 'Réfrigérateur de laboratoire vitré',
    size: [0.75, 1.95, 0.7],
    credit: '« Cupboards, Drawers and Coolers » par thelegokid4455 (CC BY 4.0) — sketchfab.com/3d-models/f78bde3bd8bc4d64b7d673c2de6b30f4',
  },
  freezer: {
    label: 'Congélateur armoire',
    size: [0.82, 1.95, 0.85],
    credit: '« Glass Door Reach-In Refrigerator » par allenbranch (CC BY 4.0) — sketchfab.com/3d-models/c639ecb7af754050a8080a98eecce5ba',
  },
  water_dispenser: {
    label: 'Fontaine à eau',
    size: [0.31, 1.38, 0.34],
    credit: '« Water cooler » par tboiston (CC BY 4.0) — sketchfab.com/3d-models/4b88c4c4e94c497ca39f831f374e89fc',
  },
  photocopier: {
    label: 'Photocopieur',
    size: [0.6, 1.1, 0.56],
    credit: '« Copier » par ykykykk (CC BY 4.0) — sketchfab.com/3d-models/9eebb4e8b77944159892df30d8b44de5',
  },
  radiator: {
    label: 'Radiateur',
    size: [1.1, 0.6, 0.1],
    credit: '« Radiator » par yryabchenko (CC BY 4.0) — sketchfab.com/3d-models/cec6a4d3ac3a426e85cedf2ff80aee20',
  },
  fire_extinguisher: {
    label: 'Extincteur',
    size: [0.28, 0.58, 0.16],
    credit: '« Fire Extinguisher » par azzajess (CC BY 4.0) — sketchfab.com/3d-models/829be3eaaa8d47ae86a7f70ffb196b20',
  },
  wall_clock: {
    label: 'Horloge murale',
    size: [0.36, 0.36, 0.05],
    credit: '« Wall Clock » par PierreB3D (CC0 1.0) — polyhaven.com/a/wall_clock',
  },
  plant_small: {
    label: 'Plante verte en pot',
    size: [0.7, 0.9, 0.73],
    credit: '« Tall Potted House Plant » par DevonCarlson (CC BY 4.0) — sketchfab.com/3d-models/9d67ee5efd7e414ebf81a3dcc6bf7ada',
  },
  plant_large: {
    label: 'Dracaena en pot',
    size: [1.09, 1.85, 0.88],
    credit: '« Pot plant - Dracena » par Asia Matusik (CC BY 4.0) — sketchfab.com/3d-models/c2207e3e18ba454f8ceb43f208d0927c',
  },
  microscope: {
    label: 'Microscope binoculaire',
    size: [0.19, 0.45, 0.29],
    credit: '« Microscope » par lionclaw0612 (CC BY 4.0) — sketchfab.com/3d-models/dd9e73d51edb43198bd40d0bbd2dd54e',
  },
  pcr_machine: {
    label: 'Automate de paillasse (thermocycleur)',
    size: [0.5, 0.42, 0.52],
    credit: '« PCR machine » par orphic_oasis8 (CC BY 4.0) — sketchfab.com/3d-models/a76bd38f0af1422d96add0d9606e5fee',
  },
  medical_cart: {
    label: 'Chariot à plateaux',
    size: [0.85, 0.82, 0.43],
    credit: '« Medical Cart » par NicolasVB (CC BY 4.0) — sketchfab.com/3d-models/2a0a574f9e374702af8c415fce296f45',
  },
  carton_stack: {
    label: 'Pile de cartons',
    size: [1.0, 1.12, 0.72],
    credit: '« Set of Cardboard Boxes » par NotAnotherApocalypticCo. (CC BY 4.0) — sketchfab.com/3d-models/8986ba512f704ac5b253286a0d1ad8bb',
  },
  pallet: {
    label: 'Palette en bois',
    size: [1.2, 0.14, 0.8],
    credit: '« Wooden Pallet » par PagDev (CC BY 4.0) — sketchfab.com/3d-models/da68b3ed714b436f9e94c36b0e8171c0',
  },
  pallet_loaded: {
    label: 'Palette de cartons',
    size: [1.2, 1.26, 0.8],
    credit: '« Wooden Pallet » par PagDev (CC BY 4.0) — sketchfab.com/3d-models/da68b3ed714b436f9e94c36b0e8171c0 + « Set of Cardboard Boxes » par NotAnotherApocalypticCo. (CC BY 4.0) — sketchfab.com/3d-models/8986ba512f704ac5b253286a0d1ad8bb',
  },
  pallet_jack: {
    label: 'Transpalette manuel',
    size: [0.56, 1.14, 1.55],
    credit: '« pallet truck » par Kwon_Hyuk (CC BY 4.0) — sketchfab.com/3d-models/0419ee072fa4427aaadc2afbcae2894d',
  },
  storage_shelf: {
    label: 'Étagère de stockage garnie de cartons',
    size: [1.2, 2.0, 0.5],
    credit: '« Steel Frame Shelves 01 » par James Ray Cock (CC0 1.0) — polyhaven.com/a/steel_frame_shelves_01 + « Set of Cardboard Boxes » par NotAnotherApocalypticCo. (CC BY 4.0) — sketchfab.com/3d-models/8986ba512f704ac5b253286a0d1ad8bb',
  },
  car_sedan: {
    label: 'Berline grise',
    size: [1.94, 1.34, 4.36],
    credit: '« Generic passenger car pack » par Comrade1280 (CC BY 4.0) — sketchfab.com/3d-models/20f9af9b8a404d5cb022ac6fe87f21f5',
  },
  car_hatchback: {
    label: 'Citadine rouge',
    size: [1.74, 1.35, 3.96],
    credit: '« Generic passenger car pack » par Comrade1280 (CC BY 4.0) — sketchfab.com/3d-models/20f9af9b8a404d5cb022ac6fe87f21f5',
  },
  car_wagon: {
    label: 'Break bleu nuit',
    size: [1.95, 1.38, 4.38],
    credit: '« Generic passenger car pack » par Comrade1280 (CC BY 4.0) — sketchfab.com/3d-models/20f9af9b8a404d5cb022ac6fe87f21f5',
  },
  van: {
    label: 'Fourgon utilitaire',
    size: [2.51, 2.25, 5.0],
    credit: '« 2014 Fiat Ducato » par razor24 (CC BY 4.0) — sketchfab.com/3d-models/8a651ad182414bb0a8b6c6d8d5bd7c01',
  },
  street_tree: {
    label: "Érable d'alignement",
    size: [4.2, 7.6, 4.2],
    credit: '« Maple tree » par atrodler (CC BY 4.0) — sketchfab.com/3d-models/4b27adcf92f644bdabf8ecc6c5bef399',
  },
  wheelie_bin_green: {
    label: 'Bac roulant vert',
    size: [0.63, 1.08, 0.66],
    credit: '« Trash can » par zevs (CC BY 4.0) — sketchfab.com/3d-models/576e6bcadb764bb5ad91bf48d93a95a5',
  },
  wheelie_bin_grey: {
    label: 'Bac roulant gris',
    size: [0.63, 1.08, 0.66],
    credit: '« Trash can » par zevs (CC BY 4.0) — sketchfab.com/3d-models/576e6bcadb764bb5ad91bf48d93a95a5',
  },
  dumpster_a: {
    label: 'Benne à ordures (vert clair)',
    size: [2.69, 1.4, 1.39],
    credit: '« Dumpster » par wand3rer (CC BY 4.0) — sketchfab.com/3d-models/3e37f225ff474567a68c998b47fcde26',
  },
  dumpster_b: {
    label: 'Benne à ordures (vert foncé)',
    size: [2.65, 1.4, 1.36],
    credit: '« Game Ready Dumpster » par Nathan.Goodman (CC BY 4.0) — sketchfab.com/3d-models/2001da965c74469c8e5f682387ca1f3a',
  },
  bus_shelter: {
    label: 'Abribus vitré',
    size: [4.12, 2.5, 1.64],
    credit: '« Bus stop » par Mentalist (CC BY 4.0) — sketchfab.com/3d-models/f0e7ff79b95d461bb69f5e927b5db062',
  },
  street_bin: {
    label: 'Corbeille de rue',
    size: [0.51, 0.95, 0.51],
    credit: '« Bus stop » par Mentalist (CC BY 4.0) — sketchfab.com/3d-models/f0e7ff79b95d461bb69f5e927b5db062',
  },
  street_lamp: {
    label: 'Lampadaire',
    size: [0.72, 7.0, 3.36],
    credit: '« Street Lamp » par desvat (CC BY 4.0) — sketchfab.com/3d-models/9a09a3a47b03435f8d7d329d80e86516',
  },
  utility_box: {
    label: 'Armoire électrique de rue',
    size: [0.52, 1.12, 0.43],
    credit: '« Utility Box 01 » par James Ray Cock (CC0 1.0) — polyhaven.com/a/utility_box_01',
  },
};
