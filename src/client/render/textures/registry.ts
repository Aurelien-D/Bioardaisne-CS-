/**
 * One generator per MaterialId. The Record type makes the compiler reject a missing or
 * misspelt material: adding an id to shared/maps/materials.ts fails the build here until
 * a generator is listed.
 */
import type { MaterialId } from '../../../shared/maps/materials';
import { carpet, ceramic, concrete, lino, parquet } from './gen/floors';
import { asphalt, cobble, dirt, grass, gravel, pavingStone, sidewalk, water } from './gen/ground';
import { ashlar, brick, cladding, clayTiles, render, slateRoof } from './gen/masonry';
import { bark, leaves } from './gen/nature';
import { door, facadeWindow, frostedGlass, glass, led, screenOff, screenOn, shopfront, shutter } from './gen/objects';
import { brushedSteel, cardboard, enamel, fabric, grate, laminate, paintedMetal, paper, planks, plastic, rustCorrugated, wood } from './gen/props';
import { ceilingTile, labPanel, lightPanel, lightWarm, paint } from './gen/walls';
import { hex, type Generator } from './painter';

const smoothPaint = paintedMetal({ rough: 0.012, wear: 0.5 });

export const GENERATORS: Record<MaterialId, Generator> = {
  // --- Floors (interior) ---
  lino_grey: lino(),
  lino_blue: lino(),
  lino_green: lino(),
  tile_white: ceramic({ count: 4, joint: 0.004, jointColor: hex(0x8f9498), colors: [hex(0xeef1f3)], vary: 0.022, gloss: 0.11, mottle: 0.006 }),
  tile_beige: ceramic({ count: 4, joint: 0.006, jointColor: hex(0x7d7464), colors: [hex(0xcfc3aa)], vary: 0.05, gloss: 0.03, mottle: 0.05 }),
  tile_checker: ceramic({ count: 4, joint: 0.004, jointColor: hex(0x6e7072), colors: [hex(0xe4e4e0), hex(0x2c2d30)], vary: 0.03, gloss: 0.1, mottle: 0.01 }),
  carpet_blue: carpet(),
  carpet_grey: carpet(),
  parquet: parquet(),
  concrete_floor: concrete({ rough: 0.045, stains: 0.7, cracks: 5 }),
  // --- Walls / ceilings (interior) ---
  plaster_white: paint(),
  plaster_cream: paint(),
  plaster_blue: paint(),
  plaster_grey: paint(),
  plaster_green: paint(),
  wall_lab_panel: labPanel(),
  wall_tile_white: ceramic({ count: 6, joint: 0.003, jointColor: hex(0xa3a8ab), colors: [hex(0xf4f6f7)], vary: 0.014, gloss: 0.14, mottle: 0.004 }),
  ceiling_tile: ceilingTile(),
  light_panel: lightPanel(),
  light_warm: lightWarm(),
  concrete: concrete({ rough: 0.07, stains: 0.6, cracks: 3, formwork: true, streaks: 0.03 }),
  concrete_dark: concrete({ rough: 0.1, stains: 1, cracks: 6, streaks: 0.06 }),
  // --- Metal / plastic / wood (props) ---
  metal_brushed: brushedSteel(),
  metal_white: enamel(),
  metal_dark: smoothPaint,
  metal_grey: smoothPaint,
  metal_grate: grate(),
  metal_rust: rustCorrugated(),
  metal_green: paintedMetal({ rough: 0.05, wear: 0.6 }),
  metal_blue: smoothPaint,
  metal_red: smoothPaint,
  metal_yellow: paintedMetal({ rough: 0.014, wear: 1 }),
  wood_light: wood({ rings: 9, ringAmp: 0.05, warp: 1.6, streak: 0.035, flecks: 1 }),
  wood_dark: wood({ rings: 7, ringAmp: 0.2, warp: 2.6, streak: 0.07, flecks: 0.6 }),
  wood_planks: planks(),
  laminate_white: laminate(false),
  laminate_grey: laminate(true),
  plastic_white: plastic(),
  plastic_grey: plastic(),
  plastic_black: plastic(),
  plastic_blue: plastic(),
  plastic_red: plastic(),
  plastic_yellow: plastic(),
  plastic_green: plastic(),
  plastic_purple: plastic(),
  plastic_orange: plastic(),
  rubber_black: plastic(true),
  fabric_blue: fabric(),
  fabric_grey: fabric(),
  fabric_red: fabric(),
  fabric_white: fabric(true),
  cardboard: cardboard(),
  paper_white: paper(),
  glass: glass(),
  glass_frosted: frostedGlass(),
  screen_on: screenOn(),
  screen_off: screenOff(),
  led_green: led(),
  led_red: led(),
  led_blue: led(),
  door_wood: door({ kind: 'wood' }),
  door_white: door({ kind: 'white' }),
  door_metal: door({ kind: 'metal' }),
  // --- Exterior ground ---
  asphalt: asphalt(),
  sidewalk: sidewalk(),
  cobble: cobble(),
  paving_stone: pavingStone(),
  grass: grass(),
  dirt: dirt(),
  gravel: gravel(),
  water: water(),
  // --- Exterior walls / roofs ---
  brick_red: brick({ mortar: hex(0xb3a898), vary: 0.11, burnt: 0.1 }),
  brick_brown: brick({ mortar: hex(0x9c9080), vary: 0.14, burnt: 0.16 }),
  stone_yellow: ashlar({
    courses: [0.3],
    unit: 0.15,
    lengths: [3, 4, 4, 5],
    joint: 0.007,
    jointColor: hex(0x8a7a5c),
    vary: 0.06,
    rough: 0.03,
    accents: [hex(0xc9a868), hex(0xdcc48c), hex(0xc4ae84)],
  }),
  stone_grey: ashlar({
    courses: [0.24, 0.36],
    unit: 0.12,
    lengths: [2, 3, 3, 4, 5],
    joint: 0.012,
    jointColor: hex(0x9a988f),
    vary: 0.13,
    rough: 0.07,
    accents: [hex(0x6d7884), hex(0x8a8c8c), hex(0x7a7f7a), hex(0x6a7078)],
  }),
  stone_white: ashlar({
    courses: [0.4],
    unit: 0.2,
    lengths: [3, 4, 4, 5],
    joint: 0.005,
    jointColor: hex(0x9c978a),
    vary: 0.04,
    rough: 0.022,
    accents: [hex(0xd3ccb8), hex(0xe0dccf)],
  }),
  facade_cream: render(),
  facade_grey: render(),
  facade_white: render(),
  facade_pink: render(),
  facade_blue: cladding(),
  slate_roof: slateRoof(),
  roof_tile_red: clayTiles(),
  window_facade: facadeWindow(false),
  window_lit: facadeWindow(true),
  shopfront: shopfront(),
  shutter: shutter(),
  hedge: leaves({ leaf: 0.036, count: 5200, depth: 0.16 }),
  foliage: leaves({ leaf: 0.075, count: 1500, depth: 0.2 }),
  bark: bark(),
};

/**
 * Materials whose repeat covers 4 m of ground or wall: they get twice the resolution of
 * the others (1024 at high quality) so that their texel density stays comparable.
 */
export const LARGE_TILE: Partial<Record<MaterialId, true>> = {
  concrete_floor: true,
  concrete: true,
  concrete_dark: true,
  asphalt: true,
};
