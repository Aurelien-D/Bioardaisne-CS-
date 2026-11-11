/**
 * Top centre of the HUD: team scores (rounds won, with pips), round clock,
 * objective line and the phase banner (warm-up, freeze-time countdown…).
 */
import type { HudFrame } from '../../core/contracts';
import { TEAMS } from '../../../shared/identity';
import type { MatchPhase } from '../../../shared/types';
import { frTypo, h } from '../dom';
import { T } from './texts';
import { formatClock, play, setFlag } from './util';

export interface TopBar {
  el: HTMLElement;
  update(f: HudFrame): void;
}

/** Above this many rounds the pips are dropped (the number alone stays readable). */
const MAX_PIPS = 8;

interface TeamBlock {
  el: HTMLElement;
  num: HTMLElement;
  pips: HTMLElement;
  items: HTMLElement[];
  score: number;
}

function teamBlock(team: 0 | 1): TeamBlock {
  const num = h('span', { class: 'bh-team__num bas-display' }, '0');
  const pips = h('span', { class: 'bh-team__pips' });
  const label = h('span', { class: 'bh-team__name bas-display' }, TEAMS[team].short);
  const info = h('span', { class: 'bh-team__info' }, label, pips);
  const el = h('div', { class: `bh-team bh-team--${team}` }, team === 0 ? [info, num] : [num, info]);
  return { el, num, pips, items: [], score: -1 };
}

export function createTopBar(): TopBar {
  const teams: [TeamBlock, TeamBlock] = [teamBlock(0), teamBlock(1)];
  const roundEl = h('span', { class: 'bh-clock__round bas-display' });
  const timeEl = h('span', { class: 'bh-clock__time bas-display' }, '0:00');
  const clock = h('div', { class: 'bh-clock' }, roundEl, timeEl);
  const objective = h('div', { class: 'bh-objective' });
  const phaseTitle = h('span', { class: 'bh-phase__title bas-display' });
  const phaseSub = h('span', { class: 'bh-phase__sub' });
  const phaseEl = h('div', { class: 'bh-phase', hidden: true }, phaseTitle, phaseSub);
  const el = h('div', { class: 'bh-top' }, h('div', { class: 'bh-score' }, teams[0].el, clock, teams[1].el), objective, phaseEl);

  let round = -1;
  let clockText = '';
  let crit = false;
  let idle = false;
  let objText = '';
  let myTeam = -1;
  let roundsToWin = -1;
  let phase: MatchPhase | '' = '';
  let phaseSecs = -1;
  let phaseShown = false;
  let phaseTitleText: string | null = null;
  let phaseSubText: string | null = null;

  function buildPips(n: number): void {
    const show = n > 0 && n <= MAX_PIPS;
    for (const t of teams) {
      t.items = [];
      t.pips.replaceChildren();
      if (show) {
        for (let i = 0; i < n; i++) {
          const pip = h('i');
          t.items.push(pip);
          t.pips.appendChild(pip);
        }
      }
      t.score = -1; // force a repaint of the filled pips
    }
  }

  return {
    el,
    update(f) {
      if (f.roundsToWin !== roundsToWin) {
        roundsToWin = f.roundsToWin;
        buildPips(roundsToWin);
      }
      for (let i = 0; i < 2; i++) {
        const t = teams[i]!;
        const s = f.score[i]!;
        if (s !== t.score) {
          const gained = t.score >= 0 && s > t.score;
          t.score = s;
          t.num.textContent = String(s);
          t.items.forEach((pip, k) => pip.classList.toggle('is-on', k < s));
          if (gained) play(t.num, [{ transform: 'scale(1.45)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
        }
      }
      if (f.team !== myTeam) {
        myTeam = f.team;
        teams[0].el.classList.toggle('is-mine', myTeam === 0);
        teams[1].el.classList.toggle('is-mine', myTeam === 1);
      }

      if (f.round !== round) {
        round = f.round;
        roundEl.textContent = T.round(Math.max(1, round));
      }
      const text = formatClock(f.timeLeft);
      if (text !== clockText) {
        clockText = text;
        timeEl.textContent = text;
      }
      const isCrit = f.phase === 'live' && f.timeLeft > 0 && f.timeLeft <= 10;
      if (isCrit !== crit) {
        crit = isCrit;
        setFlag(clock, 'data-crit', crit);
      }
      // Outside a live round the clock is only a phase countdown: dim it.
      const isIdle = f.phase !== 'live';
      if (isIdle !== idle) {
        idle = isIdle;
        setFlag(clock, 'data-idle', idle);
      }

      if (f.objectiveLine !== objText) {
        objText = f.objectiveLine;
        objective.textContent = objText;
        objective.hidden = objText === '';
      }

      // Phase banner.
      const secs = Math.max(0, Math.ceil(f.timeLeft - 1e-6));
      if (f.phase !== phase || secs !== phaseSecs) {
        const phaseChanged = f.phase !== phase;
        phase = f.phase;
        phaseSecs = secs;
        let title = '';
        let sub = '';
        if (phase === 'warmup') {
          title = T.warmup;
          sub = T.warmupSub;
        } else if (phase === 'freeze' && secs > 0) {
          title = T.freeze(secs);
          sub = T.freezeSub;
        } else if (phase === 'post' && secs > 0) sub = T.postNext(secs);
        else if (phase === 'over' && secs > 0) sub = T.overNext(secs);

        const show = title !== '' || sub !== '';
        if (show !== phaseShown) {
          phaseShown = show;
          phaseEl.hidden = !show;
        }
        if (show) {
          if (phaseChanged) phaseEl.setAttribute('data-phase', phase);
          if (title !== phaseTitleText) {
            phaseTitleText = title;
            phaseTitle.textContent = title;
            phaseTitle.hidden = title === '';
            // One beat per second of the countdown.
            if (phase === 'freeze') play(phaseTitle, [{ transform: 'scale(1.16)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'ease-out' });
          }
          if (sub !== phaseSubText) {
            phaseSubText = sub;
            phaseSub.textContent = frTypo(sub);
            phaseSub.hidden = sub === '';
          }
        }
      }
    },
  };
}
