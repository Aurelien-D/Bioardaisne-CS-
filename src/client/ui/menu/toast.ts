/** Transient confirmation messages ("Lien copié !") and the test-tube rain easter egg. */
import { h, prefersReducedMotion, svg } from '../dom';
import { icon } from './icons';
import type { ToastTone } from './types';

export interface Toaster {
  readonly el: HTMLElement;
  show(text: string, tone?: ToastTone): void;
  dispose(): void;
}

export function createToaster(): Toaster {
  const el = h('div', { class: 'bas-toasts', 'aria-live': 'polite', role: 'status' });
  const timers = new Set<number>();
  const later = (fn: () => void, ms: number): void => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };

  return {
    el,
    show(text, tone = 'info') {
      // Keep at most three messages on screen.
      while (el.children.length >= 3) el.firstElementChild?.remove();
      const item = h(
        'div',
        { class: `bas-toast bas-toast--${tone}` },
        icon(tone === 'error' ? 'alert' : tone === 'success' ? 'check' : 'tube'),
        h('span', null, text),
      );
      el.appendChild(item);
      later(() => item.classList.add('is-leaving'), 3200);
      later(() => item.remove(), 3500);
    },
    dispose() {
      for (const id of timers) window.clearTimeout(id);
      timers.clear();
      el.remove();
    },
  };
}

const TUBE_COLORS = ['#e7343f', '#8e5bd0', '#3182ce', '#45d6a0', '#ffc24a'];

function tubeSprite(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 44">
    <rect x="2" y="0.5" width="12" height="7" rx="1.5" fill="${color}"/>
    <path d="M3.5 7.5h9V36a4.5 4.5 0 0 1-9 0z" fill="rgba(235,246,255,0.22)" stroke="rgba(235,246,255,0.75)" stroke-width="1"/>
    <path d="M4.5 20h7v16a3.5 3.5 0 0 1-7 0z" fill="#d62a36"/>
  </svg>`;
}

function dropSprite(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 22">
    <path d="M8 1c4 5.5 6.5 8.8 6.5 12.5a6.5 6.5 0 0 1-13 0C1.5 9.8 4 6.5 8 1z" fill="#e7343f"/>
    <path d="M4.8 14a3.4 3.4 0 0 0 2.2 3" fill="none" stroke="#fff" stroke-opacity="0.75" stroke-width="1.2" stroke-linecap="round"/>
  </svg>`;
}

/**
 * Harmless surprise: a shower of small test tubes and drops falling across the
 * menu. Purely decorative (pointer-events: none), removes itself when done.
 * With reduced motion nothing falls: the caller's toast is the whole surprise.
 */
export function rainTubes(host: HTMLElement): void {
  if (prefersReducedMotion()) return;
  host.querySelector('.bas-rain')?.remove();
  const layer = h('div', { class: 'bas-rain', 'aria-hidden': 'true' });
  const count = 46;
  let longest = 0;
  for (let i = 0; i < count; i++) {
    const isDrop = i % 3 === 2;
    const sprite = svg(isDrop ? dropSprite() : tubeSprite(TUBE_COLORS[i % TUBE_COLORS.length]!), 'bas-rain__item');
    const duration = 1.5 + Math.random() * 1.8;
    const delay = Math.random() * 1.6;
    const size = (isDrop ? 0.8 : 1.1) + Math.random() * 0.9;
    longest = Math.max(longest, duration + delay);
    sprite.style.left = `${(Math.random() * 100).toFixed(2)}%`;
    sprite.style.width = `${size.toFixed(2)}rem`;
    sprite.style.animationDuration = `${duration.toFixed(2)}s`;
    sprite.style.animationDelay = `${delay.toFixed(2)}s`;
    sprite.style.setProperty('--spin', `${Math.round((Math.random() - 0.5) * 540)}deg`);
    sprite.style.setProperty('--drift', `${((Math.random() - 0.5) * 12).toFixed(1)}vw`);
    layer.appendChild(sprite);
  }
  host.appendChild(layer);
  window.setTimeout(() => layer.remove(), (longest + 0.3) * 1000);
}
