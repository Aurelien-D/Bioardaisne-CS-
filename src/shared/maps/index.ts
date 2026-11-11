/**
 * Map registry. To add a map: create `maps/<id>.ts` exporting `meta` and `build()`,
 * then add it to MAP_MODULES below.
 */
import type { MapData, MapMeta } from './types';
import * as devKit from './dev_kit';
import * as devTest from './dev_test';

export interface MapModule {
  meta: MapMeta;
  build(): MapData;
}

/** Order = order in the map picker. Maps whose id starts with "dev_" are hidden from the menu. */
export const MAP_MODULES: MapModule[] = [devTest, devKit];

const cache = new Map<string, MapData>();

export function hasMap(id: string): boolean {
  return MAP_MODULES.some((m) => m.meta.id === id);
}

/** Build (once) and return the map with this id. Throws if unknown. */
export function getMap(id: string): MapData {
  let data = cache.get(id);
  if (!data) {
    const mod = MAP_MODULES.find((m) => m.meta.id === id);
    if (!mod) throw new Error(`Unknown map: ${id}`);
    data = mod.build();
    cache.set(id, data);
  }
  return data;
}

export function listMaps(includeDev = false): MapMeta[] {
  return MAP_MODULES.map((m) => m.meta).filter((m) => includeDev || !m.id.startsWith('dev_'));
}
