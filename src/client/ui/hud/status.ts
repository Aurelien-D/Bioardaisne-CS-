/**
 * Bottom corners of the HUD: health and armour (left), ammunition, weapon name
 * and the weapon bar (right).
 */
import type { HudFrame } from '../../core/contracts';
import type { SettingsStore } from '../../core/settings';
import { MAX_ARMOR, MAX_HEALTH, SLOT_COUNT } from '../../../shared/constants';
import { WEAPONS, type WeaponDef, type WeaponId } from '../../../shared/weapons/defs';
import { h } from '../dom';
import { bindingLabel } from '../keys';
import { hudIcon, weaponIcon } from './icons';
import { T } from './texts';
import { clamp, setFlag, type Timers } from './util';

// =================================================================================
// Health and armour
// =================================================================================

export interface Vitals {
  el: HTMLElement;
  update(f: HudFrame): void;
}

function stat(kind: 'hp' | 'ar', icon: SVGSVGElement): { el: HTMLElement; num: HTMLElement; fill: HTMLElement; trail: HTMLElement } {
  const num = h('span', { class: 'bh-stat__num bas-display' }, '0');
  const fill = h('i', { class: 'bh-stat__fill' });
  const trail = h('i', { class: 'bh-stat__trail' });
  const el = h('div', { class: `bh-stat bh-stat--${kind}` }, icon, num, h('div', { class: 'bh-stat__bar' }, trail, fill));
  return { el, num, fill, trail };
}

export function createVitals(): Vitals {
  const hp = stat('hp', hudIcon('health'));
  const ar = stat('ar', hudIcon('armor'));
  const el = h('div', { class: 'bh-vitals' }, hp.el, ar.el);

  let health = -1;
  let armor = -1;
  let level = '';
  let alive = true;

  return {
    el,
    update(f) {
      if (f.alive !== alive) {
        alive = f.alive;
        el.classList.toggle('is-off', !alive);
      }
      if (!alive) return;

      const hv = Math.max(0, Math.ceil(f.health));
      if (hv !== health) {
        // A refill (respawn) must not animate the damage trail backwards.
        const up = hv > health;
        health = hv;
        hp.num.textContent = String(hv);
        const k = clamp(hv / MAX_HEALTH, 0, 1);
        hp.fill.style.transform = `scaleX(${k})`;
        hp.trail.classList.toggle('is-snap', up);
        hp.trail.style.transform = `scaleX(${k})`;
        const lv = hv < 25 ? 'low' : hv <= 50 ? 'mid' : 'ok';
        if (lv !== level) {
          level = lv;
          hp.el.setAttribute('data-level', lv);
        }
      }

      const av = Math.max(0, Math.ceil(f.armor));
      if (av !== armor) {
        const up = av > armor;
        if ((av === 0) !== (armor === 0) || armor < 0) setFlag(ar.el, 'data-empty', av === 0);
        armor = av;
        ar.num.textContent = String(av);
        const k = clamp(av / MAX_ARMOR, 0, 1);
        ar.fill.style.transform = `scaleX(${k})`;
        ar.trail.classList.toggle('is-snap', up);
        ar.trail.style.transform = `scaleX(${k})`;
      }
    },
  };
}

// =================================================================================
// Ammunition, weapon name, weapon bar
// =================================================================================

export interface Arsenal {
  /** Ammo panel (bottom right). */
  el: HTMLElement;
  /** Weapon bar (stacked above the ammo panel). */
  bar: HTMLElement;
  update(f: HudFrame): void;
  /** Key labels changed (settings or keyboard layout). */
  refreshKeys(): void;
}

const BAR_VISIBLE_MS = 2600;

export function createArsenal(settings: SettingsStore, timers: Timers): Arsenal {
  // --- Ammo panel ------------------------------------------------------------------
  const name = h('div', { class: 'bh-ammo__name bas-display' });
  const art = h('div', { class: 'bh-ammo__art' });
  const clip = h('span', { class: 'bh-ammo__clip bas-display' }, '0');
  const reserve = h('span', { class: 'bh-ammo__res bas-display' }, '0');
  const reloadKey = h('kbd', { class: 'bas-kbd' });
  const hintText = h('span', null, T.reload);
  const hint = h('div', { class: 'bh-ammo__hint bas-display' }, reloadKey, hintText);
  const gauge = h('i', { class: 'bh-ammo__gauge' });
  const reloadFill = h('i', { class: 'bh-ammo__prog' });
  const el = h(
    'div',
    { class: 'bh-ammo' },
    hint,
    h('div', { class: 'bh-ammo__head' }, name, art),
    h('div', { class: 'bh-ammo__count' }, clip, h('span', { class: 'bh-ammo__sep' }, '/'), reserve),
    h('div', { class: 'bh-ammo__bar' }, gauge, reloadFill),
  );

  // --- Weapon bar ------------------------------------------------------------------
  interface SlotRow {
    el: HTMLElement;
    art: HTMLElement;
    name: HTMLElement;
    key: HTMLElement;
    weapon: WeaponId | null | undefined;
  }
  const rows: SlotRow[] = [];
  const bar = h('div', { class: 'bh-wbar' });
  for (let i = 0; i < SLOT_COUNT; i++) {
    const rArt = h('span', { class: 'bh-wslot__art' });
    const rName = h('span', { class: 'bh-wslot__name bas-display' });
    const rKey = h('kbd', { class: 'bas-kbd' });
    const row = h('div', { class: 'bh-wslot' }, rName, rArt, rKey);
    bar.appendChild(row);
    rows.push({ el: row, art: rArt, name: rName, key: rKey, weapon: undefined });
  }

  // --- State -----------------------------------------------------------------------
  let weapon: WeaponId | null | undefined;
  let gaugeDef: WeaponDef | null | undefined;
  let clipV = -1;
  let resV = -1;
  let state = '';
  let hintKind = '';
  let reloading = false;
  let alive = true;
  let activeSlot = -1;
  let barTimer = 0;
  let barOn = false;
  let primed = false;

  function showBar(): void {
    if (!barOn) {
      barOn = true;
      bar.classList.add('is-on');
    }
    timers.cancel(barTimer);
    barTimer = timers.after(BAR_VISIBLE_MS, () => {
      barOn = false;
      bar.classList.remove('is-on');
    });
  }

  function refreshKeys(): void {
    const keys = settings.value.keys;
    reloadKey.textContent = bindingLabel(keys.reload, true);
    const slotKeys = [keys.slot1, keys.slot2, keys.slot3];
    rows.forEach((r, i) => (r.key.textContent = bindingLabel(slotKeys[i], true)));
  }
  refreshKeys();

  return {
    el,
    bar,
    refreshKeys,

    update(f) {
      if (f.alive !== alive) {
        alive = f.alive;
        el.classList.toggle('is-off', !alive);
        bar.classList.toggle('is-cut', !alive);
        if (!alive && barOn) {
          timers.cancel(barTimer);
          barOn = false;
          bar.classList.remove('is-on');
        }
      }
      if (!alive) {
        primed = false;
        return;
      }

      // Weapon in hands.
      if (f.weapon !== weapon) {
        weapon = f.weapon;
        const def = weapon ? WEAPONS[weapon] : null;
        name.textContent = def ? def.name : '';
        art.replaceChildren(...(weapon ? [weaponIcon(weapon)] : []));
        // A weapon switch always cancels a reload: stop the progress bar.
        reloading = false;
        el.removeAttribute('data-reloading');
      }
      const def = weapon ? WEAPONS[weapon] : null;
      const melee = !def || def.kind === 'melee' || def.clip <= 0;

      if (f.clip !== clipV || def !== gaugeDef) {
        clipV = f.clip;
        gaugeDef = def;
        clip.textContent = String(Math.max(0, f.clip));
        // The bar under the counter is a magazine gauge.
        gauge.style.transform = `scaleX(${def && def.clip > 0 ? clamp(f.clip / def.clip, 0, 1) : 0})`;
      }
      if (f.reserve !== resV) {
        resV = f.reserve;
        reserve.textContent = String(Math.max(0, f.reserve));
      }

      // Colour state of the clip counter.
      const lowAt = def ? Math.max(1, Math.ceil(def.clip * 0.25)) : 0;
      const st = melee ? 'melee' : f.clip <= 0 ? 'empty' : f.clip <= lowAt ? 'low' : 'ok';
      if (st !== state) {
        state = st;
        el.setAttribute('data-state', st);
      }

      // Reload progress: the duration is known from the weapon data, so the bar is a
      // plain CSS animation (no per-frame work).
      if (f.reloading !== reloading) {
        reloading = f.reloading;
        if (reloading && def) {
          reloadFill.style.animationDuration = `${def.reloadTime}s`;
          el.setAttribute('data-reloading', '');
        } else el.removeAttribute('data-reloading');
      }

      // Hint above the panel.
      const hk = melee ? '' : reloading ? 'reloading' : f.clip <= lowAt && f.reserve > 0 ? 'reload' : f.clip <= 0 && f.reserve <= 0 ? 'dry' : '';
      if (hk !== hintKind) {
        hintKind = hk;
        if (hk) {
          hintText.textContent = hk === 'reloading' ? T.reloading : hk === 'dry' ? T.noAmmo : T.reload;
          hint.setAttribute('data-kind', hk);
        } else hint.removeAttribute('data-kind');
      }

      // Weapon bar.
      let changed = false;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!;
        const w = f.slots[i] ?? null;
        if (w !== r.weapon) {
          r.weapon = w;
          r.art.replaceChildren(...(w ? [weaponIcon(w)] : []));
          r.name.textContent = w ? WEAPONS[w].name : '';
          setFlag(r.el, 'data-empty', !w);
          changed = true;
        }
      }
      if (f.activeSlot !== activeSlot) {
        activeSlot = f.activeSlot;
        rows.forEach((r, i) => setFlag(r.el, 'data-active', i === activeSlot));
        changed = true;
      }
      // Shown briefly on every change (and when coming back to life).
      if (changed || !primed) showBar();
      primed = true;
    },
  };
}
