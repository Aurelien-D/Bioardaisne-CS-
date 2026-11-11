/**
 * Small helpers shared by the HUD parts.
 *
 * The HUD is updated every rendered frame, so every part keeps the last value it
 * wrote and only touches the DOM when that value changes. These helpers wrap the
 * few DOM writes that are used everywhere.
 */

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** "1:05" (minutes are not padded, like a match clock). Negative values clamp to 0:00. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds - 1e-6));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

/** Toggle a boolean attribute (present / absent). Callers cache the state themselves. */
export function setFlag(el: Element, name: string, on: boolean): void {
  if (on) el.setAttribute(name, '');
  else el.removeAttribute(name);
}

/**
 * Timers that can all be cancelled at once (dispose) and never fire afterwards.
 * Used for the life cycle of transient rows (kill feed, chat, toasts, announcements):
 * they must expire even while `update()` is not being called.
 */
export class Timers {
  private ids = new Set<number>();
  private dead = false;

  after(ms: number, fn: () => void): number {
    if (this.dead) return 0;
    const id = window.setTimeout(() => {
      this.ids.delete(id);
      if (!this.dead) fn();
    }, ms);
    this.ids.add(id);
    return id;
  }

  cancel(id: number): void {
    if (this.ids.delete(id)) window.clearTimeout(id);
  }

  dispose(): void {
    this.dead = true;
    for (const id of this.ids) window.clearTimeout(id);
    this.ids.clear();
  }
}

/**
 * Restart a one-shot animation on an element without forcing a layout: the Web
 * Animations API replaces the running animation instead of needing the usual
 * "remove class, read offsetWidth, add class" trick.
 */
export function play(el: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  if (typeof el.animate !== 'function') return null;
  for (const a of el.getAnimations()) a.cancel();
  return el.animate(keyframes, options);
}

/** Device pixel ratio capped for canvases (above 2 the gain is invisible on a small radar). */
export const canvasDpr = (): number => clamp(window.devicePixelRatio || 1, 1, 2);
