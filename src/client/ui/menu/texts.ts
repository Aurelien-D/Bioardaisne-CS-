/**
 * Player-facing French texts of the menus that are more than a label: lab tips,
 * nickname generator, credits, difficulty flavour. Plain spaces before : ; ! ? are
 * fine here — `h()` / `frTypo()` insert the non-breaking spaces at render time.
 */
import type { KeyAction } from '../../core/settings';
import type { GameModeId, TeamId } from '../../../shared/types';

export const VERSION_LABEL = 'v0.1 — non accrédité';

/**
 * "Astuces du labo" shown on the loading screen and the title screen: gameplay
 * tips mixed with lab jokes. `{action}` placeholders are replaced by the key
 * currently bound to that action (see `formatTip`).
 */
export const LAB_TIPS: string[] = [
  'Arrêtez-vous avant de tirer : en pleine course, vos balles partent comme une pipette mal calibrée.',
  'Visez la tête. Un résultat net vaut mieux qu’une série à repasser.',
  'Maintenez {walk} pour marcher en silence : idéal pour surprendre un auditeur plongé dans ses dossiers.',
  'Accroupi ({crouch}), votre tir gagne en précision. Votre dos, lui, vous dira merci plus tard.',
  'Rechargez ({reload}) à couvert. Un chargeur vide, c’est comme un automate sans réactif : ça arrive toujours au pire moment.',
  'Le Bistouri ({slot3}) est silencieux, et encore plus convaincant dans le dos.',
  'Le Microscope se porte lentement : choisissez votre poste d’observation avant de mettre l’œil à l’oculaire.',
  'Tirez par courtes rafales : le recul grimpe aussi vite que la pile de dossiers un vendredi à 17 h.',
  'Plus rapide que de recharger : passez à l’arme de poing avec {slot2}.',
  'L’Agitateur 12 règne dans les couloirs. Sur le parking, beaucoup moins.',
  'L’écart critique ne se lève pas tout seul : couvrez le collègue qui s’en occupe.',
  'Une glacière ne se sécurise pas à distance. Restez dessus et maintenez {use}.',
  'Écoutez les pas : un auditeur pressé s’entend depuis l’autre bout du plateau technique.',
  'Restez groupés. Un préleveur isolé est un préleveur prélevé.',
  '{scoreboard} affiche le tableau des scores. Le rendu des résultats, lui, n’attend pas.',
  'Un audit surprise ne prévient jamais. C’est même le principe.',
  'En cas de doute, recentrifugez.',
  'Tube violet pour la numération, tube bleu pour la coagulation, sang-froid pour tout le reste.',
  'Le technicien de garde ne dort jamais. Il ferme juste les yeux entre deux séries urgentes.',
  'Un tube bien étiqueté est un tube heureux. Un coéquipier bien couvert aussi.',
  'On ne court pas avec un bistouri. Sauf ici.',
  'Le contrôle qualité passe toujours… à la troisième tentative.',
  'Pensez à vous hydrater. Le café ne compte pas. Enfin si, un peu.',
  'Changez d’arme avec {loadout} en début de manche : le bon outil pour la bonne paillasse.',
];

/** Funny lab nicknames proposed by the dice button (all ≤ LIMITS.maxNameLength). */
export const NICKNAMES: string[] = [
  'Globule Rouge',
  'Sergent Garrot',
  'Pipette Folle',
  'Major Hémolyse',
  'Dr Hématocrite',
  'Agent Leucocyte',
  'Plaquette Furtive',
  'Roi du Vortex',
  'Reine des Aliquotes',
  'Colonel Potassium',
  'Miss Ferritine',
  'Frottis Fatal',
  'Lame Mince',
  'Sniper de Paillasse',
  'Astreinte Fantôme',
  'Garde de Nuit',
  'Café Serré',
  'Bouchon Rouge',
  'Portoir Complet',
  'Cône Jaune',
  'Gélose Furtive',
  'Boîte de Pétri',
  'Stagiaire Zélé',
  'Coursier Pressé',
  'Bip d’Automate',
  'Tube Citraté',
  'Sérum Physio',
  'Culot Globulaire',
  'Aiguille Verte',
  'Buvard Masqué',
  'Glacière Express',
  'Échantillon 42',
];

export const DIFFICULTY_LABELS = ['Facile', 'Normal', 'Difficile', 'Expert'] as const;
export const DIFFICULTY_HINTS = [
  'Stagiaires en première semaine : ils cherchent encore la salle de pause.',
  'Techniciens confirmés : appliqués, mais humains.',
  'Référents de paillasse : rapides, précis, peu bavards.',
  'Comité d’accréditation : aucun écart ne leur échappe.',
] as const;

/** Short mode names for compact places (chips, summaries). */
export const MODE_SHORT: Record<GameModeId, string> = {
  tdm: 'Match à mort par équipe',
  defuse: 'Audit surprise',
  secure: 'Sécurisation du laboratoire',
};

/** Role line of each team per mode (team select). */
export const TEAM_ROLES: Record<GameModeId, Record<0 | 1, { tag: string; goal: string }>> = {
  tdm: {
    0: { tag: 'Match à mort', goal: 'Éliminez les Auditeurs avant qu’ils n’atteignent le quota.' },
    1: { tag: 'Match à mort', goal: 'Éliminez l’Équipe Labo avant qu’elle n’atteigne le quota.' },
  },
  defuse: {
    0: { tag: 'Défense', goal: 'Protégez les sites A et B, puis levez l’écart critique s’il est déposé.' },
    1: { tag: 'Attaque', goal: 'Déposez l’écart critique sur un site et tenez jusqu’à la fin du délai.' },
  },
  secure: {
    0: { tag: 'Défense', goal: 'Gardez les glacières d’échantillons au frais jusqu’à la fin du temps.' },
    1: { tag: 'Attaque', goal: 'Saisissez les glacières et rapportez-les à la zone d’extraction.' },
  },
};

export const TEAM_ARTICLE: Record<TeamId, string> = {
  0: 'l’Équipe Labo',
  1: 'Les Auditeurs',
  2: 'les spectateurs',
};

/** Groups of the key binding list (options and cheat-sheet). */
export const KEY_GROUPS: { title: string; actions: KeyAction[] }[] = [
  { title: 'Déplacement', actions: ['forward', 'back', 'left', 'right', 'jump', 'crouch', 'walk'] },
  { title: 'Combat', actions: ['fire', 'altFire', 'reload', 'use'] },
  { title: 'Armes', actions: ['slot1', 'slot2', 'slot3', 'lastWeapon'] },
  { title: 'Interface', actions: ['scoreboard', 'chat', 'teamChat', 'loadout', 'teamMenu'] },
];

export interface CreditLine {
  role: string;
  who: string;
}

export const CREDITS: CreditLine[] = [
  { role: 'Conception', who: 'Le plateau technique, entre deux séries urgentes' },
  { role: 'Programmation', who: 'L’équipe de garde (de nuit, forcément)' },
  { role: 'Cartes et décors', who: 'Le service qualité, qui connaît tous les recoins' },
  { role: 'Armurerie', who: 'La métrologie : chaque arme est étalonnée, raccordée, vérifiée' },
  { role: 'Bande-son', who: 'Les alarmes des automates, enfin utiles à quelque chose' },
  { role: 'Tests', who: 'Les collègues, pendant la pause café — et seulement pendant' },
  { role: 'Remerciements', who: 'Aux préleveurs matinaux, aux coursiers, et à la machine à café' },
];

/** The credits are also a (very) unofficial lab report. */
export const CREDITS_REPORT: { test: string; result: string; ref: string; flag?: 'high' | 'ok' }[] = [
  { test: 'Hémolyse', result: 'Absente', ref: 'Absente', flag: 'ok' },
  { test: 'Bonne humeur', result: 'Très élevée', ref: 'Élevée', flag: 'high' },
  { test: 'Sérieux', result: 'Traces', ref: '< 5 %', flag: 'ok' },
  { test: 'Caféine', result: '++++', ref: '2 à 4 tasses / garde', flag: 'high' },
  { test: 'Non-conformités', result: 'Quelques-unes', ref: 'On en reparle à l’audit' },
];

export const CREDITS_NOTES: string[] = [
  'Aucun tube n’a été hémolysé pendant le développement.',
  'Aucun auditeur n’a été blessé. Vexé, peut-être.',
  'Toute ressemblance avec un audit réel serait purement fortuite.',
  'Résultats rendus sans validation biologique. Ne remplace pas une vraie pause.',
];

export const EASTER_EGG_TOASTS: string[] = [
  'Alerte : pluie de tubes sur le plateau technique ! Pensez à recentrifuger.',
  'Portoir renversé ! Rien de cassé, tout est en plastique.',
  'Le logo a été prélevé cinq fois. Il demande une pause.',
];

/** Texts under each main navigation entry (shown in the footer hint and panel header). */
export const SECTION_TEXT = {
  solo: { title: 'Jouer en solo', sub: 'Affrontez les bots, sans connexion et sans témoin.' },
  create: { title: 'Créer un salon privé', sub: 'Réglez la partie, puis invitez vos collègues.' },
  join: { title: 'Rejoindre un salon', sub: 'Saisissez le code à 5 caractères communiqué par l’hôte.' },
  options: { title: 'Options', sub: 'Réglages enregistrés automatiquement sur ce poste.' },
  controls: { title: 'Commandes', sub: 'Les touches affichées sont celles de votre clavier.' },
  credits: { title: 'Crédits', sub: 'Compte rendu (très) officieux.' },
  host: { title: 'Paramètres de la partie', sub: 'Réservé à l’hôte : carte, mode, bots et règles.' },
} as const;
