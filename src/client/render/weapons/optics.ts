/**
 * Optics: lens glass and illuminated reticles.
 *
 * A lens is a thin disc (or a rectangular window) whose geometry is expressed in the WEAPON
 * FRAME (barrel toward -Z, +Y up, +X right) and whose object transform is the identity, so the
 * shader can read the weapon axes straight from the model-view matrix.
 *
 *  - Glass: fresnel reflection of a small procedural environment, tinted by the lens coating,
 *    a faint haze of the glass itself and a darker rim. Opaque lenses (objective lens, lenses
 *    of other players' weapons) show a dark tube behind the glass.
 *  - Reticle: drawn in angular space, i.e. collimated like a real red dot / holographic sight:
 *    its position on the screen depends on where the weapon POINTS, not on where the weapon
 *    is. `collimation` blends the weapon axis with the view axis (where the bullets actually
 *    go in the game) so the reticle stays on the aim point while the weapon sways.
 *  - Tube optics: a virtual aperture in front of the lens gives the scope shadow: rays that
 *    miss it show the dark inside of the tube, so the sight only "opens" when the eye is
 *    lined up, and a crescent of shadow slides in when it is not.
 *
 * In the view model a see-through tube lens is paired with a depth mask (see models.ts): the
 * mask is drawn before everything else, so nothing of the weapon is drawn behind the lens
 * and the world, rendered before the overlay scene, shows through.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type ReticleKind = 'none' | 'chevron' | 'holo' | 'dot';

export interface LensOptions {
  /** Lens centre (weapon frame, metres). */
  center: [number, number, number];
  /** Radius of a round lens, or half width of a rectangular window. */
  radius: number;
  /** Half height of a rectangular window (omit for a round lens). */
  halfHeight?: number;
  /** +1: the lens faces the shooter (+Z), -1: it faces the target (-Z). */
  facing?: 1 | -1;
  reticle?: ReticleKind;
  /** See-through (view model). Otherwise an opaque, dark coated glass. */
  open?: boolean;
  /** Tube optic: virtual front aperture [distance in front of the lens, radius] in metres. */
  aperture?: [number, number];
  /** Colour of the coating reflection (linear-sRGB hex). */
  coat?: number;
  /** Tint of the glass haze. */
  tint?: number;
  /** Reticle colour and brightness (values above 1 feed the bloom). */
  reticleColor?: number;
  reticleGain?: number;
}

const VERT = /* glsl */ `
uniform vec3 uCenter;
uniform vec2 uHalf;
uniform vec2 uAperture;
varying vec3 vView;
varying vec3 vNormalV;
varying vec2 vDisc;
varying vec3 vAx;
varying vec3 vRt;
varying vec3 vUp;
varying vec3 vApC;
void main() {
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  vView = mv.xyz;
  vNormalV = normalMatrix * normal;
  vDisc = ( position.xy - uCenter.xy ) / uHalf;
  // Weapon axes in view space (their length is the uniform scale of the view model).
  vAx = ( modelViewMatrix * vec4( 0.0, 0.0, -1.0, 0.0 ) ).xyz;
  vRt = ( modelViewMatrix * vec4( 1.0, 0.0, 0.0, 0.0 ) ).xyz;
  vUp = ( modelViewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz;
  vApC = ( modelViewMatrix * vec4( uCenter + vec3( 0.0, 0.0, -uAperture.x ), 1.0 ) ).xyz;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform vec3 uTint;
uniform vec3 uCoat;
uniform vec3 uReticleColor;
uniform vec2 uAperture;
uniform float uLight;
uniform float uOpacity;
uniform float uCollim;
uniform float uGain;
varying vec3 vView;
varying vec3 vNormalV;
varying vec2 vDisc;
varying vec3 vAx;
varying vec3 vRt;
varying vec3 vUp;
varying vec3 vApC;

// Small procedural surroundings for the reflections: sky above, ground below, one soft window.
vec3 lensEnv( vec3 r ) {
  vec3 sky = mix( vec3( 0.62, 0.66, 0.70 ), vec3( 0.26, 0.42, 0.74 ), smoothstep( 0.0, 0.9, r.y ) );
  vec3 gnd = mix( vec3( 0.26, 0.24, 0.22 ), vec3( 0.07, 0.065, 0.06 ), smoothstep( 0.0, -0.8, r.y ) );
  vec3 c = mix( gnd, sky, smoothstep( -0.08, 0.08, r.y ) );
  c += vec3( 2.4, 2.3, 2.1 ) * smoothstep( HILITE, 0.992, dot( r, normalize( vec3( -0.32, 0.62, 0.72 ) ) ) );
  c += vec3( 1.2, 1.25, 1.4 ) * smoothstep( 0.90, 0.99, dot( r, normalize( vec3( 0.5, 0.45, -0.74 ) ) ) );
  return c;
}

float sdSeg( vec2 p, vec2 a, vec2 b ) {
  vec2 pa = p - a, ba = b - a;
  return length( pa - ba * clamp( dot( pa, ba ) / dot( ba, ba ), 0.0, 1.0 ) );
}

float hash21( vec2 p ) {
  return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
}

// Signed distance (degrees) to the reticle pattern; q = angular offset from the aim point.
float reticleSd( vec2 q, float px ) {
  float d = 1e3;
#if RETICLE == 1
  // Chevron with a ranging stem (magnified combat optic).
  float w = max( 0.075, px * 0.8 );
  d = min( sdSeg( q, vec2( 0.0 ), vec2( -0.62, -0.92 ) ), sdSeg( q, vec2( 0.0 ), vec2( 0.62, -0.92 ) ) ) - w;
  float t = max( 0.03, px * 0.55 );
  d = min( d, sdSeg( q, vec2( 0.0, -1.3 ), vec2( 0.0, -3.5 ) ) - t );
  d = min( d, sdSeg( q, vec2( -0.46, -1.8 ), vec2( 0.46, -1.8 ) ) - t );
  d = min( d, sdSeg( q, vec2( -0.32, -2.4 ), vec2( 0.32, -2.4 ) ) - t );
  d = min( d, sdSeg( q, vec2( -0.20, -3.0 ), vec2( 0.20, -3.0 ) ) - t );
#elif RETICLE == 2
  // Holographic ring, four ticks and a centre dot.
  float r = length( q );
  float w = max( 0.036, px * 0.6 );
  d = abs( r - 1.15 ) - w;
  d = min( d, r - max( 0.085, px * 0.9 ) );
  vec2 a = abs( q );
  vec2 m = a.x > a.y ? a : a.yx;
  d = min( d, max( m.y - w, abs( m.x - 1.36 ) - 0.2 ) );
#elif RETICLE == 3
  d = length( q ) - max( 0.11, px );
#endif
  return d;
}

void main() {
  vec3 ray = normalize( vView );
  float s = length( vAx );
  vec3 ax = vAx / s;
  vec3 rt = vRt / s;
  vec3 up = vUp / s;

  // --- Glass -----------------------------------------------------------------------
  vec3 n = normalize( vNormalV );
  if ( ! gl_FrontFacing ) n = -n;
#ifdef LENS_SHAPED
  // A slightly convex lens: the normal leans outward toward the rim.
  n = normalize( n + ( rt * vDisc.x + up * vDisc.y ) * LENS_CURVE );
#endif
  float nv = clamp( dot( n, -ray ), 0.0, 1.0 );
  float fres = 0.045 + 0.955 * pow( 1.0 - nv, 5.0 );
  vec3 refl = lensEnv( reflect( ray, n ) ) * uLight;
  // Anti-reflection coating: a faint coloured reflection even at normal incidence.
  vec3 col = refl * ( fres + COAT_K * uCoat * ( 0.35 + 0.65 * nv ) );

  // --- Tube: scope shadow ------------------------------------------------------------
  float shadow = 1.0;
#ifdef LENS_OPEN
  shadow = 0.0;
  if ( uAperture.y > 0.0 ) {
    float along = dot( ray, ax );
    if ( along > 1e-3 ) {
      vec3 hit = ray * ( dot( vApC, ax ) / along ) - vApC;
      float off = length( vec2( dot( hit, rt ), dot( hit, up ) ) ) / s;
      shadow = smoothstep( uAperture.y * 0.80, uAperture.y, off );
    } else {
      shadow = 1.0;
    }
  }
#endif

  float rim = 0.0;
#ifdef LENS_SHAPED
  #ifdef LENS_RECT
  rim = smoothstep( 0.90, 1.0, max( abs( vDisc.x ), abs( vDisc.y ) ) );
  #else
  rim = smoothstep( 0.84, 1.0, length( vDisc ) );
  #endif
#endif

  float alpha = mix( uOpacity, 1.0, shadow );
  alpha = max( alpha, rim * RIM_K );
  // Haze of the glass itself (seen against the world), dark tube where the view is shadowed.
  col += uTint * uOpacity * uLight * 0.55 * ( 1.0 - shadow );
  col += vec3( 0.010, 0.011, 0.013 ) * uLight * shadow;

  // --- Reticle -----------------------------------------------------------------------
#if RETICLE > 0
  // Angular offset of this ray from the aim direction, in the weapon's tangent plane.
  float along2 = max( dot( ray, ax ), 1e-3 );
  vec2 a = vec2( dot( ray, rt ), dot( ray, up ) ) / along2;
  vec3 fwd = vec3( 0.0, 0.0, -1.0 );
  vec2 f = vec2( dot( fwd, rt ), dot( fwd, up ) ) / max( dot( fwd, ax ), 1e-3 );
  vec2 q = ( a - f * ( 1.0 - uCollim ) ) * 57.29578;
  float px = max( fwidth( q.x ), fwidth( q.y ) );
  float d = reticleSd( q, px );
  float core = 1.0 - smoothstep( -px, px, d );
  float glow = exp( -max( d, 0.0 ) * RETICLE_GLOW ) * 0.16;
  #if RETICLE == 2
  core *= 0.72 + 0.5 * hash21( floor( q * 55.0 ) );
  #endif
  float visible = ( 1.0 - shadow ) * ( 1.0 - rim ) * step( 0.0, dot( ray, ax ) );
  col += uReticleColor * uGain * ( core + glow ) * visible;
#endif

  gl_FragColor = vec4( col, alpha );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Per-lens handle: the mesh, its material and what the view model drives. */
export interface Lens {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  /** Local light level (reflections dim in dark rooms). */
  setLight(level: number): void;
}

const RETICLE_ID: Record<ReticleKind, number> = { none: 0, chevron: 1, holo: 2, dot: 3 };

/** Lens material. `shaped` = the geometry is the lens disc / window itself (rim and curvature are drawn). */
export function createLensMaterial(o: LensOptions, shaped = true): THREE.ShaderMaterial {
  const open = o.open === true;
  const rect = o.halfHeight !== undefined;
  const defines: Record<string, string | number> = {
    RETICLE: open ? RETICLE_ID[o.reticle ?? 'none'] : 0,
    RETICLE_GLOW: '9.0',
    COAT_K: open ? '0.035' : '0.26',
    // The window reflected by an eyepiece is a thin crescent near its rim, not a veil over the sight picture.
    HILITE: open ? '0.955' : '0.86',
    RIM_K: open ? '0.9' : '1.0',
    LENS_CURVE: rect ? '0.03' : '0.22',
  };
  if (open) defines.LENS_OPEN = 1;
  if (shaped) defines.LENS_SHAPED = 1;
  if (rect) defines.LENS_RECT = 1;
  const material = new THREE.ShaderMaterial({
    name: `lens:${o.reticle ?? 'none'}`,
    defines,
    uniforms: {
      uCenter: { value: new THREE.Vector3(o.center[0], o.center[1], o.center[2]) },
      uHalf: { value: new THREE.Vector2(o.radius, o.halfHeight ?? o.radius) },
      uAperture: { value: new THREE.Vector2(o.aperture?.[0] ?? 0, o.aperture?.[1] ?? 0) },
      uTint: { value: new THREE.Color(o.tint ?? 0x9fd8c8) },
      uCoat: { value: new THREE.Color(o.coat ?? 0x7a4cff) },
      uReticleColor: { value: new THREE.Color(o.reticleColor ?? 0xff2a12) },
      uLight: { value: 1 },
      uOpacity: { value: open ? 0.07 : 1 },
      uCollim: { value: 0.45 },
      uGain: { value: o.reticleGain ?? 4.5 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: open,
    premultipliedAlpha: true,
    depthWrite: !open,
    side: THREE.DoubleSide,
  });
  return material;
}

/** A round lens or a rectangular window, built in the weapon frame. */
export function createLens(o: LensOptions): Lens {
  const facing = o.facing ?? 1;
  const geometry =
    o.halfHeight !== undefined ? new THREE.PlaneGeometry(o.radius * 2, o.halfHeight * 2) : new THREE.CircleGeometry(o.radius, 40);
  if (facing < 0) geometry.rotateY(Math.PI);
  geometry.translate(o.center[0], o.center[1], o.center[2]);
  const material = createLensMaterial(o, true);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = o.open ? 'lens:open' : 'lens';
  mesh.renderOrder = 4;
  mesh.castShadow = false;
  return lensHandle(mesh, material);
}

export function lensHandle(mesh: THREE.Mesh, material: THREE.ShaderMaterial): Lens {
  return {
    mesh,
    material,
    setLight(level) {
      material.uniforms.uLight!.value = level;
    },
  };
}

let maskMaterial: THREE.MeshBasicMaterial | null = null;

/**
 * Depth-only copy of a lens, drawn before every other object of the overlay scene: whatever
 * lies behind the lens (inside of the tube, front of the weapon) is not drawn at all, so the
 * world rendered underneath stays visible through the glass.
 */
export function createLensMask(lens: THREE.Mesh): THREE.Mesh {
  maskMaterial ??= new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  const mask = new THREE.Mesh(lens.geometry, maskMaterial);
  mask.name = 'lens:mask';
  mask.position.z = -0.0005;
  mask.renderOrder = -100;
  mask.castShadow = false;
  return mask;
}

// --- Holographic sight -------------------------------------------------------------

let holoMats: { body: THREE.MeshStandardMaterial; hood: THREE.MeshStandardMaterial; rubber: THREE.MeshStandardMaterial } | null = null;

export interface HoloSight {
  /** Origin on top of the rail, under the middle of the sight; -Z toward the muzzle. */
  group: THREE.Group;
  lens: Lens;
  /** Centre of the window, in the group's frame. */
  window: [number, number, number];
  dispose(): void;
}

/**
 * A compact holographic sight (original design) for the procedural weapons: base clamped on
 * the rail, battery cap across the front, control block at the back and a hooded window
 * carrying the ring-and-dot reticle. `reticle` false = the glass only (weapons seen from outside).
 */
export function createHoloSight(reticle: boolean): HoloSight {
  holoMats ??= {
    body: new THREE.MeshStandardMaterial({ name: 'holo:body', color: 0x17181a, metalness: 0.2, roughness: 0.66 }),
    hood: new THREE.MeshStandardMaterial({ name: 'holo:hood', color: 0x202225, metalness: 0.82, roughness: 0.46 }),
    rubber: new THREE.MeshStandardMaterial({ name: 'holo:rubber', color: 0x0b0b0c, metalness: 0, roughness: 0.9 }),
  };
  const lists: Record<'body' | 'hood' | 'rubber', THREE.BufferGeometry[]> = { body: [], hood: [], rubber: [] };
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  const put = (g: THREE.BufferGeometry, mat: keyof typeof lists, x: number, y: number, z: number, rx = 0, rz = 0): void => {
    g.applyMatrix4(m4.compose(new THREE.Vector3(x, y, z), q.setFromEuler(e.set(rx, 0, rz)), one));
    lists[mat].push(g.index ? g.toNonIndexed() : g);
  };
  const box = (w: number, h: number, l: number, x: number, y: number, z: number, mat: keyof typeof lists = 'body', rx = 0, rz = 0): void =>
    put(new THREE.BoxGeometry(w, h, l), mat, x, y, z, rx, rz);
  const drum = (r: number, len: number, x: number, y: number, z: number, mat: keyof typeof lists = 'body'): void => {
    const g = new THREE.CylinderGeometry(r, r, len, 14);
    g.rotateZ(Math.PI / 2);
    put(g, mat, x, y, z);
  };
  // Base and rail clamp.
  box(0.038, 0.021, 0.088, 0, 0.0115, 0);
  box(0.045, 0.008, 0.052, 0, 0.003, -0.004);
  drum(0.0045, 0.052, 0, 0.004, 0.012, 'hood');
  box(0.006, 0.012, 0.03, -0.0245, 0.007, -0.004, 'hood'); // locking lever
  // Battery cap across the front.
  drum(0.0088, 0.042, 0, 0.0125, -0.047);
  drum(0.0098, 0.006, 0.023, 0.0125, -0.047, 'hood');
  // Low control block at the back (it must stay under the window), with its two buttons.
  box(0.036, 0.006, 0.02, 0, 0.0235, 0.032);
  box(0.036, 0.006, 0.012, 0, 0.0225, 0.0405, 'body', -0.5);
  box(0.0055, 0.004, 0.003, -0.007, 0.0155, 0.0445, 'rubber');
  box(0.0055, 0.004, 0.003, 0.007, 0.0155, 0.0445, 'rubber');
  // Window frame.
  const wy = 0.043;
  const wz = -0.012;
  box(0.036, 0.005, 0.014, 0, wy - 0.0185, wz);
  box(0.0022, 0.034, 0.007, -0.0172, wy, wz);
  box(0.0022, 0.034, 0.007, 0.0172, wy, wz);
  box(0.0366, 0.0022, 0.007, 0, wy + 0.0172, wz);
  // Protective hood: two side plates, a roof and chamfered corners.
  box(0.0028, 0.034, 0.054, -0.0205, wy - 0.004, wz + 0.004, 'hood');
  box(0.0028, 0.034, 0.054, 0.0205, wy - 0.004, wz + 0.004, 'hood');
  box(0.03, 0.0028, 0.054, 0, wy + 0.0225, wz + 0.004, 'hood');
  box(0.0028, 0.0135, 0.054, -0.0172, wy + 0.0178, wz + 0.004, 'hood', 0, -Math.PI / 4);
  box(0.0028, 0.0135, 0.054, 0.0172, wy + 0.0178, wz + 0.004, 'hood', 0, Math.PI / 4);

  const group = new THREE.Group();
  group.name = 'holo';
  const made: THREE.BufferGeometry[] = [];
  for (const k of ['body', 'hood', 'rubber'] as const) {
    const merged = mergeGeometries(lists[k], false);
    for (const g of lists[k]) g.dispose();
    if (!merged) continue;
    made.push(merged);
    const mesh = new THREE.Mesh(merged, holoMats[k]);
    mesh.castShadow = true;
    group.add(mesh);
  }
  const window: [number, number, number] = [0, wy, wz];
  const lens = createLens({ ...HOLO_LENS, center: window, reticle: reticle ? 'holo' : 'none' });
  group.add(lens.mesh);
  made.push(lens.mesh.geometry);
  return {
    group,
    lens,
    window,
    dispose() {
      for (const g of made) g.dispose();
      lens.material.dispose();
    },
  };
}

/** Glass of the holographic sight's window (centre filled in by createHoloSight). */
const HOLO_LENS: LensOptions = { center: [0, 0, 0], radius: 0.016, halfHeight: 0.016, open: true, coat: 0xff5038, tint: 0xa8e0d0 };
