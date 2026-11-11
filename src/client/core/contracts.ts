/**
 * Client subsystem contracts. Each subsystem lives in its own folder, exposes a
 * factory with the signature listed below, and is wired together by the game
 * core (src/client/game). Subsystems never import each other: they only depend
 * on these interfaces, on src/shared, and on the settings store.
 *
 *   render/engine.ts            createEngine(canvas, settings): IEngine
 *   render/viewmodel/index.ts   createViewModel(): IViewModel
 *   render/avatar/index.ts      createAvatar(team, name): IAvatar
 *   render/effects/index.ts     createEffects(engine): IEffects
 *   audio/index.ts              createAudio(settings): IAudio
 *   ui/hud.ts                   createHud(root, settings, callbacks): IHud
 *   ui/menus.ts                 createMenus(root, settings, callbacks): IMenus
 */
import type * as THREE from 'three';
import type { SurfaceType } from '../../shared/maps/materials';
import type { MapData } from '../../shared/maps/types';
import type { Vec3 } from '../../shared/math/vec3';
import type { CollisionWorld } from '../../shared/physics/world';
import type { GameModeId, MatchPhase, MatchState, PlayerInfo, RoomConfig, TeamId } from '../../shared/types';
import type { Loadout, WeaponId } from '../../shared/weapons/defs';
import type { SettingsStore } from './settings';

// =================================================================================
// Rendering
// =================================================================================

export interface IEngine {
  readonly renderer: THREE.WebGLRenderer;
  /** World scene (map, avatars, effects). */
  readonly scene: THREE.Scene;
  /** First-person world camera, rotation order 'YXZ'. The game sets position / rotation / fov. */
  readonly camera: THREE.PerspectiveCamera;
  /** Overlay scene for the first-person weapon, rendered after the world with a cleared depth buffer. */
  readonly viewScene: THREE.Scene;
  /** Camera of the overlay scene (fixed at the origin, fixed FOV: the weapon does not stretch with the world FOV). */
  readonly viewCamera: THREE.PerspectiveCamera;

  /** Build all meshes, textures and baked lighting for a map. Replaces any previous map. */
  loadMap(map: MapData, world: CollisionWorld, onProgress?: (fraction: number, label: string) => void): Promise<void>;
  unloadMap(): void;
  /** Baked/ambient light colour at a world position — used to tint avatars and the view model. */
  sampleLight(pos: Vec3, out: THREE.Color): THREE.Color;
  /** Set the vertical FOV of the world camera (degrees). */
  setFov(vfovDeg: number): void;
  /** Re-read quality / resolution settings. */
  applySettings(): void;
  resize(): void;
  /** Draw one frame (world, then view model). */
  render(): void;
  dispose(): void;
}

/** Per-frame input of the first-person weapon. */
export interface ViewModelFrame {
  dt: number;
  /** Horizontal speed (m/s) and stance, for bobbing. */
  speed: number;
  onGround: boolean;
  crouch: number;
  /** View rotation applied this frame (radians), for weapon sway. */
  lookDeltaYaw: number;
  lookDeltaPitch: number;
  /** Current recoil punch (radians). */
  punchPitch: number;
  punchYaw: number;
  /** Sniper zoom level (the scoped rifle hides itself when > 0). */
  zoom: number;
  /** Aim-down-sights blend, 0 (hip) … 1 (sights aligned with the screen centre). */
  ads: number;
  /** Team of the local player (colour of the first-person arms). */
  team?: number;
  /** Light colour at the player's position. */
  light: THREE.Color;
}

/**
 * Mechanical sound of a first-person weapon animation, emitted at the exact moment the part
 * moves (magazine leaving the well, bolt slamming home…), so sound and motion stay in sync.
 */
export type WeaponFoley = 'mag_out' | 'mag_in' | 'bolt_back' | 'bolt_forward' | 'slide' | 'pump' | 'shell_in' | 'cloth' | 'draw' | 'swish' | 'click';

export interface IViewModel {
  /** Add this to engine.viewScene. */
  readonly root: THREE.Object3D;
  /**
   * True when this view model emits the reload / draw / inspect sounds itself through `onFoley`:
   * the game then skips the generic `audio.reload()` and `audio.draw()` for the local player.
   */
  readonly foley?: boolean;
  /** Set by the game: receives the foley events of the animations. */
  onFoley?: ((sound: WeaponFoley, weapon: WeaponId) => void) | null;
  /** Swap the weapon mesh (null = empty hands). Call onDraw() to play the draw animation. */
  setWeapon(id: WeaponId | null): void;
  onFire(): void;
  onDryFire(): void;
  /** Play the reload animation over `duration` seconds. */
  onReload(duration: number): void;
  /** Play the draw (raise) animation over `duration` seconds. */
  onDraw(duration: number): void;
  /** Cancel a reload animation (weapon switch). */
  cancelReload(): void;
  /** Play the weapon inspection animation (the player looks the weapon over). Firing, reloading or switching cancels it. */
  onInspect?(): void;
  update(frame: ViewModelFrame): void;
  /** Muzzle position in viewCamera space (to start the local player's tracers). */
  getMuzzle(out: THREE.Vector3): THREE.Vector3;
  setVisible(visible: boolean): void;
  dispose(): void;
}

/** Per-frame input of a third-person player model. */
export interface AvatarFrame {
  dt: number;
  /** Feet position. */
  pos: Vec3;
  yaw: number;
  pitch: number;
  crouch: number;
  /** Horizontal speed (m/s). */
  speed: number;
  /** Horizontal velocity (m/s, world axes): lets the legs strafe or backpedal instead of always running forward. */
  velX?: number;
  velZ?: number;
  onGround: boolean;
  weapon: WeaponId;
  reloading: boolean;
  /** Carrying an objective item (dossier / glacière). */
  carrying: boolean;
  /** Spawn protection (rendered as a soft glow / transparency). */
  protected: boolean;
  light: THREE.Color;
}

export interface IAvatar {
  /** Add this to engine.scene. */
  readonly root: THREE.Object3D;
  update(frame: AvatarFrame): void;
  /** Weapon fire animation (recoil of the arms). */
  onFire(): void;
  /** A bullet hit this player (it survives): flinch away from `dir`, the direction the bullet travelled. */
  onHit?(dir: Vec3): void;
  /** Play the death animation; `impulse` = direction of the killing shot. The corpse stays until dispose(). */
  die(impulse: Vec3): void;
  /** World position of the weapon muzzle (to start tracers / muzzle flashes). */
  getMuzzle(out: THREE.Vector3): THREE.Vector3;
  /** World position just above the head (name tags). */
  getHead(out: THREE.Vector3): THREE.Vector3;
  dispose(): void;
}

export interface IEffects {
  /** Bullet tracer from `from` to `to`. */
  tracer(from: Vec3, to: Vec3, weapon: WeaponId): void;
  /** Bullet impact on the world: particles + bullet-hole decal. */
  impact(point: Vec3, normal: Vec3, surf: SurfaceType): void;
  /** Hit on a player. */
  blood(point: Vec3, dir: Vec3): void;
  /** Third-person muzzle flash (remote players). */
  muzzleFlash(pos: Vec3, dir: Vec3, weapon: WeaponId): void;
  /** Objective explosion / big burst (e.g. confetti of paperwork when the "écart critique" goes off). */
  explosion(pos: Vec3): void;
  /** World marker for objectives (pulsing beacon). Returns a handle to move / remove it. */
  marker(kind: 'bomb' | 'sample' | 'site' | 'extract', pos: Vec3, color: number): { set(pos: Vec3): void; remove(): void };
  update(dt: number): void;
  /** Remove every transient effect and decal (map change / round restart). */
  clear(): void;
  dispose(): void;
}

// =================================================================================
// Audio
// =================================================================================

export type UiSound = 'click' | 'hover' | 'back' | 'error' | 'join' | 'chat';
export type FeedbackSound =
  | 'hitmarker'
  | 'headshot'
  | 'kill'
  | 'hurt'
  | 'death'
  | 'respawn'
  | 'pickup'
  | 'countdown'
  | 'round_start'
  | 'round_win'
  | 'round_lose'
  | 'plant_tick'
  | 'defuse_tick';

export interface IAudio {
  /** Create / resume the AudioContext. Must be called from a user gesture. */
  unlock(): void;
  /** Re-read volumes from the settings store. */
  applySettings(): void;
  setListener(pos: Vec3, forward: Vec3): void;
  /** Gunshot. `pos` = null for the local player's own weapon (not spatialised, full weight). */
  shot(weapon: WeaponId, pos: Vec3 | null): void;
  /** One mechanical sound of the local player's weapon, in sync with its animation (see WeaponFoley). */
  foley?(sound: WeaponFoley, weapon: WeaponId): void;
  /** Full reload sequence (mag out / mag in / bolt) spread over `duration` seconds. */
  reload(weapon: WeaponId, duration: number, pos: Vec3 | null): void;
  draw(weapon: WeaponId, pos: Vec3 | null): void;
  dryFire(pos: Vec3 | null): void;
  zoom(): void;
  /** Footstep on a surface; `loud` 0..1. */
  footstep(surf: SurfaceType, pos: Vec3 | null, loud: number): void;
  jump(pos: Vec3 | null): void;
  land(surf: SurfaceType, speed: number, pos: Vec3 | null): void;
  /** Bullet hitting the world. */
  impact(surf: SurfaceType, pos: Vec3): void;
  /** Bullet hitting a player (heard in the world). */
  bodyHit(pos: Vec3, headshot: boolean): void;
  /** Bullet passing close to the listener. */
  whizz(pos: Vec3): void;
  ui(kind: UiSound): void;
  feedback(kind: FeedbackSound): void;
  /** Objective sounds: 'bomb_beep', 'bomb_planted', 'bomb_defused', 'bomb_exploded', 'sample_taken', 'sample_returned', 'sample_extracted'. */
  objective(kind: string, pos: Vec3 | null): void;
  /** Announcer: jingle + (if enabled) speech synthesis of identity.ANNOUNCE[key].voice. */
  announce(key: string): void;
  /** Looping ambience: 'interior' (ventilation, analysers humming), 'city' (wind, distant traffic, birds) or null. */
  ambience(kind: 'interior' | 'city' | null): void;
  /** Menu music loop (procedural) or null to stop. */
  music(track: 'menu' | null): void;
  stopAll(): void;
}

// =================================================================================
// HUD
// =================================================================================

/** Everything the HUD needs each frame. Cheap to build; the HUD diffs before touching the DOM. */
export interface HudFrame {
  /** False while in menus / loading: the HUD is hidden. */
  visible: boolean;
  alive: boolean;
  health: number;
  armor: number;
  team: TeamId;
  weapon: WeaponId | null;
  clip: number;
  reserve: number;
  reloading: boolean;
  /** Inventory, for the weapon bar: weapon id per slot (null = empty) and active slot. */
  slots: (WeaponId | null)[];
  activeSlot: number;
  /** Current inaccuracy (radians) and vertical FOV (degrees), for the dynamic crosshair. */
  spread: number;
  fov: number;
  /** Sniper zoom level (> 0 shows the scope overlay and hides the crosshair). */
  zoom: number;
  /** Aiming down the sights of the weapon: the crosshair is hidden (the weapon's own sight is used). */
  ads?: boolean;
  mode: GameModeId;
  phase: MatchPhase;
  /** Seconds left in the current phase (0 if no timer). */
  timeLeft: number;
  round: number;
  /** Rounds won [Labo, Auditeurs]. */
  score: [number, number];
  roundsToWin: number;
  /** Secondary score line, e.g. TDM kills this round "12 – 9 / 25". */
  objectiveLine: string;
  /** Interaction hint, e.g. "Maintenir [E] pour déposer l'écart" (null = none). */
  prompt: string | null;
  /** Progress bar of a timed action (plant / defuse), null = hidden. */
  action: { label: string; progress: number } | null;
  /** When dead or spectating. */
  spectating: string | null;
  /** Seconds until respawn (TDM), -1 = not applicable. */
  respawnIn: number;
  /** Spawn protection active. */
  protected: boolean;
  carrying: boolean;
  ping: number;
  fps: number;
  /** Radar data (world coordinates), null to hide the radar. */
  radar: null | {
    x: number;
    z: number;
    yaw: number;
    blips: { x: number; z: number; team: TeamId; kind: 'player' | 'bomb' | 'sample' | 'site' }[];
  };
}

export interface KillFeedEntry {
  killer: string;
  killerTeam: TeamId;
  victim: string;
  victimTeam: TeamId;
  /** null = world (fall, objective). */
  weapon: WeaponId | null;
  headshot: boolean;
  /** The local player is the killer or the victim (highlight). */
  involvesLocal: boolean;
}

export interface HudCallbacks {
  /** The player submitted a chat line. */
  chatSubmit(text: string, teamOnly: boolean): void;
  /** Chat input opened / closed (the game releases / restores the pointer lock and stops reading keys). */
  chatFocus(open: boolean): void;
}

export interface IHud {
  update(frame: HudFrame): void;
  /** Called once per map load (radar background, map name). */
  setMap(map: MapData): void;
  setRoster(players: PlayerInfo[], localId: number, match: MatchState): void;
  setScoreboardVisible(visible: boolean): void;
  pushKill(entry: KillFeedEntry): void;
  /** Crosshair hit confirmation. */
  hitMarker(headshot: boolean, kill: boolean): void;
  /** Damage direction indicator: angle (radians) of the attacker relative to the view direction (0 = front, + = left). */
  damageFrom(relativeAngle: number, amount: number): void;
  /** Big centre-screen announcement (round start, win…). */
  announce(title: string, sub?: string, tone?: 'neutral' | 'good' | 'bad'): void;
  /** Small transient info line (e.g. "Vous avez rejoint l'Équipe Labo"). */
  toast(text: string): void;
  chatMessage(name: string, team: TeamId | -1, text: string, teamOnly: boolean): void;
  /** Open the chat input. */
  openChat(teamOnly: boolean): void;
  isChatOpen(): boolean;
  dispose(): void;
}

// =================================================================================
// Menus
// =================================================================================

export interface PauseContext {
  /** Room code, null in solo. */
  roomCode: string | null;
  /** Shareable URL, null in solo. */
  shareUrl: string | null;
  isHost: boolean;
  config: RoomConfig;
  /** Local (solo) game. */
  local: boolean;
  /** This browser hosts the match for the other players (no game server): leaving closes the room. */
  hostedHere?: boolean;
}

export interface MenuCallbacks {
  /** Start a local game against bots. */
  playSolo(config: RoomConfig): void;
  /** Create a private room on the server. */
  createRoom(config: RoomConfig): void;
  /** Join a room by code. */
  joinRoom(code: string): void;
  /** Close the pause menu and re-capture the mouse (called from a click: user gesture). */
  resume(): void;
  /** Leave the game and go back to the main menu. */
  leave(): void;
  /** 0, 1, 2 (spectator) or -1 (auto). */
  pickTeam(team: number): void;
  pickLoadout(loadout: Loadout): void;
  /** Host: change room settings (map / mode / bots…). */
  hostConfig(patch: Partial<RoomConfig>, restart: boolean): void;
  /** Any UI sound the menus want to play. */
  uiSound(kind: UiSound): void;
}

export type MenuScreen = 'main' | 'loading' | 'pause' | 'team' | 'loadout' | null;

export interface IMenus {
  /** Screen currently displayed (null = none: the game has the focus). */
  readonly current: MenuScreen;
  /** Title screen. `joinCode` pre-fills the "rejoindre" form (from the URL ?room=CODE). */
  showMain(opts?: { error?: string; joinCode?: string }): void;
  showLoading(label: string, fraction: number): void;
  showPause(ctx: PauseContext): void;
  showTeamSelect(ctx: { counts: [number, number]; current: TeamId; mode: GameModeId }): void;
  showLoadout(current: Loadout, team: TeamId): void;
  /** Hide the current screen. */
  hide(): void;
  dispose(): void;
}

export type { SettingsStore };
