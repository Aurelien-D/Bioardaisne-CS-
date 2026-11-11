/** Full-screen loading: logo, test-tube progress bar, current step and rotating lab tips. */
import { GAME_TAGLINE, GAME_TITLE } from '../../../shared/identity';
import { clamp, h, setText } from '../dom';
import { createLogo } from './logo';
import { createTipCard, presentedBy } from './panel';
import { VERSION_LABEL } from './texts';
import type { MenuContext, Screen } from './types';

export interface LoadingScreen extends Screen {
  update(label: string, fraction: number): void;
}

export function createLoadingScreen(ctx: MenuContext): LoadingScreen {
  const tip = createTipCard(ctx.settings, 5500);
  const label = h('span', { class: 'bas-loading__label' });
  const percent = h('span', { class: 'bas-loading__percent bas-display' });
  const fill = h('div', { class: 'bas-tubebar__fill' });
  const bar = h(
    'div',
    { class: 'bas-tubebar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': 'Chargement' },
    h('div', { class: 'bas-tubebar__cap' }),
    h('div', { class: 'bas-tubebar__glass' }, fill, h('div', { class: 'bas-tubebar__ticks' }), h('div', { class: 'bas-tubebar__shine' })),
  );

  const el = h(
    'div',
    { class: 'bas-screen bas-loading' },
    h('div', { class: 'bas-loading__bg', 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'bas-loading__center' },
      createLogo('stacked', 'bas-loading__logo', GAME_TITLE),
      h('p', { class: 'bas-loading__tagline' }, GAME_TAGLINE),
      h('div', { class: 'bas-loading__progress' }, h('div', { class: 'bas-loading__row' }, label, percent), bar),
    ),
    h('div', { class: 'bas-loading__tip' }, tip.el),
    h('div', { class: 'bas-loading__footer' }, h('span', null, VERSION_LABEL), h('div', { class: 'bas-ecg', 'aria-hidden': 'true' }), presentedBy()),
  );

  return {
    el,
    update(text, fraction) {
      const f = clamp(Number.isFinite(fraction) ? fraction : 0, 0, 1);
      const pct = Math.round(f * 100);
      setText(label, text || 'Chargement…');
      percent.textContent = `${pct}\u00a0%`;
      fill.style.transform = `scaleX(${f.toFixed(4)})`;
      bar.setAttribute('aria-valuenow', String(pct));
      bar.setAttribute('aria-valuetext', `${text} — ${pct} %`);
    },
    back() {
      /* nothing to go back to while loading */
    },
    dispose() {
      tip.dispose();
    },
  };
}
