/**
 * Game menus (DOM + CSS over the 3D canvas): title screen, loading, pause, team
 * selection and load-out. Entry point of the subsystem — see IMenus in
 * core/contracts.ts. The screens live in ui/menu/*, the look in ui/styles/*.
 *
 * Behaviour worth knowing when wiring the game core:
 *  - `root` gets one child layer covering the page; it only takes pointer events
 *    where a screen is displayed. Toasts stay visible after `hide()`.
 *  - Escape goes back one level inside the menus; from the pause root it calls
 *    `callbacks.resume()`. On a team / load-out screen shown by the game it also
 *    calls `callbacks.resume()` (there is nothing to go back to).
 *  - Screens shown by the game (`showTeamSelect`, `showLoadout`) stay up after
 *    `pickTeam` / `pickLoadout`: the game decides what comes next. When the same
 *    screens are opened from the pause menu and the game does not switch screens
 *    during the callback, the menus call `callbacks.resume()` themselves.
 *  - The pause menu opens team select / load-out with the last data it was given
 *    (`showTeamSelect`, `showLoadout`, or the optional `setTeamInfo` /
 *    `setLoadoutInfo` below, which do not display anything).
 */
import './styles/tokens.css';
import './styles/menus.css';

import type { IMenus, MenuCallbacks, MenuScreen, PauseContext, UiSound } from '../core/contracts';
import type { SettingsStore } from '../core/settings';
import type { GameModeId, TeamId } from '../../shared/types';
import { DEFAULT_LOADOUT, TEAM_DEFAULT_LOADOUT, WEAPONS, isValidLoadout, type Loadout } from '../../shared/weapons/defs';
import { Disposer, focusables, h, isTextField } from './dom';
import { initKeyLabels } from './keys';
import { createLoadingScreen, type LoadingScreen } from './menu/screenLoading';
import { createLoadoutScreen, type LoadoutScreen } from './menu/screenLoadout';
import { createMainScreen, type MainScreen, type MainSection } from './menu/screenMain';
import { createPauseScreen, type PauseScreen } from './menu/screenPause';
import { createTeamScreen, type TeamInfo, type TeamScreen } from './menu/screenTeam';
import { createToaster, rainTubes } from './menu/toast';
import type { MenuContext, Screen, ToastTone } from './menu/types';

/** IMenus plus a few optional extras for the game core, the dev harness and automated tests. */
export interface MenusApi extends IMenus {
  /**
   * Open a sub-section of the screen currently displayed, e.g. on the title screen
   * 'solo', 'create', 'join', 'options', 'options/keys', 'controls', 'credits', ''
   * (back to the root); on the pause menu 'options/audio', 'host', 'team',
   * 'loadout', 'leave', ''.
   */
  navigate(path: string): void;
  /** Refresh what "Changer d'équipe" (pause menu) will show, without displaying anything. */
  setTeamInfo(info: { counts: [number, number]; current: TeamId; mode: GameModeId }): void;
  /** Refresh what "Choisir les armes" (pause menu) will show, without displaying anything. */
  setLoadoutInfo(current: Loadout, team: TeamId): void;
  /** Show a toast from outside (e.g. "Connexion rétablie"). */
  toast(text: string, tone?: ToastTone): void;
}

export function createMenus(root: HTMLElement, settings: SettingsStore, callbacks: MenuCallbacks): MenusApi {
  const d = new Disposer();
  const layer = h('div', { class: 'bas-ui bas-menus' });
  const toaster = createToaster();
  layer.appendChild(toaster.el);
  root.appendChild(layer);
  void initKeyLabels();

  let screen: Screen | null = null;
  let current: MenuScreen = null;
  /** Incremented on every screen change: lets callbacks detect that the game navigated. */
  let navToken = 0;
  /** Team select / load-out opened from the pause menu (Escape returns there). */
  let fromPause = false;
  let pauseCtx: PauseContext | null = null;
  let teamInfo: TeamInfo = { counts: null, current: null, mode: 'tdm' };
  let loadoutInfo: { loadout: Loadout; team: TeamId } | null = null;
  /** A handler played its own sound during the current click: skip the default one. */
  let explicitSound = false;

  const ctx: MenuContext = {
    settings,
    callbacks,
    capturing: false,
    sound(kind: UiSound) {
      explicitSound = true;
      try {
        callbacks.uiSound(kind);
      } catch {
        /* audio must never break the menus */
      }
    },
    toast: (text, tone) => toaster.show(text, tone),
    rain: () => rainTubes(layer),
  };

  // --- Screen switching ------------------------------------------------------------
  const unmount = (): void => {
    if (!screen) return;
    const old = screen;
    screen = null;
    ctx.capturing = false;
    old.dispose();
    old.el.remove();
  };

  const mount = (kind: Exclude<MenuScreen, null>, next: Screen): void => {
    // Replacing a screen is instant (no fade): the 3D scene must not flash between two backdrops.
    if (screen) next.el.classList.add('is-swap');
    unmount();
    navToken++;
    screen = next;
    current = kind;
    layer.insertBefore(next.el, toaster.el);
    next.mounted?.();
  };

  const hide = (): void => {
    navToken++;
    fromPause = false;
    current = null;
    if (!screen) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && layer.contains(active)) active.blur();
    unmount();
  };

  // --- Pause sub-screens -------------------------------------------------------------
  const backToPause = (focus: string): void => {
    if (pauseCtx) {
      mountPause(pauseCtx);
      layer.querySelector<HTMLElement>(`.bas-nav__item[data-id="${focus}"]`)?.focus();
    } else {
      fromPause = false;
      callbacks.resume();
    }
  };

  /** After a pick made from the pause menu: return to the game unless the game already navigated. */
  const afterPausePick = (token: number): void => {
    if (navToken !== token) return;
    callbacks.resume();
    // Safety net: a game that does not hide the menus on resume() gets the pause menu back.
    if (navToken === token && pauseCtx) mountPause(pauseCtx);
  };

  const mountTeam = (): void => {
    const s: TeamScreen = createTeamScreen(ctx, teamInfo, {
      onPick(team) {
        const viaPause = fromPause;
        if (team === 0 || team === 1 || team === 2) teamInfo = { ...teamInfo, current: team };
        const token = navToken;
        callbacks.pickTeam(team);
        if (viaPause) {
          ctx.toast(team === -1 ? 'Affectation automatique demandée.' : team === 2 ? 'Vous passez en spectateur.' : `Vous rejoignez ${team === 0 ? 'l’Équipe Labo' : 'Les Auditeurs'}.`, 'success');
          afterPausePick(token);
        }
      },
      onBack() {
        if (fromPause) backToPause('team');
        else callbacks.resume();
      },
    });
    mount('team', s);
  };

  const currentLoadout = (): { loadout: Loadout; team: TeamId } => {
    if (loadoutInfo && isValidLoadout(loadoutInfo.loadout)) return loadoutInfo;
    const team: TeamId = loadoutInfo?.team ?? teamInfo.current ?? 0;
    return { loadout: { ...(team === 0 || team === 1 ? TEAM_DEFAULT_LOADOUT[team] : DEFAULT_LOADOUT) }, team };
  };

  const mountLoadout = (): void => {
    const info = currentLoadout();
    const s: LoadoutScreen = createLoadoutScreen(ctx, info.loadout, info.team, {
      onPick(loadout) {
        const viaPause = fromPause;
        loadoutInfo = { loadout, team: info.team };
        const token = navToken;
        callbacks.pickLoadout(loadout);
        if (viaPause) {
          ctx.toast(`Équipement enregistré : ${WEAPONS[loadout.primary].name} et ${WEAPONS[loadout.secondary].name}.`, 'success');
          afterPausePick(token);
        }
      },
      onBack() {
        if (fromPause) backToPause('loadout');
        else callbacks.resume();
      },
    });
    mount('loadout', s);
  };

  // --- IMenus ------------------------------------------------------------------------
  const showMain = (opts?: { error?: string; joinCode?: string }): void => {
    fromPause = false;
    pauseCtx = null;
    if (current !== 'main') mount('main', createMainScreen(ctx));
    (screen as MainScreen).update(opts ?? {});
  };

  const showLoading = (label: string, fraction: number): void => {
    fromPause = false;
    if (current !== 'loading') mount('loading', createLoadingScreen(ctx));
    (screen as LoadingScreen).update(label, fraction);
  };

  /** Display the pause menu (or refresh it in place when it is already displayed). */
  function mountPause(p: PauseContext): void {
    fromPause = false;
    pauseCtx = p;
    teamInfo = { ...teamInfo, mode: p.config.mode };
    if (current === 'pause') {
      (screen as PauseScreen).update(p);
      return;
    }
    mount(
      'pause',
      createPauseScreen(ctx, p, {
        team() {
          fromPause = true;
          mountTeam();
        },
        loadout() {
          fromPause = true;
          mountLoadout();
        },
      }),
    );
  }

  const showPause = (p: PauseContext): void => {
    // The game may refresh the pause context at any time (roster, host change…): while the
    // player is on a team / load-out screen opened from the pause menu, only remember it.
    if (fromPause && (current === 'team' || current === 'loadout')) {
      pauseCtx = p;
      teamInfo = { ...teamInfo, mode: p.config.mode };
      return;
    }
    mountPause(p);
  };

  const showTeamSelect = (info: { counts: [number, number]; current: TeamId; mode: GameModeId }): void => {
    teamInfo = { counts: [info.counts[0], info.counts[1]], current: info.current, mode: info.mode };
    if (current === 'team') {
      (screen as TeamScreen).update(teamInfo);
      return;
    }
    fromPause = false;
    mountTeam();
  };

  const showLoadout = (loadout: Loadout, team: TeamId): void => {
    loadoutInfo = { loadout: { ...loadout }, team };
    if (current === 'loadout') {
      (screen as LoadoutScreen).update(loadoutInfo.loadout, team);
      return;
    }
    fromPause = false;
    mountLoadout();
  };

  // --- Keyboard ------------------------------------------------------------------------
  const trapFocus = (e: KeyboardEvent): void => {
    if (!screen) return;
    const scope = screen.el.querySelector<HTMLElement>('.bas-modal') ?? screen.el;
    const items = focusables(scope);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    const inside = !!active && scope.contains(active);
    if (e.shiftKey && (!inside || active === first)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (!inside || active === last)) {
      e.preventDefault();
      first.focus();
    }
  };

  d.listen(
    window,
    'keydown',
    (e: KeyboardEvent) => {
      if (!screen) return;
      if (e.key === 'Escape') {
        // The menus own Escape while a screen is displayed.
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) screen.back();
        return;
      }
      if (ctx.capturing) return;
      if (e.key === 'Tab') {
        trapFocus(e);
        return;
      }
      if (isTextField(e.target)) return;
      if (screen.onKey?.(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );

  // --- Sounds (delegated): hover and click on every control ------------------------------
  const CONTROL = 'button, [role="button"], a[href], input[type="color"]';
  let hovered: Element | null = null;
  d.listen(layer, 'pointerover', (e: PointerEvent) => {
    const el = (e.target as Element | null)?.closest?.(CONTROL) ?? null;
    if (el === hovered) return;
    hovered = el;
    if (!el || (el as HTMLButtonElement).disabled || (el as HTMLElement).dataset.snd === 'none') return;
    ctx.sound('hover');
  });
  d.listen(layer, 'pointerleave', () => (hovered = null));
  d.listen(layer, 'click', () => (explicitSound = false), true);
  d.listen(layer, 'click', (e: MouseEvent) => {
    if (explicitSound) return;
    const el = (e.target as Element | null)?.closest?.(CONTROL) as HTMLElement | null;
    if (!el || (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return;
    const snd = el.dataset.snd;
    if (snd === 'none') return;
    ctx.sound(snd === 'back' ? 'back' : 'click');
  });
  d.listen(layer, 'change', (e: Event) => {
    if (e.target instanceof HTMLInputElement && e.target.type === 'range') ctx.sound('click');
  });

  const navigate = (path: string): void => {
    const [head = '', arg] = path.split('/');
    if (current === 'main') {
      (screen as MainScreen).open(head === '' ? null : (head as MainSection), arg);
    } else if (current === 'pause') {
      const p = screen as PauseScreen;
      if (head === 'team') {
        fromPause = true;
        mountTeam();
      } else if (head === 'loadout') {
        fromPause = true;
        mountLoadout();
      } else if (head === 'leave') p.confirmLeave();
      else p.open(head === 'options' || head === 'host' ? head : null, arg);
    }
  };

  return {
    get current() {
      return current;
    },
    showMain,
    showLoading,
    showPause,
    showTeamSelect,
    showLoadout,
    hide,
    navigate,
    setTeamInfo(info) {
      teamInfo = { counts: [info.counts[0], info.counts[1]], current: info.current, mode: info.mode };
      if (current === 'team') (screen as TeamScreen).update(teamInfo);
    },
    setLoadoutInfo(loadout, team) {
      loadoutInfo = { loadout: { ...loadout }, team };
    },
    toast: (text, tone) => toaster.show(text, tone),
    dispose() {
      hide();
      d.dispose();
      toaster.dispose();
      layer.remove();
    },
  };
}

export type { ToastTone } from './menu/types';
