/**
 * Everything drawn around the aiming point: crosshair, hit marker, damage
 * direction indicators, hurt / low-health vignettes and the sniper scope.
 *
 * Two elements are exposed: `fx` (full-screen effects, below the panels) and
 * `anchor` (a 0 × 0 box snapped to the pixel at the centre of the screen, in
 * which the crosshair parts are positioned in whole pixels so they stay sharp).
 */
import type { HudFrame } from '../../core/contracts';
import type { CrosshairSettings } from '../../core/settings';
import { h, svg } from '../dom';
import { T } from './texts';
import { clamp, play } from './util';

const DAMAGE_SLOTS = 6;
const DAMAGE_MS = 1200;
const LOW_HEALTH = 25;

interface DamageSlot {
  el: HTMLElement;
  /** performance.now() at which the indicator is gone. */
  until: number;
  /** Direction of the attacker relative to the view when the hit was taken (0 = front, + = left). */
  angle: number;
  /** View yaw when the hit was taken (NaN = unknown: the arc does not follow the view). */
  yaw: number;
  shownDeg: number;
}

export interface Reticle {
  fx: HTMLElement;
  anchor: HTMLElement;
  resize(width: number, height: number): void;
  applySettings(c: CrosshairSettings): void;
  update(f: HudFrame, now: number): void;
  hit(headshot: boolean, kill: boolean): void;
  damage(relativeAngle: number, amount: number, now: number): void;
}

export function createReticle(): Reticle {
  // --- Crosshair -------------------------------------------------------------------
  const armT = h('i', { class: 'bh-xh__arm' });
  const armB = h('i', { class: 'bh-xh__arm' });
  const armL = h('i', { class: 'bh-xh__arm' });
  const armR = h('i', { class: 'bh-xh__arm' });
  const dot = h('i', { class: 'bh-xh__arm' });
  const xhair = h('div', { class: 'bh-xh' }, armT, armB, armL, armR, dot);

  // --- Hit marker ------------------------------------------------------------------
  const X_PATH = 'M-17-17L-8-8M17-17L8-8M-17 17L-8 8M17 17L8 8';
  const hitEl = svg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-26 -26 52 52" fill="none" stroke-linecap="square">
      <circle class="bh-hit__ring-o" r="22"/><circle class="bh-hit__ring" r="22"/>
      <path class="bh-hit__o" d="${X_PATH}"/><path class="bh-hit__x" d="${X_PATH}"/>
    </svg>`,
    'bh-hit',
  );

  // --- Damage direction indicators ---------------------------------------------------
  const slots: DamageSlot[] = [];
  const dmgLayer = h('div', { class: 'bh-dmg-layer' });
  for (let i = 0; i < DAMAGE_SLOTS; i++) {
    // A 56° arc of radius 100 centred on the aiming point: bright outer rim, soft falloff inwards.
    const arc = svg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -104 100 24">
        <defs><linearGradient id="bh-dmg-g${i}" gradientUnits="userSpaceOnUse" x1="0" y1="-100" x2="0" y2="-84">
          <stop offset="0" stop-color="#ee1227"/><stop offset=".45" stop-color="#ff2a3a" stop-opacity=".7"/><stop offset="1" stop-color="#ff2a3a" stop-opacity="0"/>
        </linearGradient></defs>
        <path fill="url(#bh-dmg-g${i})" d="M-46.95-88.29A100 100 0 0 1 46.95-88.29Q0-73-46.95-88.29z"/>
        <path class="bh-dmg__core" d="M-42.26-90.63A100 100 0 0 1 42.26-90.63Q0-104.6-42.26-90.63z"/>
      </svg>`,
      'bh-dmg__arc',
    );
    const el = h('div', { class: 'bh-dmg' }, arc);
    dmgLayer.appendChild(el);
    slots.push({ el, until: 0, angle: 0, yaw: NaN, shownDeg: NaN });
  }
  let damageActive = false;

  const anchor = h('div', { class: 'bh-anchor' }, dmgLayer, xhair, hitEl);

  // --- Full-screen effects -----------------------------------------------------------
  const vigLow = h('div', { class: 'bh-vig bh-vig--low' });
  const vigHurt = h('div', { class: 'bh-vig bh-vig--hurt' });
  const lens = h('span', { class: 'bh-scope__lens' });
  const scope = h(
    'div',
    { class: 'bh-scope', hidden: true },
    h('div', { class: 'bh-scope__mask' }),
    h('i', { class: 'bh-scope__line bh-scope__line--h' }),
    h('i', { class: 'bh-scope__line bh-scope__line--v' }),
    h('i', { class: 'bh-scope__post bh-scope__post--l' }),
    h('i', { class: 'bh-scope__post bh-scope__post--r' }),
    h('i', { class: 'bh-scope__post bh-scope__post--b' }),
    h('i', { class: 'bh-scope__ticks' }),
    lens,
  );
  const fx = h('div', { class: 'bh-fx' }, vigLow, vigHurt, scope);

  // --- State -----------------------------------------------------------------------
  let vh = window.innerHeight;
  let dynamic = true;
  let shown = true;
  let lastExtra = -1;
  let lastZoom = 0;
  let lowOn = false;
  let prevHealth = -1;
  let prevAlive = false;
  let lastYaw = NaN;
  let hurtAt = -1e9;
  let hurtK = 0;

  const snap = (v: number): number => {
    const dpr = window.devicePixelRatio || 1;
    return Math.round(v * dpr) / dpr;
  };

  function setExtra(extra: number): void {
    if (extra === lastExtra) return;
    lastExtra = extra;
    armT.style.transform = `translate3d(0,${-extra}px,0)`;
    armB.style.transform = `translate3d(0,${extra}px,0)`;
    armL.style.transform = `translate3d(${-extra}px,0,0)`;
    armR.style.transform = `translate3d(${extra}px,0,0)`;
  }

  function hurtFlash(amount: number, now: number): void {
    let k = clamp(0.3 + amount / 55, 0.3, 1);
    // Two triggers for the same hit (health drop + damageFrom): keep the stronger one.
    if (now - hurtAt < 60) k = Math.max(k, hurtK);
    hurtAt = now;
    hurtK = k;
    play(vigHurt, [{ opacity: k }, { opacity: k * 0.6, offset: 0.3 }, { opacity: 0 }], { duration: 520, easing: 'ease-out' });
  }

  return {
    fx,
    anchor,

    resize(width, height) {
      vh = height;
      // Whole-pixel centre: the crosshair arms must not straddle two pixel rows.
      anchor.style.transform = `translate3d(${Math.floor(width / 2)}px,${Math.floor(height / 2)}px,0)`;
      lastExtra = -1;
    },

    applySettings(c) {
      const t = Math.max(1, Math.round(c.thickness));
      const s = Math.max(0, Math.round(c.size));
      const g = Math.max(0, Math.round(c.gap));
      const off = -Math.floor(t / 2);
      const box = (el: HTMLElement, left: number, top: number, w: number, hgt: number): void => {
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.style.width = `${w}px`;
        el.style.height = `${hgt}px`;
      };
      box(armT, off, -(g + s), t, s);
      box(armB, off, g, t, s);
      box(armL, -(g + s), off, s, t);
      box(armR, g, off, s, t);
      box(dot, off, off, t, t);
      dot.hidden = !c.dot;
      const lines = s > 0;
      armT.hidden = armB.hidden = armL.hidden = armR.hidden = !lines;
      xhair.style.color = c.color;
      dynamic = c.dynamic;
      lastExtra = -1;
      if (!dynamic) setExtra(0);
    },

    update(f, now) {
      // Crosshair: hidden when dead or looking through the scope.
      const show = f.alive && f.zoom <= 0 && !f.ads;
      if (show !== shown) {
        shown = show;
        xhair.hidden = !show;
      }
      if (show && dynamic) {
        const half = Math.tan((clamp(f.fov, 1, 170) * Math.PI) / 360);
        const extra = (Math.tan(clamp(f.spread, 0, 1.2)) / half) * (vh / 2);
        setExtra(snap(clamp(extra, 0, vh * 0.3)));
      }

      // Scope overlay.
      const zoom = f.alive ? Math.max(0, f.zoom) : 0;
      if (zoom !== lastZoom) {
        if (zoom > 0) {
          lens.textContent = T.scopeLens(zoom);
          if (lastZoom <= 0) {
            scope.hidden = false;
            play(scope, [{ opacity: 0 }, { opacity: 1 }], { duration: 90, easing: 'ease-out' });
          }
        } else scope.hidden = true;
        lastZoom = zoom;
      }

      // Vignettes.
      const low = f.alive && f.health > 0 && f.health < LOW_HEALTH;
      if (low !== lowOn) {
        lowOn = low;
        vigLow.classList.toggle('is-on', low);
      }
      if (prevAlive && prevHealth >= 0) {
        if (!f.alive) hurtFlash(100, now);
        else if (f.health < prevHealth) hurtFlash(prevHealth - f.health, now);
      }
      prevAlive = f.alive;
      prevHealth = f.health;

      // Damage arcs keep pointing at the attacker while the player turns.
      lastYaw = f.radar ? f.radar.yaw : NaN;
      if (damageActive) {
        let any = false;
        for (const s of slots) {
          if (s.until <= 0) continue;
          if (now >= s.until) {
            s.until = 0;
            s.el.classList.remove('is-on');
            continue;
          }
          any = true;
          if (!Number.isNaN(s.yaw) && !Number.isNaN(lastYaw)) {
            const deg = Math.round((-(s.angle - (lastYaw - s.yaw)) * 180) / Math.PI);
            if (deg !== s.shownDeg) {
              s.shownDeg = deg;
              s.el.style.transform = `rotate(${deg}deg)`;
            }
          }
        }
        damageActive = any;
      }
    },

    hit(headshot, kill) {
      hitEl.setAttribute('data-kind', kill ? (headshot ? 'hskill' : 'kill') : headshot ? 'hs' : 'hit');
      const from = kill ? 1.7 : 1.4;
      play(
        hitEl,
        [
          { opacity: 1, transform: `scale(${from})` },
          { opacity: 1, transform: 'scale(1)', offset: kill ? 0.22 : 0.3 },
          { opacity: 1, transform: 'scale(1)', offset: kill ? 0.6 : 0.5 },
          { opacity: 0, transform: 'scale(0.9)' },
        ],
        { duration: kill ? 560 : 300, easing: 'ease-out' },
      );
    },

    damage(relativeAngle, amount, now) {
      hurtFlash(amount, now);
      // Reuse the slot of a hit from (nearly) the same direction, else a free one, else the oldest.
      let slot: DamageSlot | null = null;
      for (const s of slots) {
        if (s.until > now && Math.abs(Math.atan2(Math.sin(s.angle - relativeAngle), Math.cos(s.angle - relativeAngle))) < 0.2 && s.yaw === lastYaw) {
          slot = s;
          break;
        }
      }
      if (!slot) {
        slot = slots[0]!;
        for (const s of slots) {
          if (s.until <= now) {
            slot = s;
            break;
          }
          if (s.until < slot.until) slot = s;
        }
      }
      slot.angle = relativeAngle;
      slot.yaw = lastYaw;
      slot.until = now + DAMAGE_MS;
      slot.shownDeg = Math.round((-relativeAngle * 180) / Math.PI);
      slot.el.style.transform = `rotate(${slot.shownDeg}deg)`;
      slot.el.classList.add('is-on');
      const k = clamp(0.55 + amount / 60, 0.55, 1);
      play(slot.el, [{ opacity: k }, { opacity: k, offset: 0.3 }, { opacity: 0 }], { duration: DAMAGE_MS, easing: 'ease-in' });
      damageActive = true;
    },
  };
}
