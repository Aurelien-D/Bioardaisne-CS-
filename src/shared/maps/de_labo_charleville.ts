/**
 * de_labo_charleville — laboratoire inspiré du site du cours Briand (Charleville-Mézières).
 *
 * L'organisation s'inspire des plans du site (grand plateau de l'ancien magasin,
 * bureaux, annexe basse, étage de bureaux avec terrasse) mais reste volontairement
 * approximative : échelle agrandie, circulations élargies, accès secondaires inventés,
 * aucun dispositif de sécurité représenté.
 *
 * Repère : X 0→45 (le long de la rue), Z 0→40 (cour arrière → rue). Bâtiment X 3→42, Z 8→33.
 * Niveaux : rez-de-chaussée 0, étage +4,0 m.
 */
import { MapBuilder } from './builder';
import { ceiling, ceilingLights, doorLeaf, floor, railing, stairs, wall, type Opening } from './helpers';
import type { MaterialId } from './materials';
import { placeProp } from './props';
import type { MapData, MapMeta } from './types';

export const meta: MapMeta = {
  id: 'de_labo_charleville',
  name: 'Laboratoire — Cours Briand',
  description: 'Plateau technique, accueil, boxes de prélèvement, bureaux à l’étage et terrasse : le labo de Charleville comme vous ne l’avez jamais validé.',
  // Les zones « site » / « extract » et les points « sample » sont déjà posés pour les futurs modes à objectif.
  modes: ['tdm'],
  players: [4, 12],
};

const H0 = 3.6; // ground-floor ceiling
const F1 = 4.0; // upper-floor level
const H1 = 7.0; // upper-floor ceiling (absolute)
const ROAD = -0.12; // carriageway level, one kerb below the pavement

export function build(): MapData {
  const b = new MapBuilder(meta, {
    // Fin d'après-midi : soleil bas et chaud dans l'axe du cours (ouest-sud-ouest), brume légère.
    skyTop: 0x41679f,
    skyHorizon: 0xf0c9a0,
    sunDir: { x: -0.72, y: 0.5, z: 0.38 },
    sunColor: 0xffd2a0,
    sunIntensity: 1,
    ambientSky: 0xb9c8e6,
    ambientGround: 0x7a6a5a,
    ambientIntensity: 0.42,
    fogColor: 0xcfae8e,
    fogNear: 60,
    fogFar: 230,
  });

  const door = (at: number, width = 1.4, height = 2.2): Opening => ({ at, width, height, frame: 'metal_white' });
  /** Baie de vitrine (l'ancien magasin) : grand vitrage dans un cadre aluminium sombre. */
  const shop = (at: number, width: number, fill: 'glass' | 'frosted' = 'glass'): Opening => ({ at, width, height: 2.55, sill: 0.35, fill, frame: 'metal_dark' });
  const win = (at: number, width = 2, sill = 0.9, height = 1.5): Opening => ({ at, width, height, sill, fill: 'glass', frame: 'metal_white' });
  /** Ground-floor wall. */
  /** `inner` = material of the interior face: [side, material] with side 'pos' (+X / +Z) or 'neg'. */
  const W = (x0: number, z0: number, x1: number, z1: number, mat: MaterialId, openings: Opening[] = [], height = H0, y = 0, inner?: ['pos' | 'neg', MaterialId]): void => {
    // Finitions intérieures : plinthe partout, bande de protection murale au rez-de-chaussée (locaux de soins).
    const side = inner ? inner[0] : 'both';
    wall(b, {
      x0, z0, x1, z1, y, height, thickness: 0.25, mat, openings,
      matPos: inner?.[0] === 'pos' ? inner[1] : undefined,
      matNeg: inner?.[0] === 'neg' ? inner[1] : undefined,
      skirting: { mat: 'plastic_grey', side, height: 0.1 },
      bands: y === 0 && height > 2 ? [{ mat: 'plastic_grey', y: 0.86, height: 0.14, side, depth: 0.022 }] : [],
    });
  };
  /** Détail décoratif sans collision. */
  const D = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: MaterialId): void => {
    b.box(x0, y0, z0, x1, y1, z1, mat, { solid: false, detail: true });
  };
  const P = (id: string, x: number, z: number, q = 0, y = 0, anchor: 'center' | 'back' = 'center'): void => {
    placeProp(b, id, x, y, z, q, anchor);
  };

  // =====================================================================================
  // Sols extérieurs et enceinte
  // =====================================================================================
  floor(b, { x0: -1, z0: -1, x1: 46, z1: 8, y: 0, thickness: 0.5, mat: 'asphalt' }); // cour arrière
  floor(b, { x0: -1, z0: 8, x1: 3, z1: 33, y: 0, thickness: 0.5, mat: 'gravel' }); // passage ouest
  floor(b, { x0: 31, z0: 8, x1: 36, z1: 17, y: 0, thickness: 0.5, mat: 'sidewalk' }); // courette
  floor(b, { x0: -1, z0: 33, x1: 46, z1: 36, y: 0, thickness: 0.5, mat: 'sidewalk' }); // trottoir
  floor(b, { x0: -1, z0: 36, x1: 46, z1: 41, y: ROAD, thickness: 0.5, mat: 'asphalt' }); // contre-allée, en contrebas du trottoir
  D(-1, ROAD, 35.84, 46, 0.012, 36.03, 'stone_grey'); // bordure de trottoir
  // Murs d'enceinte (immeubles voisins)
  b.box(-1, 0, -1, 46, 9, 0, 'brick_red');
  b.box(-1, -0.7, 40, 46, 9, 41, 'facade_cream', { faces: { nz: 'facade_cream' } });
  b.box(-1, -0.7, 0, 0, 9, 40, 'facade_grey');
  b.box(45, -0.7, 0, 46, 9, 40, 'brick_brown');
  b.box(42, 0, 8, 45, 9, 33, 'facade_grey'); // pignon voisin à l'est
  for (let i = 0; i < 7; i++) {
    b.box(3 + i * 6, 3.2, 40 - 0.02, 5 + i * 6, 5.6, 40, 'window_facade', { solid: false, detail: true });
    b.box(3 + i * 6, 6.2, 40 - 0.02, 5 + i * 6, 8.4, 40, 'window_facade', { solid: false, detail: true });
    b.box(3 + i * 6, 0.3, 40 - 0.02, 5.4 + i * 6, 2.7, 40, i % 2 ? 'shopfront' : 'shutter', { solid: false, detail: true });
    // Appuis de fenêtre, linteaux et bandeau d'enseigne des immeubles d'en face
    for (const wy of [3.2, 6.2]) {
      D(2.9 + i * 6, wy - 0.12, 39.9, 5.1 + i * 6, wy, 40, 'stone_white');
      D(2.95 + i * 6, wy + (wy < 4 ? 2.4 : 2.2), 39.94, 5.05 + i * 6, wy + (wy < 4 ? 2.52 : 2.32), 40, 'stone_white');
    }
    D(2.9 + i * 6, 2.7, 39.88, 5.5 + i * 6, 3.0, 40, i % 2 ? 'metal_dark' : 'metal_grey');
  }
  D(-1, -0.12, 39.93, 46, 0.3, 40, 'stone_grey'); // soubassement d'en face
  D(-1, 8.55, 39.82, 46, 8.8, 40, 'stone_white'); // corniche d'en face
  D(-1, 5.82, 39.94, 46, 5.96, 40, 'stone_white'); // bandeau d'étage

  // =====================================================================================
  // Rez-de-chaussée : sols
  // =====================================================================================
  floor(b, { x0: 3, z0: 15, x1: 18, z1: 33, y: 0.02, thickness: 0.3, mat: 'lino_green' }); // plateau technique
  floor(b, { x0: 3, z0: 8, x1: 18, z1: 15, y: 0.02, thickness: 0.3, mat: 'lino_grey' }); // laverie / réserve
  floor(b, { x0: 18, z0: 8, x1: 31, z1: 15, y: 0.02, thickness: 0.3, mat: 'carpet_grey' }); // bureaux des biologistes
  floor(b, { x0: 18, z0: 15, x1: 31, z1: 19, y: 0.02, thickness: 0.3, mat: 'lino_grey' }); // tri + boxes
  floor(b, { x0: 18, z0: 19, x1: 31, z1: 22, y: 0.02, thickness: 0.3, mat: 'lino_blue' }); // couloir des prélèvements
  floor(b, { x0: 18, z0: 22, x1: 31, z1: 33, y: 0.02, thickness: 0.3, mat: 'tile_beige' }); // accueil + attente
  floor(b, { x0: 31, z0: 17, x1: 36, z1: 33, y: 0.02, thickness: 0.3, mat: 'tile_white' }); // hall + porche
  floor(b, { x0: 36, z0: 8, x1: 42, z1: 33, y: 0.02, thickness: 0.3, mat: 'lino_grey' }); // annexe

  // =====================================================================================
  // Rez-de-chaussée : murs extérieurs
  // =====================================================================================
  // Façade sur rue (Z = 33) : vitrine de l'accueil, porche, dépôt
  W(3, 33, 18, 33, 'facade_cream', [shop(2.9, 3.6, 'frosted'), shop(7.5, 3.6, 'frosted'), shop(12.1, 3.6, 'frosted')], 5.4, 0, ['neg', 'plaster_green']);
  W(18, 33, 31, 33, 'facade_cream', [shop(2.4, 3.6), door(6.5, 2.5, 2.4), shop(10.6, 3.6)], H0, 0, ['neg', 'plaster_white']);
  W(36, 33, 42, 33, 'facade_cream', [door(2.5, 1.5)], 3.0, 0, ['neg', 'plaster_cream']);
  // Porche : ouvert sur la rue, porte double vers le hall en retrait (Z = 30)
  W(31, 30, 36, 30, 'plaster_white', [door(2.5, 2.2, 2.4)]);
  // Façade arrière (Z = 8)
  W(3, 8, 18, 8, 'brick_red', [door(10, 2.2, 2.4)], H0, 0, ['pos', 'plaster_grey']);
  W(18, 8, 31, 8, 'brick_red', [win(2.5, 2.4), door(6, 1.4), win(10, 2.4)], H0, 0, ['pos', 'plaster_white']);
  W(36, 8, 42, 8, 'brick_red', [door(3, 1.4)], 3.0, 0, ['pos', 'plaster_cream']);
  // Pignon ouest (X = 3) et retours de la courette
  W(3, 8, 3, 33, 'brick_red', [door(22, 1.4)], 5.4, 0, ['pos', 'plaster_green']);
  W(31, 8, 31, 17, 'brick_red', [], H0, 0, ['neg', 'plaster_white']);
  W(36, 8, 36, 17, 'brick_red', [], 3.0, 0, ['pos', 'plaster_cream']);
  W(31, 17, 36, 17, 'brick_red', [door(2.5, 1.5)], H0, 0, ['pos', 'plaster_white']);

  // =====================================================================================
  // Rez-de-chaussée : cloisons
  // =====================================================================================
  // Plateau technique / laverie (grande ouverture sous poutre)
  W(3, 15, 18, 15, 'plaster_green', [door(7.5, 3.2, 2.8)], 5.0);
  // Plateau technique ↔ couloir des prélèvements, accueil
  W(18, 15, 18, 33, 'plaster_green', [door(5.5, 2, 2.3), door(11.75, 1.6, 2.3)], 5.0);
  // Laverie ↔ bureaux
  W(18, 8, 18, 15, 'plaster_white', [door(3.5, 1.4)]);
  // Bureaux ↔ tri / boxes
  W(18, 15, 31, 15, 'plaster_white', [door(2, 1.4)]);
  // Boxes de prélèvement (S3, S2, S1) : cloisons et portes sur le couloir
  W(22, 15, 22, 19, 'wall_lab_panel', []);
  W(25, 15, 25, 19, 'wall_lab_panel', []);
  W(28, 15, 28, 19, 'wall_lab_panel', []);
  W(22, 19, 31, 19, 'wall_lab_panel', [door(1.5, 1.2), door(4.5, 1.2), door(7.5, 1.2)]);
  // Couloir ↔ accueil
  W(18, 22, 31, 22, 'plaster_white', [door(9.5, 1.6, 2.3)]);
  // Hall : côté accueil / couloir, côté annexe
  W(31, 17, 31, 33, 'plaster_white', [door(3.5, 1.5), door(6.5, 1.5, 2.3)]);
  W(36, 17, 36, 33, 'plaster_white', [door(2.5, 1.4)]);
  // Annexe : salle de repos / couloir-réserve / dépôt
  W(36, 16, 42, 16, 'plaster_cream', [door(3, 1.4)], 2.75);
  W(36, 25, 42, 25, 'plaster_cream', [door(3, 1.4)], 2.75);

  // Poteaux du plateau et de l'accueil
  for (const [px, pz] of [[8, 21], [13, 21], [8, 28], [13, 28], [24.5, 25], [24.5, 29.5]] as const) {
    b.box(px - 0.25, 0, pz - 0.25, px + 0.25, px < 18 ? 5 : H0, pz + 0.25, 'plaster_white');
    D(px - 0.27, 0, pz - 0.27, px + 0.27, 0.1, pz + 0.27, 'plastic_grey'); // plinthe
    D(px - 0.265, 0.86, pz - 0.265, px + 0.265, 1.0, pz + 0.265, 'plastic_grey'); // protection d'angle
  }

  // Façade sur rue : soubassement en pierre, bandeau d'étage, corniches, auvent, descentes d'eau
  for (const [xa, xb] of [[3, 23.25], [25.75, 31], [36, 37.75], [39.25, 42]] as const) D(xa, 0, 33.125, xb, 0.35, 33.175, 'stone_grey');
  D(18, 3.58, 33.125, 36, 3.8, 33.21, 'stone_white');
  D(3, 5.22, 33.125, 18, 5.45, 33.25, 'stone_white');
  D(18, 6.8, 33.125, 36, 7.05, 33.25, 'stone_white');
  D(36, 2.82, 33.125, 42, 3.05, 33.23, 'stone_white');
  D(22.9, 2.62, 33.125, 26.1, 2.7, 34.25, 'metal_dark'); // auvent de l'entrée
  D(22.9, 2.7, 33.125, 22.94, 3.2, 34.2, 'metal_dark');
  D(26.06, 2.7, 33.125, 26.1, 3.2, 34.2, 'metal_dark');
  for (const px of [18.02, 35.9]) D(px, 0, 33.125, px + 0.1, 6.8, 33.225, 'metal_dark');
  for (const lx of [22.65, 26.25]) D(lx, 2.05, 33.125, lx + 0.12, 2.35, 33.2, 'light_warm'); // appliques de l'entrée
  b.light(24.5, 2.3, 34.1, 0xffe2b8, 0.7, 6);
  // Façade arrière : soubassement béton, appliques au-dessus des portes
  for (const [xa, xb] of [[3, 11.9], [14.1, 23.3], [24.7, 31], [36, 38.3], [39.7, 42]] as const) D(xa, 0, 7.84, xb, 0.3, 7.875, 'concrete');
  for (const lx of [13, 24, 39]) {
    D(lx - 0.18, 2.55, 7.78, lx + 0.18, 2.67, 7.875, 'light_warm');
    b.light(lx, 2.4, 7.3, 0xffe2b8, 0.6, 6);
  }

  // =====================================================================================
  // Plafonds du rez-de-chaussée / plancher de l'étage / toitures
  // =====================================================================================
  // Plateau technique : plafond haut (5,0 m), toiture inaccessible
  ceiling(b, { x0: 3, z0: 15, x1: 18, z1: 33, y: 5.0, thickness: 0.4, mat: 'ceiling_tile', otherMat: 'gravel' });
  // Laverie : toit-terrasse à +4,0 avec lanterneau ouvert
  ceiling(b, { x0: 3, z0: 8, x1: 18, z1: 15, y: H0, thickness: 0.4, mat: 'concrete', otherMat: 'sidewalk', holes: [{ x0: 9, z0: 10.5, x1: 11, z1: 12.5 }] });
  // Bureaux, tri, boxes, couloir, accueil : dalle de l'étage
  ceiling(b, { x0: 18, z0: 8, x1: 31, z1: 33, y: H0, thickness: 0.4, mat: 'ceiling_tile', otherMat: 'lino_grey' });
  // Hall : dalle avec trémie d'escalier
  ceiling(b, { x0: 31, z0: 17, x1: 36, z1: 33, y: H0, thickness: 0.4, mat: 'ceiling_tile', otherMat: 'tile_white', holes: [{ x0: 31.25, z0: 24.1, x1: 33.3, z1: 29.6 }] });
  // Annexe : toit bas
  ceiling(b, { x0: 36, z0: 8, x1: 42, z1: 33, y: 2.75, thickness: 0.3, mat: 'ceiling_tile', otherMat: 'gravel' });

  // =====================================================================================
  // Escaliers
  // =====================================================================================
  // Escalier principal du hall : volée droite montant vers -Z
  stairs(b, { x: 32.25, y: 0.02, z: 29.4, dir: 2, width: 1.9, rise: F1 - 0.02, stepDepth: 0.33, mat: 'plaster_white', treadMat: 'tile_white', right: 'rail' });
  railing(b, { x0: 33.35, z0: 24.1, x1: 33.35, z1: 29.6, y: F1, height: 1.05, style: 'glass' });
  railing(b, { x0: 31.25, z0: 29.65, x1: 33.4, z1: 29.65, y: F1, height: 1.05, style: 'glass' });
  // Escalier métallique extérieur : de la cour à la terrasse, le long de la façade arrière
  stairs(b, { x: 3.8, y: 0, z: 7.1, dir: 1, width: 1.5, rise: F1, stepDepth: 0.33, mat: 'metal_grate', open: true, left: 'rail' });
  b.box(9.05, F1 - 0.15, 6.3, 12.2, F1, 8, 'metal_grate'); // palier d'arrivée
  b.box(11.2, 0, 6.3, 11.4, F1 - 0.15, 6.5, 'metal_dark');
  b.box(12, 0, 6.3, 12.2, F1 - 0.15, 6.5, 'metal_dark');

  // =====================================================================================
  // Étage (+4,0) : bureaux, secrétariat, salle de réunion, terrasse
  // =====================================================================================
  const W1 = (x0: number, z0: number, x1: number, z1: number, mat: MaterialId, openings: Opening[] = [], inner?: ['pos' | 'neg', MaterialId]): void => W(x0, z0, x1, z1, mat, openings, H1 - F1, F1, inner);
  // Enveloppe
  W1(18, 33, 36, 33, 'facade_cream', [win(2.5, 2.2), win(7, 2.2), win(11.5, 2.2), win(15.5, 2.2)], ['neg', 'plaster_white']);
  W1(18, 8, 31, 8, 'brick_red', [win(3, 2.2), win(9.5, 2.2)], ['pos', 'plaster_white']);
  W1(18, 8, 18, 33, 'facade_cream', [door(3.5, 1.4), win(8.5, 2), win(18, 2.4)], ['pos', 'plaster_white']);
  W1(31, 8, 31, 17, 'brick_red', [], ['neg', 'plaster_white']);
  W1(31, 17, 36, 17, 'brick_red', [win(2.5, 2.4)], ['pos', 'plaster_white']);
  W1(36, 17, 36, 33, 'facade_cream', [win(5, 2.2), win(11, 2.2)], ['neg', 'plaster_white']);
  // Cloisons : couloir central (Z 19→22), bureaux au nord, secrétariat et réunion au sud
  W1(18, 19, 31, 19, 'plaster_white', [door(3, 1.4), door(10, 1.4)]);
  W1(18, 22, 31, 22, 'plaster_white', [door(3.5, 1.4), door(9.5, 1.4)]);
  W1(24.5, 8, 24.5, 19, 'plaster_white', [door(5.5, 1.3)]);
  W1(24.5, 22, 24.5, 33, 'plaster_white', [door(5, 1.3)]);
  W1(31, 17, 31, 33, 'plaster_white', [door(3.5, 2.4, 2.3)]);
  ceiling(b, { x0: 18, z0: 8, x1: 31, z1: 33, y: H1, thickness: 0.3, mat: 'ceiling_tile', otherMat: 'gravel' });
  ceiling(b, { x0: 31, z0: 17, x1: 36, z1: 33, y: H1, thickness: 0.3, mat: 'ceiling_tile', otherMat: 'gravel' });
  floor(b, { x0: 18, z0: 19, x1: 31, z1: 22, y: F1 + 0.01, thickness: 0.02, mat: 'carpet_grey', solid: false });
  floor(b, { x0: 18, z0: 22, x1: 31, z1: 33, y: F1 + 0.01, thickness: 0.02, mat: 'carpet_grey', solid: false });
  // Terrasse (toit de la laverie) : garde-corps, ouverture face au palier de l'escalier extérieur
  railing(b, { x0: 3, z0: 8.05, x1: 10.4, z1: 8.05, y: F1, height: 1.05 });
  railing(b, { x0: 12.2, z0: 8.05, x1: 18, z1: 8.05, y: F1, height: 1.05 });
  railing(b, { x0: 3.05, z0: 8, x1: 3.05, z1: 15, y: F1, height: 1.05 });
  b.box(3, F1, 15, 18, 5.4, 15.25, 'facade_cream'); // acrotère du plateau
  // Terrasse : mobilier
  P('plant_large', 16.8, 9.2, 0, F1);
  P('coffee_table', 6, 11.5, 0, F1);
  P('visitor_chair', 5, 11.5, 1, F1);
  P('visitor_chair', 7, 11.5, 3, F1);
  b.box(13, F1, 13.2, 15.5, F1 + 1.0, 14.2, 'metal_grey'); // groupe de ventilation (couvert)

  // =====================================================================================
  // Éclairage
  // =====================================================================================
  ceilingLights(b, { x0: 4, z0: 16, x1: 17, z1: 32 }, 4.2, 5.0, { intensity: 1.5, range: 11 });
  ceilingLights(b, { x0: 4, z0: 9, x1: 17, z1: 14 }, 4.5, H0, { intensity: 0.9 });
  ceilingLights(b, { x0: 19, z0: 9, x1: 30, z1: 14 }, 4, H0);
  ceilingLights(b, { x0: 19, z0: 16, x1: 30, z1: 18 }, 3, H0);
  ceilingLights(b, { x0: 19, z0: 19.5, x1: 30, z1: 21.5 }, 4, H0);
  ceilingLights(b, { x0: 19, z0: 23, x1: 30, z1: 32 }, 4, H0, { intensity: 1.2 });
  ceilingLights(b, { x0: 33.6, z0: 18, x1: 35.6, z1: 29 }, 4, H0);
  for (const [za, zb] of [[9, 15], [17, 24], [26, 32]] as const) ceilingLights(b, { x0: 37, z0: za, x1: 41, z1: zb }, 4.5, 2.75, { intensity: 0.8, range: 7 });
  ceilingLights(b, { x0: 19, z0: 9, x1: 30, z1: 32 }, 4.5, H1);
  ceilingLights(b, { x0: 31.5, z0: 18, x1: 35.5, z1: 32 }, 5, H1);
  b.light(33.5, 3, 31.5, 0xfff0d0, 0.8, 8); // porche

  // Ventilation : bouches de soufflage au plafond des locaux à faux plafond
  const vents = (x0: number, z0: number, x1: number, z1: number, y: number, step = 4.5): void => {
    const nx = Math.max(1, Math.round((x1 - x0) / step));
    const nz = Math.max(1, Math.round((z1 - z0) / step));
    for (let i = 0; i < nx; i++) {
      for (let k = 0; k < nz; k++) {
        const vx = x0 + ((i + 0.5) * (x1 - x0)) / nx + 1.1;
        const vz = z0 + ((k + 0.5) * (z1 - z0)) / nz + 0.9;
        if (vx > x1 - 0.4 || vz > z1 - 0.4) continue;
        D(vx - 0.3, y - 0.025, vz - 0.3, vx + 0.3, y, vz + 0.3, 'metal_white');
        D(vx - 0.22, y - 0.035, vz - 0.22, vx + 0.22, y - 0.025, vz + 0.22, 'metal_grey');
      }
    }
  };
  vents(19, 9, 30, 14, H0);
  vents(19, 23, 30, 32, H0);
  vents(19, 19.5, 30, 21.5, H0, 5.5);
  vents(33.6, 18, 35.6, 29, H0, 5.5);
  vents(19, 9, 30, 18, H1);
  vents(19, 23, 30, 32, H1);
  // Plateau technique (5 m sous plafond) : gaine de ventilation apparente, piquages et chemin de câbles
  D(4.2, 4.25, 23.7, 17.4, 4.7, 24.3, 'metal_brushed');
  for (const dx of [6, 9.5, 13, 16.2]) {
    D(dx - 0.2, 3.95, 23.8, dx + 0.2, 4.25, 24.2, 'metal_brushed');
    D(dx - 0.32, 3.9, 23.68, dx + 0.32, 3.95, 24.32, 'metal_white');
    D(dx - 0.02, 4.7, 23.98, dx + 0.02, 5.0, 24.02, 'metal_dark'); // suspente
  }
  D(3.35, 3.6, 15.4, 3.65, 3.66, 32.8, 'metal_grey'); // chemin de câbles le long du pignon
  D(3.35, 3.66, 15.4, 3.38, 3.74, 32.8, 'metal_grey');
  D(3.62, 3.66, 15.4, 3.65, 3.74, 32.8, 'metal_grey');
  for (let cz = 16.5; cz < 32.8; cz += 2.6) D(3.13, 3.5, cz - 0.03, 3.65, 3.6, cz + 0.03, 'metal_dark');
  // Laverie / réserve : tuyauteries le long du mur du fond et descente vers l'évier
  for (const [py, pm] of [[3.1, 'metal_red'], [3.25, 'metal_brushed'], [3.4, 'metal_blue']] as const) D(3.3, py, 8.2, 17.8, py + 0.07, 8.27, pm);
  D(7.9, 1.2, 8.2, 7.97, 3.1, 8.27, 'metal_brushed');
  D(8.1, 1.2, 8.2, 8.17, 3.4, 8.27, 'metal_blue');

  // =====================================================================================
  // Mobilier : plateau technique (site A)
  // =====================================================================================
  P('analyser_large', 6.5, 19, 0);
  P('analyser_large', 10.6, 24.5, 2);
  P('analyser_large', 14.5, 30.5, 2);
  P('conveyor', 10.5, 19, 0);
  P('conveyor', 12.5, 19, 0);
  P('island_bench', 10.5, 28, 1);
  P('lab_bench_shelf', 3.13, 18.5, 1, 0, 'back');
  P('lab_bench', 3.13, 22, 1, 0, 'back');
  P('lab_bench_sink', 3.13, 25, 1, 0, 'back');
  P('lab_bench', 3.13, 29, 1, 0, 'back');
  P('lab_fridge', 17.87, 16.2, 3, 0, 'back');
  P('freezer', 17.87, 17.4, 3, 0, 'back');
  P('centrifuge_floor', 15.5, 23.5, 0);
  P('fume_hood', 6.5, 32.87, 2, 0, 'back');
  P('reagent_cabinet', 9.5, 32.87, 2, 0, 'back');
  P('trolley', 13.5, 26, 1);
  P('clinical_waste_bin', 16.8, 30.8, 0);
  P('analyser_bench', 3.58, 22, 1, 0.9);
  P('microscope', 3.58, 28.6, 1, 0.9);
  P('tube_rack', 3.58, 29.5, 1, 0.9);
  P('centrifuge_bench', 3.58, 25.6, 1, 0.9);
  // Laverie / réserve
  P('storage_shelf', 3.13, 9.6, 1, 0, 'back');
  P('storage_shelf', 3.13, 11.2, 1, 0, 'back');
  P('storage_shelf', 3.13, 12.8, 1, 0, 'back');
  P('pallet_loaded', 15.5, 10, 0);
  P('carton_stack', 14, 13.6, 0);
  P('crate_stack', 7, 13.9, 0);
  P('pallet_jack', 12.8, 12.2, 1);
  P('gas_cylinder', 17.3, 14.2, 0);
  P('lab_bench_sink', 7.5, 8.13, 0, 0, 'back');
  // Bureaux des biologistes
  P('workstation', 21, 10, 0);
  P('workstation', 27.5, 10, 0);
  P('corner_desk', 29.5, 13.4, 3);
  P('office_chair', 28.6, 13.2, 1);
  P('binder_shelf', 30.87, 9.5, 3, 0, 'back');
  P('office_cupboard', 18.13, 13.5, 1, 0, 'back');
  P('photocopier', 23.2, 14.2, 2);
  P('plant_small', 30.2, 14.2, 0);
  // Tri
  P('lab_bench', 18.13, 17, 1, 0, 'back');
  P('label_printer', 18.45, 16.6, 1, 0.9);
  P('tube_box', 18.45, 17.5, 1, 0.9);
  P('transport_crate', 21.3, 18.3, 0);
  // Boxes de prélèvement
  for (const x of [23.5, 26.5, 29.5]) {
    P('phlebotomy_chair', x - 0.3, 16.2, 0);
    P('sampling_trolley', x + 0.9, 16.4, 3);
    P('sharps_box', x + 0.9, 16.4, 0, 1.05);
  }
  P('wall_cabinet', 23.5, 15.13, 0, 0, 'back');
  P('wash_basin', 29.5, 15.13, 0, 0, 'back');
  // Couloir des prélèvements
  P('gel_stand', 21.2, 21.5, 0);
  P('waiting_chairs_3', 25.5, 21.87, 2, 0, 'back');
  // Accueil + attente
  P('reception_desk_l', 21, 25.5, 1);
  P('ticket_kiosk', 25.6, 31.4, 2);
  P('waiting_chairs_4', 29.6, 22.13, 0, 0, 'back');
  P('waiting_chairs_4', 30.87, 26.5, 3, 0, 'back');
  P('waiting_chairs_3', 27.5, 28.5, 0);
  P('coffee_table', 28, 25.8, 0);
  P('water_dispenser', 30.87, 31.6, 3, 0, 'back');
  P('magazine_rack', 30.87, 29.4, 3, 0, 'back');
  P('plant_large', 19, 32, 0);
  P('plant_small', 19, 23, 0);
  P('call_screen', 24.5, 22.13, 0, 0, 'back');
  P('privacy_screen', 22.5, 29.2, 0);
  // Hall
  P('plant_large', 35.2, 29, 0);
  P('fire_extinguisher', 35.87, 22, 3, 0, 'back');
  b.box(33.9, 0, 17.3, 35.7, 2.4, 17.5, 'metal_brushed', { detail: true, solid: false }); // ascenseur (décor)
  // Annexe
  P('kitchen_counter', 41.99, 10, 3, 0, 'back');
  P('kitchen_fridge', 41.99, 12, 3, 0, 'back');
  P('meeting_table', 38.7, 12, 0);
  P('lockers', 36.13, 14.5, 1, 0, 'back');
  P('storage_shelf', 41.99, 18, 3, 0, 'back');
  P('storage_shelf', 41.99, 20, 3, 0, 'back');
  P('carton_stack', 40.5, 23.5, 0);
  P('pallet_loaded', 40.5, 27.5, 0);
  P('crate_stack', 37, 31.5, 0);
  P('transport_crate', 39.5, 31.8, 0);
  P('sample_cooler', 38.5, 26, 0);
  // Étage : bureaux (nord), secrétariat et salle de réunion (sud)
  P('desk', 20.5, 11, 0, F1);
  P('office_chair', 20.5, 10.1, 0, F1);
  P('computer_set', 20.5, 11.1, 2, F1 + 0.74);
  P('office_cupboard', 24.37, 16.5, 3, F1, 'back');
  P('corner_desk', 28, 10.5, 0, F1);
  P('office_chair', 27.6, 9.6, 0, F1);
  P('sofa', 29.5, 18.87, 2, F1, 'back');
  P('binder_shelf', 24.63, 10.2, 1, F1, 'back');
  P('workstation', 21, 27, 1, F1);
  P('desk', 21.5, 31.5, 2, F1);
  P('photocopier', 23.6, 23, 0, F1);
  P('meeting_table', 27.8, 28, 1, F1);
  P('whiteboard', 30.87, 28, 3, F1, 'back');
  P('plant_small', 25.2, 32.3, 0, F1);
  P('kitchen_counter', 35.87, 19.5, 3, F1, 'back');
  P('coffee_machine', 35.6, 19.5, 3, F1 + 0.9);
  P('plant_large', 35, 31.8, 0, F1);

  // Battants de porte, ouverts et repliés contre les murs (décor, sans collision)
  const leaf = (x: number, z: number, axis: 'x' | 'z', width: number, hinge: 'low' | 'high', swing: 'pos' | 'neg', y = 0, mat: MaterialId = 'door_white', glazed = false, height = 2.15): void => {
    doorLeaf(b, { x, z, y, axis, width, height, wallThickness: 0.25, hinge, swing, open: 180, mat, glazed });
  };
  /** Deux vantaux d'une porte double. */
  const leaves = (x: number, z: number, axis: 'x' | 'z', width: number, swing: 'pos' | 'neg', y = 0, mat: MaterialId = 'door_white', glazed = true, height = 2.25): void => {
    const h = width / 4;
    if (axis === 'z') {
      leaf(x, z - h, axis, width / 2, 'low', swing, y, mat, glazed, height);
      leaf(x, z + h, axis, width / 2, 'high', swing, y, mat, glazed, height);
    } else {
      leaf(x - h, z, axis, width / 2, 'low', swing, y, mat, glazed, height);
      leaf(x + h, z, axis, width / 2, 'high', swing, y, mat, glazed, height);
    }
  };
  leaves(18, 20.5, 'z', 2, 'neg'); // plateau technique ↔ couloir
  leaves(18, 26.75, 'z', 1.6, 'neg'); // plateau technique ↔ accueil
  leaf(18, 11.5, 'z', 1.4, 'high', 'neg'); // laverie ↔ bureaux
  leaf(20, 15, 'x', 1.4, 'high', 'neg'); // bureaux ↔ tri
  leaves(31, 20.5, 'z', 1.5, 'pos'); // couloir ↔ hall
  leaf(36, 19.5, 'z', 1.4, 'high', 'pos'); // hall ↔ annexe
  leaf(39, 16, 'x', 1.4, 'high', 'pos'); // salle de repos ↔ réserve
  leaf(39, 25, 'x', 1.4, 'low', 'neg'); // réserve ↔ dépôt
  leaf(24, 8, 'x', 1.4, 'high', 'neg', 0, 'door_metal'); // bureaux → cour
  leaf(39, 8, 'x', 1.4, 'low', 'neg', 0, 'door_metal'); // salle de repos → cour
  leaf(38.5, 33, 'x', 1.5, 'high', 'pos', 0, 'door_metal'); // dépôt → rue
  leaf(3, 30, 'z', 1.4, 'low', 'neg', 0, 'door_metal'); // plateau → passage ouest
  leaf(21, 19, 'x', 1.4, 'high', 'pos', F1);
  leaf(28, 19, 'x', 1.4, 'high', 'pos', F1);
  leaf(21.5, 22, 'x', 1.4, 'low', 'neg', F1);
  leaf(27.5, 22, 'x', 1.4, 'low', 'neg', F1);
  leaf(24.5, 13.5, 'z', 1.3, 'high', 'pos', F1);
  leaf(24.5, 27, 'z', 1.3, 'low', 'neg', F1);
  leaf(18, 11.5, 'z', 1.4, 'high', 'neg', F1, 'door_white', true); // bureaux → terrasse
  // Boxes de prélèvement : portes ouvertes à 90° vers l'intérieur
  for (const dx of [23.5, 26.5, 29.5]) doorLeaf(b, { x: dx, z: 19, axis: 'x', width: 1.2, height: 2.15, wallThickness: 0.25, hinge: 'high', swing: 'neg', open: 90, mat: 'door_white' });

  // Compléments de mobilier : bureaux du rez-de-chaussée
  P('workstation', 24.3, 12.9, 2);
  P('office_cupboard', 18.13, 10.4, 1, 0, 'back');
  P('office_cupboard', 18.13, 9.3, 1, 0, 'back');
  P('radiator', 20.5, 8.13, 0, 0, 'back');
  P('radiator', 28, 8.13, 0, 0, 'back');
  P('notice_board', 26, 14.87, 2, 0, 'back');
  P('wall_clock', 24.5, 8.13, 0, 0, 'back');
  P('coat_rack', 19, 14.3, 2);
  P('drawer_unit', 22.1, 10.1, 0);
  P('drawer_unit', 28.6, 10.1, 0);
  // Couloir, accueil, hall
  P('notice_board', 20, 21.87, 2, 0, 'back');
  P('wall_clock', 21, 22.13, 0, 0, 'back');
  P('plant_large', 30.3, 23, 0);
  P('waiting_chairs_3', 35.87, 23.5, 3, 0, 'back');
  P('notice_board', 35.87, 26.5, 3, 0, 'back');
  P('plant_large', 35.2, 18.4, 0);
  // Annexe : salle de repos et réserves
  P('coffee_machine', 41.72, 9.5, 3, 0.9);
  P('microwave', 41.72, 10.5, 3, 0.9);
  P('sofa', 36.13, 10.6, 1, 0, 'back');
  P('plant_small', 36.6, 8.6, 0);
  P('wall_clock', 37.5, 8.13, 0, 0, 'back');
  P('notice_board', 37.2, 15.87, 2, 0, 'back');
  P('storage_shelf', 36.13, 22.3, 1, 0, 'back');
  P('storage_shelf', 36.13, 23.7, 1, 0, 'back');
  P('storage_shelf', 41.99, 22, 3, 0, 'back');
  P('storage_shelf', 41.99, 27, 3, 0, 'back');
  P('storage_shelf', 41.99, 28.4, 3, 0, 'back');
  P('pallet_jack', 38.2, 28.9, 2);
  P('carton_stack', 36.8, 26, 0);
  // Étage : bureaux nord
  P('workstation', 22, 16.2, 2, F1);
  P('office_cupboard', 18.13, 14, 1, F1, 'back');
  P('radiator', 21, 8.13, 0, F1, 'back');
  P('radiator', 27.5, 8.13, 0, F1, 'back');
  P('plant_large', 30.2, 9, 0, F1);
  P('whiteboard', 26.6, 18.87, 2, F1, 'back');
  P('coffee_table', 29.5, 17.2, 0, F1);
  P('visitor_chair', 28.2, 12.3, 2, F1);
  P('drawer_unit', 21.6, 11.1, 0, F1);
  // Étage : couloir, secrétariat, salle de réunion
  P('plant_small', 30.4, 20.5, 0, F1);
  P('notice_board', 24.6, 19.13, 0, F1, 'back');
  P('fire_extinguisher', 24, 21.87, 2, F1, 'back');
  P('office_cupboard', 18.13, 30, 1, F1, 'back');
  P('office_cupboard', 18.13, 31.1, 1, F1, 'back');
  P('plant_small', 18.6, 22.7, 0, F1);
  P('office_chair', 21.5, 30.6, 0, F1);
  P('computer_set', 21.5, 31.4, 0, F1 + 0.74);
  P('radiator', 21, 32.87, 2, F1, 'back');
  P('radiator', 27.5, 32.87, 2, F1, 'back');
  P('office_cupboard', 24.63, 31.3, 1, F1, 'back');
  P('wall_clock', 27.8, 22.13, 0, F1, 'back');

  // =====================================================================================
  // Extérieur : cour arrière, passage, rue
  // =====================================================================================
  // Les objets de l'extérieur sont de vrais modèles 3D (maps/models.ts) posés avec b.model() ;
  // les collisions restent des boîtes invisibles, aux emplacements des anciens volumes.
  // Fourgon de la navette (cour) : fourgon blanc de 5 m, l'avant vers +X
  // Garé le long de la façade arrière, entre la porte de livraison et les fenêtres des bureaux :
  // la cour reste dégagée devant les apparitions de l'Équipe Labo.
  b.at(16.7, 0, 6.72, 1, (m) => {
    m.model('van', 0, 0, -0.05);
    m.collider(-1.02, 0, -2.55, 1.02, 2.25, 1.3, 'metal'); // caisse et cabine
    m.collider(-0.97, 0, 1.3, 0.97, 1.4, 2.45, 'metal'); // capot
  });
  b.sign({ x: 15.6, y: 1.5, z: 5.68, facing: 2, w: 2.2, h: 0.7, text: 'bio ard’aisne', sub: 'Navette échantillons', style: 'plaque', icon: 'logo', bg: 0xffffff, color: 0x4a4a49 });
  // Bennes et palettes
  b.model('dumpster_b', 39.5, 0, 1.8);
  b.collider(38.17, 0, 1.12, 40.83, 1.3, 2.48, 'metal');
  b.model('dumpster_a', 35.25, 0, 1.8);
  b.collider(33.9, 0, 1.1, 36.6, 1.3, 2.5, 'metal');
  P('pallet_loaded', 6, 2.5, 0);
  P('pallet_loaded', 9.6, 6.6, 1);
  P('carton_stack', 30, 6.9, 0);
  b.box(42.2, 0, 4.5, 44.6, 2.2, 7.6, 'brick_brown'); // local poubelles
  // Passage ouest : bacs roulants (trois gris contre le mur mitoyen, deux verts contre le pignon)
  for (const bz of [14.45, 15.25, 16.05]) b.model('wheelie_bin_grey', 0.68, 0, bz, 90);
  b.collider(0.34, 0, 14.1, 1.03, 1.08, 16.4, 'plastic');
  for (const bz of [24.55, 25.4]) b.model('wheelie_bin_green', 2.4, 0, bz, -90);
  b.collider(2.05, 0, 24.2, 2.75, 1.08, 25.75, 'plastic');
  P('gas_cylinder', 2.6, 10, 0);
  // Rue : érables d'alignement (tronc sous l'origine du modèle), lampadaires, abribus, voitures
  [5, 14, 23, 32, 41].forEach((tx, i) => {
    b.model('street_tree', tx, 0.1, 35.3, i * 73, 1 - (i % 3) * 0.04);
    b.collider(tx - 0.14, 0, 35.16, tx + 0.14, 3.2, 35.44, 'wood');
    b.box(tx - 0.7, 0, 34.6, tx + 0.7, 0.12, 36, 'dirt', { solid: false, detail: true });
  });
  for (const lx of [9.5, 18.5, 36.5]) {
    b.model('street_lamp', lx, 0, 35.72); // crosse vers la chaussée (+Z)
    b.collider(lx - 0.1, 0, 35.62, lx + 0.1, 6.9, 35.82, 'metal');
  }
  /** Parked car, nose toward +X: `cabin` = [rear, front] of the glasshouse along the car, `half` = half body width. */
  const car = (asset: string, x: number, z: number, half: number, length: number, cabin: [number, number]): void => {
    b.at(x, ROAD, z, 1, (m) => {
      m.model(asset, 0, 0, 0);
      m.collider(-half, 0, -length / 2, half, 0.9, length / 2, 'metal');
      m.collider(-half + 0.1, 0.9, cabin[0], half - 0.1, 1.32, cabin[1], 'glass');
    });
  };
  car('car_wagon', 9.5, 38.4, 0.87, 4.38, [-2.1, 1.0]);
  car('car_sedan', 20.7, 38.6, 0.87, 4.36, [-1.4, 1.0]);
  // Stationnement en long : ligne continue et séparations des places
  D(0, ROAD, 37.44, 45, ROAD + 0.006, 37.56, 'plastic_white');
  for (let bx = 1.1; bx < 45; bx += 5.6) D(bx - 0.06, ROAD, 37.56, bx + 0.06, ROAD + 0.006, 39.9, 'plastic_white');
  car('car_hatchback', 37, 38.4, 0.84, 3.96, [-1.8, 1.0]);
  // Abribus vitré (ouvert vers la chaussée), corbeille, armoire électrique
  b.model('bus_shelter', 28.5, 0, 35.06);
  b.collider(26.46, 0.2, 34.22, 30.54, 2.4, 34.28, 'glass'); // fond vitré
  b.collider(26.42, 2.38, 34.24, 30.58, 2.5, 35.88, 'metal'); // toit
  b.collider(26.44, 0.5, 34.42, 26.6, 2.02, 35.72, 'glass'); // panneau d'affichage
  b.collider(30.47, 0.2, 34.36, 30.53, 2.15, 35.24, 'glass'); // joue vitrée
  b.collider(26.9, 0.4, 34.3, 30.1, 0.54, 34.74, 'metal'); // banc
  b.model('street_bin', 31.15, 0, 34.6);
  b.collider(30.9, 0, 34.35, 31.4, 0.95, 34.85, 'metal');
  b.model('utility_box', 43.5, 0, 33.23);
  b.collider(43.24, 0, 33, 43.76, 1.12, 33.45, 'metal');

  // =====================================================================================
  // Signalétique
  // =====================================================================================
  b.sign({ x: 24.5, y: 3.25, z: 33.14, facing: 0, w: 9, h: 0.6, text: 'LABORATOIRE DE BIOLOGIE MÉDICALE', style: 'shop', bg: 0x6f8496, color: 0xffffff });
  b.sign({ x: 26.3, y: 1.7, z: 33.14, facing: 0, w: 0.9, h: 0.62, text: 'bio ard’aisne', sub: 'LABORATOIRE', style: 'plaque', icon: 'logo', bg: 0xffffff, color: 0x4a4a49 });
  b.sign({ x: 33.5, y: 2.75, z: 30.14, facing: 0, w: 2.2, h: 0.4, text: 'Entrée du personnel', style: 'door' });
  b.sign({ x: 10.5, y: 3.3, z: 14.86, facing: 2, w: 3, h: 0.5, text: 'PLATEAU TECHNIQUE', sub: 'Accès réservé au personnel habilité', style: 'plaque' });
  b.sign({ x: 17.86, y: 2.6, z: 20.5, facing: 3, w: 1.8, h: 0.35, text: 'Prélèvements', style: 'door', icon: 'arrow_right' });
  b.sign({ x: 23.5, y: 2.45, z: 19.14, facing: 0, w: 0.9, h: 0.3, text: 'Salle 3', style: 'door' });
  b.sign({ x: 26.5, y: 2.45, z: 19.14, facing: 0, w: 0.9, h: 0.3, text: 'Salle 2', style: 'door' });
  b.sign({ x: 29.5, y: 2.45, z: 19.14, facing: 0, w: 0.9, h: 0.3, text: 'Salle 1', style: 'door' });
  b.sign({ x: 27.5, y: 2.6, z: 22.14, facing: 0, w: 2, h: 0.4, text: 'Salles de prélèvement', style: 'door', icon: 'arrow_up' });
  b.sign({ x: 18.14, y: 2.7, z: 26.75, facing: 1, w: 2, h: 0.4, text: 'Plateau technique', style: 'door', icon: 'biohazard' });
  b.sign({ x: 21.5, y: 2.3, z: 22.14, facing: 0, w: 1.6, h: 1.1, text: 'Prise de sang', sub: 'Sans rendez-vous · Résultats en ligne', style: 'poster', icon: 'drop' });
  b.sign({ x: 30.86, y: 1.8, z: 28, facing: 3, w: 1.1, h: 1.5, text: 'À jeun ?', sub: 'Glycémie : 8 h sans manger. Le croissant attendra.', style: 'poster', icon: 'tube' });
  b.sign({ x: 18.14, y: 1.8, z: 30.5, facing: 1, w: 1.1, h: 1.5, text: 'Tube hémolysé', sub: 'Ni repris, ni échangé. Merci de votre compréhension.', style: 'poster', icon: 'tube' });
  b.sign({ x: 3.14, y: 2.2, z: 24, facing: 1, w: 1.4, h: 1, text: 'Automate en calibration', sub: 'Ne pas déranger (lui non plus)', style: 'poster' });
  b.sign({ x: 12, y: 3.6, z: 32.86, facing: 2, w: 1.6, h: 1, text: 'Contrôle qualité', sub: 'Passé ce matin. Promis.', style: 'poster' });
  b.sign({ x: 39, y: 2.2, z: 8.14, facing: 0, w: 1.6, h: 0.4, text: 'Salle de repos', style: 'door' });
  b.sign({ x: 41.99, y: 1.7, z: 14, facing: 3, w: 1.2, h: 0.9, text: 'Frigo', sub: 'Yaourts ≠ échantillons', style: 'poster' });
  b.sign({ x: 39, y: 2.2, z: 32.86, facing: 2, w: 1.6, h: 0.4, text: 'Dépôt des échantillons', style: 'door' });
  b.sign({ x: 34.8, y: 1.6, z: 17.52, facing: 0, w: 1.2, h: 0.5, text: 'Ascenseur en panne', sub: 'Depuis l’audit précédent', style: 'poster' });
  b.sign({ x: 21.5, y: F1 + 2.45, z: 21.86, facing: 2, w: 1.6, h: 0.35, text: 'Secrétariat', style: 'door' });
  b.sign({ x: 27.9, y: F1 + 2.4, z: 22.14, facing: 0, w: 1.9, h: 0.35, text: 'Salle de réunion', style: 'door' });
  b.sign({ x: 21, y: F1 + 2.4, z: 18.86, facing: 2, w: 1.6, h: 0.35, text: 'Direction', style: 'door' });
  b.sign({ x: 28, y: F1 + 2.4, z: 18.86, facing: 2, w: 1.6, h: 0.35, text: 'Biologistes', style: 'door' });
  b.sign({ x: 30.86, y: F1 + 1.7, z: 24, facing: 3, w: 1.3, h: 0.9, text: 'Revue de direction', sub: 'Ordre du jour : qui a fini le café ?', style: 'poster' });
  b.sign({ x: 18.14, y: F1 + 2.4, z: 11.5, facing: 1, w: 1.4, h: 0.35, text: 'Terrasse', style: 'door', icon: 'exit' });
  b.sign({ x: 22, y: 3, z: 0.01, facing: 0, w: 3, h: 0.5, text: 'COURS ARISTIDE BRIAND', sub: 'Accès livraisons', style: 'street' });
  b.sign({ x: 13, y: 3.5, z: 39.99, facing: 2, w: 3, h: 0.5, text: 'COURS ARISTIDE BRIAND', style: 'street' });
  b.sign({ x: 28.5, y: 1.7, z: 34.28, facing: 0, w: 1.6, h: 0.9, text: 'Ligne 4', sub: 'Gare · Place Ducale · Cours Briand', style: 'screen', lit: true });

  // =====================================================================================
  // Apparitions, zones et points d'intérêt
  // =====================================================================================
  for (let i = 0; i < 10; i++) {
    b.spawn(0, 3 + i * 3, 0.05, 1.2, 180); // Équipe Labo : cour arrière
    b.spawn(1, 4.5 + i * 3.6, ROAD + 0.05, i % 2 ? 36.5 : 37, 0); // Auditeurs : rue
  }
  b.zone('site', 'A', 5, 0, 19.5, 17, 3, 32.5, 'Plateau technique');
  b.zone('site', 'B', 19, 0, 23, 30, 3, 32, 'Accueil');
  b.zone('extract', 'navette', 22, 0, 36.2, 30, 3, 39.6, 'Contre-allée');
  b.point('sample', 's1', 12.5, 0.05, 22.5, 'Plateau technique');
  b.point('sample', 's2', 26.5, 0.05, 12.5, 'Bureaux des biologistes');
  b.point('sample', 's3', 38.5, 0.05, 21, 'Réserve');
  b.point('poi', 'plateau', 11, 0.05, 25.5, 'Plateau technique');
  b.point('poi', 'accueil', 26, 0.05, 27, 'Accueil');
  b.point('poi', 'couloir', 24, 0.05, 20.5, 'Couloir des prélèvements');
  b.point('poi', 'hall', 34.5, 0.05, 24, 'Hall');
  b.point('poi', 'bureaux', 24, 0.05, 11.5, 'Bureaux');
  b.point('poi', 'laverie', 11, 0.05, 12, 'Laverie');
  b.point('poi', 'etage', 24, F1 + 0.05, 20.5, 'Étage');
  b.point('poi', 'terrasse', 8, F1 + 0.05, 12, 'Terrasse');
  b.point('poi', 'annexe', 39, 0.05, 20, 'Annexe');

  return b.build();
}
