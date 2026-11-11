/**
 * Title screen: logo, player name, main navigation and the content panel that
 * opens next to it (solo, create, join, options, controls, credits).
 */
import { LIMITS } from '../../../shared/constants';
import { GAME_TAGLINE, GAME_TITLE } from '../../../shared/identity';
import { ROOM_CODE_LENGTH, normalizeRoomCode } from '../../../shared/protocol';
import { Disposer, clear, h, isolateKeys, setText } from '../dom';
import { createGameSetup, setupSummary, type GameSetup } from './gameSetup';
import { icon, type IconName } from './icons';
import { createControlsSheet, createCredits } from './infoViews';
import { createLogo } from './logo';
import { createOptions, type OptionsTab, type OptionsView } from './options';
import { createTipCard, panel, presentedBy } from './panel';
import { loadSetup, saveSetup } from './setupStore';
import { EASTER_EGG_TOASTS, NICKNAMES, SECTION_TEXT, VERSION_LABEL } from './texts';
import type { MenuContext, Screen, View } from './types';
import { arrowNav, button, iconButton, kbd } from './widgets';

export type MainSection = 'solo' | 'create' | 'join' | 'options' | 'controls' | 'credits';

export interface MainScreen extends Screen {
  /** Apply the options of IMenus.showMain(). */
  update(opts: { error?: string; joinCode?: string }): void;
  /** Open a section (null = back to the title), e.g. open('options', 'keys'). */
  open(section: MainSection | null, arg?: string): void;
}

const NAV: { id: MainSection; icon: IconName; gap?: boolean }[] = [
  { id: 'solo', icon: 'crosshair' },
  { id: 'create', icon: 'users' },
  { id: 'join', icon: 'enter' },
  { id: 'options', icon: 'sliders', gap: true },
  { id: 'controls', icon: 'keyboard' },
  { id: 'credits', icon: 'award' },
];

/** Section used by the last "play" action, reopened when the game comes back with an error. */
let lastPlaySection: MainSection | null = null;

/** Extract a room code from what the player typed or pasted (a code or a full invitation link). */
function parseRoomCode(raw: string): string {
  const fromUrl = /[?&#]room=([A-Za-z0-9]+)/.exec(raw);
  return normalizeRoomCode(fromUrl ? fromUrl[1]! : raw);
}

export function createMainScreen(ctx: MenuContext): MainScreen {
  const d = new Disposer();
  const { settings } = ctx;
  let section: MainSection | null = null;
  let view: View | null = null;
  let viewDisposer = new Disposer();
  let joinCode = '';
  let errorText = '';

  // --- Brand ---------------------------------------------------------------------
  let logoClicks = 0;
  let logoTimer = 0;
  const logoBtn = h(
    'button',
    {
      type: 'button',
      class: 'bas-logo-btn',
      'aria-label': GAME_TITLE,
      dataset: { snd: 'none' },
      onclick() {
        logoClicks++;
        window.clearTimeout(logoTimer);
        logoTimer = window.setTimeout(() => (logoClicks = 0), 1600);
        if (logoClicks >= 5) {
          logoClicks = 0;
          ctx.rain();
          ctx.sound('join');
          ctx.toast(EASTER_EGG_TOASTS[Math.floor(Math.random() * EASTER_EGG_TOASTS.length)]!, 'info');
        }
      },
    },
    createLogo('full', 'bas-logo'),
  );
  d.add(() => window.clearTimeout(logoTimer));

  // --- Player name ---------------------------------------------------------------
  const cleanName = (raw: string): string =>
    raw
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/^ /, '')
      .slice(0, LIMITS.maxNameLength);

  const nameInput = h('input', {
    type: 'text',
    id: 'bas-player-name',
    class: 'bas-input bas-id__input',
    maxlength: String(LIMITS.maxNameLength),
    placeholder: 'Votre pseudo',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    'aria-describedby': 'bas-player-name-msg',
  });
  nameInput.value = settings.value.playerName;
  isolateKeys(nameInput);
  const nameMsg = h('p', { class: 'bas-id__msg', id: 'bas-player-name-msg', 'aria-live': 'polite' });
  const nameCount = h('span', { class: 'bas-id__count' });
  const paintName = (): void => {
    nameCount.textContent = `${nameInput.value.length}/${LIMITS.maxNameLength}`;
  };
  const setNameError = (msg: string): void => {
    setText(nameMsg, msg);
    idBox.classList.toggle('is-error', msg !== '');
  };
  nameInput.addEventListener('input', () => {
    const cleaned = cleanName(nameInput.value);
    if (cleaned !== nameInput.value) nameInput.value = cleaned;
    settings.update({ playerName: cleaned.trim() });
    if (cleaned.trim()) setNameError('');
    paintName();
  });
  nameInput.addEventListener('blur', () => {
    nameInput.value = settings.value.playerName;
    paintName();
  });
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') nameInput.blur();
  });
  const randomName = (): string => {
    const pool = NICKNAMES.filter((n) => n.length <= LIMITS.maxNameLength && n !== settings.value.playerName);
    return pool[Math.floor(Math.random() * pool.length)] ?? 'Tech de Garde';
  };
  const dice = iconButton('dice', 'Proposer un pseudo de labo au hasard', () => {
    const name = randomName();
    nameInput.value = name;
    settings.update({ playerName: name });
    setNameError('');
    paintName();
    dice.classList.remove('is-rolling');
    void dice.offsetWidth; // restart the animation
    dice.classList.add('is-rolling');
  });
  dice.classList.add('bas-id__dice');
  const idBox = h(
    'div',
    { class: 'bas-id' },
    h('div', { class: 'bas-id__head' }, h('label', { class: 'bas-kicker', for: 'bas-player-name' }, 'Badge d’accès — votre pseudo'), nameCount),
    h('div', { class: 'bas-id__field' }, h('span', { class: 'bas-id__icon' }, icon('user')), nameInput, dice),
    nameMsg,
  );
  paintName();

  /** Online play needs a name; point at the field when it is empty. */
  const requireName = (): boolean => {
    if (settings.value.playerName.trim()) return true;
    setNameError('Indiquez un pseudo pour que vos collègues vous reconnaissent.');
    ctx.sound('error');
    idBox.classList.remove('is-shaking');
    void idBox.offsetWidth;
    idBox.classList.add('is-shaking');
    nameInput.focus();
    return false;
  };

  // --- Navigation ----------------------------------------------------------------
  const navButtons = new Map<MainSection, HTMLButtonElement>();
  const nav = h('nav', { class: 'bas-nav', 'aria-label': 'Menu principal' });
  NAV.forEach((item, i) => {
    const btn = h(
      'button',
      { type: 'button', class: `bas-nav__item${item.gap ? ' bas-nav__item--gap' : ''}`, onclick: () => open(item.id) },
      h('span', { class: 'bas-nav__num' }, String(i + 1).padStart(2, '0')),
      icon(item.icon),
      h('span', { class: 'bas-nav__label bas-display' }, SECTION_TEXT[item.id].title),
      icon('chevronRight', 'bas-nav__chevron'),
    );
    btn.addEventListener('pointerenter', () => setHint(SECTION_TEXT[item.id].sub));
    btn.addEventListener('focus', () => setHint(SECTION_TEXT[item.id].sub));
    btn.addEventListener('pointerleave', () => setHint(''));
    btn.addEventListener('blur', () => setHint(''));
    navButtons.set(item.id, btn);
    nav.appendChild(btn);
  });
  arrowNav(nav, '.bas-nav__item');

  // --- Footer --------------------------------------------------------------------
  const hintText = h('span', { class: 'bas-main__hint' });
  const backHint = h('span', { class: 'bas-main__keys', hidden: true }, kbd('Échap'), ' Retour');
  const setHint = (text: string): void => setText(hintText, text);

  // --- Content -------------------------------------------------------------------
  const alertBox = h('div', { class: 'bas-main__alert' });
  const stage = h('div', { class: 'bas-main__stage' });
  const content = h('div', { class: 'bas-main__content' }, alertBox, stage);

  const paintAlert = (): void => {
    clear(alertBox);
    if (!errorText) return;
    alertBox.append(
      h(
        'div',
        { class: 'bas-alert', role: 'alert' },
        icon('alert'),
        h('div', { class: 'bas-alert__body' }, h('strong', null, 'Non-conformité détectée'), h('span', null, errorText)),
        iconButton(
          'close',
          'Fermer le message',
          () => {
            errorText = '';
            paintAlert();
          },
          'back',
        ),
      ),
    );
  };

  const closeView = (): void => {
    viewDisposer.dispose();
    viewDisposer = new Disposer();
    view?.dispose();
    view = null;
    clear(stage);
  };

  // Title (no section open): pitch, quick play and a rotating lab tip.
  const showHero = (): void => {
    const cfg = loadSetup();
    const tip = createTipCard(settings);
    viewDisposer.add(() => tip.dispose());
    stage.append(
      h(
        'div',
        { class: 'bas-hero' },
        h(
          'div',
          { class: 'bas-hero__pitch' },
          h('div', { class: 'bas-kicker' }, 'Note de service — diffusion immédiate'),
          h('h1', { class: 'bas-hero__title bas-display' }, 'Audit surprise', h('br'), 'au laboratoire'),
          h(
            'p',
            { class: 'bas-hero__text' },
            'Les Auditeurs débarquent sans prévenir. Enfilez vos gants, défendez le plateau technique… ou passez de l’autre côté du dossier d’écart.',
          ),
          h(
            'div',
            { class: 'bas-hero__actions' },
            button({
              label: 'Partie rapide',
              icon: 'play',
              variant: 'primary',
              size: 'lg',
              onClick: () => launchSolo(loadSetup()),
            }),
            h('div', { class: 'bas-hero__cfg' }, h('span', { class: 'bas-kicker' }, 'Solo contre les bots'), h('span', null, setupSummary(cfg))),
          ),
        ),
        tip.el,
      ),
    );
  };

  const launchSolo = (cfg: ReturnType<typeof loadSetup>): void => {
    if (!settings.value.playerName.trim()) {
      // Solo never blocks on the name: hand out a lab nickname.
      const name = randomName();
      settings.update({ playerName: name });
      nameInput.value = name;
      paintName();
    }
    saveSetup(cfg);
    lastPlaySection = 'solo';
    ctx.callbacks.playSolo(cfg);
  };

  const setupSection = (kind: 'solo' | 'create'): { view: GameSetup; footer: HTMLElement } => {
    const setup = createGameSetup(ctx, { initial: loadSetup(), kind });
    const recap = h('span', { class: 'bas-foot__recap' }, setup.summary());
    setup.onChange = (cfg) => {
      saveSetup(cfg);
      setText(recap, setup.summary());
    };
    const footer =
      kind === 'solo'
        ? h(
            'div',
            { class: 'bas-foot' },
            h('div', { class: 'bas-foot__info' }, h('span', { class: 'bas-kicker' }, 'Votre partie'), recap),
            button({ label: 'Lancer la partie', icon: 'play', variant: 'primary', size: 'lg', onClick: () => launchSolo(setup.config()) }),
          )
        : h(
            'div',
            { class: 'bas-foot' },
            h(
              'div',
              { class: 'bas-foot__info' },
              h('span', { class: 'bas-kicker' }, 'Salon privé'),
              h('span', { class: 'bas-foot__note' }, icon('link'), 'Un lien et un code à 5 caractères seront disponibles pour inviter vos collègues.'),
            ),
            button({
              label: 'Créer le salon',
              icon: 'users',
              variant: 'primary',
              size: 'lg',
              onClick() {
                if (!requireName()) return;
                const cfg = setup.config();
                saveSetup(cfg);
                lastPlaySection = 'create';
                ctx.callbacks.createRoom(cfg);
              },
            }),
          );
    return { view: setup, footer };
  };

  const joinSection = (): { view: View; footer: null } => {
    const input = h('input', {
      type: 'text',
      class: 'bas-codefield__input',
      maxlength: '120',
      autocomplete: 'off',
      autocapitalize: 'characters',
      spellcheck: 'false',
      inputmode: 'text',
      'aria-label': `Code du salon (${ROOM_CODE_LENGTH} caractères)`,
    });
    input.value = joinCode;
    isolateKeys(input);
    // The real field is invisible; the five cells below mirror its value.
    const cells = Array.from({ length: ROOM_CODE_LENGTH }, () => h('span', { class: 'bas-code__cell bas-display' }));
    const field = h('div', { class: 'bas-codefield' }, input, h('div', { class: 'bas-code', 'aria-hidden': 'true' }, cells));
    const msg = h('p', { class: 'bas-join__msg', 'aria-live': 'polite' });
    const submit = (): void => {
      const code = parseRoomCode(input.value);
      if (code.length !== ROOM_CODE_LENGTH) {
        setText(msg, `Le code comporte ${ROOM_CODE_LENGTH} caractères (lettres et chiffres).`);
        ctx.sound('error');
        input.focus();
        return;
      }
      if (!requireName()) return;
      setText(msg, '');
      lastPlaySection = 'join';
      ctx.callbacks.joinRoom(code);
    };
    const joinBtn = button({ label: 'Rejoindre', icon: 'enter', variant: 'primary', size: 'lg', onClick: submit });
    const paint = (): void => {
      const value = input.value;
      cells.forEach((cell, i) => {
        cell.textContent = value[i] ?? '';
        cell.classList.toggle('is-filled', i < value.length);
        cell.classList.toggle('is-active', i === Math.min(value.length, ROOM_CODE_LENGTH - 1));
      });
    };
    const caretToEnd = (): void => input.setSelectionRange(input.value.length, input.value.length);
    input.addEventListener('input', () => {
      const code = parseRoomCode(input.value);
      if (code !== input.value) input.value = code;
      joinCode = code;
      setText(msg, '');
      paint();
    });
    input.addEventListener('focus', caretToEnd);
    input.addEventListener('click', caretToEnd);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        ctx.sound('click');
        submit();
      } else if (e.key.startsWith('Arrow') || e.key === 'Home') {
        e.preventDefault(); // the caret always stays at the end
      }
    });
    paint();
    const el = h(
      'div',
      { class: 'bas-join' },
      h('div', { class: 'bas-join__icon' }, icon('tubes')),
      h('div', { class: 'bas-kicker' }, 'Code du salon'),
      field,
      msg,
      joinBtn,
      h(
        'ul',
        { class: 'bas-join__help' },
        h('li', null, icon('info'), h('span', null, 'L’hôte trouve le code et le lien d’invitation dans son menu pause (touche ', kbd('Échap'), ').')),
        h('li', null, icon('link'), h('span', null, 'Vous avez reçu un lien ? Ouvrez-le ou collez-le ici : le code se remplit tout seul.')),
      ),
    );
    return { view: { el, dispose() {}, focus: () => input.focus() }, footer: null };
  };

  function open(next: MainSection | null, arg?: string): void {
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
    backHint.hidden = next === null;
    root.classList.toggle('has-panel', next !== null);
    setHint('');
    if (next === null) {
      showHero();
      return;
    }

    let footer: HTMLElement | null = null;
    let cls = '';
    if (next === 'solo' || next === 'create') {
      const s = setupSection(next);
      view = s.view;
      footer = s.footer;
    } else if (next === 'join') {
      view = joinSection().view;
      cls = 'bas-panel--narrow';
    } else if (next === 'options') {
      view = createOptions(ctx, arg as OptionsTab | undefined);
    } else if (next === 'controls') {
      view = createControlsSheet(ctx, () => open('options', 'keys'));
    } else {
      view = createCredits(ctx);
    }
    const meta = SECTION_TEXT[next];
    const navItem = NAV.find((n) => n.id === next)!;
    stage.append(
      panel({
        icon: navItem.icon,
        title: meta.title,
        sub: meta.sub,
        body: view.el,
        footer: footer ?? undefined,
        class: cls,
        onClose: () => {
          open(null);
          navButtons.get(next)?.focus();
        },
      }),
    );
    if (root.isConnected) view.focus?.();
  }

  const root = h(
    'div',
    { class: 'bas-screen bas-main' },
    h('div', { class: 'bas-main__bg', 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'bas-main__side' },
      h('header', { class: 'bas-main__brand' }, logoBtn, h('p', { class: 'bas-main__tagline' }, GAME_TAGLINE)),
      idBox,
      nav,
      presentedBy(),
    ),
    content,
    h(
      'footer',
      { class: 'bas-main__footer' },
      h('span', { class: 'bas-main__version' }, VERSION_LABEL),
      h('div', { class: 'bas-ecg', 'aria-hidden': 'true' }),
      hintText,
      backHint,
    ),
  );

  open(null);

  return {
    el: root,
    update(opts) {
      errorText = opts.error?.trim() ?? '';
      paintAlert();
      if (opts.joinCode !== undefined) joinCode = normalizeRoomCode(opts.joinCode);
      if (opts.joinCode) {
        if (section === 'join') open(null);
        open('join');
      } else if (errorText) {
        open(lastPlaySection && lastPlaySection !== 'solo' ? lastPlaySection : 'join');
      } else {
        open(null);
      }
      if (errorText) ctx.sound('error');
    },
    open,
    back() {
      if (view?.back?.()) return;
      if (section !== null) {
        const from = section;
        ctx.sound('back');
        open(null);
        navButtons.get(from)?.focus();
      }
    },
    mounted() {
      if (section !== null) view?.focus?.();
      else if (!settings.value.playerName) nameInput.focus();
      else navButtons.get('solo')?.focus();
    },
    onKey(e) {
      // Type-ahead comfort: digits 1–6 open the matching entry of the main menu.
      if (section !== null || e.ctrlKey || e.altKey || e.metaKey) return false;
      const m = /^(?:Digit|Numpad)([1-6])$/.exec(e.code);
      const item = m ? NAV[Number(m[1]) - 1] : undefined;
      if (!item) return false;
      ctx.sound('click');
      open(item.id);
      return true;
    },
    dispose() {
      closeView();
      d.dispose();
    },
  };
}
