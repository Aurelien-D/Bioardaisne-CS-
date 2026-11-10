/**
 * Small DOM helpers shared by the menus and the HUD (no framework).
 *
 *   h('button', { class: 'x', onclick: fn, 'aria-label': 'Fermer' }, 'Texte', child)
 *   svg('<svg viewBox="0 0 24 24">…</svg>', 'bas-icon')
 *   const d = new Disposer(); d.listen(window, 'resize', fn); … d.dispose();
 *
 * French typography: every string child passed to `h()` (and the `title`,
 * `aria-label`, `placeholder` and `alt` attributes) goes through `frTypo()`, which
 * puts the non-breaking spaces French punctuation requires (before « : ; ! ? »).
 * Write UI strings with plain spaces and let the helper do the rest.
 */

/** Non-breaking space (before ":" and inside « »). */
export const NBSP = ' ';
/** Narrow non-breaking space (before ";", "!" and "?"). */
export const NNBSP = ' ';

/** Apply French typographic spacing rules to a UI string. Idempotent. */
export function frTypo(text: string): string {
  if (text.length < 2) return text;
  return text
    .replace(/ :(?=\s|$)/g, `${NBSP}:`)
    .replace(/ ([;!?])/g, `${NNBSP}$1`)
    .replace(/« /g, `«${NBSP}`)
    .replace(/ »/g, `${NBSP}»`)
    .replace(/(\d) (%|ms\b|s\b|min\b|m\b|px\b|°)/g, `$1${NBSP}$2`);
}

export type Child = Node | string | number | false | null | undefined | Child[];

/** Attributes accepted by `h()`. See the function for the special keys. */
export type Attrs = Record<string, unknown>;

const TYPO_ATTRS = new Set(['title', 'aria-label', 'placeholder', 'alt']);

function appendChildren(parent: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) appendChildren(parent, c);
    else if (c instanceof Node) parent.appendChild(c);
    else parent.appendChild(document.createTextNode(frTypo(String(c))));
  }
}

/**
 * Create an HTML element.
 *  - `class`: class string; `style`: object of CSS properties (custom properties allowed: `{ '--x': '1' }`);
 *  - `dataset`: object copied to `el.dataset`;
 *  - `onxxx`: function → `addEventListener('xxx', fn)`;
 *  - `value` / `checked` / `disabled` / `tabIndex`: set as properties;
 *  - `true` → empty attribute, `false` / `null` / `undefined` → attribute omitted;
 *  - anything else → `setAttribute(key, String(value))`.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const key in attrs) {
      const v = attrs[key];
      if (v === null || v === undefined || v === false) continue;
      if (key === 'class') el.className = String(v);
      else if (key === 'style' && typeof v === 'object') {
        for (const [prop, val] of Object.entries(v as Record<string, string>)) {
          if (prop.startsWith('--')) el.style.setProperty(prop, val);
          else (el.style as unknown as Record<string, string>)[prop] = val;
        }
      } else if (key === 'dataset' && typeof v === 'object') {
        Object.assign(el.dataset, v as Record<string, string>);
      } else if (key.startsWith('on') && typeof v === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), v as EventListener);
      } else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'tabIndex') {
        (el as unknown as Record<string, unknown>)[key] = v;
      } else if (v === true) el.setAttribute(key, '');
      else el.setAttribute(key, TYPO_ATTRS.has(key) ? frTypo(String(v)) : String(v));
    }
  }
  appendChildren(el, children);
  return el;
}

/** Parse an inline SVG string into an element (crisp at any size, inherits `currentColor`). */
export function svg(markup: string, className?: string): SVGSVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup.trim();
  const el = tpl.content.firstElementChild as SVGSVGElement;
  if (className) el.setAttribute('class', className);
  if (!el.hasAttribute('aria-hidden') && !el.hasAttribute('aria-label')) el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  return el;
}

/** Remove every child of an element. */
export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Replace the children of an element. */
export function setChildren(el: Element, ...children: Child[]): void {
  clear(el);
  appendChildren(el, children);
}

/** Set the text of an element (with French typography). */
export function setText(el: Element, text: string): void {
  const t = frTypo(text);
  if (el.textContent !== t) el.textContent = t;
}

/** addEventListener that returns its own remover. */
export function listen<T extends EventTarget>(
  target: T,
  type: string,
  handler: (e: any) => void, // eslint-disable-line @typescript-eslint/no-explicit-any
  options?: boolean | AddEventListenerOptions,
): () => void {
  target.addEventListener(type, handler as EventListener, options);
  return () => target.removeEventListener(type, handler as EventListener, options);
}

/** Collects clean-up callbacks (listeners, timers…) and runs them once. */
export class Disposer {
  private fns: (() => void)[] = [];
  private done = false;

  get disposed(): boolean {
    return this.done;
  }

  add(fn: () => void): void {
    if (this.done) fn();
    else this.fns.push(fn);
  }

  listen<T extends EventTarget>(
    target: T,
    type: string,
    handler: (e: any) => void, // eslint-disable-line @typescript-eslint/no-explicit-any
    options?: boolean | AddEventListenerOptions,
  ): void {
    this.add(listen(target, type, handler, options));
  }

  timeout(fn: () => void, ms: number): number {
    const id = window.setTimeout(fn, ms);
    this.add(() => window.clearTimeout(id));
    return id;
  }

  interval(fn: () => void, ms: number): number {
    const id = window.setInterval(fn, ms);
    this.add(() => window.clearInterval(id));
    return id;
  }

  dispose(): void {
    if (this.done) return;
    this.done = true;
    for (let i = this.fns.length - 1; i >= 0; i--) {
      try {
        this.fns[i]!();
      } catch {
        /* a failing clean-up must not prevent the others */
      }
    }
    this.fns.length = 0;
  }
}

/**
 * Keep keyboard events of a text field away from the game: the key handlers of
 * the game core listen on window/document, so events are stopped at the field.
 * (Escape is left alone when `letEscape` is true so menus can still go back.)
 */
export function isolateKeys(field: HTMLElement, letEscape = true): void {
  const stop = (e: Event): void => {
    if (letEscape && (e as KeyboardEvent).key === 'Escape') return;
    e.stopPropagation();
  };
  field.addEventListener('keydown', stop);
  field.addEventListener('keyup', stop);
  field.addEventListener('keypress', stop);
}

/** True when the event target is an editable field (keyboard shortcuts must be ignored). */
export function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    return !['range', 'checkbox', 'radio', 'button', 'color', 'submit'].includes(target.type);
  }
  return false;
}

/** Focusable descendants of a container, in DOM order, visible ones only. */
export function focusables(container: HTMLElement): HTMLElement[] {
  const sel = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const out: HTMLElement[] = [];
  for (const el of container.querySelectorAll<HTMLElement>(sel)) {
    if ((el as HTMLButtonElement).disabled) continue;
    if (el.getAttribute('aria-hidden') === 'true') continue;
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
    out.push(el);
  }
  return out;
}

/** The user asked the system for less motion: skip decorative animations. */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);

/** "4 min", "2 min 15 s", "45 s". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r} s`;
  return r === 0 ? `${m} min` : `${m} min ${String(r).padStart(2, '0')} s`;
}

/** French plural helper: plural(3, 'joueur') → "3 joueurs". */
export function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n} ${n > 1 ? (pluralForm ?? `${singular}s`) : singular}`;
}
