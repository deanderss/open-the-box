// Tiny synthesized sound effects for the big reveal (no audio files to host).
// Everything is best effort: if the browser blocks audio, the reveal is simply silent.

type AC = typeof AudioContext;
let ctx: AudioContext | null = null;
const timers: ReturnType<typeof setTimeout>[] = [];

const KEY = "otb-muted";
export const isMuted = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};
export const setMuted = (m: boolean) => {
  try {
    localStorage.setItem(KEY, m ? "1" : "0");
  } catch {
    /* ignore */
  }
  if (m) stopSfx();
};

function audio(): AudioContext | null {
  if (typeof window === "undefined" || isMuted()) return null;
  try {
    const Ctor: AC | undefined = window.AudioContext || (window as unknown as { webkitAudioContext?: AC }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = ctx || new Ctor();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/**
 * iOS Safari only lets an `AudioContext` actually start making sound if it was created (or resumed) from
 * directly inside a real tap's event handler — by the time the reveal fires a few seconds after the host
 * last touched anything, that window has closed, and the fanfare/drumroll above would otherwise just silently
 * do nothing. Call this synchronously from the host's own taps (Start, Next, Reveal now) so the context is
 * already running well before the reveal needs it.
 */
export function unlockAudio() {
  audio();
}

function thump(c: AudioContext, when: number, gain: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "triangle";
  o.frequency.setValueAtTime(140, when);
  o.frequency.exponentialRampToValueAtTime(48, when + 0.12);
  g.gain.setValueAtTime(gain, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + 0.16);
  o.connect(g).connect(c.destination);
  o.start(when);
  o.stop(when + 0.18);
}

/** A drum roll that speeds up and swells over `ms` milliseconds. */
export function playDrumroll(ms: number) {
  const c = audio();
  if (!c) return;
  const start = c.currentTime + 0.05;
  let t = 0;
  let gap = 0.16;
  while (t < ms / 1000) {
    const progress = t / (ms / 1000);
    thump(c, start + t, 0.25 + progress * 0.55);
    gap = 0.16 - progress * 0.12; // 160ms apart down to 40ms
    t += Math.max(0.04, gap);
  }
}

function note(c: AudioContext, freq: number, when: number, dur: number, gain = 0.18, type: OscillatorType = "sawtooth") {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(gain, when + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  o.connect(g).connect(c.destination);
  o.start(when);
  o.stop(when + dur + 0.05);
}

/** Cymbal-ish crash plus a rising fanfare ending in a big major chord. */
export function playFanfare() {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + 0.02;
  // crash: short burst of noise
  const len = Math.floor(c.sampleRate * 0.8);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = c.createBufferSource();
  const hp = c.createBiquadFilter();
  const g = c.createGain();
  hp.type = "highpass";
  hp.frequency.value = 3000;
  g.gain.value = 0.35;
  src.buffer = buf;
  src.connect(hp).connect(g).connect(c.destination);
  src.start(t0);
  // fanfare: C5 E5 G5 then a held C major chord
  [523.25, 659.25, 783.99].forEach((f, i) => note(c, f, t0 + i * 0.11, 0.18));
  [523.25, 659.25, 783.99, 1046.5].forEach((f) => note(c, f, t0 + 0.38, 1.1, 0.14));
}

export function stopSfx() {
  timers.splice(0).forEach(clearTimeout);
  // Suspend, don't close: closing destroys the context permanently, so the very next reveal would need a
  // brand new one created outside of any tap's gesture — right back to the iOS silence problem `unlockAudio`
  // exists to avoid. Suspending just pauses it; `audio()` resumes the same (already-unlocked) context.
  if (ctx) void ctx.suspend().catch(() => {});
}
