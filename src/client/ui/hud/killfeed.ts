/**
 * Kill feed (top right): killer [weapon] [headshot] victim, newest at the bottom,
 * five lines at most, each one fading after six seconds.
 */
import type { KillFeedEntry } from '../../core/contracts';
import { WEAPONS } from '../../../shared/weapons/defs';
import { h } from '../dom';
import { hudIcon, weaponIcon } from './icons';
import type { Timers } from './util';

const MAX_LINES = 5;
const LIFE_MS = 6000;
const FADE_MS = 450;

export interface KillFeed {
  el: HTMLElement;
  push(entry: KillFeedEntry): void;
  clear(): void;
}

export function createKillFeed(timers: Timers): KillFeed {
  const el = h('div', { class: 'bh-feed' });
  const rows: HTMLElement[] = [];

  const drop = (row: HTMLElement): void => {
    const i = rows.indexOf(row);
    if (i >= 0) rows.splice(i, 1);
    row.remove();
  };

  return {
    el,
    push(e) {
      // Fall, objective or self-inflicted: no killer on the left.
      const solo = e.weapon === null && (e.killer === '' || e.killer === e.victim);
      const known = e.weapon !== null && e.weapon in WEAPONS;
      const weapon = h('span', { class: 'bh-kill__weapon' }, known ? weaponIcon(e.weapon!) : hudIcon('skull'));
      const row = h(
        'div',
        { class: e.involvesLocal ? 'bh-kill is-local' : 'bh-kill' },
        solo ? null : h('span', { class: `bh-kill__name bh-t${e.killerTeam}` }, e.killer),
        weapon,
        e.headshot ? hudIcon('headshot', 'bh-kill__hs') : null,
        h('span', { class: `bh-kill__name bh-t${e.victimTeam}` }, e.victim),
      );
      el.appendChild(row);
      rows.push(row);
      while (rows.length > MAX_LINES) drop(rows[0]!);
      timers.after(LIFE_MS, () => {
        row.classList.add('is-out');
        timers.after(FADE_MS, () => drop(row));
      });
    },
    clear() {
      while (rows.length) drop(rows[0]!);
    },
  };
}
