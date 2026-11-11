/**
 * Every French string of the HUD in one place (plain spaces: `h()` / `frTypo()`
 * add the non-breaking ones French punctuation needs).
 */
import type { GameModeId } from '../../../shared/types';

export const T = {
  // --- Ammo ---
  reload: 'Recharger',
  reloading: 'Rechargement…',
  noAmmo: 'Plus de munitions',
  // --- Top bar ---
  round: (n: number): string => `Série ${n}`,
  warmup: 'Échauffement',
  warmupSub: 'Calibration des automates en cours…',
  freeze: (s: number): string => `Début dans ${s}…`,
  freezeSub: 'Préparez vos pipettes',
  postNext: (s: number): string => `Prochaine série dans ${s} s`,
  overNext: (s: number): string => `Nouveau match dans ${s} s`,
  // --- Dead / spectating ---
  spectating: 'Vous observez',
  spectatorMode: 'Mode spectateur',
  /** Followed by the number of seconds and the unit ("Réapparition dans 3 s"). */
  respawnLead: 'Réapparition dans',
  respawnSub: 'Nouveau prélèvement en cours…',
  respawnNow: 'Réapparition imminente',
  eliminated: 'Vous êtes hors jeu',
  eliminatedSub: 'Retour à la paillasse à la prochaine série.',
  // --- Status chips ---
  protectedChip: 'Protection de réapparition',
  protectedHint: 'Tirer l’annule',
  carrying: {
    tdm: 'Vous portez l’objectif',
    defuse: 'Vous portez le dossier d’écart critique',
    secure: 'Vous portez une glacière d’échantillons',
  } as Record<GameModeId, string>,
  // --- Chat ---
  chatAll: 'À tous',
  chatTeam: 'À l’équipe',
  chatTeamPrefix: '(Équipe)',
  chatPlaceholder: 'Votre message…',
  chatHintSend: 'envoyer',
  chatHintCancel: 'annuler',
  // --- Scoreboard ---
  boardPlayer: 'Joueur',
  boardKills: 'Élim.',
  boardKillsTotal: 'éliminations',
  boardDeaths: 'Morts',
  boardScore: 'Score',
  boardPing: 'Ping',
  boardBot: 'BOT',
  boardYou: 'Vous',
  boardAlive: (alive: number, total: number): string => `${alive} / ${total} en vie`,
  boardEmpty: 'Aucun joueur — la paillasse est libre.',
  boardSpectators: 'En salle d’attente',
  boardGoal: (n: number): string => (n > 1 ? `Victoire en ${n} séries gagnantes` : 'Victoire en une série gagnante'),
  boardPhase: {
    warmup: 'Échauffement',
    freeze: 'Mise en place',
    live: 'Série en cours',
    post: 'Série terminée',
    over: 'Match terminé',
  } as Record<string, string>,
  // --- Scope ---
  scopeLens: (level: number): string => `Objectif ×${level >= 2 ? 10 : 4}`,
  // --- Performance read-out ---
  fps: 'IPS',
} as const;
