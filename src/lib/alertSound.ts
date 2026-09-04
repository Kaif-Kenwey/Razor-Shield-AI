"use client";

/**
 * RazorShield AI — critical-arrival chime.
 *
 * A tiny WebAudio two-tone chime played when a CRITICAL transaction lands
 * (opt-in via the analyst's sound toggle). The AudioContext is created
 * lazily on the first user gesture (toggling the switch counts), so
 * autoplay policies are respected. Everything is guarded — audio must
 * never break the demo.
 */

let ctx: AudioContext | null = null;

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!ctx) ctx = new Ctor();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Prime the audio context from a user gesture so later chimes can play. */
export function primeAlertSound() {
  ensureContext();
}

/**
 * Play the two-tone critical chime (E5 → A5 sine, soft envelope).
 * Returns false when audio is unavailable — callers can fall back to toast-only.
 */
export function playCriticalChime(): boolean {
  const ac = ensureContext();
  if (!ac) return false;

  try {
    const now = ac.currentTime;
    const master = ac.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.75);
    master.connect(ac.destination);

    const note = (freq: number, start: number, dur: number) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(1, now + start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
      osc.connect(gain);
      gain.connect(master);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.05);
    };

    note(659.25, 0, 0.28); // E5
    note(880.0, 0.16, 0.45); // A5
    return true;
  } catch {
    return false;
  }
}
