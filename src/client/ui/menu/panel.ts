/** Glass content panel (title bar, scrolling body, optional action footer) and the lab tips widget. */
import { BRAND_LOGO, BRAND_WORDMARK } from '../../core/brand';
import type { KeyAction, SettingsStore } from '../../core/settings';
import { Disposer, clear, h, prefersReducedMotion, type Child } from '../dom';
import { bindingLabel } from '../keys';
import { icon, type IconName } from './icons';
import { LAB_TIPS } from './texts';
import { iconButton, kbd } from './widgets';

export interface PanelOpts {
  icon: IconName;
  title: string;
  sub?: string;
  body: Child;
  footer?: Child;
  /** Adds a close button in the title bar. */
  onClose?: () => void;
  class?: string;
}

let panelUid = 0;

export function panel(opts: PanelOpts): HTMLElement {
  const titleId = `bas-panel-${++panelUid}`;
  return h(
    'section',
    { class: `bas-panel bas-glass${opts.class ? ` ${opts.class}` : ''}`, 'aria-labelledby': titleId },
    h(
      'header',
      { class: 'bas-panel__head' },
      h('span', { class: 'bas-panel__icon' }, icon(opts.icon)),
      h(
        'div',
        { class: 'bas-panel__titles' },
        h('h2', { class: 'bas-panel__title bas-display', id: titleId }, opts.title),
        opts.sub ? h('p', { class: 'bas-panel__sub' }, opts.sub) : null,
      ),
      opts.onClose ? iconButton('close', 'Fermer (Échap)', opts.onClose, 'back') : null,
    ),
    h('div', { class: 'bas-panel__body' }, opts.body),
    opts.footer ? h('footer', { class: 'bas-panel__foot' }, opts.footer) : null,
  );
}

/** Turn "Maintenez {walk} pour…" into text + key caps of the current bindings. */
export function tipNodes(tip: string, settings: SettingsStore): Child[] {
  const keys = settings.value.keys;
  const out: Child[] = [];
  const re = /\{(\w+)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tip))) {
    if (m.index > last) out.push(tip.slice(last, m.index));
    out.push(kbd(bindingLabel(keys[m[1] as KeyAction])));
    last = m.index + m[0].length;
  }
  if (last < tip.length) out.push(tip.slice(last));
  return out;
}

export interface TipCard {
  readonly el: HTMLElement;
  dispose(): void;
}

/** "Astuce du labo" card cycling through LAB_TIPS in a random order. */
export function createTipCard(settings: SettingsStore, periodMs = 7000): TipCard {
  const d = new Disposer();
  const order = LAB_TIPS.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  let index = 0;
  const text = h('p', { class: 'bas-tip__text' });
  const counter = h('span', { class: 'bas-tip__count' });
  const el = h(
    'aside',
    { class: 'bas-tip' },
    h('span', { class: 'bas-tip__icon' }, icon('tube')),
    h('div', { class: 'bas-tip__body' }, h('div', { class: 'bas-tip__head' }, h('span', { class: 'bas-kicker' }, 'Astuce du labo'), counter), text),
  );
  const paint = (): void => {
    clear(text);
    // Through h() so the French non-breaking spaces are applied to every fragment.
    text.append(h('span', null, tipNodes(LAB_TIPS[order[index]!]!, settings)));
    counter.textContent = `${index + 1}/${order.length}`;
  };
  paint();
  d.interval(() => {
    index = (index + 1) % order.length;
    if (prefersReducedMotion()) {
      paint();
      return;
    }
    text.classList.add('is-swapping');
    d.timeout(() => {
      paint();
      text.classList.remove('is-swapping');
    }, 180);
  }, periodMs);
  return { el, dispose: () => d.dispose() };
}

/**
 * Signature of the laboratory behind the game: the official Bio Ard'Aisne logo
 * (core/brand.ts, shown unmodified, white-text variant for dark backgrounds).
 * The game's own emblem (menu/logo.ts) stays the title; this is the "presented by".
 */
export function presentedBy(caption = 'Un jeu du'): HTMLElement {
  return h(
    'div',
    { class: 'bas-presented' },
    h('span', { class: 'bas-presented__caption' }, caption),
    h('img', {
      class: 'bas-presented__logo',
      src: BRAND_LOGO.horizontalDark,
      alt: `${BRAND_WORDMARK.top} ${BRAND_WORDMARK.bottom}`,
      width: '1164',
      height: '310',
      draggable: 'false',
      // The game must still look right if the brand files are missing.
      onerror: (e: Event) => ((e.target as HTMLElement).closest<HTMLElement>('.bas-presented')!.hidden = true),
    }),
  );
}
