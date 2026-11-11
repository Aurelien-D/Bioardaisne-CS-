/**
 * Reusable menu controls: buttons, sliders, switches, segmented choices, tabs,
 * setting rows. All of them are plain DOM built with `h()`; sounds are handled by
 * delegation in menus.ts (`data-snd="back" | "none"` overrides the default click).
 */
import { clamp, h, type Child } from '../dom';
import { icon, type IconName } from './icons';

// ---------------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------------

export interface ButtonOpts {
  label: string;
  icon?: IconName;
  iconEnd?: IconName;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  /** Key cap shown at the end of the label (purely informative). */
  kbd?: string;
  /** Sound played on click (default 'click'). */
  sound?: 'click' | 'back' | 'none';
  title?: string;
  class?: string;
  onClick(e: MouseEvent): void;
}

export function button(opts: ButtonOpts): HTMLButtonElement {
  const cls = ['bas-btn', `bas-btn--${opts.variant ?? 'secondary'}`, `bas-btn--${opts.size ?? 'md'}`];
  if (opts.class) cls.push(opts.class);
  return h(
    'button',
    {
      type: 'button',
      class: cls.join(' '),
      title: opts.title,
      dataset: opts.sound && opts.sound !== 'click' ? { snd: opts.sound } : undefined,
      onclick: opts.onClick,
    },
    opts.icon ? icon(opts.icon) : null,
    h('span', { class: 'bas-btn__label' }, opts.label),
    opts.iconEnd ? icon(opts.iconEnd) : null,
    opts.kbd ? kbd(opts.kbd) : null,
  );
}

/** Square icon-only button (close, dice…). */
export function iconButton(name: IconName, label: string, onClick: (e: MouseEvent) => void, sound?: 'back' | 'none'): HTMLButtonElement {
  return h(
    'button',
    { type: 'button', class: 'bas-iconbtn', 'aria-label': label, title: label, dataset: sound ? { snd: sound } : undefined, onclick: onClick },
    icon(name),
  );
}

export function kbd(label: string): HTMLElement {
  return h('kbd', { class: 'bas-kbd' }, label);
}

// ---------------------------------------------------------------------------------
// Slider
// ---------------------------------------------------------------------------------

export interface SliderOpts {
  /** Accessible name. */
  label: string;
  min?: number;
  max?: number;
  step?: number;
  /** Discrete list of allowed values (replaces min / max / step). */
  values?: readonly number[];
  value: number;
  format(v: number): string;
  /** Called continuously while dragging. */
  onInput(v: number): void;
}

export interface Slider {
  readonly el: HTMLElement;
  value(): number;
  set(v: number): void;
  setDisabled(disabled: boolean): void;
}

export function slider(opts: SliderOpts): Slider {
  const values = opts.values;
  const min = values ? 0 : (opts.min ?? 0);
  const max = values ? values.length - 1 : (opts.max ?? 1);
  const step = values ? 1 : (opts.step ?? 1);

  const toRaw = (v: number): number => {
    if (!values) return clamp(v, min, max);
    let best = 0;
    for (let i = 1; i < values.length; i++) if (Math.abs(values[i]! - v) < Math.abs(values[best]! - v)) best = i;
    return best;
  };
  const fromRaw = (raw: number): number => {
    if (values) return values[clamp(Math.round(raw), 0, values.length - 1)]!;
    // Snap to the step grid without floating point dust (0.30000000004).
    const snapped = Math.round((raw - min) / step) * step + min;
    return clamp(Number(snapped.toFixed(6)), min, max);
  };

  const input = h('input', {
    type: 'range',
    class: 'bas-slider__input',
    min: String(min),
    max: String(max),
    step: String(step),
    'aria-label': opts.label,
  });
  const out = h('output', { class: 'bas-slider__value' });
  const el = h('div', { class: 'bas-slider' }, input, out);

  const paint = (): void => {
    const raw = Number(input.value);
    const v = fromRaw(raw);
    const pct = max > min ? ((raw - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--fill', `${pct}%`);
    const text = opts.format(v);
    out.textContent = text;
    input.setAttribute('aria-valuetext', text);
  };
  input.value = String(toRaw(opts.value));
  paint();
  input.addEventListener('input', () => {
    paint();
    opts.onInput(fromRaw(Number(input.value)));
  });

  return {
    el,
    value: () => fromRaw(Number(input.value)),
    set(v: number) {
      input.value = String(toRaw(v));
      paint();
    },
    setDisabled(disabled: boolean) {
      input.disabled = disabled;
      el.classList.toggle('is-disabled', disabled);
    },
  };
}

// ---------------------------------------------------------------------------------
// Switch
// ---------------------------------------------------------------------------------

export interface Toggle {
  readonly el: HTMLButtonElement;
  set(on: boolean): void;
  setDisabled(disabled: boolean): void;
}

export function toggle(opts: { label: string; value: boolean; onChange(on: boolean): void; texts?: [on: string, off: string] }): Toggle {
  const texts = opts.texts ?? ['Activé', 'Désactivé'];
  const text = h('span', { class: 'bas-toggle__text' });
  const el = h(
    'button',
    { type: 'button', class: 'bas-toggle', role: 'switch', 'aria-label': opts.label },
    h('span', { class: 'bas-toggle__track' }, h('span', { class: 'bas-toggle__thumb' })),
    text,
  );
  let on = opts.value;
  const paint = (): void => {
    el.setAttribute('aria-checked', on ? 'true' : 'false');
    text.textContent = on ? texts[0] : texts[1];
  };
  paint();
  el.addEventListener('click', () => {
    on = !on;
    paint();
    opts.onChange(on);
  });
  return {
    el,
    set(v: boolean) {
      on = v;
      paint();
    },
    setDisabled(disabled: boolean) {
      el.disabled = disabled;
    },
  };
}

// ---------------------------------------------------------------------------------
// Segmented choice (radio group)
// ---------------------------------------------------------------------------------

export interface Segmented<T> {
  readonly el: HTMLElement;
  set(value: T): void;
}

export function segmented<T extends string | number>(opts: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange(value: T): void;
}): Segmented<T> {
  const buttons = opts.options.map((o) =>
    h('button', { type: 'button', class: 'bas-seg__btn', role: 'radio', dataset: { value: String(o.value) } }, o.label),
  );
  const el = h('div', { class: 'bas-seg', role: 'radiogroup', 'aria-label': opts.label }, buttons);
  let current = opts.value;
  const paint = (): void => {
    buttons.forEach((b, i) => {
      const active = opts.options[i]!.value === current;
      b.setAttribute('aria-checked', active ? 'true' : 'false');
      b.tabIndex = active ? 0 : -1;
    });
  };
  paint();
  const select = (i: number, focus: boolean): void => {
    const o = opts.options[i];
    if (!o) return;
    if (focus) buttons[i]!.focus();
    if (o.value === current) return;
    current = o.value;
    paint();
    opts.onChange(current);
  };
  buttons.forEach((b, i) => b.addEventListener('click', () => select(i, false)));
  el.addEventListener('keydown', (e) => {
    const i = opts.options.findIndex((o) => o.value === current);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      select((i + 1) % buttons.length, true);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      select((i - 1 + buttons.length) % buttons.length, true);
    }
  });
  return {
    el,
    set(v: T) {
      current = v;
      paint();
    },
  };
}

// ---------------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------------

export interface Tabs<T> {
  readonly el: HTMLElement;
  set(id: T): void;
}

export function tabs<T extends string>(opts: {
  label: string;
  tabs: { id: T; label: string; icon?: IconName }[];
  active: T;
  onSelect(id: T): void;
}): Tabs<T> {
  const buttons = opts.tabs.map((t) =>
    h('button', { type: 'button', class: 'bas-tab', role: 'tab', dataset: { tab: t.id } }, t.icon ? icon(t.icon) : null, h('span', null, t.label)),
  );
  const el = h('div', { class: 'bas-tabs', role: 'tablist', 'aria-label': opts.label }, buttons);
  let current = opts.active;
  const paint = (): void => {
    buttons.forEach((b, i) => {
      const active = opts.tabs[i]!.id === current;
      b.setAttribute('aria-selected', active ? 'true' : 'false');
      b.tabIndex = active ? 0 : -1;
    });
  };
  paint();
  const select = (i: number, focus: boolean): void => {
    const t = opts.tabs[i];
    if (!t) return;
    if (focus) buttons[i]!.focus();
    if (t.id === current) return;
    current = t.id;
    paint();
    opts.onSelect(current);
  };
  buttons.forEach((b, i) => b.addEventListener('click', () => select(i, false)));
  el.addEventListener('keydown', (e) => {
    const i = opts.tabs.findIndex((t) => t.id === current);
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      select((i + 1) % buttons.length, true);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      select((i - 1 + buttons.length) % buttons.length, true);
    }
  });
  return {
    el,
    set(id: T) {
      current = id;
      paint();
    },
  };
}

// ---------------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------------

/** One setting: label (+ optional hint) on the left, control on the right. */
export function row(label: string, control: Child, hint?: Child): HTMLElement {
  return h(
    'div',
    { class: 'bas-row' },
    h('div', { class: 'bas-row__label' }, h('span', null, label), hint ? h('small', null, hint) : null),
    h('div', { class: 'bas-row__control' }, control),
  );
}

/** Titled group of rows / cards. */
export function group(title: string, ...children: Child[]): HTMLElement {
  return h('section', { class: 'bas-group' }, h('h3', { class: 'bas-group__title' }, title), children);
}

/** Inline message box. */
export function notice(tone: 'info' | 'warn' | 'error' | 'success', ...children: Child[]): HTMLElement {
  const ic: IconName = tone === 'info' ? 'info' : tone === 'success' ? 'check' : 'alert';
  return h('div', { class: `bas-notice bas-notice--${tone}`, role: tone === 'error' ? 'alert' : 'note' }, icon(ic), h('div', { class: 'bas-notice__body' }, children));
}

/**
 * Arrow-key navigation inside a list of sibling controls (vertical menus, card
 * grids). Tab still moves in and out of the list. With `activate`, moving also
 * selects the control (radio-group behaviour), except disabled choices.
 */
export function arrowNav(
  container: HTMLElement,
  selector: string,
  orientation: 'vertical' | 'horizontal' | 'both' = 'vertical',
  activate = false,
): void {
  container.addEventListener('keydown', (e) => {
    const prev = orientation !== 'horizontal' && e.key === 'ArrowUp' ? true : orientation !== 'vertical' && e.key === 'ArrowLeft';
    const next = orientation !== 'horizontal' && e.key === 'ArrowDown' ? true : orientation !== 'vertical' && e.key === 'ArrowRight';
    if (!prev && !next) return;
    const items = [...container.querySelectorAll<HTMLElement>(selector)].filter((el) => !(el as HTMLButtonElement).disabled);
    if (items.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const i = active ? items.indexOf(active) : -1;
    if (i < 0) return;
    e.preventDefault();
    const target = items[(i + (next ? 1 : -1) + items.length) % items.length]!;
    target.focus();
    if (activate && target.getAttribute('aria-disabled') !== 'true') target.click();
  });
}

const NUM2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** French decimal notation: "2,00". */
export const fmt2 = (v: number): string => NUM2.format(v);
/** "80 %" with a non-breaking space. */
export const fmtPercent = (v: number): string => `${Math.round(v * 100)}\u00a0%`;
