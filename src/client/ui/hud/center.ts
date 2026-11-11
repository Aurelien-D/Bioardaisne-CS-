/**
 * Centre column of the HUD: big announcements (queued), interaction prompt with
 * key caps, action progress bar, dead / spectating block with the respawn
 * countdown, status chips (spawn protection, carried objective) and toasts.
 */
import type { HudFrame } from '../../core/contracts';
import type { KeyAction, SettingsStore } from '../../core/settings';
import type { GameModeId } from '../../../shared/types';
import { frTypo, h } from '../dom';
import { bindingLabel } from '../keys';
import { hudIcon } from './icons';
import { T } from './texts';
import { clamp, play, type Timers } from './util';

export type Tone = 'neutral' | 'good' | 'bad';

export interface Center {
  /** Announcements (upper third). */
  announceEl: HTMLElement;
  /** Prompt + action bar (just under the crosshair). */
  interactEl: HTMLElement;
  /** Dead / spectating block. */
  deadEl: HTMLElement;
  /** Toasts and status chips (bottom centre). */
  footEl: HTMLElement;
  update(f: HudFrame): void;
  announce(title: string, sub: string | undefined, tone: Tone): void;
  toast(text: string): void;
  /** Key labels changed: re-render the prompt. */
  refreshKeys(): void;
  clear(): void;
}

const ANNOUNCE_MS = 2800;
const ANNOUNCE_BUSY_MS = 1700;
const ANNOUNCE_MAX_QUEUE = 4;
const TOAST_MS = 3600;
const TOAST_MAX = 3;
const EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';

export function createCenter(settings: SettingsStore, timers: Timers): Center {
  // --- Announcements -----------------------------------------------------------------
  const aTitle = h('div', { class: 'bh-announce__title bas-display' });
  const aRule = h('i', { class: 'bh-announce__rule' });
  const aSub = h('div', { class: 'bh-announce__sub' });
  const announceEl = h('div', { class: 'bh-announce', hidden: true }, aTitle, aRule, aSub);
  const queue: { title: string; sub: string; tone: Tone }[] = [];
  let announcing = false;
  let lastAnnounce = '';

  function nextAnnouncement(): void {
    const item = queue.shift();
    if (!item) {
      announcing = false;
      lastAnnounce = '';
      announceEl.hidden = true;
      return;
    }
    announcing = true;
    lastAnnounce = `${item.title}\n${item.sub}`;
    aTitle.textContent = frTypo(item.title);
    aSub.textContent = frTypo(item.sub);
    aSub.hidden = item.sub === '';
    announceEl.setAttribute('data-tone', item.tone);
    announceEl.hidden = false;
    play(announceEl, [{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: 'linear' });
    play(aTitle, [{ transform: 'translateY(-0.45rem) scale(1.16)' }, { transform: 'none' }], { duration: 300, easing: EASE });
    play(aRule, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 480, easing: EASE });
    play(aSub, [{ opacity: 0, transform: 'translateY(0.35rem)' }, { opacity: 1, transform: 'none' }], {
      duration: 260,
      delay: 140,
      easing: EASE,
      fill: 'backwards',
    });
    timers.after(queue.length ? ANNOUNCE_BUSY_MS : ANNOUNCE_MS, () => {
      const out = play(announceEl, [{ opacity: 1 }, { opacity: 0, transform: 'translateY(-0.4rem)' }], { duration: 200, easing: 'ease-in', fill: 'forwards' });
      timers.after(out ? 200 : 0, nextAnnouncement);
    });
  }

  // --- Prompt and action bar ---------------------------------------------------------
  const promptEl = h('div', { class: 'bh-prompt', hidden: true });
  const actionLabel = h('span', { class: 'bh-action__label' });
  const actionPct = h('span', { class: 'bh-action__pct bas-display' });
  const actionFill = h('i');
  const actionEl = h(
    'div',
    { class: 'bh-action', hidden: true },
    h('div', { class: 'bh-action__head' }, actionLabel, actionPct),
    h('div', { class: 'bh-action__bar' }, actionFill),
  );
  const interactEl = h('div', { class: 'bh-interact' }, promptEl, actionEl);
  let promptText: string | null = null;
  let actionOn = false;
  let actionText = '';
  let actionStep = -1;
  let actionPctV = -1;

  function renderPrompt(text: string): void {
    const keys = settings.value.keys as Record<string, string[] | undefined>;
    const parts: (Node | string)[] = [];
    const re = /\[([^[\]]{1,24})\]/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m.index > last) parts.push(text.slice(last, m.index));
      // "[use]" resolves to the key bound to that action, "[E]" is shown as written.
      const token = m[1]!;
      const bound = keys[token as KeyAction];
      parts.push(h('kbd', { class: 'bas-kbd' }, bound ? bindingLabel(bound, true) : token));
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push(text.slice(last));
    promptEl.replaceChildren(...parts.map((p) => (typeof p === 'string' ? document.createTextNode(frTypo(p)) : p)));
  }

  // --- Dead / spectating -------------------------------------------------------------
  const specName = h('span', { class: 'bh-dead__name' });
  const specLabel = h('span', null);
  const specEl = h('div', { class: 'bh-dead__spec' }, hudIcon('eye'), specLabel, specName);
  const deadTitle = h('div', { class: 'bh-dead__title bas-display' });
  const deadSub = h('div', { class: 'bh-dead__sub' });
  const deadEl = h('div', { class: 'bh-dead', hidden: true }, specEl, deadTitle, deadSub);
  let deadOn = false;
  let specText: string | null | undefined;
  let specKind = '';
  let deadKey = '';

  // --- Chips and toasts --------------------------------------------------------------
  const chipProtect = h(
    'div',
    { class: 'bh-chip bh-chip--protect', hidden: true },
    hudIcon('shieldCheck'),
    h('span', null, T.protectedChip),
    h('span', { class: 'bh-chip__hint' }, T.protectedHint),
  );
  const carryIcon = h('span', { class: 'bh-chip__icon' });
  const carryText = h('span', null);
  const chipCarry = h('div', { class: 'bh-chip bh-chip--carry', hidden: true }, carryIcon, carryText);
  const chips = h('div', { class: 'bh-chips' }, chipProtect, chipCarry);
  const toasts = h('div', { class: 'bh-toasts' });
  const footEl = h('div', { class: 'bh-foot' }, toasts, chips);
  const toastRows: HTMLElement[] = [];
  let protectOn = false;
  let carryOn = false;
  let carryMode: GameModeId | '' = '';

  return {
    announceEl,
    interactEl,
    deadEl,
    footEl,

    update(f) {
      // Prompt.
      const prompt = f.alive ? f.prompt : null;
      if (prompt !== promptText) {
        promptText = prompt;
        if (prompt) renderPrompt(prompt);
        promptEl.hidden = !prompt;
      }

      // Action progress.
      const action = f.alive ? f.action : null;
      if ((action !== null) !== actionOn) {
        actionOn = action !== null;
        actionEl.hidden = !actionOn;
        actionStep = -1;
        actionPctV = -1;
      }
      if (action) {
        if (action.label !== actionText) {
          actionText = action.label;
          actionLabel.textContent = frTypo(action.label);
        }
        const k = clamp(action.progress, 0, 1);
        const step = Math.round(k * 400);
        if (step !== actionStep) {
          actionStep = step;
          actionFill.style.transform = `scaleX(${step / 400})`;
        }
        const pct = Math.floor(k * 100);
        if (pct !== actionPctV) {
          actionPctV = pct;
          actionPct.textContent = `${pct} %`;
        }
      }

      // Dead / spectating.
      const dead = !f.alive;
      if (dead !== deadOn) {
        deadOn = dead;
        deadEl.hidden = !dead;
        if (dead) play(deadEl, [{ opacity: 0, transform: 'translateY(0.5rem)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: EASE });
      }
      if (dead) {
        const kind = f.spectating ? 'watch' : f.team === 2 ? 'mode' : '';
        if (kind !== specKind || f.spectating !== specText) {
          specKind = kind;
          specText = f.spectating;
          specEl.hidden = kind === '';
          specLabel.textContent = kind === 'watch' ? frTypo(`${T.spectating} :`) : T.spectatorMode;
          specName.textContent = kind === 'watch' ? (f.spectating ?? '') : '';
        }
        let title = '';
        let sub = '';
        let secs = 0;
        if (f.team !== 2) {
          if (f.respawnIn >= 0) {
            secs = Math.ceil(f.respawnIn - 1e-6);
            title = secs > 0 ? T.respawnLead : T.respawnNow;
            sub = T.respawnSub;
          } else {
            title = T.eliminated;
            sub = T.eliminatedSub;
          }
        }
        const key = `${title}|${secs}|${sub}`;
        if (key !== deadKey) {
          deadKey = key;
          // "RÉAPPARITION DANS 3 s": the title is upper-case, the unit symbol is not.
          if (secs > 0) deadTitle.replaceChildren(`${title} ${secs}\u00a0`, h('span', { class: 'bh-unit' }, 's'));
          else deadTitle.textContent = frTypo(title);
          deadTitle.hidden = title === '';
          deadSub.textContent = frTypo(sub);
          deadSub.hidden = sub === '';
        }
      }

      // Chips.
      const protect = f.alive && f.protected;
      if (protect !== protectOn) {
        protectOn = protect;
        chipProtect.hidden = !protect;
      }
      const carry = f.alive && f.carrying;
      if (carry !== carryOn || (carry && f.mode !== carryMode)) {
        carryOn = carry;
        chipCarry.hidden = !carry;
        if (carry && f.mode !== carryMode) {
          carryMode = f.mode;
          carryIcon.replaceChildren(hudIcon(f.mode === 'secure' ? 'cooler' : 'dossier'));
          carryText.textContent = frTypo(T.carrying[f.mode]);
        }
      }
    },

    announce(title, sub, tone) {
      const item = { title, sub: sub ?? '', tone };
      const key = `${item.title}\n${item.sub}`;
      const tail = queue[queue.length - 1];
      // The same line twice in a row is shown once.
      if (tail ? `${tail.title}\n${tail.sub}` === key : announcing && lastAnnounce === key) return;
      queue.push(item);
      while (queue.length > ANNOUNCE_MAX_QUEUE) queue.shift();
      if (!announcing) nextAnnouncement();
    },

    toast(text) {
      const row = h('div', { class: 'bh-toast' }, text);
      toasts.appendChild(row);
      toastRows.push(row);
      while (toastRows.length > TOAST_MAX) toastRows.shift()!.remove();
      timers.after(TOAST_MS, () => {
        row.classList.add('is-out');
        timers.after(400, () => {
          const i = toastRows.indexOf(row);
          if (i >= 0) toastRows.splice(i, 1);
          row.remove();
        });
      });
    },

    refreshKeys() {
      if (promptText) renderPrompt(promptText);
    },

    clear() {
      queue.length = 0;
      while (toastRows.length) toastRows.shift()!.remove();
    },
  };
}
