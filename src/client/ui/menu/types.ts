/** Shared types of the menu modules. */
import type { MenuCallbacks, UiSound } from '../../core/contracts';
import type { SettingsStore } from '../../core/settings';

export type ToastTone = 'info' | 'success' | 'error';

/** Services every menu module receives. */
export interface MenuContext {
  readonly settings: SettingsStore;
  readonly callbacks: MenuCallbacks;
  /** Play an interface sound (never throws). */
  sound(kind: UiSound): void;
  /** Transient message at the bottom of the screen. */
  toast(text: string, tone?: ToastTone): void;
  /** Easter egg: rain of test tubes over the menu. */
  rain(): void;
  /**
   * True while a widget captures raw input (key rebinding): global shortcuts
   * other than Escape are suspended.
   */
  capturing: boolean;
}

/** A full-page screen (main, loading, pause, team, load-out). */
export interface Screen {
  readonly el: HTMLElement;
  /** Escape was pressed: go back one level. */
  back(): void;
  /** Screen-specific shortcuts (number keys…). Return true when the key was used. */
  onKey?(e: KeyboardEvent): boolean;
  /** Called once the element is in the document (initial focus). */
  mounted?(): void;
  dispose(): void;
}

/** Content of a panel inside a screen (game setup, options, credits…). */
export interface View {
  readonly el: HTMLElement;
  /** Escape: return true when the view consumed it (e.g. cancelled a key capture). */
  back?(): boolean;
  /** Give the keyboard focus to the first meaningful control. */
  focus?(): void;
  dispose(): void;
}
