/**
 * Material catalogue shared by map authors (shared code) and the renderer (client).
 * The shared side only knows the surface type (footsteps, impact effects);
 * the client generates a procedural texture for every id (see client/render/textures).
 */

export type SurfaceType =
  | 'concrete'
  | 'tile'
  | 'lino'
  | 'carpet'
  | 'wood'
  | 'metal'
  | 'glass'
  | 'plaster'
  | 'plastic'
  | 'fabric'
  | 'cardboard'
  | 'dirt'
  | 'grass'
  | 'gravel'
  | 'water'
  | 'foliage';

export interface MaterialInfo {
  surf: SurfaceType;
  /** Human description used as the brief for the procedural texture. */
  desc: string;
  /** Reference colour (fallback / tint base). */
  color: number;
  /** Self-illuminated (ignores lighting), e.g. screens and light panels. */
  emissive?: boolean;
  /** Rendered with alpha blending. */
  transparent?: boolean;
  /** World size (m) covered by one texture repeat. */
  tile?: number;
}

export const MATERIALS = {
  // --- Floors (interior) ---
  lino_grey: { surf: 'lino', desc: 'light grey speckled laboratory linoleum', color: 0xb9bec2, tile: 2 },
  lino_blue: { surf: 'lino', desc: 'blue-grey corridor linoleum', color: 0x7d9bb8, tile: 2 },
  lino_green: { surf: 'lino', desc: 'pale hospital-green linoleum', color: 0x9dbfa8, tile: 2 },
  tile_white: { surf: 'tile', desc: 'white ceramic tiles 30 cm with grey joints', color: 0xe8ecef, tile: 1.2 },
  tile_beige: { surf: 'tile', desc: 'beige stoneware floor tiles 40 cm', color: 0xcbbfa6, tile: 1.6 },
  tile_checker: { surf: 'tile', desc: 'black and white checker tiles 30 cm', color: 0x9a9a9a, tile: 1.2 },
  carpet_blue: { surf: 'carpet', desc: 'short-pile office carpet, BioArd’Aisne blue', color: 0x2f6ea8, tile: 2 },
  carpet_grey: { surf: 'carpet', desc: 'short-pile grey office carpet', color: 0x6f7378, tile: 2 },
  parquet: { surf: 'wood', desc: 'oak herringbone parquet', color: 0xa77b4d, tile: 2 },
  concrete_floor: { surf: 'concrete', desc: 'smooth polished concrete floor with faint stains', color: 0x8d8f8c, tile: 4 },
  // --- Walls / ceilings (interior) ---
  plaster_white: { surf: 'plaster', desc: 'white painted plaster wall, subtle roller texture', color: 0xeef0ee, tile: 3 },
  plaster_cream: { surf: 'plaster', desc: 'cream painted wall', color: 0xe9dfc6, tile: 3 },
  plaster_blue: { surf: 'plaster', desc: 'accent wall painted BioArd’Aisne blue', color: 0x3182ce, tile: 3 },
  plaster_grey: { surf: 'plaster', desc: 'light grey painted wall', color: 0xbfc4c7, tile: 3 },
  plaster_green: { surf: 'plaster', desc: 'pale mint painted wall', color: 0xcfe3d6, tile: 3 },
  wall_lab_panel: { surf: 'plastic', desc: 'white hygienic wall panels with vertical joints every 1.2 m', color: 0xf3f5f6, tile: 2.4 },
  wall_tile_white: { surf: 'tile', desc: 'white glossy wall tiles 15 cm', color: 0xf0f3f4, tile: 0.9 },
  ceiling_tile: { surf: 'plaster', desc: 'suspended ceiling, 60 cm mineral-fibre tiles with metal grid', color: 0xe6e6e1, tile: 1.2 },
  light_panel: { surf: 'glass', desc: 'bright white LED ceiling panel', color: 0xffffff, emissive: true, tile: 1 },
  light_warm: { surf: 'glass', desc: 'warm white lamp glass', color: 0xffe2b0, emissive: true, tile: 1 },
  concrete: { surf: 'concrete', desc: 'raw grey concrete with formwork marks', color: 0x9a9b97, tile: 4 },
  concrete_dark: { surf: 'concrete', desc: 'dark stained concrete', color: 0x5f615f, tile: 4 },
  // --- Metal / plastic / wood (props) ---
  metal_brushed: { surf: 'metal', desc: 'brushed stainless steel', color: 0xb4b9bd, tile: 1 },
  metal_white: { surf: 'metal', desc: 'white enamelled metal (lab analysers, fridges)', color: 0xeceeed, tile: 1 },
  metal_dark: { surf: 'metal', desc: 'dark anthracite painted metal', color: 0x3a3d42, tile: 1 },
  metal_grey: { surf: 'metal', desc: 'grey painted metal cabinet', color: 0x8e9499, tile: 1 },
  metal_grate: { surf: 'metal', desc: 'metal grating / ventilation grille', color: 0x6c7074, tile: 0.5 },
  metal_rust: { surf: 'metal', desc: 'rusty corrugated metal', color: 0x7a4b32, tile: 1.5 },
  metal_green: { surf: 'metal', desc: 'dark green painted cast iron (street furniture)', color: 0x244a33, tile: 1 },
  metal_blue: { surf: 'metal', desc: 'blue painted metal', color: 0x2b6cb0, tile: 1 },
  metal_red: { surf: 'metal', desc: 'red painted metal', color: 0xb9302a, tile: 1 },
  metal_yellow: { surf: 'metal', desc: 'yellow painted metal (safety)', color: 0xd9a514, tile: 1 },
  wood_light: { surf: 'wood', desc: 'light beech furniture wood', color: 0xd3b17c, tile: 1.5 },
  wood_dark: { surf: 'wood', desc: 'dark walnut wood', color: 0x5d4028, tile: 1.5 },
  wood_planks: { surf: 'wood', desc: 'weathered wooden planks', color: 0x8b6b47, tile: 1.5 },
  laminate_white: { surf: 'wood', desc: 'white laminate bench top (paillasse)', color: 0xf2f2ee, tile: 2 },
  laminate_grey: { surf: 'wood', desc: 'grey laminate desk top', color: 0xa9adb0, tile: 2 },
  plastic_white: { surf: 'plastic', desc: 'white matte plastic', color: 0xf1f1ef, tile: 1 },
  plastic_grey: { surf: 'plastic', desc: 'grey matte plastic', color: 0x9b9fa3, tile: 1 },
  plastic_black: { surf: 'plastic', desc: 'black matte plastic', color: 0x1e1f22, tile: 1 },
  plastic_blue: { surf: 'plastic', desc: 'blue plastic', color: 0x2f7fd0, tile: 1 },
  plastic_red: { surf: 'plastic', desc: 'red plastic', color: 0xd63a3a, tile: 1 },
  plastic_yellow: { surf: 'plastic', desc: 'yellow plastic (sharps / DASRI containers)', color: 0xf0c81e, tile: 1 },
  plastic_green: { surf: 'plastic', desc: 'green plastic', color: 0x3fa35b, tile: 1 },
  plastic_purple: { surf: 'plastic', desc: 'purple plastic (EDTA tube caps)', color: 0x8a4fb5, tile: 1 },
  plastic_orange: { surf: 'plastic', desc: 'orange plastic', color: 0xe8842a, tile: 1 },
  rubber_black: { surf: 'plastic', desc: 'black rubber', color: 0x161616, tile: 1 },
  fabric_blue: { surf: 'fabric', desc: 'blue woven upholstery fabric', color: 0x2d5f95, tile: 1 },
  fabric_grey: { surf: 'fabric', desc: 'grey woven upholstery fabric', color: 0x77797d, tile: 1 },
  fabric_red: { surf: 'fabric', desc: 'red woven upholstery fabric', color: 0xa93838, tile: 1 },
  fabric_white: { surf: 'fabric', desc: 'white cotton (lab coats, curtains)', color: 0xf4f4f0, tile: 1 },
  cardboard: { surf: 'cardboard', desc: 'brown corrugated cardboard with tape', color: 0xb08a5a, tile: 1 },
  paper_white: { surf: 'cardboard', desc: 'white paper / documents', color: 0xfafaf5, tile: 1 },
  glass: { surf: 'glass', desc: 'clear glass, slightly blue, semi-transparent', color: 0xbfe0ee, transparent: true, tile: 1 },
  glass_frosted: { surf: 'glass', desc: 'frosted privacy glass, translucent', color: 0xe4eef2, transparent: true, tile: 1 },
  screen_on: { surf: 'glass', desc: 'lit computer screen showing lab software (blue/white UI)', color: 0x9fd0ff, emissive: true, tile: 1 },
  screen_off: { surf: 'glass', desc: 'black switched-off screen', color: 0x0b0d10, tile: 1 },
  led_green: { surf: 'plastic', desc: 'glowing green status LED', color: 0x4dff7a, emissive: true, tile: 1 },
  led_red: { surf: 'plastic', desc: 'glowing red status LED', color: 0xff4040, emissive: true, tile: 1 },
  led_blue: { surf: 'plastic', desc: 'glowing blue status LED', color: 0x4aa8ff, emissive: true, tile: 1 },
  door_wood: { surf: 'wood', desc: 'light wooden interior door leaf with handle', color: 0xc9a877, tile: 1 },
  door_white: { surf: 'wood', desc: 'white painted door leaf', color: 0xecece8, tile: 1 },
  door_metal: { surf: 'metal', desc: 'grey steel service door', color: 0x7e868c, tile: 1 },
  // --- Exterior ground ---
  asphalt: { surf: 'concrete', desc: 'dark asphalt road with fine aggregate', color: 0x3f4144, tile: 4 },
  sidewalk: { surf: 'concrete', desc: 'grey concrete pavement slabs 50 cm', color: 0x9fa19d, tile: 2 },
  cobble: { surf: 'concrete', desc: 'old cobblestones (pavés) in fan pattern, warm grey', color: 0x8c877d, tile: 2 },
  paving_stone: { surf: 'concrete', desc: 'ochre/yellow stone paving slabs (Place Ducale)', color: 0xc9b48a, tile: 2.4 },
  grass: { surf: 'grass', desc: 'short green lawn', color: 0x55803a, tile: 3 },
  dirt: { surf: 'dirt', desc: 'packed brown earth', color: 0x6e5a43, tile: 3 },
  gravel: { surf: 'gravel', desc: 'light gravel', color: 0xa7a196, tile: 2 },
  water: { surf: 'water', desc: 'dark green-blue river water', color: 0x2f5560, transparent: true, tile: 6 },
  // --- Exterior walls / roofs ---
  brick_red: { surf: 'concrete', desc: 'red Ardennes brick wall, running bond', color: 0x9c4a3a, tile: 2 },
  brick_brown: { surf: 'concrete', desc: 'brown-orange brick wall', color: 0x8a5a3c, tile: 2 },
  stone_yellow: { surf: 'concrete', desc: 'ochre-yellow ashlar limestone blocks (pierre de Dom-le-Mesnil)', color: 0xd3b57a, tile: 2.4 },
  stone_grey: { surf: 'concrete', desc: 'blue-grey Ardennes stone blocks', color: 0x7f8790, tile: 2.4 },
  stone_white: { surf: 'concrete', desc: 'pale limestone blocks', color: 0xd9d4c5, tile: 2.4 },
  facade_cream: { surf: 'plaster', desc: 'cream rendered façade (crépi)', color: 0xe6d9b8, tile: 3 },
  facade_grey: { surf: 'plaster', desc: 'grey rendered façade', color: 0xb3b2ac, tile: 3 },
  facade_white: { surf: 'plaster', desc: 'white rendered façade', color: 0xecebe4, tile: 3 },
  facade_pink: { surf: 'plaster', desc: 'pale salmon rendered façade', color: 0xdcb6a3, tile: 3 },
  facade_blue: { surf: 'plaster', desc: 'modern cladding panels, BioArd’Aisne blue', color: 0x3182ce, tile: 2.4 },
  slate_roof: { surf: 'concrete', desc: 'blue-black Ardennes slate roof tiles (ardoise)', color: 0x3b4450, tile: 2 },
  roof_tile_red: { surf: 'concrete', desc: 'red clay roof tiles', color: 0xa5523a, tile: 2 },
  window_facade: { surf: 'glass', desc: 'opaque façade window: white frame, dark bluish reflective panes with curtains', color: 0x4a6076, tile: 1 },
  window_lit: { surf: 'glass', desc: 'opaque façade window lit from inside (warm)', color: 0xffd58a, emissive: true, tile: 1 },
  shopfront: { surf: 'glass', desc: 'dark shop window with reflections', color: 0x27323b, tile: 1 },
  shutter: { surf: 'wood', desc: 'louvered wooden window shutter', color: 0x5e7a8c, tile: 1 },
  hedge: { surf: 'foliage', desc: 'dense green hedge foliage', color: 0x3c6a2f, tile: 1.5 },
  foliage: { surf: 'foliage', desc: 'tree leaves, mid green', color: 0x4f8a3a, tile: 1.5 },
  bark: { surf: 'wood', desc: 'tree bark', color: 0x4f3d2c, tile: 1 },
} as const satisfies Record<string, MaterialInfo>;

export type MaterialId = keyof typeof MATERIALS;
export const MATERIAL_IDS = Object.keys(MATERIALS) as MaterialId[];
export const materialInfo = (id: MaterialId): MaterialInfo => MATERIALS[id];
