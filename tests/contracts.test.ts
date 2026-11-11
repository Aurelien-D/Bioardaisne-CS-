import { describe, expect, it } from 'vitest';
import { getMap, listMaps } from '../src/shared/maps';
import { WEAPONS, WEAPON_IDS } from '../src/shared/weapons/defs';
import { anglesFromDir, forwardFromAngles } from '../src/shared/math/vec3';

describe('shared contracts', () => {
  it('builds the dev map', () => {
    const map = getMap('dev_test');
    expect(map.solids.length).toBeGreaterThan(10);
    expect(map.spawns.filter((s) => s.team === 0).length).toBeGreaterThanOrEqual(5);
    expect(map.spawns.filter((s) => s.team === 1).length).toBeGreaterThanOrEqual(5);
    expect(listMaps(true).length).toBeGreaterThanOrEqual(1);
  });

  it('has consistent weapon data', () => {
    for (const id of WEAPON_IDS) {
      const w = WEAPONS[id];
      expect(w.id).toBe(id);
      expect(w.fireInterval).toBeGreaterThan(0);
      expect(w.damage).toBeGreaterThan(0);
    }
  });

  it('view angle conventions round-trip', () => {
    const f = forwardFromAngles(0, 0);
    expect(f.z).toBeCloseTo(-1);
    const left = forwardFromAngles(Math.PI / 2, 0);
    expect(left.x).toBeCloseTo(-1);
    const a = anglesFromDir(forwardFromAngles(0.7, -0.3));
    expect(a.yaw).toBeCloseTo(0.7);
    expect(a.pitch).toBeCloseTo(-0.3);
  });
});
