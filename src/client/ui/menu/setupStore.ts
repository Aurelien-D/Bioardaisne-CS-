/**
 * Game-setup choices: validation against the available maps / modes and
 * persistence of the last choices (localStorage key "bas.menu.setup.v1").
 */
import { LIMITS } from '../../../shared/constants';
import { MAP_MODULES, listMaps } from '../../../shared/maps';
import type { MapMeta } from '../../../shared/maps/types';
import { DEFAULT_ROOM_CONFIG, MODE_DEFAULTS, type GameModeId, type RoomConfig } from '../../../shared/types';
import { clamp } from '../dom';

const STORAGE_KEY = 'bas.menu.setup.v1';

/** Allowed values of the "players in total" slider: 0 = no bots, then 2 … 16. */
export const BOT_FILL_MAX = Math.min(LIMITS.maxPlayersPerRoom, LIMITS.maxBots + 1);
export const BOT_FILL_VALUES: number[] = [0, ...Array.from({ length: BOT_FILL_MAX - 1 }, (_, i) => i + 2)];
export const ROUND_TIME = { min: 60, max: 600, step: 15 } as const;
export const ROUNDS_TO_WIN = { min: 1, max: 10 } as const;
export const KILL_LIMIT = { min: 0, max: 100, step: 5 } as const;

const MODES: GameModeId[] = ['tdm', 'defuse', 'secure'];

/** Maps offered by the picker: public maps, or the dev maps when none is registered yet. */
export function availableMaps(alsoInclude?: string): MapMeta[] {
  let maps = listMaps();
  if (maps.length === 0) maps = listMaps(true);
  if (alsoInclude && !maps.some((m) => m.id === alsoInclude)) {
    // e.g. the host panel while a hidden dev map is being played.
    const extra = MAP_MODULES.find((m) => m.meta.id === alsoInclude);
    if (extra) maps = [...maps, extra.meta];
  }
  return maps;
}

/** Clamp a (possibly stale or partial) config to something the picker can show and the room accepts. */
export function sanitizeSetup(input: Partial<RoomConfig> | null | undefined, keepMap?: string): RoomConfig {
  const cfg: RoomConfig = { ...DEFAULT_ROOM_CONFIG, ...(input ?? {}) };
  const maps = availableMaps(keepMap);
  const map = maps.find((m) => m.id === cfg.mapId) ?? maps[0];
  if (map) cfg.mapId = map.id;
  if (!MODES.includes(cfg.mode)) cfg.mode = 'tdm';
  if (map && !map.modes.includes(cfg.mode)) {
    cfg.mode = map.modes.includes('tdm') ? 'tdm' : (map.modes[0] ?? 'tdm');
    Object.assign(cfg, MODE_DEFAULTS[cfg.mode]);
  }
  const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  cfg.botFill = clamp(Math.round(num(cfg.botFill, DEFAULT_ROOM_CONFIG.botFill)), 0, BOT_FILL_MAX);
  if (cfg.botFill === 1) cfg.botFill = 0;
  cfg.botDifficulty = clamp(Math.round(num(cfg.botDifficulty, 1)), 0, 3);
  cfg.roundTime = clamp(Math.round(num(cfg.roundTime, DEFAULT_ROOM_CONFIG.roundTime)), ROUND_TIME.min, ROUND_TIME.max);
  cfg.roundsToWin = clamp(Math.round(num(cfg.roundsToWin, DEFAULT_ROOM_CONFIG.roundsToWin)), ROUNDS_TO_WIN.min, ROUNDS_TO_WIN.max);
  cfg.killLimit = clamp(Math.round(num(cfg.killLimit, DEFAULT_ROOM_CONFIG.killLimit)), KILL_LIMIT.min, KILL_LIMIT.max);
  cfg.friendlyFire = !!cfg.friendlyFire;
  return cfg;
}

/** Last choices of the player (defaults on first launch). */
export function loadSetup(): RoomConfig {
  let saved: Partial<RoomConfig> | null = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) saved = JSON.parse(raw) as Partial<RoomConfig>;
  } catch {
    saved = null;
  }
  const base: Partial<RoomConfig> = { ...DEFAULT_ROOM_CONFIG, ...MODE_DEFAULTS[DEFAULT_ROOM_CONFIG.mode] };
  return sanitizeSetup(saved && typeof saved === 'object' ? { ...base, ...saved } : base);
}

export function saveSetup(cfg: RoomConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    /* storage unavailable: choices are simply not remembered */
  }
}

/** Fields that differ between two configs. */
export function diffConfig(from: RoomConfig, to: RoomConfig): Partial<RoomConfig> {
  const patch: Partial<RoomConfig> = {};
  for (const key of Object.keys(to) as (keyof RoomConfig)[]) {
    if (from[key] !== to[key]) (patch as Record<string, unknown>)[key] = to[key];
  }
  return patch;
}
