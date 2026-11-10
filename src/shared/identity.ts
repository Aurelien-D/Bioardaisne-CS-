/**
 * BioArd'Aisne Strike identity: teams, colours, flavour texts.
 * Humour interne au laboratoire — l'équipe « Labo » défend, les « Auditeurs » attaquent.
 */
import type { TeamId } from './constants';

export const GAME_TITLE = "BioArd'Aisne Strike";
export const GAME_TAGLINE = 'Le FPS du plateau technique';

/** Brand palette (taken from the public BioArd'Aisne website). */
export const BRAND = {
  blue: 0x3182ce,
  blueDark: 0x2b6cb0,
  navy: 0x003f71,
  red: 0xe7343f,
  pink: 0xf00069,
  grey: 0x4a4a49,
  light: 0xeaf6fe,
  white: 0xffffff,
} as const;

export interface TeamIdentity {
  id: TeamId;
  /** Full display name. */
  name: string;
  /** Short tag for HUD / scoreboard. */
  short: string;
  /** Role in objective modes. */
  role: 'defense' | 'attack' | 'spectator';
  color: number;
  /** CSS colour string. */
  css: string;
  description: string;
}

export const TEAMS: Record<TeamId, TeamIdentity> = {
  0: {
    id: 0,
    name: 'Équipe Labo',
    short: 'LABO',
    role: 'defense',
    color: BRAND.blue,
    css: '#3182ce',
    description: 'Techniciens, biologistes et préleveurs : ils défendent le plateau technique.',
  },
  1: {
    id: 1,
    name: 'Les Auditeurs',
    short: 'AUDIT',
    role: 'attack',
    color: BRAND.red,
    css: '#e7343f',
    description: "Audit surprise ! Ils viennent déposer un écart critique et saisir les échantillons.",
  },
  2: {
    id: 2,
    name: 'Spectateurs',
    short: 'SPEC',
    role: 'spectator',
    color: 0x999999,
    css: '#999999',
    description: 'En salle d’attente.',
  },
};

/** Names given to bots (clins d'œil labo). */
export const BOT_NAMES: Record<0 | 1, string[]> = {
  0: [
    'Dr Pipette',
    'Tech de Garde',
    'Mme Centrifugeuse',
    'Tube Violet',
    'Garrot Express',
    'Capitaine EDTA',
    'Bilan Complet',
    'Paillasse 3',
    'Série Urgente',
    'Agent Calibrant',
    'Hémoc Positive',
    'Coag Rapide',
  ],
  1: [
    'Auditeur Zélé',
    'Écart Critique',
    'M. Non-Conforme',
    'Fiche Qualité',
    'Traçabilité',
    'Dossier Manquant',
    'Point Sensible',
    'Preuve Documentée',
    'Revue de Direction',
    'Habilitation KO',
    'Métrologue',
    'Constat Majeur',
  ],
};

/** Announcer lines keyed by event. `{team}` / `{name}` are substituted client-side. */
export const ANNOUNCE: Record<string, { title: string; sub?: string; voice?: string }> = {
  round_start: { title: 'Début de la série', sub: 'À vos pipettes !', voice: 'Début de la série. À vos pipettes !' },
  round_start_last: { title: 'Série décisive', sub: 'Pas le droit à l’erreur analytique.', voice: 'Série décisive !' },
  warmup: { title: 'Échauffement', sub: 'Calibration des automates en cours…' },
  team_win_0: { title: 'Le Labo valide la série', sub: 'Contrôle qualité conforme.', voice: 'Le labo valide la série.' },
  team_win_1: { title: 'Les Auditeurs l’emportent', sub: 'Écart critique constaté.', voice: 'Les auditeurs remportent la série.' },
  round_draw: { title: 'Série à repasser', sub: 'Résultat ininterprétable.', voice: 'Série à repasser.' },
  match_win_0: { title: 'Accréditation maintenue !', sub: 'Victoire de l’Équipe Labo', voice: 'Accréditation maintenue ! Victoire du labo.' },
  match_win_1: { title: 'Accréditation suspendue !', sub: 'Victoire des Auditeurs', voice: 'Accréditation suspendue ! Victoire des auditeurs.' },
  match_draw: { title: 'Match nul', sub: 'On refait un prélèvement.', voice: 'Match nul.' },
  first_blood: { title: 'Premier prélèvement !', voice: 'Premier prélèvement !' },
  double_kill: { title: 'Double prélèvement !', voice: 'Double prélèvement !' },
  triple_kill: { title: 'Série analytique !', voice: 'Série analytique !' },
  multi_kill: { title: 'Bilan complet !', voice: 'Bilan complet !' },
  headshot: { title: 'Hémolysé !', voice: 'Hémolysé !' },
  knife_kill: { title: 'Prise de sang express !', voice: 'Prise de sang express !' },
  last_alive: { title: 'Dernier technicien de garde', sub: 'Tout repose sur toi.' },
  time_low: { title: 'Délai de rendu dépassé dans 30 s', voice: 'Trente secondes.' },
  // Désamorçage (« Audit surprise »)
  bomb_planted: { title: 'Écart critique déposé !', sub: 'Levez l’écart avant la fin du délai.', voice: 'Écart critique déposé !' },
  bomb_defused: { title: 'Écart levé !', sub: 'Action corrective validée.', voice: 'Écart levé !' },
  bomb_exploded: { title: 'Suspension d’accréditation !', sub: 'Le délai de réponse est dépassé.', voice: 'Suspension d’accréditation !' },
  bomb_dropped: { title: 'Le dossier d’écart est tombé' },
  bomb_picked: { title: 'Le dossier d’écart a été récupéré' },
  // Sécurisation du laboratoire
  sample_taken: { title: 'Échantillon saisi !', sub: 'Une glacière quitte le labo.', voice: 'Échantillon saisi !' },
  sample_dropped: { title: 'Glacière au sol' },
  sample_returned: { title: 'Échantillon sécurisé', sub: 'Retour en enceinte réfrigérée.', voice: 'Échantillon sécurisé.' },
  sample_extracted: { title: 'Échantillon extrait !', sub: 'Parti en contre-expertise.', voice: 'Échantillon extrait !' },
};
