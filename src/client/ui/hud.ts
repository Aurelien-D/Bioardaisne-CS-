/**
 * In-game HUD (DOM + CSS + one small canvas for the radar). Entry point of the
 * subsystem — see IHud / HudFrame in core/contracts.ts. The parts live in
 * ui/hud/*, the look in ui/styles/hud.css.
 *
 * Performance contract: `update(frame)` runs every rendered frame. Each part
 * keeps the last value it displayed and writes to the DOM only when it changes;
 * moving things use transforms / opacity, one-shot effects use the Web
 * Animations API, and nothing in the per-frame path reads layout. Sizes are in
 * rem (fluid root size from tokens.css), so the HUD scales with the viewport.
 *
 * The layer never takes the mouse (`pointer-events: none`), except the chat
 * input while it is open.
 */
import './styles/tokens.css';
import './styles/hud.css';

import type { HudCallbacks, HudFrame, IHud, KillFeedEntry } from '../core/contracts';
import type { SettingsStore } from '../core/settings';
import type { MapData } from '../../shared/maps/types';
import type { MatchState, PlayerInfo, TeamId } from '../../shared/types';
import { h } from './dom';
import { createCenter } from './hud/center';
import { createChat } from './hud/chat';
import { createKillFeed } from './hud/killfeed';
import { createRadar } from './hud/radar';
import { createReticle } from './hud/reticle';
import { createScoreboard } from './hud/scoreboard';
import { createArsenal, createVitals } from './hud/status';
import { T } from './hud/texts';
import { createTopBar } from './hud/topbar';
import { Timers } from './hud/util';
import { initKeyLabels, onKeyLabelsChange } from './keys';

/** The FPS / ping read-out is refreshed at this pace (a number changing every frame is unreadable). */
const PERF_REFRESH_MS = 500;

export function createHud(root: HTMLElement, settings: SettingsStore, callbacks: HudCallbacks): IHud {
  const timers = new Timers();
  const reticle = createReticle();
  const vitals = createVitals();
  const arsenal = createArsenal(settings, timers);
  const topbar = createTopBar();
  const feed = createKillFeed(timers);
  const radar = createRadar();
  const chat = createChat(callbacks, timers);
  const center = createCenter(settings, timers);
  const board = createScoreboard();
  const perf = h('div', { class: 'bh-perf', hidden: true });

  // Paint order: screen effects, panels, aiming point, scoreboard.
  const layer = h(
    'div',
    { class: 'bas-ui bas-hud', hidden: true },
    reticle.fx,
    radar.el,
    topbar.el,
    perf,
    feed.el,
    chat.el,
    vitals.el,
    arsenal.bar,
    arsenal.el,
    center.announceEl,
    center.interactEl,
    center.deadEl,
    center.footEl,
    reticle.anchor,
    board.el,
  );
  root.appendChild(layer);
  void initKeyLabels();

  // --- Viewport --------------------------------------------------------------------
  let aspect = window.innerWidth / Math.max(1, window.innerHeight);
  const applySize = (w: number, hgt: number): void => {
    if (w <= 0 || hgt <= 0) return;
    aspect = w / hgt;
    reticle.resize(w, hgt);
  };
  applySize(window.innerWidth, window.innerHeight);
  const observer =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver((entries) => {
          const r = entries[0]?.contentRect;
          if (r) applySize(r.width, r.height);
        })
      : null;
  observer?.observe(layer);
  const onWindowResize = (): void => {
    if (!observer) applySize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onWindowResize);

  // --- Settings ----------------------------------------------------------------------
  let showFps = false;
  const applySettings = (): void => {
    const s = settings.value;
    reticle.applySettings(s.crosshair);
    showFps = s.showFps;
    perf.hidden = !showFps;
    arsenal.refreshKeys();
    center.refreshKeys();
  };
  applySettings();
  const offSettings = settings.onChange(applySettings);
  const offKeys = onKeyLabelsChange(() => {
    arsenal.refreshKeys();
    center.refreshKeys();
  });

  // --- Per-frame state -----------------------------------------------------------------
  let visible = false;
  let team: TeamId | -1 = -1;
  let perfAt = -1e9;
  let perfText = '';
  let disposed = false;

  return {
    update(f: HudFrame): void {
      if (disposed) return;
      if (f.visible !== visible) {
        visible = f.visible;
        layer.hidden = !visible;
        if (!visible) chat.cancel();
      }
      if (!visible) return;
      const now = performance.now();

      if (f.team !== team) {
        team = f.team;
        layer.setAttribute('data-team', String(team));
        chat.setTeam(f.team);
      }

      reticle.update(f, now);
      vitals.update(f);
      arsenal.update(f);
      topbar.update(f);
      radar.update(f, aspect);
      center.update(f);

      if (showFps && now - perfAt >= PERF_REFRESH_MS) {
        perfAt = now;
        const fps = Math.max(0, Math.round(f.fps));
        const ping = Math.max(0, Math.round(f.ping));
        const text = ping > 0 ? `${fps} ${T.fps} · ${ping} ms` : `${fps} ${T.fps}`;
        if (text !== perfText) {
          perfText = text;
          perf.textContent = text;
        }
      }
    },

    setMap(map: MapData): void {
      radar.setMap(map);
      board.setMapName(map.meta.name);
      // A new map starts with a clean slate.
      feed.clear();
      center.clear();
    },

    setRoster(players: PlayerInfo[], localId: number, match: MatchState): void {
      board.setRoster(players, localId, match);
    },

    setScoreboardVisible(v: boolean): void {
      if (v === board.visible) return;
      board.setVisible(v);
      layer.classList.toggle('is-board', v);
    },

    pushKill(entry: KillFeedEntry): void {
      feed.push(entry);
    },

    hitMarker(headshot: boolean, kill: boolean): void {
      reticle.hit(headshot, kill);
    },

    damageFrom(relativeAngle: number, amount: number): void {
      reticle.damage(relativeAngle, amount, performance.now());
    },

    announce(title: string, sub?: string, tone: 'neutral' | 'good' | 'bad' = 'neutral'): void {
      if (title) center.announce(title, sub, tone);
    },

    toast(text: string): void {
      if (text) center.toast(text);
    },

    chatMessage(name: string, from: TeamId | -1, text: string, teamOnly: boolean): void {
      chat.message(name, from, text, teamOnly);
    },

    openChat(teamOnly: boolean): void {
      // The field cannot take the focus while the HUD is hidden (menus, loading).
      if (visible && !disposed) chat.open(teamOnly);
    },

    isChatOpen(): boolean {
      return chat.isOpen();
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      chat.dispose();
      timers.dispose();
      radar.dispose();
      observer?.disconnect();
      window.removeEventListener('resize', onWindowResize);
      offSettings();
      offKeys();
      layer.remove();
    },
  };
}
