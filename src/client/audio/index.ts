/**
 * Procedural audio subsystem (ARCHITECTURE §12). Everything is synthesised with the
 * Web Audio API: no audio file is loaded.
 *
 *   kit.ts          synthesis toolkit (noise, envelopes, filters, generated reverbs)
 *   sounds/*.ts     recipes: weapons, steps, impacts, feedback / UI / jingles, objectives, ambience, music
 *   bank.ts         catalogue + rendering of the recipes into AudioBuffers (OfflineAudioContext)
 *   master.ts       output stage (compressor + soft clipper)
 *   announcer.ts    spoken lines (speech synthesis, French)
 *   engine.ts       real-time engine: buses, voice pool, HRTF spatialisation, loops
 */
import type { IAudio } from '../core/contracts';
import type { SettingsStore } from '../core/settings';
import { AudioEngine } from './engine';

export function createAudio(settings: SettingsStore): IAudio {
  return new AudioEngine(settings);
}

export { AudioEngine } from './engine';
export { allSounds, getSound, renderDef, createOffline, startRendering, type SoundDef, type SoundGroup } from './bank';
export { createMasterChain, calibrateCompressor, CEILING } from './master';
