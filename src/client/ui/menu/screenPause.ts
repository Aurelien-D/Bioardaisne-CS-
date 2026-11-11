/**
 * Pause menu: resume, options, team / load-out shortcuts, room invitation card,
 * host settings and "quit" with confirmation.
 */
import type { PauseContext } from '../../core/contracts';
import { MODE_INFO, type RoomConfig } from '../../../shared/types';
import { Disposer, clear, formatDuration, h, plural, setText } from '../dom';
import { botFillText, createGameSetup, type GameSetup } from './gameSetup';
import { icon, type IconName } from './icons';
import { createLogo } from './logo';
import { createMapThumb } from './mapThumb';
import { createOptions, type OptionsTab, type OptionsView } from './options';
import { createTipCard, panel } from './panel';
import { availableMaps, diffConfig, sanitizeSetup } from './setupStore';
import { DIFFICULTY_LABELS, SECTION_TEXT } from './texts';
import type { MenuContext, Screen, View } from './types';
import { arrowNav, button, kbd } from './widgets';

export type PauseSection = 'options' | 'host';

export interface PauseScreen extends Screen {
  update(pause: PauseContext): void;
  open(section: PauseSection | null, arg?: string): void;
  /** Ask for confirmation before leaving (also used by automation). */
  confirmLeave(): void;
}

/** Settings the room can change without restarting the match. */
const LIVE_KEYS: (keyof RoomConfig)[] = ['botFill', 'botDifficulty'];

const CONFIG_LABELS: Partial<Record<keyof RoomConfig, string>> = {
  mapId: 'carte',
  mode: 'mode',
  botFill: 'nombre de joueurs',
  botDifficulty: 'niveau des bots',
  roundTime: 'durée des manches',
  roundsToWin: 'manches gagnantes',
  killLimit: 'quota d’éliminations',
  friendlyFire: 'tir allié',
  freezeTime: 'temps de préparation',
};

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* permission denied or insecure context: try the legacy way */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function createPauseScreen(ctx: MenuContext, initial: PauseContext, go: { team(): void; loadout(): void }): PauseScreen {
  const d = new Disposer();
  let pause = initial;
  let section: PauseSection | null = null;
  let view: View | null = null;
  let viewDisposer = new Disposer();
  let modal: HTMLElement | null = null;
  let modalReturnFocus: HTMLElement | null = null;
  let hostDirty = false;

  const subtitle = h('p', { class: 'bas-pause__sub' });
  const nav = h('nav', { class: 'bas-nav bas-nav--pause', 'aria-label': 'Menu pause' });
  arrowNav(nav, '.bas-nav__item');
  const navButtons = new Map<string, HTMLButtonElement>();
  const stage = h('div', { class: 'bas-pause__stage' });
  // Online, nobody waits for a paused player.
  const liveNote = h('p', { class: 'bas-pause__note' }, icon('ecg'), h('span', null, 'Le salon ne s’arrête pas pendant la pause : restez à couvert.'));

  const navItem = (id: string, label: string, ic: IconName, onClick: () => void, extra = ''): HTMLButtonElement => {
    const btn = h(
      'button',
      { type: 'button', class: `bas-nav__item ${extra}`.trim(), dataset: { id }, onclick: onClick },
      icon(ic),
      h('span', { class: 'bas-nav__label bas-display' }, label),
      id === 'host' && !pause.local ? h('span', { class: 'bas-badge' }, 'Hôte') : null,
      id === 'resume' ? kbd('Échap') : icon('chevronRight', 'bas-nav__chevron'),
    );
    navButtons.set(id, btn);
    return btn;
  };

  const paintNav = (): void => {
    clear(nav);
    navButtons.clear();
    nav.append(
      navItem('resume', 'Reprendre', 'play', () => ctx.callbacks.resume(), 'bas-nav__item--primary'),
      navItem('options', 'Options', 'sliders', () => open('options'), 'bas-nav__item--gap'),
      navItem('team', 'Changer d’équipe', 'users', () => go.team()),
      navItem('loadout', 'Choisir les armes', 'gun', () => go.loadout()),
    );
    if (pause.isHost) nav.append(navItem('host', pause.local ? 'Régler la partie' : 'Régler le salon', 'crown', () => open('host')));
    nav.append(navItem('leave', 'Quitter la partie', 'exit', () => confirmLeave(), 'bas-nav__item--gap bas-nav__item--danger'));
    for (const [id, btn] of navButtons) {
      if (id === section) btn.setAttribute('aria-current', 'page');
    }
    setText(subtitle, pause.local ? 'Partie solo' : pause.roomCode ? `Salon privé ${pause.roomCode}` : 'Partie en ligne');
    liveNote.hidden = pause.local;
  };

  const closeView = (): void => {
    viewDisposer.dispose();
    viewDisposer = new Disposer();
    view?.dispose();
    view = null;
    hostDirty = false;
    clear(stage);
  };

  // --- Overview: invitation card + current match ------------------------------------
  const roomCard = (code: string): HTMLElement => {
    const url = pause.shareUrl ?? `${location.origin}${location.pathname}?room=${encodeURIComponent(code)}`;
    const urlField = h('input', { type: 'text', class: 'bas-input bas-room__url', readonly: true, 'aria-label': 'Lien d’invitation', value: url });
    urlField.addEventListener('focus', () => urlField.select());
    const copy = async (text: string, okMsg: string): Promise<void> => {
      if (await copyText(text)) ctx.toast(okMsg, 'success');
      else {
        urlField.focus();
        urlField.select();
        ctx.sound('error');
        ctx.toast('Copie automatique impossible : le lien est sélectionné, faites Ctrl + C.', 'error');
      }
    };
    return h(
      'section',
      { class: 'bas-room bas-glass' },
      h(
        'div',
        { class: 'bas-room__code' },
        h('div', { class: 'bas-kicker' }, 'Salon privé — code d’invitation'),
        h(
          'div',
          { class: 'bas-code', role: 'img', 'aria-label': `Code du salon : ${code.split('').join(' ')}` },
          code.split('').map((c) => h('span', { class: 'bas-code__cell bas-display' }, c)),
        ),
        button({ label: 'Copier le code', icon: 'copy', variant: 'ghost', size: 'sm', onClick: () => void copy(code, 'Code du salon copié !') }),
      ),
      h(
        'div',
        { class: 'bas-room__share' },
        h(
          'p',
          null,
          pause.hostedHere
            ? 'Envoyez ce lien à vos collègues : il ouvre le jeu directement dans votre salon. Gardez cet onglet ouvert : la partie tourne dans votre navigateur.'
            : 'Envoyez ce lien à vos collègues : il ouvre le jeu directement dans votre salon. Le code suffit aussi, via « Rejoindre un salon ».',
        ),
        urlField,
        button({
          label: 'Copier le lien d’invitation',
          icon: 'link',
          variant: 'primary',
          onClick: () => void copy(url, 'Lien d’invitation copié ! Il ne reste plus qu’à le coller à vos collègues.'),
        }),
      ),
    );
  };

  const chip = (ic: IconName, text: string): HTMLElement => h('li', { class: 'bas-chip' }, icon(ic), h('span', null, text));

  const matchCard = (): HTMLElement => {
    const cfg = pause.config;
    const map = availableMaps(cfg.mapId).find((m) => m.id === cfg.mapId);
    const chips = [
      chip('bot', cfg.botFill < 2 ? 'Aucun bot' : `${botFillText(cfg.botFill)} · bots : ${DIFFICULTY_LABELS[cfg.botDifficulty] ?? 'Normal'}`),
      chip('clock', `Manches de ${formatDuration(cfg.roundTime)}`),
      chip('flag', `${plural(cfg.roundsToWin, 'manche')} pour gagner`),
    ];
    if (cfg.mode === 'tdm' && cfg.killLimit > 0) chips.push(chip('target', `Quota : ${plural(cfg.killLimit, 'élimination')}`));
    chips.push(chip('alert', cfg.friendlyFire ? 'Tir allié activé' : 'Tir allié désactivé'));
    return h(
      'section',
      { class: 'bas-match bas-glass' },
      h('div', { class: 'bas-match__thumb' }, createMapThumb(cfg.mapId)),
      h(
        'div',
        { class: 'bas-match__body' },
        h('div', { class: 'bas-kicker' }, pause.local ? 'Partie solo en cours' : 'Partie en cours'),
        h('h2', { class: 'bas-match__map bas-display' }, map?.name ?? cfg.mapId),
        h('p', { class: 'bas-match__mode' }, MODE_INFO[cfg.mode].name),
        h('ul', { class: 'bas-chips' }, chips),
        pause.isHost
          ? h(
              'div',
              { class: 'bas-match__host' },
              h('span', null, icon('crown'), pause.local ? 'Vous pouvez changer de carte, de mode ou de bots à tout moment.' : 'Vous êtes l’hôte : la carte, le mode et les bots sont entre vos mains.'),
              button({ label: 'Modifier', icon: 'sliders', variant: 'secondary', size: 'sm', onClick: () => open('host') }),
            )
          : !pause.local
            ? h('div', { class: 'bas-match__host' }, h('span', null, icon('info'), 'Seul l’hôte du salon peut changer la carte, le mode et les bots.'))
            : null,
      ),
    );
  };

  const showOverview = (): void => {
    const tip = createTipCard(ctx.settings, 9000);
    viewDisposer.add(() => tip.dispose());
    stage.append(h('div', { class: 'bas-pause__overview' }, pause.roomCode ? roomCard(pause.roomCode) : null, matchCard(), tip.el));
  };

  // --- Host panel ---------------------------------------------------------------------
  const hostSection = (): { view: GameSetup; footer: HTMLElement } => {
    let baseline = sanitizeSetup(pause.config, pause.config.mapId);
    const setup = createGameSetup(ctx, { initial: baseline, kind: 'host' });
    const status = h('span', { class: 'bas-foot__recap' });
    const applyBtn = button({
      label: 'Appliquer',
      icon: 'check',
      variant: 'secondary',
      size: 'lg',
      title: 'Applique les réglages des bots sans interrompre la partie',
      onClick() {
        const patch = diffConfig(baseline, setup.config());
        if (Object.keys(patch).length === 0) return;
        ctx.callbacks.hostConfig(patch, false);
        baseline = { ...baseline, ...patch };
        paint();
        ctx.toast('Réglages des bots appliqués, la partie continue.', 'success');
      },
    });
    const restartBtn = button({
      label: 'Appliquer et relancer',
      icon: 'restart',
      variant: 'primary',
      size: 'lg',
      onClick() {
        const patch = diffConfig(baseline, setup.config());
        if (Object.keys(patch).length === 0) return;
        ctx.callbacks.hostConfig(patch, true);
        baseline = { ...baseline, ...patch };
        paint();
      },
    });
    const paint = (): void => {
      const patch = diffConfig(baseline, setup.config());
      const keys = Object.keys(patch) as (keyof RoomConfig)[];
      const liveOnly = keys.length > 0 && keys.every((k) => LIVE_KEYS.includes(k));
      hostDirty = keys.length > 0;
      applyBtn.disabled = !liveOnly;
      restartBtn.disabled = keys.length === 0;
      if (keys.length === 0) setText(status, 'Aucune modification en attente.');
      else {
        const names = keys.map((k) => CONFIG_LABELS[k] ?? k).join(', ');
        setText(status, liveOnly ? `Modifié : ${names}. Applicable sans interrompre la partie.` : `Modifié : ${names}. La partie devra être relancée.`);
      }
      footer.classList.toggle('is-dirty', keys.length > 0);
    };
    const footer = h(
      'div',
      { class: 'bas-foot' },
      h('div', { class: 'bas-foot__info' }, h('span', { class: 'bas-kicker' }, 'Modifications'), status),
      h('div', { class: 'bas-foot__actions' }, applyBtn, restartBtn),
    );
    setup.onChange = paint;
    paint();
    return { view: setup, footer };
  };

  function open(next: PauseSection | null, arg?: string): void {
    if (next === 'host' && !pause.isHost) next = null;
    if (next === section && next !== null) {
      if (next === 'options' && arg) (view as OptionsView).setTab(arg as OptionsTab);
      return;
    }
    closeView();
    section = next;
    for (const [id, btn] of navButtons) {
      if (id === next) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    }
    if (next === null) {
      showOverview();
      return;
    }
    const onClose = (): void => {
      const from = next;
      open(null);
      navButtons.get(from ?? '')?.focus();
    };
    if (next === 'options') {
      view = createOptions(ctx, arg as OptionsTab | undefined);
      stage.append(panel({ icon: 'sliders', title: SECTION_TEXT.options.title, sub: SECTION_TEXT.options.sub, body: view.el, onClose }));
    } else {
      const s = hostSection();
      view = s.view;
      stage.append(
        panel({
          icon: 'crown',
          title: pause.local ? 'Régler la partie' : 'Régler le salon',
          sub: pause.local ? 'Carte, mode, bots et règles de votre partie solo.' : SECTION_TEXT.host.sub,
          body: view.el,
          footer: s.footer,
          onClose,
        }),
      );
    }
  }

  // --- Quit confirmation --------------------------------------------------------------
  const closeModal = (): void => {
    modal?.remove();
    modal = null;
    modalReturnFocus?.focus();
    modalReturnFocus = null;
  };

  function confirmLeave(): void {
    if (modal) return;
    modalReturnFocus = document.activeElement as HTMLElement | null;
    const stay = button({ label: 'Rester', variant: 'secondary', size: 'lg', sound: 'back', onClick: closeModal });
    const text = pause.local
      ? 'La partie en cours sera perdue. Le plateau technique se débrouillera sans vous… probablement.'
      : pause.hostedHere
        ? 'La partie tourne dans votre navigateur : en quittant, vous fermez le salon pour tout le monde.'
        : pause.isHost
          ? 'Vous êtes l’hôte : le salon restera ouvert et sera confié à un autre joueur.'
        : 'Vous pourrez revenir tant que le salon est ouvert, avec le même code.';
    modal = h(
      'div',
      { class: 'bas-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'bas-leave-title' },
      h(
        'div',
        { class: 'bas-modal__box bas-glass' },
        h('span', { class: 'bas-modal__icon' }, icon('exit')),
        h('h2', { class: 'bas-modal__title bas-display', id: 'bas-leave-title' }, 'Quitter la partie ?'),
        h('p', { class: 'bas-modal__text' }, text),
        h(
          'div',
          { class: 'bas-modal__actions' },
          stay,
          button({
            label: 'Quitter la partie',
            icon: 'exit',
            variant: 'danger',
            size: 'lg',
            onClick() {
              closeModal();
              ctx.callbacks.leave();
            },
          }),
        ),
      ),
    );
    modal.addEventListener('mousedown', (e) => {
      if (e.target === modal) {
        ctx.sound('back');
        closeModal();
      }
    });
    root.appendChild(modal);
    stay.focus();
  }

  const root = h(
    'div',
    { class: 'bas-screen bas-pause' },
    h(
      'div',
      { class: 'bas-pause__side' },
      h(
        'header',
        { class: 'bas-pause__head' },
        createLogo('emblem', 'bas-pause__emblem'),
        h('div', null, h('h1', { class: 'bas-pause__title bas-display' }, 'Pause'), subtitle),
      ),
      nav,
      liveNote,
    ),
    h('div', { class: 'bas-pause__content' }, stage),
  );

  paintNav();
  open(null);

  return {
    el: root,
    update(next) {
      const hadFocus = [...navButtons.entries()].find(([, b]) => b === document.activeElement)?.[0];
      const configChanged = Object.keys(diffConfig(pause.config, next.config)).length > 0;
      pause = next;
      paintNav();
      if (hadFocus) navButtons.get(hadFocus)?.focus();
      if (section === 'host' && (!pause.isHost || (configChanged && !hostDirty))) {
        const reopen = pause.isHost;
        open(null);
        if (reopen) {
          open('host');
          view?.focus?.();
        }
      } else if (section === null) {
        closeView();
        showOverview();
      }
    },
    open,
    confirmLeave,
    back() {
      if (modal) {
        ctx.sound('back');
        closeModal();
        return;
      }
      if (view?.back?.()) return;
      if (section !== null) {
        const from = section;
        ctx.sound('back');
        open(null);
        navButtons.get(from)?.focus();
        return;
      }
      ctx.sound('click');
      ctx.callbacks.resume();
    },
    mounted() {
      navButtons.get('resume')?.focus();
    },
    dispose() {
      closeView();
      modal?.remove();
      d.dispose();
    },
  };
}
