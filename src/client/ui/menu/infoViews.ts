/** Read-only panels of the title screen: the controls cheat-sheet and the credits. */
import { KEY_ACTION_LABELS } from '../../core/settings';
import { GAME_TITLE } from '../../../shared/identity';
import { Disposer, clear, h, type Child } from '../dom';
import { bindingLabels, keyboardLayoutName, onKeyLabelsChange } from '../keys';
import { icon } from './icons';
import { CREDITS, CREDITS_NOTES, CREDITS_REPORT, KEY_GROUPS, VERSION_LABEL } from './texts';
import type { MenuContext, View } from './types';
import { button, group, kbd } from './widgets';

/** Key caps of every binding of an action, joined by "ou". */
function caps(labels: string[]): Child[] {
  if (labels.length === 0) return [h('span', { class: 'bas-sheet__none' }, 'non attribuée')];
  const out: Child[] = [];
  labels.forEach((l, i) => {
    if (i > 0) out.push(h('span', { class: 'bas-sheet__or' }, 'ou'));
    out.push(kbd(l));
  });
  return out;
}

/** "Commandes": cheat-sheet of the current bindings with the labels of the player's keyboard. */
export function createControlsSheet(ctx: MenuContext, openKeyOptions: () => void): View {
  const d = new Disposer();
  const grid = h('div', { class: 'bas-sheet' });
  const layout = h('span', null);

  const paint = (): void => {
    const keys = ctx.settings.value.keys;
    clear(grid);
    const columns = [h('div', { class: 'bas-sheet__col' }), h('div', { class: 'bas-sheet__col' })];
    KEY_GROUPS.forEach((g, gi) => {
      const rows = g.actions.map((a) =>
        h('div', { class: 'bas-sheet__row' }, h('span', { class: 'bas-sheet__label' }, KEY_ACTION_LABELS[a]), h('span', { class: 'bas-sheet__keys' }, caps(bindingLabels(keys[a])))),
      );
      if (g.title === 'Interface') {
        rows.push(h('div', { class: 'bas-sheet__row' }, h('span', { class: 'bas-sheet__label' }, 'Menu pause'), h('span', { class: 'bas-sheet__keys' }, kbd('Échap'))));
      }
      columns[gi < 2 ? 0 : 1]!.append(group(g.title, rows));
    });
    grid.append(...columns);
    layout.textContent = keyboardLayoutName();
  };
  paint();
  d.add(ctx.settings.onChange(paint));
  d.add(onKeyLabelsChange(paint));

  const el = h(
    'div',
    { class: 'bas-sheetview' },
    grid,
    h(
      'div',
      { class: 'bas-sheetview__footer' },
      h('p', null, icon('keyboard'), ' Clavier détecté : ', h('strong', null, layout), '. Les touches suivent la position physique : le jeu se pilote à l’identique en AZERTY et en QWERTY.'),
      button({ label: 'Modifier les touches', icon: 'sliders', variant: 'secondary', size: 'sm', onClick: openKeyOptions }),
    ),
  );
  return { el, dispose: () => d.dispose(), focus: () => el.querySelector<HTMLElement>('button')?.focus() };
}

/** "Crédits": short, tongue-in-cheek, laid out like a lab report. */
export function createCredits(_ctx: MenuContext): View {
  const el = h(
    'div',
    { class: 'bas-credits' },
    h(
      'div',
      { class: 'bas-credits__col' },
      group(
        'L’équipe',
        h(
          'ul',
          { class: 'bas-credits__list' },
          CREDITS.map((c) => h('li', null, h('span', { class: 'bas-credits__role' }, c.role), h('span', { class: 'bas-credits__who' }, c.who))),
        ),
      ),
    ),
    h(
      'div',
      { class: 'bas-credits__col' },
      h(
        'div',
        { class: 'bas-report' },
        h(
          'div',
          { class: 'bas-report__head' },
          h('div', null, h('div', { class: 'bas-kicker' }, 'Compte rendu d’analyses'), h('div', { class: 'bas-report__title bas-display' }, GAME_TITLE)),
          h('div', { class: 'bas-report__stamp' }, VERSION_LABEL),
        ),
        h(
          'table',
          { class: 'bas-report__table' },
          h('thead', null, h('tr', null, h('th', null, 'Analyse'), h('th', null, 'Résultat'), h('th', null, 'Valeurs de référence'))),
          h(
            'tbody',
            null,
            CREDITS_REPORT.map((r) =>
              h('tr', null, h('td', null, r.test), h('td', { class: r.flag === 'high' ? 'is-high' : r.flag === 'ok' ? 'is-ok' : '' }, r.result, r.flag === 'high' ? ' ↑' : ''), h('td', null, r.ref)),
            ),
          ),
        ),
        h('p', { class: 'bas-report__sign' }, 'Validé biologiquement par : le technicien de garde (signature illisible)'),
      ),
      h(
        'ul',
        { class: 'bas-credits__notes' },
        CREDITS_NOTES.map((n) => h('li', null, icon('tube'), h('span', null, n))),
      ),
    ),
  );
  return { el, dispose() {} };
}
