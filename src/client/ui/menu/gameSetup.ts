/**
 * Game-setup form shared by "Jouer en solo", "Créer un salon privé" and the host
 * panel of the pause menu: map, mode, bots, rules. It only edits a RoomConfig;
 * the caller owns the action buttons.
 */
import type { MapMeta } from '../../../shared/maps/types';
import { MODE_DEFAULTS, MODE_INFO, type GameModeId, type RoomConfig } from '../../../shared/types';
import { formatDuration, h, plural, setText } from '../dom';
import { icon, type IconName } from './icons';
import { createMapThumb } from './mapThumb';
import { BOT_FILL_VALUES, KILL_LIMIT, ROUNDS_TO_WIN, ROUND_TIME, availableMaps, sanitizeSetup } from './setupStore';
import { DIFFICULTY_HINTS, DIFFICULTY_LABELS, MODE_SHORT } from './texts';
import type { MenuContext, View } from './types';
import { arrowNav, group, row, segmented, slider, toggle } from './widgets';

const MODE_ORDER: GameModeId[] = ['tdm', 'defuse', 'secure'];
const MODE_ICON: Record<GameModeId, IconName> = { tdm: 'swords', defuse: 'clipboardCheck', secure: 'shield' };
const MODE_LABEL: Record<GameModeId, string> = {
  tdm: 'Match à mort par équipe',
  defuse: 'Audit surprise',
  secure: 'Sécurisation du laboratoire',
};

export interface GameSetup extends View {
  config(): RoomConfig;
  /** One-line recap: "Arène de test · Match à mort par équipe · 8 joueurs". */
  summary(): string;
  onChange: ((cfg: RoomConfig) => void) | null;
}

export function botFillText(n: number): string {
  return n < 2 ? 'Aucun bot' : `${n}\u00a0joueurs au total`;
}

export function setupSummary(cfg: RoomConfig, maps: MapMeta[] = availableMaps(cfg.mapId)): string {
  const map = maps.find((m) => m.id === cfg.mapId);
  return [map?.name ?? cfg.mapId, MODE_SHORT[cfg.mode], cfg.botFill < 2 ? 'sans bots' : plural(cfg.botFill, 'joueur')].join(' · ');
}

export function createGameSetup(ctx: MenuContext, opts: { initial: RoomConfig; kind: 'solo' | 'create' | 'host' }): GameSetup {
  const maps = availableMaps(opts.initial.mapId);
  let cfg = sanitizeSetup(opts.initial, opts.initial.mapId);

  const api: GameSetup = {
    el: h('div', { class: 'bas-setup' }),
    config: () => ({ ...cfg }),
    summary: () => setupSummary(cfg, maps),
    onChange: null,
    focus: () => mapCards.find((c) => c.getAttribute('aria-checked') === 'true')?.focus(),
    dispose() {
      api.onChange = null;
    },
  };
  const changed = (): void => api.onChange?.({ ...cfg });

  // --- Map picker ----------------------------------------------------------------
  const mapCards = maps.map((m) =>
    h(
      'button',
      { type: 'button', class: 'bas-mapcard', role: 'radio', dataset: { map: m.id } },
      h('span', { class: 'bas-mapcard__thumb' }, createMapThumb(m.id), h('span', { class: 'bas-mapcard__check' }, icon('check'))),
      h(
        'span',
        { class: 'bas-mapcard__body' },
        h('span', { class: 'bas-mapcard__name bas-display' }, m.name),
        h('span', { class: 'bas-mapcard__desc' }, m.description),
        h(
          'span',
          { class: 'bas-mapcard__meta' },
          icon('users'),
          m.players[0] === m.players[1] ? plural(m.players[0], 'joueur') : `${m.players[0]} à ${m.players[1]}\u00a0joueurs`,
          h('span', { class: 'bas-mapcard__modes' }, plural(m.modes.length, 'mode')),
        ),
      ),
    ),
  );
  const mapList = h('div', { class: 'bas-maps', role: 'radiogroup', 'aria-label': 'Carte', dataset: { count: String(maps.length) } }, mapCards);
  arrowNav(mapList, '.bas-mapcard', 'both', true);
  mapCards.forEach((card, i) =>
    card.addEventListener('click', () => {
      const m = maps[i]!;
      if (cfg.mapId === m.id) return;
      cfg.mapId = m.id;
      let replaced: GameModeId | null = null;
      if (!m.modes.includes(cfg.mode)) {
        replaced = cfg.mode;
        applyMode(m.modes.includes('tdm') ? 'tdm' : (m.modes[0] ?? 'tdm'));
      }
      paint(replaced);
      changed();
    }),
  );

  // --- Mode picker ---------------------------------------------------------------
  const modeButtons = MODE_ORDER.map((id) =>
    h(
      'button',
      { type: 'button', class: 'bas-modecard', role: 'radio', dataset: { mode: id } },
      icon(MODE_ICON[id]),
      h('span', { class: 'bas-modecard__name' }, MODE_LABEL[id]),
    ),
  );
  const modeList = h('div', { class: 'bas-modes', role: 'radiogroup', 'aria-label': 'Mode de jeu' }, modeButtons);
  arrowNav(modeList, '.bas-modecard', 'both', true);
  const modeDesc = h('p', { class: 'bas-modedesc' });
  const modeNote = h('p', { class: 'bas-modenote', hidden: true });

  const applyMode = (mode: GameModeId): void => {
    cfg = { ...cfg, ...MODE_DEFAULTS[mode], mode };
  };
  modeButtons.forEach((btn, i) =>
    btn.addEventListener('click', () => {
      const id = MODE_ORDER[i]!;
      if (btn.getAttribute('aria-disabled') === 'true') {
        ctx.sound('error');
        return;
      }
      if (cfg.mode === id) return;
      applyMode(id);
      paint(null);
      changed();
    }),
  );

  // --- Bots ----------------------------------------------------------------------
  const botHint = h('small', null);
  const botSlider = slider({
    label: 'Nombre de joueurs, bots compris',
    values: BOT_FILL_VALUES,
    value: cfg.botFill,
    format: botFillText,
    onInput(v) {
      cfg.botFill = v;
      paintBots();
      changed();
    },
  });
  const diffHint = h('p', { class: 'bas-setup__hint' });
  const diffSeg = segmented<number>({
    label: 'Niveau des bots',
    options: DIFFICULTY_LABELS.map((label, value) => ({ value, label })),
    value: cfg.botDifficulty,
    onChange(v) {
      cfg.botDifficulty = v;
      paintBots();
      changed();
    },
  });
  const paintBots = (): void => {
    const n = cfg.botFill;
    if (n < 2) setText(botHint, opts.kind === 'solo' ? 'Seul sur la carte' : 'Humains uniquement');
    else setText(botHint, `${Math.ceil(n / 2)} contre ${Math.floor(n / 2)}, bots compris`);
    setText(diffHint, DIFFICULTY_HINTS[cfg.botDifficulty] ?? '');
  };

  // --- Rules ---------------------------------------------------------------------
  const timeSlider = slider({
    label: 'Durée d’une manche',
    min: ROUND_TIME.min,
    max: ROUND_TIME.max,
    step: ROUND_TIME.step,
    value: cfg.roundTime,
    format: formatDuration,
    onInput(v) {
      cfg.roundTime = v;
      changed();
    },
  });
  const roundsSlider = slider({
    label: 'Manches gagnantes',
    min: ROUNDS_TO_WIN.min,
    max: ROUNDS_TO_WIN.max,
    step: 1,
    value: cfg.roundsToWin,
    format: (v) => plural(v, 'manche'),
    onInput(v) {
      cfg.roundsToWin = v;
      changed();
    },
  });
  const killSlider = slider({
    label: 'Quota d’éliminations',
    min: KILL_LIMIT.min,
    max: KILL_LIMIT.max,
    step: KILL_LIMIT.step,
    value: cfg.killLimit,
    format: (v) => (v === 0 ? 'Sans quota' : plural(v, 'élimination')),
    onInput(v) {
      cfg.killLimit = v;
      changed();
    },
  });
  const killHint = h('small', null);
  const killRow = row('Quota d’éliminations', killSlider.el, killHint);
  const ffToggle = toggle({
    label: 'Tir allié',
    value: cfg.friendlyFire,
    texts: ['Activé', 'Désactivé'],
    onChange(on) {
      cfg.friendlyFire = on;
      changed();
    },
  });

  // --- Painting ------------------------------------------------------------------
  const paint = (replacedMode: GameModeId | null): void => {
    const map = maps.find((m) => m.id === cfg.mapId);
    mapCards.forEach((card, i) => {
      const active = maps[i]!.id === cfg.mapId;
      card.setAttribute('aria-checked', active ? 'true' : 'false');
      card.tabIndex = active ? 0 : -1;
    });
    const unavailable: string[] = [];
    modeButtons.forEach((btn, i) => {
      const id = MODE_ORDER[i]!;
      const ok = !map || map.modes.includes(id);
      const active = cfg.mode === id;
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
      btn.setAttribute('aria-disabled', ok ? 'false' : 'true');
      btn.tabIndex = active ? 0 : -1;
      btn.title = ok ? '' : `Indisponible sur la carte « ${map?.name ?? ''} »`;
      if (!ok) unavailable.push(MODE_LABEL[id]);
    });
    setText(modeDesc, MODE_INFO[cfg.mode].description);
    if (unavailable.length > 0 && map) {
      const prefix = replacedMode ? `Mode remplacé par « ${MODE_LABEL[cfg.mode]} ». ` : '';
      setText(modeNote, `${prefix}${unavailable.length > 1 ? 'Indisponibles' : 'Indisponible'} sur cette carte : ${unavailable.join(', ')}.`);
      modeNote.hidden = false;
    } else {
      modeNote.hidden = true;
    }
    botSlider.set(cfg.botFill);
    diffSeg.set(cfg.botDifficulty);
    timeSlider.set(cfg.roundTime);
    roundsSlider.set(cfg.roundsToWin);
    killSlider.set(cfg.killLimit);
    const tdm = cfg.mode === 'tdm';
    killSlider.setDisabled(!tdm);
    killRow.classList.toggle('is-disabled', !tdm);
    setText(killHint, tdm ? 'Par manche' : 'Sans objet dans ce mode');
    ffToggle.set(cfg.friendlyFire);
    paintBots();
  };
  paint(null);

  api.el.append(
    h('div', { class: 'bas-setup__col bas-setup__col--maps' }, group('Carte', mapList)),
    h(
      'div',
      { class: 'bas-setup__col' },
      group('Mode de jeu', modeList, modeDesc, modeNote),
      group('Bots', row('Joueurs', botSlider.el, botHint), row('Niveau des bots', diffSeg.el), diffHint),
      group(
        'Règles',
        row('Durée d’une manche', timeSlider.el),
        row('Manches gagnantes', roundsSlider.el),
        killRow,
        row('Tir allié', ffToggle.el, 'Gare aux collègues'),
      ),
    ),
  );
  return api;
}
