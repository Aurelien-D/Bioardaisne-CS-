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
    size: [0.59, 1.04, 0.59],
    credit: '« Office Chair » par Tytan (CC BY 4.0) — sketchfab.com/3d-models/87a8de3461bf44848f3629fa8a8dcd68',
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
    size: [1.6, 1.2, 1.46],
    credit: '« Office Desk 140x60 » par AleixoAlonso (CC BY 4.0) — sketchfab.com/3d-models/9262f311271c4c4390341e526d3fe103 + « Desktop Computer » par Tytan (CC BY 4.0) — sketchfab.com/3d-models/561abc2fc95941609fc7bc6f232895c2 + « Office Chair » par Tytan (CC BY 4.0) — sketchfab.com/3d-models/87a8de3461bf44848f3629fa8a8dcd68',
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
    label: 'Grande plante verte en pot',
    size: [0.93, 1.7, 1.07],
    credit: '« Pot Plant » par Ingenuitee (CC BY 4.0) — sketchfab.com/3d-models/896ed878734d43e39d583d6c75bec2f1',
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
  lab_bench: {
    label: 'Paillasse',
    size: [2.0, 0.98, 0.7],
    credit: '« Science lab cabinet » par tboiston (CC BY 4.0) — sketchfab.com/3d-models/121829e2dbef45128ba5c9b04d0f03ce',
  },
  lab_bench_sink: {
    label: 'Paillasse avec évier',
    size: [2.0, 1.12, 0.7],
    credit: '« Science lab cabinet » par tboiston (CC BY 4.0) — sketchfab.com/3d-models/121829e2dbef45128ba5c9b04d0f03ce + « Kitchen Sink » par HippoStance (CC BY 4.0) — sketchfab.com/3d-models/504248ed68e3480a807aced6f002b2d5',
  },
  lab_bench_shelf: {
    label: 'Paillasse avec étagère à réactifs',
    size: [2.0, 1.84, 0.7],
    credit: '« Science lab cabinet » par tboiston (CC BY 4.0) — sketchfab.com/3d-models/121829e2dbef45128ba5c9b04d0f03ce + « Steel Frame Shelves 01 » par James Ray Cock (CC0 1.0) — polyhaven.com/a/steel_frame_shelves_01 + « lab bench » par Konstantin_Keller (CC BY 4.0) — sketchfab.com/3d-models/1ac2a62c52a848bbaf746146dc7253f8 + « Set of Cardboard Boxes » par NotAnotherApocalypticCo. (CC BY 4.0) — sketchfab.com/3d-models/8986ba512f704ac5b253286a0d1ad8bb',
  },
  island_bench: {
    label: 'Paillasse centrale',
    size: [2.4, 1.84, 1.5],
    credit: '« Science lab cabinet » par tboiston (CC BY 4.0) — sketchfab.com/3d-models/121829e2dbef45128ba5c9b04d0f03ce + « Steel Frame Shelves 01 » par James Ray Cock (CC0 1.0) — polyhaven.com/a/steel_frame_shelves_01 + « lab bench » par Konstantin_Keller (CC BY 4.0) — sketchfab.com/3d-models/1ac2a62c52a848bbaf746146dc7253f8 + « Set of Cardboard Boxes » par NotAnotherApocalypticCo. (CC BY 4.0) — sketchfab.com/3d-models/8986ba512f704ac5b253286a0d1ad8bb',
  },
  biosafety_cabinet: {
    label: 'Poste de sécurité microbiologique',
    size: [1.5, 2.3, 0.8],
    credit: '« Laboratory Machine » par Ellie3D (CC BY 4.0) — sketchfab.com/3d-models/ff3e9ee83fd84ab3abb398a67abb005d',
  },
  safety_cabinet: {
    label: 'Armoire de sécurité pour réactifs',
    size: [1.0, 1.95, 0.5],
    credit: '« Metal Cabinet (Low Poly) » par Berk Gedik (CC BY 4.0) — sketchfab.com/3d-models/1053729ad9d24d71a578622251f76deb',
  },
  clinical_waste_bin: {
    label: 'Poubelle DASRI à pédale',
    size: [0.4, 0.7, 0.4],
    credit: '« Kitchen Dustbin » par Francesco Coldesina (CC BY 4.0) — sketchfab.com/3d-models/b503ccdc06534fdf874ad472f1537809',
  },
  gas_cylinder: {
    label: 'Bouteille de gaz',
    size: [0.26, 1.5, 0.26],
    credit: '« Simple Oxygen Tank » par Blender3D (CC BY 4.0) — sketchfab.com/3d-models/b549fd81fdae40948cfb4c36df8c230e',
  },
  transport_crate: {
    label: 'Bac de transport à couvercle',
    size: [0.62, 0.33, 0.42],
    credit: '« Industrial Plastic Container » par Galo Benivegna (CC0 1.0) — polyhaven.com/a/industrial_pastic_container',
  },
  crate_stack: {
    label: 'Pile de bacs de transport',
    size: [0.64, 0.98, 0.43],
    credit: '« Industrial Plastic Container » par Galo Benivegna (CC0 1.0) — polyhaven.com/a/industrial_pastic_container',
  },
  sample_cooler: {
    label: "Glacière d'échantillons",
    size: [0.46, 0.33, 0.31],
    credit: '« Esky Cooler » par rileylane (CC BY 4.0) — sketchfab.com/3d-models/1424536a79474381b1a85f7691656b88',
  },
  stool: {
    label: 'Tabouret à roulettes',
    size: [0.47, 0.5, 0.48],
    credit: '« Medical Examination Room » par DotBow (CC BY 4.0) — sketchfab.com/3d-models/107a137acfb243bea28c76daa7064670',
  },
  exam_couch: {
    label: "Lit d'examen",
    size: [1.95, 0.72, 0.65],
    credit: '« Medical Examination Room » par DotBow (CC BY 4.0) — sketchfab.com/3d-models/107a137acfb243bea28c76daa7064670',
  },
  wall_cabinet: {
    label: 'Armoire murale',
    size: [1.0, 0.7, 0.35],
    credit: '« Medical Examination Room » par DotBow (CC BY 4.0) — sketchfab.com/3d-models/107a137acfb243bea28c76daa7064670',
  },
  wash_basin: {
    label: 'Lavabo mural et distributeur de papier',
    size: [0.56, 1.16, 0.45],
    credit: '« Simple Sink » par Andrew.Mischenko (CC BY 4.0) — sketchfab.com/3d-models/73bda35b6e7a499a80427fc1b049b192 + « Towel dispenser » par Tombolaso (CC BY 4.0) — sketchfab.com/3d-models/8c2e6ea787a04578bed2042f3cddd5ff',
  },
  privacy_screen: {
    label: 'Paravent médical trois panneaux',
    size: [1.61, 1.75, 0.45],
    credit: '« The screen is medical » par JSlyin (CC BY 4.0) — sketchfab.com/3d-models/0412d1af80ea40daaf465d9f47e19c32',
  },
  call_screen: {
    label: "Écran d'appel mural",
    size: [1.1, 0.67, 0.08],
    credit: '« Full HD LED Television » par Pedro Belthori (CC BY 4.0) — sketchfab.com/3d-models/1ad9bc5bd6214dce85504c08463c4505',
  },
  wall_tv: {
    label: 'Téléviseur mural éteint',
    size: [1.25, 0.77, 0.09],
    credit: '« Full HD LED Television » par Pedro Belthori (CC BY 4.0) — sketchfab.com/3d-models/1ad9bc5bd6214dce85504c08463c4505',
  },
  ticket_kiosk: {
    label: 'Borne de tickets tactile',
    size: [0.56, 1.45, 0.24],
    credit: '« Interactive Kiosk » par skylineentourage (CC BY 4.0) — sketchfab.com/3d-models/828a97c923a541afb09fcc96fab02105',
  },
  whiteboard: {
    label: 'Tableau blanc',
    size: [1.8, 1.2, 0.05],
    credit: '« Whiteboard » par tboiston (CC BY 4.0) — sketchfab.com/3d-models/d0b05bd140734a799666f0a29e1fe1bb',
  },
  coffee_machine: {
    label: 'Cafetière à filtre',
    size: [0.19, 0.38, 0.38],
    credit: '« Coffee maker » par Fredrik Johansen (CC BY 4.0) — sketchfab.com/3d-models/9ccda2fddba846e6ba97eb774b8a09c6',
  },
  microwave: {
    label: 'Four à micro-ondes',
    size: [0.5, 0.29, 0.38],
    credit: '« Microwave Oven » par MustafaYerebasmaz (CC BY 4.0) — sketchfab.com/3d-models/3421e492257f40959859104f46128304',
  },
  kitchen_counter: {
    label: 'Kitchenette de la salle de pause',
    size: [1.8, 1.24, 0.62],
    credit: '« Small Kitchen with Oven » par AleixoAlonso (CC BY 4.0) — sketchfab.com/3d-models/e783d6d64f8c453ab534bdde715b210d',
  },
  binder_shelf: {
    label: 'Étagère à classeurs',
    size: [1.0, 1.95, 0.36],
    credit: '« Steel Frame Shelves 01 » par James Ray Cock (CC0 1.0) — polyhaven.com/a/steel_frame_shelves_01 + « Binder » par Marcin.Kwiatkowski (CC BY 4.0) — sketchfab.com/3d-models/78e016eeb0bf45d5bea47547128383a8',
  },
  magazine_rack: {
    label: 'Présentoir à brochures',
    size: [0.42, 1.35, 0.3],
    credit: '« Brochure Stand » par oscarherry3d (CC BY 4.0) — sketchfab.com/3d-models/38abe56473844b2797a58e001578f5fd',
  },
  door_white: {
    label: 'Porte intérieure blanche avec huisserie',
    size: [1.0, 2.12, 0.27],
    credit: '« Door with frame » par witnessk (CC BY 4.0) — sketchfab.com/3d-models/2f2f149f3ec44d658a02c1f924dfa449',
  },
  tube_light: {
    label: 'Réglette fluorescente de plafond',
    size: [1.2, 0.05, 0.05],
    credit: '« Mounted Fluorescent Lights » par Ulan Cabanilla (CC0 1.0) — polyhaven.com/a/mounted_fluorescent_lights',
  },
  exit_sign: {
    label: 'Bloc de secours « sortie »',
    size: [0.36, 0.19, 0.04],
    credit: '« Exit Sign » par tboiston (CC BY 4.0) — sketchfab.com/3d-models/46b52e08b8b64b81ad9ff5fb752bcc06',
  },
  ac_indoor: {
    label: 'Climatiseur mural (unité intérieure)',
    size: [0.92, 0.34, 0.26],
    credit: '« Air Condition » par TkachenkoPA (CC BY 4.0) — sketchfab.com/3d-models/a9899a3a32d94b3fb5f631fb881ee4ac',
  },
  ac_outdoor: {
    label: 'Climatiseur (unité extérieure sur équerres)',
    size: [0.8, 0.93, 0.37],
    credit: '« Exterior Aircon Unit » par Monsta3D (CC0 1.0) — polyhaven.com/a/exterior_aircon_unit',
  },
  ac_rooftop: {
    label: 'Groupe de climatisation de toiture',
    size: [1.69, 1.01, 1.31],
    credit: '« air conditioners » par Lora (CC BY 4.0) — sketchfab.com/3d-models/65417369a2724c9ebf06e7698238a856',
  },
  air_duct: {
    label: 'Gaine de ventilation rectangulaire',
    size: [1.44, 0.41, 0.53],
    credit: '« Modular Airduct Rectangular 01 » par James Ray Cock (CC0 1.0) — polyhaven.com/a/modular_airduct_rectangular_01',
  },
  drain_pipe: {
    label: "Descente d'eaux pluviales",
    size: [0.13, 3.4, 0.15],
    credit: '« Modular Metal Gutter » par Maxim Domnin (CC0 1.0) — polyhaven.com/a/modular_metal_gutter',
  },
  electrical_panel: {
    label: 'Tableau électrique',
    size: [0.6, 0.65, 0.52],
    credit: '« Power Box 01 » par Rico Cilliers, Yann Kervran (CC0 1.0) — polyhaven.com/a/power_box_01',
  },
  hand_dryer: {
    label: 'Sèche-mains mural',
    size: [0.26, 0.22, 0.2],
    credit: '« Shower Room - Assets » par Evan Petrov (CC BY 4.0) — sketchfab.com/3d-models/8e13a866ee184bed95bb5b59ddee62cd',
  },
  paper_dispenser: {
    label: "Distributeur d'essuie-mains",
    size: [0.28, 0.36, 0.1],
    credit: '« Towel dispenser » par Tombolaso (CC BY 4.0) — sketchfab.com/3d-models/8c2e6ea787a04578bed2042f3cddd5ff',
  },
  coat_stand: {
    label: 'Portemanteau sur pied',
    size: [0.41, 1.78, 0.39],
    credit: '« Coat Rack » par Whostea (CC BY 4.0) — sketchfab.com/3d-models/72e821fc75d9473183a63d548959693b',
  },
  floor_lamp: {
    label: 'Lampadaire de salon',
    size: [0.43, 1.65, 0.43],
    credit: '« Floor Lamp » par bilgehan.korkmaz (CC BY 4.0) — sketchfab.com/3d-models/33eb258d9873435690254cfbb0ea46ec',
  },
  wheelchair: {
    label: 'Fauteuil roulant',
    size: [0.82, 1.1, 1.09],
    credit: '« Wheelchair 01 » par Garreth Dean (CC0 1.0) — polyhaven.com/a/wheelchair_01',
  },
  first_aid_box: {
    label: 'Trousse de secours murale',
    size: [0.42, 0.28, 0.08],
    credit: '« Medical Box » par Ulan Cabanilla (CC0 1.0) — polyhaven.com/a/medical_box',
  },
  autoclave: {
    label: 'Autoclave de stérilisation',
    size: [1.4, 1.73, 1.2],
    credit: '« Esterilizador RVEQ21 equipos biomedicos » par EBP (CC BY 4.0) — sketchfab.com/3d-models/d3e1d1e363de41249d041fb3540d256f',
  },
  platform_trolley: {
    label: 'Chariot à plateau',
    size: [0.77, 0.83, 1.26],
    credit: '« Simple Platform Trolley » par Artem P (CC BY 4.0) — sketchfab.com/3d-models/6f1e3be806074833a31cf34aa18b4d73',
  },
  hand_truck: {
    label: 'Diable',
    size: [0.59, 1.4, 0.69],
    credit: '« Hand Truck » par Mutanzom3D (CC0 1.0) — polyhaven.com/a/hand_truck',
  },
  wet_floor_sign: {
    label: 'Chevalet « sol glissant »',
    size: [0.3, 0.63, 0.36],
    credit: '« Wet Floor Sign 01 » par Fran Calvente (CC0 1.0) — polyhaven.com/a/WetFloorSign_01',
  },
  magazines: {
    label: 'Piles de magazines',
    size: [0.56, 0.29, 0.29],
    credit: '« Books Magazines » par 3DWALKABOUT (CC BY 4.0) — sketchfab.com/3d-models/081bbc6af697476da7f057ad89697f62',
  },
  plastic_chair: {
    label: 'Chaise de jardin en plastique',
    size: [0.64, 0.88, 0.63],
    credit: '« Plastic Monobloc Chair 01 » par Kuutti Siitonen (CC0 1.0) — polyhaven.com/a/plastic_monobloc_chair_01',
  },
  park_bench: {
    label: 'Banc public en bois et fonte',
    size: [1.9, 0.56, 0.44],
    credit: '« Park Bench » par RBG_illustrations (CC BY 4.0) — sketchfab.com/3d-models/2ee2bc87756d4bf0932d83ab860ddb8f',
  },
  bicycle: {
    label: 'Vélo de ville',
    size: [1.76, 1.12, 0.65],
    credit: '« Yellow bicycle » par Tatyana Volkova (CC BY 4.0) — sketchfab.com/3d-models/4cc719f387cb4cb4aea6e12a27e06e2e',
  },
  scooter: {
    label: 'Scooter 50 cm³',
    size: [1.7, 1.26, 0.66],
    credit: '« MOPED Derbi DS-50 Scooter » par Scanamatics (CC BY 4.0) — sketchfab.com/3d-models/5e3ba0954ffc4a8f853c86cb7fdaa91b',
  },
  traffic_cone: {
    label: 'Cône de chantier',
    size: [0.34, 0.5, 0.34],
    credit: '« Traffic cone (Game ready) » par PT34 (CC BY 4.0) — sketchfab.com/3d-models/8cdac192abd044988c314eeb6377a3a0',
  },
  metal_barrier: {
    label: 'Barrière de police',
    size: [2.0, 1.1, 0.5],
    credit: '« Simple Metal Fence » par Blender3D (CC BY 4.0) — sketchfab.com/3d-models/9450c03e6c074982b9f86cd73866b461',
  },
  garbage_bags: {
    label: 'Sacs-poubelle',
    size: [0.7, 0.75, 1.14],
    credit: '« Garbage bags » par DJMaesen (CC BY 4.0) — sketchfab.com/3d-models/9e769751ac3a4b6a893a5719349b78ca',
  },
  trash_bag: {
    label: 'Sac-poubelle',
    size: [0.53, 0.57, 0.46],
    credit: '« Trashbag » par Benny Weimer (CC0 1.0) — polyhaven.com/a/trashbag',
  },
  car_compact: {
    label: 'Citadine blanche',
    size: [1.61, 1.32, 3.26],
    credit: '« Generic passenger car pack » par Comrade1280 (CC BY 4.0) — sketchfab.com/3d-models/20f9af9b8a404d5cb022ac6fe87f21f5',
  },
  car_suv: {
    label: 'SUV anthracite',
    size: [2.07, 1.73, 4.61],
    credit: '« Generic passenger car pack » par Comrade1280 (CC BY 4.0) — sketchfab.com/3d-models/20f9af9b8a404d5cb022ac6fe87f21f5',
  },
  car_minivan: {
    label: 'Monospace gris clair',
    size: [1.87, 1.76, 4.61],
    credit: '« Generic passenger car pack » par Comrade1280 (CC BY 4.0) — sketchfab.com/3d-models/20f9af9b8a404d5cb022ac6fe87f21f5',
  },
  bollard: {
    label: 'Potelet de trottoir',
    size: [0.22, 1.0, 0.22],
    credit: '« Street Bollard » par Faheem Yusuf (CC BY 4.0) — sketchfab.com/3d-models/9b9db79ae21c4e118423efae658e7fb7',
  },
  bike_rack: {
    label: 'Arceaux à vélos',
    size: [2.0, 0.45, 0.49],
    credit: '« CC0 - Bicycle Stand 4 » par plaggy (CC BY 4.0) — sketchfab.com/3d-models/597656d383f94bca8fa098905a126ee1',
  },
  sampling_trolley: {
    label: 'Chariot de prélèvement',
    size: [0.72, 1.03, 0.46],
    credit: '« Medical Cart » par NicolasVB (CC BY 4.0) — sketchfab.com/3d-models/2a0a574f9e374702af8c415fce296f45',
  },
};
