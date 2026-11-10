/**
 * Persistent user settings (localStorage) with change notification.
 * Every client subsystem reads its options from here.
 */

export type KeyAction =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'crouch'
  | 'walk'
  | 'fire'
  | 'altFire'
  | 'reload'
  | 'use'
  | 'slot1'
  | 'slot2'
  | 'slot3'
  | 'lastWeapon'
  | 'scoreboard'
  | 'chat'
  | 'teamChat'
  | 'loadout'
  | 'teamMenu';

export type Quality = 'low' | 'medium' | 'high';

export interface CrosshairSettings {
  /** CSS colour. */
  color: string;
  /** Line length in px. */
  size: number;
  /** Gap from the centre in px (at rest). */
  gap: number;
  thickness: number;
  /** Lines move apart with the weapon inaccuracy. */
  dynamic: boolean;
  dot: boolean;
}

export interface Settings {
  playerName: string;
  /** Mouse sensitivity (Source-like scale: degrees per count = sensitivity × 0.022). */
  sensitivity: number;
  /** Sensitivity multiplier while zoomed. */
  zoomSensitivity: number;
  invertY: boolean;
  /** Vertical field of view in degrees. */
  fov: number;
  volumeMaster: number;
  volumeSfx: number;
  volumeVoice: number;
  volumeMusic: number;
  /** Speak announcer lines with the browser's speech synthesis. */
  announcerVoice: boolean;
  quality: Quality;
  /** Render resolution multiplier (0.5 … 1). */
  resolutionScale: number;
  showFps: boolean;
  /** Weapon view bobbing. */
  viewBob: boolean;
  crosshair: CrosshairSettings;
  /**
   * Key bindings: KeyboardEvent.code values (layout independent — "KeyW" is the
   * Z key on an AZERTY keyboard) or 'Mouse0' | 'Mouse1' | 'Mouse2' | 'WheelUp' | 'WheelDown'.
   */
  keys: Record<KeyAction, string[]>;
}

export const DEFAULT_KEYS: Record<KeyAction, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  crouch: ['ControlLeft', 'KeyC'],
  walk: ['ShiftLeft'],
  fire: ['Mouse0'],
  altFire: ['Mouse2'],
  reload: ['KeyR'],
  use: ['KeyE'],
  slot1: ['Digit1'],
  slot2: ['Digit2'],
  slot3: ['Digit3'],
  lastWeapon: ['KeyQ'],
  scoreboard: ['Tab'],
  chat: ['Enter', 'KeyY'],
  teamChat: ['KeyU'],
  loadout: ['KeyB'],
  teamMenu: ['KeyM'],
};

export const KEY_ACTION_LABELS: Record<KeyAction, string> = {
  forward: 'Avancer',
  back: 'Reculer',
  left: 'Gauche',
  right: 'Droite',
  jump: 'Sauter',
  crouch: 'S’accroupir',
  walk: 'Marche silencieuse',
  fire: 'Tirer',
  altFire: 'Viser / lunette',
  reload: 'Recharger',
  use: 'Utiliser / objectif',
  slot1: 'Arme principale',
  slot2: 'Arme de poing',
  slot3: 'Bistouri',
  lastWeapon: 'Dernière arme',
  scoreboard: 'Tableau des scores',
  chat: 'Chat général',
  teamChat: 'Chat d’équipe',
  loadout: 'Choix des armes',
  teamMenu: 'Choix de l’équipe',
};

export const DEFAULT_SETTINGS: Settings = {
  playerName: '',
  sensitivity: 2.0,
  zoomSensitivity: 0.8,
  invertY: false,
  fov: 74,
  volumeMaster: 0.8,
  volumeSfx: 1,
  volumeVoice: 0.8,
  volumeMusic: 0.4,
  announcerVoice: true,
  quality: 'high',
  resolutionScale: 1,
  showFps: false,
  viewBob: true,
  crosshair: { color: '#39ff6a', size: 7, gap: 4, thickness: 2, dynamic: true, dot: false },
  keys: DEFAULT_KEYS,
};

const STORAGE_KEY = 'bas.settings.v1';

type Listener = (s: Settings) => void;

export class SettingsStore {
  private data: Settings;
  private listeners = new Set<Listener>();

  constructor() {
    this.data = SettingsStore.load();
  }

  private static load(): Settings {
    const base: Settings = structuredClone(DEFAULT_SETTINGS);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return base;
      const saved = JSON.parse(raw) as Partial<Settings>;
      const merged: Settings = {
        ...base,
        ...saved,
        crosshair: { ...base.crosshair, ...(saved.crosshair ?? {}) },
        keys: { ...base.keys, ...(saved.keys ?? {}) },
      };
      return merged;
    } catch {
      return base;
    }
  }

  /** Current settings (treat as read-only; use `update`). */
  get value(): Settings {
    return this.data;
  }

  update(patch: Partial<Settings>): void {
    this.data = { ...this.data, ...patch };
    this.save();
    for (const l of this.listeners) l(this.data);
  }

  reset(): void {
    const name = this.data.playerName;
    this.data = { ...structuredClone(DEFAULT_SETTINGS), playerName: name };
    this.save();
    for (const l of this.listeners) l(this.data);
  }

  /** Subscribe to changes; returns an unsubscribe function. */
  onChange(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      /* storage unavailable (private mode): settings stay in memory */
    }
  }
}

/** Radians of rotation per mouse count for a sensitivity value. */
export const radiansPerCount = (sensitivity: number): number => (sensitivity * 0.022 * Math.PI) / 180;
