/** Load-out: one primary and one secondary weapon, with silhouettes and stat bars. */
import { TEAMS } from '../../../shared/identity';
import type { TeamId } from '../../../shared/types';
import { PRIMARY_WEAPONS, SECONDARY_WEAPONS, WEAPONS, isValidLoadout, type Loadout, type WeaponId } from '../../../shared/weapons/defs';
import { h, setText } from '../dom';
import type { MenuContext, Screen } from './types';
import { CATEGORY_LABEL, weaponArt, weaponStats } from './weaponArt';
import { arrowNav, button, kbd } from './widgets';

export interface LoadoutScreen extends Screen {
  update(current: Loadout, team: TeamId): void;
}

export function createLoadoutScreen(
  ctx: MenuContext,
  initial: Loadout,
  initialTeam: TeamId,
  opts: { onPick(loadout: Loadout): void; onBack(): void },
): LoadoutScreen {
  let loadout: Loadout = { ...initial };
  let team = initialTeam;
  const cards = new Map<WeaponId, HTMLButtonElement>();

  const kicker = h('div', { class: 'bas-kicker' });
  const kitPrimary = h('span', { class: 'bas-kit__name' });
  const kitSecondary = h('span', { class: 'bas-kit__name' });

  const card = (id: WeaponId, key: number, wide: boolean): HTMLButtonElement => {
    const w = WEAPONS[id];
    const stats = weaponStats(id);
    const btn = h(
      'button',
      { type: 'button', class: `bas-wcard${wide ? ' bas-wcard--wide' : ''}`, role: 'radio', dataset: { weapon: id } },
      h('span', { class: 'bas-wcard__top' }, kbd(String(key)), h('span', { class: 'bas-wcard__cat' }, CATEGORY_LABEL[w.category])),
      h('span', { class: 'bas-wcard__art' }, weaponArt(id)),
      h(
        'span',
        { class: 'bas-wcard__text' },
        h('span', { class: 'bas-wcard__name bas-display' }, w.name),
        h('span', { class: 'bas-wcard__blurb' }, w.blurb),
      ),
      h(
        'span',
        { class: 'bas-stats' },
        stats.map((s) =>
          h(
            'span',
            { class: 'bas-stat' },
            h('span', { class: 'bas-stat__label' }, s.label),
            h('span', { class: 'bas-stat__bar' }, h('i', { style: { width: `${Math.round(s.value * 100)}%` } })),
            h('span', { class: 'bas-stat__value' }, s.text),
          ),
        ),
      ),
    );
    btn.addEventListener('click', () => select(id));
    cards.set(id, btn);
    return btn;
  };

  const select = (id: WeaponId): void => {
    if (PRIMARY_WEAPONS.includes(id)) loadout = { ...loadout, primary: id };
    else if (SECONDARY_WEAPONS.includes(id)) loadout = { ...loadout, secondary: id };
    paint();
  };

  const paint = (): void => {
    for (const [id, btn] of cards) {
      const active = id === loadout.primary || id === loadout.secondary;
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
      btn.tabIndex = active ? 0 : -1;
    }
    setText(kitPrimary, WEAPONS[loadout.primary].name);
    setText(kitSecondary, WEAPONS[loadout.secondary].name);
    setText(kicker, `Armurerie — ${TEAMS[team].name}`);
    el.dataset.team = String(team);
  };

  const validate = (): void => {
    if (!isValidLoadout(loadout)) {
      ctx.sound('error');
      return;
    }
    opts.onPick({ ...loadout });
  };

  const primaryList = h('div', { class: 'bas-weapons', role: 'radiogroup', 'aria-label': 'Arme principale' }, PRIMARY_WEAPONS.map((id, i) => card(id, i + 1, false)));
  const secondaryList = h(
    'div',
    { class: 'bas-weapons bas-weapons--wide', role: 'radiogroup', 'aria-label': 'Arme de poing' },
    SECONDARY_WEAPONS.map((id, i) => card(id, PRIMARY_WEAPONS.length + i + 1, true)),
  );
  arrowNav(primaryList, '.bas-wcard', 'both', true);
  arrowNav(secondaryList, '.bas-wcard', 'both', true);

  const kitRow = (slot: string, name: HTMLElement | string): HTMLElement =>
    h('li', { class: 'bas-kit__row' }, h('span', { class: 'bas-kit__slot' }, slot), typeof name === 'string' ? h('span', { class: 'bas-kit__name' }, name) : name);

  const el = h(
    'div',
    { class: 'bas-screen bas-loadout' },
    h(
      'div',
      { class: 'bas-loadout__inner' },
      h(
        'header',
        { class: 'bas-loadout__head' },
        h('div', null, kicker, h('h1', { class: 'bas-loadout__title bas-display' }, 'Choisissez vos armes')),
        h('p', { class: 'bas-loadout__note' }, 'Votre choix s’applique à la prochaine réapparition — tout de suite pendant le temps de préparation.'),
      ),
      h('section', { class: 'bas-loadout__section' }, h('h2', { class: 'bas-group__title' }, 'Arme principale'), primaryList),
      h(
        'div',
        { class: 'bas-loadout__bottom' },
        h('section', { class: 'bas-loadout__section' }, h('h2', { class: 'bas-group__title' }, 'Arme de poing'), secondaryList),
        h(
          'aside',
          { class: 'bas-kit bas-glass' },
          h('h2', { class: 'bas-group__title' }, 'Votre équipement'),
          h(
            'ul',
            { class: 'bas-kit__list' },
            kitRow('Principale', kitPrimary),
            kitRow('Poing', kitSecondary),
            kitRow('Mêlée', `${WEAPONS.knife.name} — toujours fourni`),
          ),
          button({ label: 'Valider', icon: 'check', variant: 'primary', size: 'lg', kbd: 'Entrée', onClick: validate }),
        ),
      ),
    ),
    h(
      'footer',
      { class: 'bas-screen__keys' },
      h('span', null, kbd('1'), '–', kbd(String(PRIMARY_WEAPONS.length + SECONDARY_WEAPONS.length)), ' Choisir une arme'),
      h('span', null, kbd('Entrée'), ' Valider'),
      h('span', null, kbd('Échap'), ' Retour'),
    ),
  );
  paint();

  return {
    el,
    update(next, nextTeam) {
      loadout = { ...next };
      team = nextTeam;
      paint();
    },
    onKey(e) {
      if (e.ctrlKey || e.altKey || e.metaKey) return false;
      if (e.key === 'Enter') {
        // Enter on a focused card or button keeps its native meaning.
        const active = document.activeElement;
        if (active instanceof HTMLButtonElement && !active.classList.contains('bas-wcard')) return false;
        ctx.sound('click');
        validate();
        return true;
      }
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (!m) return false;
      const all = [...PRIMARY_WEAPONS, ...SECONDARY_WEAPONS];
      const id = all[Number(m[1]) - 1];
      if (!id) return false;
      ctx.sound('click');
      select(id);
      cards.get(id)?.focus();
      return true;
    },
    back() {
      ctx.sound('back');
      opts.onBack();
    },
    mounted() {
      cards.get(loadout.primary)?.focus();
    },
    dispose() {},
  };
}
