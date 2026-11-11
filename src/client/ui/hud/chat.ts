/**
 * Chat (bottom left, above the vitals): the last six lines, each fading after
 * eight seconds, and the input line opened by `open(teamOnly)`.
 *
 * While the input is open every keyboard event stops at the field (the game
 * must not see the typed letters), Enter submits and Escape cancels. The game is
 * told through `callbacks.chatFocus()` so it can release / restore the pointer lock.
 */
import type { HudCallbacks } from '../../core/contracts';
import { LIMITS } from '../../../shared/constants';
import type { TeamId } from '../../../shared/types';
import { h } from '../dom';
import { T } from './texts';
import type { Timers } from './util';

const MAX_LINES = 6;
const LIFE_MS = 8000;

export interface Chat {
  el: HTMLElement;
  message(name: string, team: TeamId | -1, text: string, teamOnly: boolean): void;
  open(teamOnly: boolean): void;
  /** Close without sending. */
  cancel(): void;
  isOpen(): boolean;
  setTeam(team: TeamId): void;
  clear(): void;
  dispose(): void;
}

export function createChat(callbacks: HudCallbacks, timers: Timers): Chat {
  const log = h('div', { class: 'bh-chat__log' });
  const scope = h('span', { class: 'bh-chat__scope bas-display' });
  const input = h('input', {
    class: 'bh-chat__input',
    type: 'text',
    maxlength: String(LIMITS.maxChatLength),
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    enterkeyhint: 'send',
    placeholder: T.chatPlaceholder,
    'aria-label': T.chatPlaceholder,
  });
  const counter = h('span', { class: 'bh-chat__count' });
  const hint = h(
    'div',
    { class: 'bh-chat__hint' },
    h('span', null, h('kbd', { class: 'bas-kbd' }, 'Entrée'), T.chatHintSend),
    h('span', null, h('kbd', { class: 'bas-kbd' }, 'Échap'), T.chatHintCancel),
  );
  const entry = h('div', { class: 'bh-chat__entry', hidden: true }, h('div', { class: 'bh-chat__field' }, scope, input, counter), hint);
  const el = h('div', { class: 'bh-chat' }, log, entry);

  const rows: HTMLElement[] = [];
  let open = false;
  let teamOnly = false;
  let team: TeamId = 0;
  let focusTimer = 0;

  function close(send: boolean): void {
    if (!open) return;
    open = false;
    window.clearTimeout(focusTimer);
    const text = input.value.replace(/\s+/g, ' ').trim().slice(0, LIMITS.maxChatLength);
    input.value = '';
    entry.hidden = true;
    el.removeAttribute('data-open');
    if (document.activeElement === input) input.blur();
    if (send && text) callbacks.chatSubmit(text, teamOnly);
    callbacks.chatFocus(false);
  }

  function updateCounter(): void {
    const left = LIMITS.maxChatLength - input.value.length;
    // Only shown when the limit gets close.
    const text = left <= 30 ? String(left) : '';
    if (counter.textContent !== text) counter.textContent = text;
  }

  /** Keys pressed while the field has the focus (see the auto-repeat guard below). */
  const pressed = new Set<string>();

  // Nothing typed in the field may reach the game (movement keys, weapon slots, pause…).
  const onKey = (e: KeyboardEvent): void => {
    e.stopPropagation();
    if (e.type === 'keyup') pressed.delete(e.code);
    if (e.type !== 'keydown') return;
    // The key that opened the chat may still be held down: its auto-repeat must
    // not fill the field with that letter.
    if (!e.repeat) pressed.add(e.code);
    else if (!pressed.has(e.code)) {
      e.preventDefault();
      return;
    }
    if (e.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(false);
    } else if (e.key === 'Tab') e.preventDefault(); // keep the focus in the field
  };
  input.addEventListener('keydown', onKey);
  input.addEventListener('keyup', onKey);
  input.addEventListener('keypress', onKey);
  input.addEventListener('input', updateCounter);
  // Clicking elsewhere (or the browser taking the focus away) cancels the message.
  input.addEventListener('blur', () => {
    if (open) close(false);
  });
  // The field takes the mouse; clicks around it must not start shooting.
  const stop = (e: Event): void => e.stopPropagation();
  entry.addEventListener('mousedown', stop);
  entry.addEventListener('mouseup', stop);
  entry.addEventListener('click', stop);
  entry.addEventListener('wheel', stop, { passive: true });

  return {
    el,

    message(name, from, text, isTeamOnly) {
      let row: HTMLElement;
      if (from === -1) {
        row = h('div', { class: 'bh-chat__row bh-chat__row--server' }, name ? `${name} : ${text}` : text);
      } else {
        row = h(
          'div',
          { class: 'bh-chat__row' },
          isTeamOnly ? h('span', { class: 'bh-chat__team' }, `${T.chatTeamPrefix} `) : null,
          h('span', { class: `bh-chat__name bh-t${from}` }, name),
          h('span', { class: 'bh-chat__text' }, ` : ${text}`),
        );
      }
      log.appendChild(row);
      rows.push(row);
      while (rows.length > MAX_LINES) rows.shift()!.remove();
      timers.after(LIFE_MS, () => row.classList.add('is-old'));
    },

    open(isTeamOnly) {
      teamOnly = isTeamOnly;
      scope.textContent = isTeamOnly ? T.chatTeam : T.chatAll;
      entry.setAttribute('data-scope', isTeamOnly ? `team${team}` : 'all');
      if (open) {
        input.focus({ preventScroll: true });
        return;
      }
      open = true;
      pressed.clear();
      input.value = '';
      updateCounter();
      entry.hidden = false;
      el.setAttribute('data-open', '');
      callbacks.chatFocus(true);
      // Focus on the next task: the key press that opened the chat is still being
      // dispatched, and focusing now would type that letter into the field.
      window.clearTimeout(focusTimer);
      focusTimer = window.setTimeout(() => {
        if (open) input.focus({ preventScroll: true });
      }, 0);
    },

    cancel: () => close(false),
    isOpen: () => open,

    setTeam(t) {
      team = t;
    },

    clear() {
      while (rows.length) rows.shift()!.remove();
    },

    dispose() {
      window.clearTimeout(focusTimer);
      if (open) close(false);
    },
  };
}
