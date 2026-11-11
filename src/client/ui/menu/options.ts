/**
 * Options panel (title screen and pause menu): Souris, Vidéo, Audio, Viseur,
 * Touches. Every control writes straight to the SettingsStore, so the game, the
 * renderer and the audio engine react immediately.
 */
import {
  DEFAULT_KEYS,
  DEFAULT_SETTINGS,
  KEY_ACTION_LABELS,
  type CrosshairSettings,
  type KeyAction,
  type Quality,
  type Settings,
} from '../../core/settings';
import { Disposer, clear, h, setText } from '../dom';
import { codeFromKeyEvent, codeFromMouseEvent, codeFromWheelEvent, keyLabel, keyboardLayoutName, onKeyLabelsChange } from '../keys';
import { icon, type IconName } from './icons';
import { KEY_GROUPS } from './texts';
import type { MenuContext, View } from './types';
import { button, fmt2, fmtPercent, group, kbd, notice, row, segmented, slider, tabs, toggle } from './widgets';

export type OptionsTab = 'mouse' | 'video' | 'audio' | 'crosshair' | 'keys';

export interface OptionsView extends View {
  setTab(tab: OptionsTab): void;
}

const TABS: { id: OptionsTab; label: string; icon: IconName }[] = [
  { id: 'mouse', label: 'Souris', icon: 'mouse' },
  { id: 'video', label: 'Vidéo', icon: 'monitor' },
  { id: 'audio', label: 'Audio', icon: 'volume' },
  { id: 'crosshair', label: 'Viseur', icon: 'crosshair' },
  { id: 'keys', label: 'Touches', icon: 'keyboard' },
];

const CROSSHAIR_COLORS: { value: string; name: string }[] = [
  { value: '#39ff6a', name: 'Vert réactif' },
  { value: '#3de8ff', name: 'Cyan' },
  { value: '#ffe94a', name: 'Jaune' },
  { value: '#ff5fd2', name: 'Magenta' },
  { value: '#ffffff', name: 'Blanc' },
  { value: '#ff4646', name: 'Rouge' },
];

/** The tab is remembered while the page lives (pause → options reopens where you left). */
let lastTab: OptionsTab = 'mouse';

const px = (v: number): string => `${v}\u00a0px`;

export function createOptions(ctx: MenuContext, initialTab?: OptionsTab): OptionsView {
  const { settings } = ctx;
  const body = h('div', { class: 'bas-options__body', role: 'tabpanel' });
  let current: OptionsTab = initialTab ?? lastTab;
  let tabDisposer = new Disposer();
  let cancelCapture: (() => void) | null = null;

  const tabBar = tabs<OptionsTab>({
    label: 'Catégories d’options',
    tabs: TABS,
    active: current,
    onSelect: (id) => show(id),
  });

  const el = h('div', { class: 'bas-options' }, tabBar.el, body);

  function show(id: OptionsTab): void {
    cancelCapture?.();
    tabDisposer.dispose();
    tabDisposer = new Disposer();
    current = id;
    lastTab = id;
    tabBar.set(id);
    clear(body);
    body.dataset.tab = id;
    body.scrollTop = 0;
    if (id === 'mouse') mouseTab();
    else if (id === 'video') videoTab();
    else if (id === 'audio') audioTab();
    else if (id === 'crosshair') crosshairTab();
    else keysTab();
  }

  /** Footer of a tab: restore the defaults of the settings it shows. */
  function resetFooter(keys: (keyof Settings)[], label = 'Réglages par défaut'): HTMLElement {
    return h(
      'div',
      { class: 'bas-options__footer' },
      button({
        label,
        icon: 'reset',
        variant: 'ghost',
        size: 'sm',
        title: 'Rétablir les réglages par défaut de cet onglet',
        onClick() {
          const patch: Partial<Settings> = {};
          for (const k of keys) (patch as Record<string, unknown>)[k] = structuredClone(DEFAULT_SETTINGS[k]);
          settings.update(patch);
          ctx.toast('Réglages par défaut rétablis.', 'success');
          show(current);
        },
      }),
    );
  }

  // --- Souris --------------------------------------------------------------------
  function mouseTab(): void {
    const s = settings.value;
    body.append(
      group(
        'Visée',
        row(
          'Sensibilité',
          slider({ label: 'Sensibilité de la souris', min: 0.2, max: 8, step: 0.05, value: s.sensitivity, format: fmt2, onInput: (v) => settings.update({ sensitivity: v }) }).el,
          'Même échelle que les FPS classiques : reprenez votre valeur habituelle.',
        ),
        row(
          'Sensibilité en visée',
          slider({
            label: 'Sensibilité en visée',
            min: 0.2,
            max: 2,
            step: 0.05,
            value: s.zoomSensitivity,
            format: (v) => `×\u00a0${fmt2(v)}`,
            onInput: (v) => settings.update({ zoomSensitivity: v }),
          }).el,
          'Multiplicateur appliqué quand vous visez à la lunette du Microscope.',
        ),
        row(
          'Inverser l’axe Y',
          toggle({ label: 'Inverser l’axe Y', value: s.invertY, onChange: (on) => settings.update({ invertY: on }) }).el,
          'Pousser la souris vers l’avant fait regarder vers le bas.',
        ),
      ),
      resetFooter(['sensitivity', 'zoomSensitivity', 'invertY']),
    );
  }

  // --- Vidéo ---------------------------------------------------------------------
  function videoTab(): void {
    const s = settings.value;
    const horizontal = (v: number): number => Math.round((2 * Math.atan(Math.tan((v * Math.PI) / 360) * (16 / 9)) * 180) / Math.PI);
    const fovText = (v: number): string => `Vertical. ${v}° correspond à environ ${horizontal(v)}° à l’horizontale en 16/9.`;
    const fovHint = h('span', null, fovText(s.fov));
    body.append(
      group(
        'Rendu',
        row(
          'Qualité graphique',
          segmented<Quality>({
            label: 'Qualité graphique',
            options: [
              { value: 'low', label: 'Basse' },
              { value: 'medium', label: 'Moyenne' },
              { value: 'high', label: 'Haute' },
            ],
            value: s.quality,
            onChange: (v) => settings.update({ quality: v }),
          }).el,
          '« Basse » soulage les postes sans carte graphique dédiée.',
        ),
        row(
          'Échelle de résolution',
          slider({ label: 'Échelle de résolution', min: 0.5, max: 1, step: 0.05, value: s.resolutionScale, format: fmtPercent, onInput: (v) => settings.update({ resolutionScale: v }) }).el,
          'À réduire si l’image saccade : moins net, mais plus fluide.',
        ),
        row(
          'Champ de vision',
          slider({
            label: 'Champ de vision vertical',
            min: 55,
            max: 95,
            step: 1,
            value: s.fov,
            format: (v) => `${v}°`,
            onInput: (v) => {
              settings.update({ fov: v });
              setText(fovHint, fovText(v));
            },
          }).el,
          fovHint,
        ),
      ),
      group(
        'Affichage',
        row('Afficher les FPS', toggle({ label: 'Afficher les FPS', value: s.showFps, onChange: (on) => settings.update({ showFps: on }) }).el, 'Compteur d’images par seconde dans un coin de l’écran.'),
        row(
          'Balancement de l’arme',
          toggle({ label: 'Balancement de l’arme', value: s.viewBob, onChange: (on) => settings.update({ viewBob: on }) }).el,
          'L’arme accompagne vos pas. À couper si vous avez le mal de mer.',
        ),
      ),
      resetFooter(['quality', 'resolutionScale', 'fov', 'showFps', 'viewBob']),
    );
  }

  // --- Audio ---------------------------------------------------------------------
  function audioTab(): void {
    const s = settings.value;
    const vol = (label: string, key: 'volumeMaster' | 'volumeSfx' | 'volumeVoice' | 'volumeMusic'): HTMLElement =>
      slider({ label, min: 0, max: 1, step: 0.05, value: s[key], format: fmtPercent, onInput: (v) => settings.update({ [key]: v } as Partial<Settings>) }).el;
    body.append(
      group(
        'Volumes',
        row('Volume général', vol('Volume général', 'volumeMaster')),
        row('Effets', vol('Volume des effets', 'volumeSfx'), 'Tirs, pas, impacts, automates qui bipent.'),
        row('Musique', vol('Volume de la musique', 'volumeMusic'), 'L’ambiance du menu.'),
      ),
      group(
        'Annonceur',
        row(
          'Voix de l’annonceur',
          toggle({ label: 'Voix de l’annonceur', value: s.announcerVoice, texts: ['Activée', 'Désactivée'], onChange: (on) => settings.update({ announcerVoice: on }) }).el,
          '« Premier prélèvement ! », « Hémolysé ! »… lus par la synthèse vocale du navigateur.',
        ),
        row('Volume de l’annonceur', vol('Volume de l’annonceur', 'volumeVoice'), 'Voix et jingles des annonces.'),
      ),
      resetFooter(['volumeMaster', 'volumeSfx', 'volumeMusic', 'announcerVoice', 'volumeVoice']),
    );
  }

  // --- Viseur --------------------------------------------------------------------
  function crosshairTab(): void {
    const arms = [h('i', { class: 'bas-xhair__t' }), h('i', { class: 'bas-xhair__b' }), h('i', { class: 'bas-xhair__l' }), h('i', { class: 'bas-xhair__r' })];
    const dot = h('i', { class: 'bas-xhair__dot' });
    const xhair = h('div', { class: 'bas-xhair' }, arms, dot);
    const preview = h(
      'div',
      { class: 'bas-xpreview', 'aria-hidden': 'true' },
      h('div', { class: 'bas-xpreview__wall' }),
      h('div', { class: 'bas-xpreview__floor' }),
      h('div', { class: 'bas-xpreview__target' }, h('span'), h('span')),
      xhair,
      h('div', { class: 'bas-xpreview__label bas-kicker' }, 'Aperçu en direct'),
    );
    const previewBox = h(
      'div',
      { class: 'bas-xside' },
      preview,
      h('p', { class: 'bas-xside__note' }, 'Taille réelle : le viseur s’affiche en jeu au pixel près, quel que soit l’écran.'),
    );
    const swatches = CROSSHAIR_COLORS.map((c) =>
      h('button', { type: 'button', class: 'bas-swatch', role: 'radio', title: c.name, 'aria-label': c.name, style: { '--c': c.value }, dataset: { color: c.value } }),
    );
    const custom = h('input', { type: 'color', class: 'bas-swatch bas-swatch--custom', title: 'Couleur personnalisée', 'aria-label': 'Couleur personnalisée' });

    const paint = (): void => {
      const c = settings.value.crosshair;
      xhair.style.setProperty('--xc', c.color);
      xhair.style.setProperty('--xs', `${c.size}px`);
      xhair.style.setProperty('--xg', `${c.gap}px`);
      xhair.style.setProperty('--xt', `${c.thickness}px`);
      xhair.classList.toggle('is-dynamic', c.dynamic);
      dot.hidden = !c.dot;
      const preset = CROSSHAIR_COLORS.some((p) => p.value.toLowerCase() === c.color.toLowerCase());
      swatches.forEach((sw) => sw.setAttribute('aria-checked', sw.dataset.color!.toLowerCase() === c.color.toLowerCase() ? 'true' : 'false'));
      custom.classList.toggle('is-active', !preset);
      if (/^#[0-9a-f]{6}$/i.test(c.color)) custom.value = c.color;
    };
    const set = (patch: Partial<CrosshairSettings>): void => {
      settings.update({ crosshair: { ...settings.value.crosshair, ...patch } });
      paint();
    };
    swatches.forEach((sw) => sw.addEventListener('click', () => set({ color: sw.dataset.color! })));
    custom.addEventListener('input', () => set({ color: custom.value }));

    const c = settings.value.crosshair;
    const controls = h(
      'div',
      { class: 'bas-xcontrols' },
      group(
        'Apparence',
        row('Couleur', h('div', { class: 'bas-swatches', role: 'radiogroup', 'aria-label': 'Couleur du viseur' }, swatches, custom)),
        row('Longueur des traits', slider({ label: 'Longueur des traits', min: 1, max: 20, step: 1, value: c.size, format: px, onInput: (v) => set({ size: v }) }).el),
        row('Écart au centre', slider({ label: 'Écart au centre', min: 0, max: 14, step: 1, value: c.gap, format: px, onInput: (v) => set({ gap: v }) }).el),
        row('Épaisseur', slider({ label: 'Épaisseur des traits', min: 1, max: 6, step: 1, value: c.thickness, format: px, onInput: (v) => set({ thickness: v }) }).el),
      ),
      group(
        'Comportement',
        row(
          'Viseur dynamique',
          toggle({ label: 'Viseur dynamique', value: c.dynamic, onChange: (on) => set({ dynamic: on }) }).el,
          'Les traits s’écartent quand l’arme perd en précision.',
        ),
        row('Point central', toggle({ label: 'Point central', value: c.dot, onChange: (on) => set({ dot: on }) }).el),
      ),
    );
    paint();
    body.append(h('div', { class: 'bas-xlayout' }, previewBox, controls), resetFooter(['crosshair'], 'Viseur par défaut'));
  }

  // --- Touches -------------------------------------------------------------------
  function keysTab(): void {
    const slots = new Map<string, HTMLButtonElement>();
    const warnEls = new Map<KeyAction, HTMLElement>();
    const conflictBox = h('div', { class: 'bas-keys__conflicts' });
    const layoutNote = h('span', null);

    const slotId = (a: KeyAction, i: number): string => `${a}:${i}`;

    const paint = (): void => {
      const keys = settings.value.keys;
      // Which actions share a key?
      const users = new Map<string, KeyAction[]>();
      for (const g of KEY_GROUPS) {
        for (const a of g.actions) {
          for (const code of (keys[a] ?? []).slice(0, 2)) {
            if (!code) continue;
            const list = users.get(code);
            if (list) {
              if (!list.includes(a)) list.push(a);
            } else users.set(code, [a]);
          }
        }
      }
      const conflicts = [...users.entries()].filter(([, list]) => list.length > 1);
      const conflictActions = new Map<KeyAction, string[]>();
      for (const [code, list] of conflicts) {
        for (const a of list) {
          const others = list.filter((o) => o !== a).map((o) => KEY_ACTION_LABELS[o]);
          conflictActions.set(a, [...(conflictActions.get(a) ?? []), `${keyLabel(code)} : aussi « ${others.join(' », « ')} »`]);
        }
      }
      for (const [id, btn] of slots) {
        const [a, i] = id.split(':') as [KeyAction, string];
        const code = (keys[a] ?? [])[Number(i)] ?? '';
        const capturing = btn.classList.contains('is-capturing');
        if (!capturing) {
          setText(btn, code ? keyLabel(code) : '—');
          btn.classList.toggle('is-empty', !code);
        }
        btn.classList.toggle('is-conflict', !!code && (users.get(code)?.length ?? 0) > 1);
        btn.setAttribute('aria-label', `${KEY_ACTION_LABELS[a]}, touche ${Number(i) + 1} : ${code ? keyLabel(code) : 'aucune'}. Cliquer pour modifier.`);
      }
      for (const [a, warn] of warnEls) {
        const msgs = conflictActions.get(a);
        warn.hidden = !msgs;
        warn.title = msgs ? msgs.join('\n') : '';
      }
      clear(conflictBox);
      if (conflicts.length > 0) {
        conflictBox.append(
          notice(
            'warn',
            h('strong', null, conflicts.length > 1 ? `${conflicts.length} touches en double` : 'Touche en double'),
            ' — ',
            conflicts.map(([code, list]) => `${keyLabel(code)} : ${list.map((a) => KEY_ACTION_LABELS[a]).join(' et ')}`).join(' · '),
            '.',
          ),
        );
      }
      setText(layoutNote, `Clavier détecté : ${keyboardLayoutName()}.`);
    };

    const assign = (action: KeyAction, index: number, code: string | null): void => {
      const keys = { ...settings.value.keys };
      const list = [...(keys[action] ?? [])];
      while (list.length < 2) list.push('');
      if (code) {
        // Same key in the other slot of this action: move it instead of duplicating.
        const other = list.indexOf(code);
        if (other >= 0 && other !== index) list[other] = '';
      }
      list[index] = code ?? '';
      keys[action] = list.filter((c) => !!c);
      settings.update({ keys });
    };

    const startCapture = (action: KeyAction, index: number, btn: HTMLButtonElement): void => {
      cancelCapture?.();
      const d = new Disposer();
      ctx.capturing = true;
      btn.classList.add('is-capturing');
      btn.textContent = 'Appuyez…';
      hint.classList.add('is-active');

      const finish = (): void => {
        d.dispose();
        cancelCapture = null;
        ctx.capturing = false;
        btn.classList.remove('is-capturing');
        hint.classList.remove('is-active');
        paint();
      };
      cancelCapture = finish;

      d.listen(
        window,
        'keydown',
        (e: KeyboardEvent) => {
          if (e.key === 'Escape') return; // handled by the menus' back chain → cancelCapture()
          e.preventDefault();
          e.stopImmediatePropagation();
          if (e.repeat) return;
          if (e.key === 'Delete' || e.key === 'Backspace') {
            assign(action, index, null);
            ctx.sound('back');
          } else {
            const code = codeFromKeyEvent(e);
            if (!code) return;
            assign(action, index, code);
            ctx.sound('click');
          }
          finish();
        },
        true,
      );
      d.listen(
        window,
        'mousedown',
        (e: MouseEvent) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          assign(action, index, codeFromMouseEvent(e));
          ctx.sound('click');
          // Swallow what the browser fires when this button is released
          // (click for the left button, auxclick / context menu for the others).
          const followUps = e.button === 0 ? ['click'] : e.button === 2 ? ['auxclick', 'contextmenu'] : ['auxclick'];
          const swallow = (ev: Event): void => {
            ev.preventDefault();
            ev.stopImmediatePropagation();
          };
          for (const type of followUps) window.addEventListener(type, swallow, { capture: true, once: true });
          window.setTimeout(() => {
            for (const type of followUps) window.removeEventListener(type, swallow, true);
          }, 350);
          finish();
        },
        true,
      );
      d.listen(
        window,
        'wheel',
        (e: WheelEvent) => {
          const code = codeFromWheelEvent(e);
          if (!code) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          assign(action, index, code);
          ctx.sound('click');
          finish();
        },
        { capture: true, passive: false },
      );
      d.listen(window, 'blur', finish);
    };

    const hint = h(
      'p',
      { class: 'bas-keys__hint' },
      h('span', { class: 'bas-keys__hint-idle' }, 'Cliquez sur une touche, puis appuyez sur la nouvelle touche ou le bouton de souris à lui attribuer.'),
      h('span', { class: 'bas-keys__hint-active' }, 'En attente d’une touche… ', kbd('Échap'), ' annuler · ', kbd('Suppr'), ' effacer'),
    );

    const columns = [h('div', { class: 'bas-keys__col' }), h('div', { class: 'bas-keys__col' })];
    KEY_GROUPS.forEach((g, gi) => {
      const rows = g.actions.map((a) => {
        const warn = h('span', { class: 'bas-keys__warn', hidden: true }, icon('alert'));
        warnEls.set(a, warn);
        const btns = [0, 1].map((i) => {
          const b = h('button', { type: 'button', class: 'bas-keyslot', dataset: { snd: 'none' } });
          b.addEventListener('click', () => {
            ctx.sound('click');
            startCapture(a, i, b);
          });
          slots.set(slotId(a, i), b);
          return b;
        });
        return h('div', { class: 'bas-keyrow' }, h('span', { class: 'bas-keyrow__label' }, KEY_ACTION_LABELS[a], warn), btns);
      });
      columns[gi < 2 ? 0 : 1]!.append(group(g.title, rows));
    });

    paint();
    tabDisposer.add(onKeyLabelsChange(paint));
    tabDisposer.add(() => cancelCapture?.());

    body.append(
      h(
        'div',
        { class: 'bas-keys__top' },
        h('div', { class: 'bas-keys__intro' }, hint, h('small', null, layoutNote)),
        button({
          label: 'Touches par défaut',
          title: 'Rétablir toutes les touches par défaut',
          icon: 'reset',
          variant: 'ghost',
          size: 'sm',
          onClick() {
            cancelCapture?.();
            settings.update({ keys: structuredClone(DEFAULT_KEYS) });
            ctx.toast('Touches par défaut rétablies.', 'success');
            paint();
          },
        }),
      ),
      conflictBox,
      h('div', { class: 'bas-keys' }, columns),
    );
  }

  show(current);

  return {
    el,
    setTab: show,
    back() {
      if (cancelCapture) {
        cancelCapture();
        ctx.sound('back');
        return true;
      }
      return false;
    },
    focus() {
      el.querySelector<HTMLElement>('.bas-tab[aria-selected="true"]')?.focus();
    },
    dispose() {
      cancelCapture?.();
      tabDisposer.dispose();
    },
  };
}
