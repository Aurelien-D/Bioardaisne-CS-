/**
 * Human-readable labels for key bindings (Settings.keys values).
 *
 * Bindings are physical codes (KeyboardEvent.code, e.g. "KeyW") plus the pseudo
 * codes 'Mouse0'…'Mouse4', 'WheelUp' and 'WheelDown'. `keyLabel()` turns them into
 * what is printed on the player's keyboard:
 *   1. the real layout from navigator.keyboard.getLayoutMap() when the browser
 *      provides it (call `initKeyLabels()` once at start-up; it is async and cached);
 *   2. otherwise a built-in AZERTY table when navigator.language starts with "fr",
 *      else QWERTY.
 * Special keys get French names (Espace, Maj gauche, Clic droit, Molette haut…).
 *
 *   await initKeyLabels();            // optional: labels work (fallback tables) before it resolves
 *   keyLabel('KeyW')        → "Z"     (AZERTY)        keyLabel('ShiftLeft')       → "Maj gauche"
 *   keyLabel('Mouse0', true) → "Clic G" (short form for tight HUD prompts)
 *   bindingLabel(settings.value.keys.use) → "E"
 */

// ---------------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------------

/** [long, short] French names of non-printable keys and mouse inputs. */
const SPECIAL: Record<string, [string, string]> = {
  Space: ['Espace', 'Espace'],
  Enter: ['Entrée', 'Entrée'],
  NumpadEnter: ['Entrée (pavé num.)', 'Entrée'],
  Tab: ['Tab', 'Tab'],
  Escape: ['Échap', 'Échap'],
  Backspace: ['Retour arrière', 'Retour'],
  Delete: ['Suppr', 'Suppr'],
  Insert: ['Inser', 'Inser'],
  Home: ['Début', 'Début'],
  End: ['Fin', 'Fin'],
  PageUp: ['Page précédente', 'Pg préc.'],
  PageDown: ['Page suivante', 'Pg suiv.'],
  CapsLock: ['Verr. maj', 'Verr. maj'],
  ShiftLeft: ['Maj gauche', 'Maj'],
  ShiftRight: ['Maj droite', 'Maj D'],
  ControlLeft: ['Ctrl gauche', 'Ctrl'],
  ControlRight: ['Ctrl droite', 'Ctrl D'],
  AltLeft: ['Alt', 'Alt'],
  AltRight: ['Alt Gr', 'Alt Gr'],
  MetaLeft: ['Méta gauche', 'Méta'],
  MetaRight: ['Méta droite', 'Méta D'],
  ContextMenu: ['Menu', 'Menu'],
  ArrowUp: ['Flèche haut', '↑'],
  ArrowDown: ['Flèche bas', '↓'],
  ArrowLeft: ['Flèche gauche', '←'],
  ArrowRight: ['Flèche droite', '→'],
  PrintScreen: ['Impr. écran', 'Impr.'],
  ScrollLock: ['Arrêt défil', 'Défil'],
  Pause: ['Pause', 'Pause'],
  NumLock: ['Verr. num', 'Verr. num'],
  NumpadAdd: ['+ (pavé num.)', 'Pavé +'],
  NumpadSubtract: ['- (pavé num.)', 'Pavé -'],
  NumpadMultiply: ['* (pavé num.)', 'Pavé *'],
  NumpadDivide: ['/ (pavé num.)', 'Pavé /'],
  NumpadDecimal: ['. (pavé num.)', 'Pavé .'],
  Mouse0: ['Clic gauche', 'Clic G'],
  Mouse1: ['Clic molette', 'Clic M'],
  Mouse2: ['Clic droit', 'Clic D'],
  Mouse3: ['Souris 4', 'Souris 4'],
  Mouse4: ['Souris 5', 'Souris 5'],
  WheelUp: ['Molette haut', 'Molette ↑'],
  WheelDown: ['Molette bas', 'Molette ↓'],
};

/** Punctuation keys on a US QWERTY keyboard. */
const QWERTY: Record<string, string> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  IntlBackslash: '\\',
};

/** Keys that differ on a French AZERTY keyboard. */
const AZERTY: Record<string, string> = {
  KeyQ: 'A',
  KeyW: 'Z',
  KeyA: 'Q',
  KeyZ: 'W',
  KeyM: ',',
  Semicolon: 'M',
  Backquote: '²',
  Minus: ')',
  Equal: '=',
  BracketLeft: '^',
  BracketRight: '$',
  Backslash: '*',
  Quote: 'ù',
  Comma: ';',
  Period: ':',
  Slash: '!',
  IntlBackslash: '<',
};

// ---------------------------------------------------------------------------------
// Layout detection
// ---------------------------------------------------------------------------------

type LayoutMap = { get(code: string): string | undefined };

let layoutMap: LayoutMap | null = null;
let initPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function languageIsFrench(): boolean {
  try {
    return (navigator.language || '').toLowerCase().startsWith('fr');
  } catch {
    return false;
  }
}

/**
 * Load the real keyboard layout when the browser exposes it (Chromium). Safe to
 * call several times; resolves in every case (labels fall back to the built-in tables).
 */
export function initKeyLabels(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const kb = (navigator as unknown as { keyboard?: { getLayoutMap?: () => Promise<LayoutMap> } }).keyboard;
        if (kb && typeof kb.getLayoutMap === 'function') {
          const map = await kb.getLayoutMap();
          if (map && typeof map.get === 'function') {
            layoutMap = map;
            for (const l of listeners) l();
          }
        }
      } catch {
        /* permission denied / unsupported: keep the fallback tables */
      }
    })();
  }
  return initPromise;
}

/** Be notified when the async layout detection changes the labels (returns an unsubscribe function). */
export function onKeyLabelsChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Which table the labels currently come from (for the "clavier détecté" hint). */
export function keyboardLayoutName(): string {
  const w = keyLabel('KeyW');
  const q = keyLabel('KeyQ');
  if (w === 'Z' && q === 'A') return 'AZERTY';
  if (w === 'W' && q === 'Q') return 'QWERTY';
  if (keyLabel('KeyY') === 'Z') return 'QWERTZ';
  return 'personnalisé';
}

// ---------------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------------

/**
 * Label of a binding code as printed on the player's keyboard / mouse.
 * `short` returns compact forms for HUD prompts ("Maj", "Clic G", "↑").
 */
export function keyLabel(code: string, short = false): string {
  if (!code) return '—';
  const special = SPECIAL[code];
  if (special) return special[short ? 1 : 0];

  // Number row: always the digit (clearer than "&", "é"… on AZERTY).
  let m = /^Digit(\d)$/.exec(code);
  if (m) return m[1]!;
  m = /^Numpad(\d)$/.exec(code);
  if (m) return short ? `Pavé ${m[1]}` : `${m[1]} (pavé num.)`;
  if (/^F\d{1,2}$/.test(code)) return code;

  if (layoutMap) {
    const v = layoutMap.get(code);
    if (v && v !== 'Dead' && v.trim() !== '') return v.length === 1 ? v.toUpperCase() : v;
  }

  if (languageIsFrench()) {
    const fr = AZERTY[code];
    if (fr) return fr;
  }
  m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1]!;
  return QWERTY[code] ?? code;
}

/** Label of the first binding of an action ("—" when unbound). */
export function bindingLabel(codes: readonly string[] | undefined, short = false): string {
  const first = codes?.find((c) => !!c);
  return first ? keyLabel(first, short) : '—';
}

/** Labels of every binding of an action, e.g. ["Z", "Flèche haut"]. */
export function bindingLabels(codes: readonly string[] | undefined, short = false): string[] {
  return (codes ?? []).filter((c) => !!c).map((c) => keyLabel(c, short));
}

// ---------------------------------------------------------------------------------
// Events → binding codes (same convention as Settings.keys)
// ---------------------------------------------------------------------------------

/** Binding code of a keyboard event (null when the browser gives no physical code). */
export function codeFromKeyEvent(e: KeyboardEvent): string | null {
  return e.code && e.code !== 'Unidentified' ? e.code : null;
}

/** Binding code of a mouse button event: 'Mouse0' (left), 'Mouse1' (middle), 'Mouse2' (right)… */
export function codeFromMouseEvent(e: MouseEvent): string {
  return `Mouse${e.button}`;
}

/** Binding code of a wheel event. */
export function codeFromWheelEvent(e: WheelEvent): string | null {
  if (e.deltaY === 0) return null;
  return e.deltaY < 0 ? 'WheelUp' : 'WheelDown';
}
