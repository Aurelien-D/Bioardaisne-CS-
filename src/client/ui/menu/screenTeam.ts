/** Team selection: two large team cards, automatic assignment and spectator. */
import { TEAMS } from '../../../shared/identity';
import { MODE_INFO, type GameModeId, type TeamId } from '../../../shared/types';
import { clear, h, plural, svg } from '../dom';
import { icon } from './icons';
import { TEAM_ROLES } from './texts';
import type { MenuContext, Screen } from './types';
import { button, kbd } from './widgets';

export interface TeamInfo {
  /** Players per team [Labo, Auditeurs]; null when unknown (opened from the pause menu before any roster update). */
  counts: [number, number] | null;
  current: TeamId | null;
  mode: GameModeId;
}

export interface TeamScreen extends Screen {
  update(info: TeamInfo): void;
}

/** Team emblems: a flask for the lab, an audit check-list (with one cross…) for the auditors. */
const EMBLEM: Record<0 | 1, string> = {
  0: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
    <path d="M60 7l46 26.5v53L60 113 14 86.5v-53z" stroke-width="3" opacity="0.55"/>
    <path d="M46.5 77h27l7.5 13a4.5 4.5 0 0 1-4 7H43a4.5 4.5 0 0 1-4-7z" fill="currentColor" stroke="none" opacity="0.55"/>
    <path d="M49 32h22M53 32v22L36.5 85.5A7.5 7.5 0 0 0 43 97h34a7.5 7.5 0 0 0 6.5-11.5L67 54V32" stroke-width="5"/>
    <circle cx="56" cy="68" r="2.5" fill="currentColor" stroke="none"/>
    <circle cx="65" cy="60" r="1.8" fill="currentColor" stroke="none"/>
    <circle cx="62" cy="46" r="1.5" fill="currentColor" stroke="none"/>
  </svg>`,
  1: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
    <path d="M60 7l46 26.5v53L60 113 14 86.5v-53z" stroke-width="3" opacity="0.55"/>
    <path d="M48 31h-7a5 5 0 0 0-5 5v54a5 5 0 0 0 5 5h38a5 5 0 0 0 5-5V36a5 5 0 0 0-5-5h-7" stroke-width="5"/>
    <rect x="48" y="25" width="24" height="12" rx="3.5" fill="currentColor" stroke="none"/>
    <path d="M44 53l3.5 3.5 6-7M44 68l3.5 3.5 6-7M45 81l7 7M52 81l-7 7" stroke-width="3.5"/>
    <path d="M61 54h15M61 69h15M61 84.5h15" stroke-width="3.5" opacity="0.55"/>
  </svg>`,
};

export function createTeamScreen(ctx: MenuContext, initial: TeamInfo, opts: { onPick(team: number): void; onBack(): void }): TeamScreen {
  let info = initial;
  const kicker = h('div', { class: 'bas-kicker' });
  const cards = h('div', { class: 'bas-team__cards' });
  const alt = h('div', { class: 'bas-team__alt' });
  let cardButtons: HTMLButtonElement[] = [];

  const pick = (team: number): void => opts.onPick(team);

  const card = (team: 0 | 1): HTMLButtonElement => {
    const t = TEAMS[team];
    const role = TEAM_ROLES[info.mode][team];
    const count = info.counts ? info.counts[team] : null;
    const isCurrent = info.current === team;
    const pips =
      count === null
        ? null
        : h(
            'span',
            { class: 'bas-teamcard__count' },
            h(
              'span',
              { class: 'bas-teamcard__pips', 'aria-hidden': 'true' },
              Array.from({ length: Math.max(8, Math.min(count, 16)) }, (_, i) => h('i', { class: i < count ? 'is-on' : '' })),
            ),
            h('span', null, count === 0 ? 'Aucun joueur' : plural(count, 'joueur')),
          );
    return h(
      'button',
      { type: 'button', class: `bas-teamcard bas-teamcard--${team}${isCurrent ? ' is-current' : ''}`, dataset: { team: String(team) }, onclick: () => pick(team) },
      h('span', { class: 'bas-teamcard__top' }, kbd(String(team + 1)), h('span', { class: 'bas-teamcard__role' }, role.tag), isCurrent ? h('span', { class: 'bas-badge' }, 'Votre équipe') : null),
      h('span', { class: 'bas-teamcard__emblem' }, svg(EMBLEM[team])),
      h('span', { class: 'bas-teamcard__name bas-display' }, t.name),
      h('span', { class: 'bas-teamcard__desc' }, t.description),
      h('span', { class: 'bas-teamcard__goal' }, icon('target'), h('span', null, role.goal)),
      h('span', { class: 'bas-teamcard__foot' }, pips ?? h('span', null), h('span', { class: 'bas-teamcard__cta bas-display' }, isCurrent ? 'Rester' : 'Rejoindre', icon('arrowRight'))),
    );
  };

  const paint = (): void => {
    kicker.textContent = MODE_INFO[info.mode].name;
    clear(cards);
    cardButtons = [card(0), card(1)];
    cards.append(cardButtons[0]!, h('span', { class: 'bas-team__vs bas-display', 'aria-hidden': 'true' }, 'VS'), cardButtons[1]!);
    clear(alt);
    alt.append(
      button({ label: 'Affectation automatique', icon: 'shuffle', variant: 'secondary', size: 'lg', kbd: '3', title: 'Rejoindre l’équipe la moins nombreuse', onClick: () => pick(-1) }),
      button({
        label: info.current === 2 ? 'Rester spectateur' : 'Spectateur',
        icon: 'eye',
        variant: 'ghost',
        size: 'lg',
        kbd: '4',
        title: TEAMS[2].description,
        onClick: () => pick(2),
      }),
    );
  };
  paint();

  const el = h(
    'div',
    { class: 'bas-screen bas-team' },
    h('div', { class: 'bas-team__inner' }, h('header', { class: 'bas-team__head' }, kicker, h('h1', { class: 'bas-team__title bas-display' }, 'Choisissez votre camp')), cards, alt),
    h('footer', { class: 'bas-screen__keys' }, h('span', null, kbd('1'), kbd('2'), ' Équipe'), h('span', null, kbd('Échap'), ' Retour')),
  );

  return {
    el,
    update(next) {
      info = next;
      const focused = cardButtons.indexOf(document.activeElement as HTMLButtonElement);
      paint();
      if (focused >= 0) cardButtons[focused]?.focus();
    },
    onKey(e) {
      const map: Record<string, number> = { Digit1: 0, Numpad1: 0, Digit2: 1, Numpad2: 1, Digit3: -1, Numpad3: -1, Digit4: 2, Numpad4: 2 };
      const team = map[e.code];
      if (team === undefined || e.ctrlKey || e.altKey || e.metaKey) return false;
      ctx.sound('click');
      pick(team);
      return true;
    },
    back() {
      ctx.sound('back');
      opts.onBack();
    },
    mounted() {
      const target = info.current === 0 || info.current === 1 ? info.current : 0;
      cardButtons[target]?.focus();
    },
    dispose() {},
  };
}
