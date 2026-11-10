/**
 * Map format. A map is plain data produced by a MapBuilder (see builder.ts):
 *  - `solids`: axis-aligned boxes used for ALL collision (players, bullets, bots);
 *  - `boxes`:  visible axis-aligned boxes (walls, floors, furniture) — light-mapped;
 *  - `prims`:  other visible primitives (cylinders, roofs…), decoration only;
 *  - lights, signs, spawn points, gameplay zones and environment.
 * Adding a map = one TypeScript file that fills a MapBuilder and is registered
 * in maps/index.ts. No renderer or server code needs to change.
 */
import type { Vec3 } from '../math/vec3';
import type { GameModeId } from '../types';
import type { MaterialId, SurfaceType } from './materials';

export interface Solid {
  min: Vec3;
  max: Vec3;
  surf: SurfaceType;
  /** Bullets pass through (e.g. railings, thin foliage) but players collide. */
  noBullets?: boolean;
  /** Players pass through but bullets are stopped (rare). */
  noPlayers?: boolean;
}

export type FaceName = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';

export interface BoxPrim {
  min: Vec3;
  max: Vec3;
  mat: MaterialId;
  /** Multiplicative colour tint (0xRRGGBB). */
  tint?: number;
  /** Per-face material override; `null` hides the face. */
  faces?: Partial<Record<FaceName, MaterialId | null>>;
  /** Small/detail box: skip light-mapping, use vertex lighting instead. */
  detail?: boolean;
}

export type PrimShape = 'box' | 'cyl' | 'sphere' | 'cone' | 'prism' | 'pyramid' | 'wedge';

/**
 * Decorative primitive, centred on `pos`, local size `size`, Euler rotation (radians, order YXZ).
 *  - box:     size = full extents.
 *  - cyl:     axis = local Y; size.x / size.z = diameters, size.y = height.
 *  - sphere:  ellipsoid with diameters = size.
 *  - cone:    axis = local Y, apex up; size.x / size.z = base diameters.
 *  - prism:   gable-roof shape: base size.x × size.z, ridge along local Z at height size.y.
 *  - pyramid: base size.x × size.z, apex centred at height size.y (hip roof / pavilion).
 *  - wedge:   ramp: base size.x × size.z, rises along +Z from 0 to size.y.
 * For prism / pyramid / wedge, `pos` is the centre of the bounding box.
 */
export interface Prim {
  shape: PrimShape;
  pos: Vec3;
  size: Vec3;
  rot?: Vec3;
  mat: MaterialId;
  tint?: number;
  /** Radial segments for round shapes (default 12). */
  seg?: number;
}

export interface LightDef {
  pos: Vec3;
  /** 0xRRGGBB */
  color: number;
  /** Brightness at 1 m (1 = normal ceiling light). */
  intensity: number;
  /** Distance (m) at which the light fades to zero. */
  range: number;
}

export type SignStyle = 'plaque' | 'door' | 'poster' | 'street' | 'shop' | 'screen' | 'banner' | 'floor';

/** Text panel rendered client-side on a quad (signage, posters, shop names, screens). */
export interface SignDef {
  /** Centre of the quad. */
  pos: Vec3;
  /** Direction the sign faces: 0 = +Z, 1 = +X, 2 = -Z, 3 = -X, 4 = up (floor marking), 5 = down. */
  facing: number;
  w: number;
  h: number;
  text: string;
  sub?: string;
  style: SignStyle;
  /** Text colour / background colour (0xRRGGBB). Defaults depend on the style. */
  color?: number;
  bg?: number;
  /** Optional pictogram: 'logo' (BioArd'Aisne), 'cross', 'biohazard', 'arrow_left', 'arrow_right', 'arrow_up', 'wc', 'exit', 'tube', 'drop'. */
  icon?: string;
  /** Self-illuminated (screens, lit shop signs). */
  lit?: boolean;
}

export interface SpawnDef {
  team: 0 | 1;
  pos: Vec3;
  yaw: number;
}

/**
 * Gameplay volume.
 *  - 'site':    objective site for Désamorçage (id 'A' / 'B').
 *  - 'extract': extraction zone for Sécurisation (attackers bring samples here).
 *  - 'buy':     optional spawn area marker.
 */
export interface ZoneDef {
  kind: 'site' | 'extract' | 'buy';
  id: string;
  min: Vec3;
  max: Vec3;
  /** Display name, e.g. "Plateau technique". */
  label?: string;
}

/**
 * Gameplay point.
 *  - 'sample': home position of a sample cooler (Sécurisation).
 *  - 'poi':    named place (bot roaming target, radar label).
 */
export interface PointDef {
  kind: 'sample' | 'poi';
  id: string;
  pos: Vec3;
  label?: string;
}

export interface EnvDef {
  /** Sky gradient colours (0xRRGGBB). */
  skyTop: number;
  skyHorizon: number;
  /** Direction TO the sun (normalised). */
  sunDir: Vec3;
  sunColor: number;
  /** 0 = no sun (interior-only map). */
  sunIntensity: number;
  /** Ambient light: colour from above / from below, and overall strength. */
  ambientSky: number;
  ambientGround: number;
  ambientIntensity: number;
  fogColor: number;
  /** Fog distances (m); far <= 0 disables fog. */
  fogNear: number;
  fogFar: number;
}

export interface MapMeta {
  id: string;
  /** Display name, e.g. "Laboratoire de Charleville". */
  name: string;
  /** One-line description for the map picker. */
  description: string;
  /** Modes this map supports (must include 'tdm'). */
  modes: GameModeId[];
  /** Recommended total player count [min, max]. */
  players: [number, number];
}

export interface MapData {
  meta: MapMeta;
  /** World bounds enclosing all gameplay space. */
  bounds: { min: Vec3; max: Vec3 };
  solids: Solid[];
  boxes: BoxPrim[];
  prims: Prim[];
  lights: LightDef[];
  signs: SignDef[];
  spawns: SpawnDef[];
  zones: ZoneDef[];
  points: PointDef[];
  env: EnvDef;
  /** Players falling below this height die. */
  killY: number;
}
