/**
 * Spoken announcer lines through the browser's speech synthesis, in French.
 * Everything is defensive: the API may be missing, voices arrive asynchronously,
 * and some engines forget to fire `end`. Nothing here ever throws.
 */
import type { SettingsStore } from '../core/settings';

/** A line that could not start within this delay is dropped (the moment has passed). */
const STALE_MS = 3200;
/** A line already being spoken may hold a newer one back for this long before it is cut. */
const MAX_HOLD_MS = 1700;
/** Safety net when the engine never reports the end of an utterance. */
const WATCHDOG_MS = 9000;

function synthesis(): SpeechSynthesis | null {
  try {
    const g = globalThis as unknown as { speechSynthesis?: SpeechSynthesis; SpeechSynthesisUtterance?: unknown };
    if (!g.speechSynthesis || typeof g.SpeechSynthesisUtterance !== 'function') return null;
    return g.speechSynthesis;
  } catch {
    return null;
  }
}

export class Announcer {
  private voice: SpeechSynthesisVoice | null = null;
  private voicesLoaded = false;
  private pending: { text: string; due: number; born: number } | null = null;
  private speaking = false;
  private speakStart = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Identifies the utterance in progress so late events of older ones are ignored. */
  private serial = 0;

  constructor(private readonly settings: SettingsStore) {
    const synth = synthesis();
    if (!synth) return;
    try {
      this.loadVoices();
      synth.addEventListener?.('voiceschanged', () => this.loadVoices());
    } catch {
      /* voices stay on the engine default */
    }
  }

  get supported(): boolean {
    return synthesis() !== null;
  }

  /** Name of the French voice in use (diagnostics / dev harness). */
  get voiceName(): string | null {
    return this.voice ? `${this.voice.name} (${this.voice.lang})` : null;
  }

  private loadVoices(): void {
    const synth = synthesis();
    if (!synth) return;
    let voices: SpeechSynthesisVoice[] = [];
    try {
      voices = synth.getVoices();
    } catch {
      return;
    }
    if (voices.length === 0) return;
    this.voicesLoaded = true;
    const lang = (v: SpeechSynthesisVoice): string => v.lang.replace('_', '-').toLowerCase();
    const french = voices.filter((v) => lang(v).startsWith('fr'));
    const score = (v: SpeechSynthesisVoice): number =>
      (lang(v) === 'fr-fr' ? 4 : 0) + (v.localService ? 2 : 0) + (v.default ? 1 : 0);
    french.sort((a, b) => score(b) - score(a));
    this.voice = french[0] ?? null;
  }

  /** Queue a line; `delayMs` leaves room for the jingle that precedes it. */
  say(text: string, delayMs = 0): void {
    if (!this.settings.value.announcerVoice) return;
    const clean = text.replace(/\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
    if (!clean || !synthesis()) return;
    const now = performance.now();
    // A newer line makes the one still waiting obsolete.
    this.pending = { text: clean, due: now + delayMs, born: now };
    this.pump();
  }

  /** Silence the announcer and forget what was queued. */
  cancel(): void {
    this.pending = null;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.serial++;
    this.speaking = false;
    try {
      synthesis()?.cancel();
    } catch {
      /* ignore */
    }
  }

  private retry(ms: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
    }, ms);
  }

  private pump(): void {
    const p = this.pending;
    const synth = synthesis();
    if (!p || !synth) return;
    const now = performance.now();
    if (now - p.due > STALE_MS) {
      this.pending = null;
      return;
    }
    if (now < p.due) {
      this.retry(p.due - now);
      return;
    }
    if (this.speaking) {
      const held = now - this.speakStart;
      if (held < MAX_HOLD_MS) {
        this.retry(Math.min(150, MAX_HOLD_MS - held));
        return;
      }
      if (held < WATCHDOG_MS) {
        // The previous line drags on: cut it and start the new one on the next tick
        // (some engines swallow a speak() issued right after cancel()).
        this.serial++;
        this.speaking = false;
        try {
          synth.cancel();
        } catch {
          /* ignore */
        }
        this.retry(70);
        return;
      }
      this.speaking = false;
    }
    this.pending = null;
    try {
      // Anything still queued in the engine at this point is stale.
      if (synth.pending || synth.speaking) synth.cancel();
      if (!this.voicesLoaded) this.loadVoices();
      const s = this.settings.value;
      const utter = new SpeechSynthesisUtterance(p.text);
      utter.lang = this.voice?.lang ?? 'fr-FR';
      if (this.voice) utter.voice = this.voice;
      utter.rate = 1.06;
      utter.pitch = 0.92;
      utter.volume = Math.max(0, Math.min(1, s.volumeVoice * s.volumeMaster));
      if (utter.volume <= 0.001) return;
      const id = ++this.serial;
      const finish = (): void => {
        if (id !== this.serial) return;
        this.speaking = false;
        if (this.pending) this.pump();
      };
      utter.onend = finish;
      utter.onerror = finish;
      this.speaking = true;
      this.speakStart = now;
      synth.speak(utter);
    } catch {
      this.speaking = false;
    }
  }
}
