/**
 * Scoreboard overlay: header (map, mode, round and scores), one table per team
 * sorted by score, spectators below. Built only when the roster changes or when
 * the overlay opens — never per frame.
 */
import { TEAMS } from '../../../shared/identity';
import { MODE_INFO, type MatchState, type PlayerInfo } from '../../../shared/types';
import { frTypo, h } from '../dom';
import { hudIcon } from './icons';
import { T } from './texts';
import { play } from './util';

export interface Scoreboard {
  el: HTMLElement;
  setMapName(name: string): void;
  setRoster(players: PlayerInfo[], localId: number, match: MatchState): void;
  setVisible(visible: boolean): void;
  readonly visible: boolean;
}

const byScore = (a: PlayerInfo, b: PlayerInfo): number =>
  b.score - a.score || b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name, 'fr') || a.id - b.id;

export function createScoreboard(): Scoreboard {
  const mapName = h('div', { class: 'bh-board__map bas-display' });
  const modeName = h('div', { class: 'bh-board__mode' });
  const roundInfo = h('div', { class: 'bh-board__round bas-kicker' });
  const goal = h('div', { class: 'bh-board__goal' });
  const score0 = h('span', { class: 'bh-board__num bh-t0 bas-display' }, '0');
  const score1 = h('span', { class: 'bh-board__num bh-t1 bas-display' }, '0');
  const head = h(
    'header',
    { class: 'bh-board__head' },
    h('div', { class: 'bh-board__title' }, mapName, modeName),
    h(
      'div',
      { class: 'bh-board__score' },
      h('span', { class: 'bh-board__side bh-t0 bas-display' }, TEAMS[0].short),
      score0,
      h('span', { class: 'bh-board__dash' }, '–'),
      score1,
      h('span', { class: 'bh-board__side bh-t1 bas-display' }, TEAMS[1].short),
    ),
    h('div', { class: 'bh-board__meta' }, roundInfo, goal),
  );
  const tables = h('div', { class: 'bh-board__teams' });
  const spectators = h('div', { class: 'bh-board__spec', hidden: true });
  const panel = h('div', { class: 'bh-board__panel' }, head, tables, spectators);
  const el = h('div', { class: 'bh-board', hidden: true }, panel);

  let visible = false;
  let stale = true;
  let map = '';
  let roster: PlayerInfo[] = [];
  let localId = -1;
  let match: MatchState | null = null;

  function teamTable(team: 0 | 1, players: PlayerInfo[]): HTMLElement {
    const alive = players.filter((p) => p.alive).length;
    const kills = players.reduce((n, p) => n + p.kills, 0);
    const body = h('div', { class: 'bh-table__body' });
    for (const p of players) {
      const cls = ['bh-row'];
      if (p.id === localId) cls.push('is-me');
      if (!p.alive) cls.push('is-dead');
      body.appendChild(
        h(
          'div',
          { class: cls.join(' ') },
          h(
            'span',
            { class: 'bh-row__name' },
            p.alive ? h('i', { class: 'bh-row__dot' }) : hudIcon('skull', 'bh-row__skull'),
            h('span', { class: 'bh-row__text' }, p.name),
            p.bot ? h('span', { class: 'bh-tag' }, T.boardBot) : null,
            p.id === localId ? h('span', { class: 'bh-tag bh-tag--me' }, T.boardYou) : null,
          ),
          h('span', { class: 'bh-row__n' }, String(p.kills)),
          h('span', { class: 'bh-row__n' }, String(p.deaths)),
          h('span', { class: 'bh-row__n bh-row__score' }, String(p.score)),
          h('span', { class: 'bh-row__n bh-row__ping' }, p.bot ? '–' : String(Math.max(0, Math.round(p.ping)))),
        ),
      );
    }
    if (players.length === 0) body.appendChild(h('div', { class: 'bh-table__empty' }, T.boardEmpty));
    return h(
      'section',
      { class: `bh-table bh-table--${team}` },
      h(
        'div',
        { class: 'bh-table__head' },
        h('span', { class: 'bh-table__team bas-display' }, TEAMS[team].name),
        h('span', { class: 'bh-table__alive' }, T.boardAlive(alive, players.length)),
        h('span', { class: 'bh-table__total' }, h('b', null, String(kills)), T.boardKillsTotal),
      ),
      h(
        'div',
        { class: 'bh-table__cols' },
        h('span', null, T.boardPlayer),
        h('span', null, T.boardKills),
        h('span', null, T.boardDeaths),
        h('span', null, T.boardScore),
        h('span', null, T.boardPing),
      ),
      body,
    );
  }

  function render(): void {
    stale = false;
    mapName.textContent = map;
    if (!match) return;
    modeName.textContent = frTypo(MODE_INFO[match.mode]?.name ?? '');
    roundInfo.textContent = frTypo(`${T.round(Math.max(1, match.round))} · ${T.boardPhase[match.phase] ?? ''}`);
    goal.textContent = frTypo(T.boardGoal(match.roundsToWin));
    score0.textContent = String(match.score[0]);
    score1.textContent = String(match.score[1]);

    const t0 = roster.filter((p) => p.team === 0).sort(byScore);
    const t1 = roster.filter((p) => p.team === 1).sort(byScore);
    const spec = roster.filter((p) => p.team === 2);
    tables.replaceChildren(teamTable(0, t0), teamTable(1, t1));
    // Long rosters use tighter rows so that 16 players always fit on a 720p screen.
    panel.classList.toggle('is-dense', Math.max(t0.length, t1.length) > 9);

    spectators.hidden = spec.length === 0;
    if (spec.length) {
      spectators.replaceChildren(
        hudIcon('eye'),
        h('span', { class: 'bh-board__spec-label' }, `${T.boardSpectators} :`),
        ...spec.map((p) => h('span', { class: p.id === localId ? 'bh-board__spec-name is-me' : 'bh-board__spec-name' }, p.name)),
      );
    }
  }

  return {
    el,
    get visible() {
      return visible;
    },

    setMapName(name) {
      map = name;
      stale = true;
      if (visible) render();
    },

    setRoster(players, id, m) {
      roster = players.slice();
      localId = id;
      match = m;
      stale = true;
      if (visible) render();
    },

    setVisible(v) {
      if (v === visible) return;
      visible = v;
      if (v && stale) render();
      el.hidden = !v;
      if (v) play(panel, [{ opacity: 0, transform: 'translateY(0.4rem)' }, { opacity: 1, transform: 'none' }], { duration: 120, easing: 'ease-out' });
    },
  };
}
