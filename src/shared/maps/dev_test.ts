/**
 * dev_test — small development arena used by unit tests and early play-testing.
 * 32 × 32 m courtyard with crates, a raised walkway with stairs and a small hut.
 */
import { MapBuilder } from './builder';
import type { MapData, MapMeta } from './types';

export const meta: MapMeta = {
  id: 'dev_test',
  name: 'Arène de test',
  description: 'Petite arène de développement (caisses, passerelle, cabanon).',
  modes: ['tdm'],
  players: [2, 8],
};

export function build(): MapData {
  const b = new MapBuilder(meta);
  const H = 16; // half size

  // Ground and perimeter walls
  b.box(-H, -0.5, -H, H, 0, H, 'concrete_floor');
  b.box(-H - 0.5, 0, -H - 0.5, H + 0.5, 5, -H, 'brick_red');
  b.box(-H - 0.5, 0, H, H + 0.5, 5, H + 0.5, 'brick_red');
  b.box(-H - 0.5, 0, -H, -H, 5, H, 'brick_red');
  b.box(H, 0, -H, H + 0.5, 5, H, 'brick_red');

  // Central cover: crates of various heights
  b.box(-1.5, 0, -1.5, 1.5, 1.2, 1.5, 'cardboard');
  b.box(-0.6, 1.2, -0.6, 0.6, 2.2, 0.6, 'cardboard');
  b.box(-7, 0, -2, -5.5, 1.0, 2, 'metal_grey');
  b.box(5.5, 0, -2, 7, 1.0, 2, 'metal_grey');
  b.box(-3, 0, 6, 3, 0.9, 7, 'laminate_white');
  b.box(-3, 0, -7, 3, 0.9, -6, 'laminate_white');

  // Raised walkway along the +X wall (2 m high) with stairs at both ends
  b.box(11, 1.8, -10, H, 2, 10, 'metal_grate');
  for (let i = 0; i < 8; i++) {
    const y = (i + 1) * 0.25;
    // stairs going up toward -Z end of the walkway (from z = -14 to z = -10)
    b.box(11, y - 0.25, -14 + i * 0.5, 13, y, -13.5 + i * 0.5, 'concrete');
    // stairs at the +Z end (from z = 14 down to z = 10)
    b.box(11, y - 0.25, 13.5 - i * 0.5, 13, y, 14 - i * 0.5, 'concrete');
  }
  // Pillars under the walkway
  b.box(11, 0, -6, 11.4, 1.8, -5.6, 'concrete');
  b.box(11, 0, 5.6, 11.4, 1.8, 6, 'concrete');

  // Small hut in the -X side with two doorways
  const hx0 = -14;
  const hx1 = -9;
  const hz0 = -4;
  const hz1 = 4;
  b.box(hx0, 0, hz0, hx1, 0.02, hz1, 'lino_grey', { solid: false });
  b.box(hx0, 2.8, hz0, hx1, 3, hz1, 'ceiling_tile');
  b.box(hx0, 0, hz0, hx0 + 0.2, 2.8, hz1, 'plaster_white');
  // wall facing +X with a 1.4 m doorway in the middle
  b.box(hx1 - 0.2, 0, hz0, hx1, 2.8, -0.7, 'plaster_white');
  b.box(hx1 - 0.2, 0, 0.7, hx1, 2.8, hz1, 'plaster_white');
  b.box(hx1 - 0.2, 2.1, -0.7, hx1, 2.8, 0.7, 'plaster_white');
  // side walls, one with a doorway
  b.box(hx0, 0, hz0, hx1, 2.8, hz0 + 0.2, 'plaster_white');
  b.box(hx0, 0, hz1 - 0.2, -12.2, 2.8, hz1, 'plaster_white');
  b.box(-10.8, 0, hz1 - 0.2, hx1, 2.8, hz1, 'plaster_white');
  b.box(-12.2, 2.1, hz1 - 0.2, -10.8, 2.8, hz1, 'plaster_white');
  b.light(-11.5, 2.6, 0, 0xffffff, 1, 8);
  b.sign({ x: hx1 + 0.01, y: 2.4, z: 0, facing: 1, w: 1.6, h: 0.4, text: "BioArd'Aisne", sub: 'Zone de test', style: 'plaque', icon: 'logo' });

  // Decoration
  b.prim('cyl', 8, 0.6, 9, 0.6, 1.2, 0.6, 'metal_blue', { collide: true });
  b.prim('cyl', -8, 0.6, -9, 0.6, 1.2, 0.6, 'metal_red', { collide: true });

  // Lights
  b.light(0, 4.5, 0, 0xfff4e0, 1.4, 18);
  b.light(-9, 4.5, 10, 0xfff4e0, 1.2, 16);
  b.light(9, 4.5, -10, 0xfff4e0, 1.2, 16);

  // Spawns: team 0 on the -Z side, team 1 on the +Z side
  for (let i = 0; i < 6; i++) {
    b.spawn(0, -7.5 + i * 3, 0, -13, 180);
    b.spawn(1, -7.5 + i * 3, 0, 13, 0);
  }
  b.point('poi', 'centre', 0, 0, 3.5, 'Centre');
  b.point('poi', 'passerelle', 13.5, 2, 0, 'Passerelle');
  b.point('poi', 'cabanon', -11.5, 0, 0, 'Cabanon');

  return b.build();
}
