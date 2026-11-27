// Tiny synthesized sound effects for the big reveal (no audio files to host).
// Everything is best effort: if the browser blocks audio, the reveal is simply silent.

type AC = typeof AudioContext;
let ctx: AudioContext | null = null;
// Every effect plays through this one gain node instead of straight to the speakers. Stopping the sounds
// (a skipped reveal, "Next award" mid-trombone, mute) unplugs it and starts a fresh one, which silences
// every note already queued. Suspending the whole context used to only pause them: the next tap resumed it
// and the old drumroll played over the next video.
let bus: GainNode | null = null;

function out(c: AudioContext): AudioNode {
  if (!bus) {
    bus = c.createGain();
    bus.connect(c.destination);
  }
  return bus;
}
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
    // "interrupted" is iOS-only (a call, or coming back from the Instagram app); treat it like "suspended".
    if (ctx.state !== "running" && ctx.state !== "closed") void ctx.resume().catch(() => {});
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
  // Safari 17+: play reveal sounds even when the iPhone's ringer switch is on silent, like the videos do.
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession && nav.audioSession.type !== "playback") nav.audioSession.type = "playback";
  } catch {
    /* not supported */
  }
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
  o.connect(g).connect(out(c));
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
  o.connect(g).connect(out(c));
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
  src.connect(hp).connect(g).connect(out(c));
  src.start(t0);
  // fanfare: C5 E5 G5 then a held C major chord
  [523.25, 659.25, 783.99].forEach((f, i) => note(c, f, t0 + i * 0.11, 0.18));
  [523.25, 659.25, 783.99, 1046.5].forEach((f) => note(c, f, t0 + 0.38, 1.1, 0.14));
}

/** "Wah wah wah wahhh": four descending trombone-ish notes, the last one sagging, for the not-so-proud awards. */
export function playSadTrombone() {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + 0.02;
  [392, 370, 349.23].forEach((f, i) => note(c, f, t0 + i * 0.42, 0.38, 0.16));
  // the long last note slides down with a slow wobble
  const o = c.createOscillator();
  const g = c.createGain();
  const lfo = c.createOscillator();
  const lfoGain = c.createGain();
  o.type = "sawtooth";
  const t = t0 + 3 * 0.42;
  o.frequency.setValueAtTime(329.63, t);
  o.frequency.linearRampToValueAtTime(293.66, t + 1.1);
  lfo.frequency.value = 6;
  lfoGain.gain.value = 6;
  lfo.connect(lfoGain).connect(o.frequency);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.16, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
  o.connect(g).connect(out(c));
  o.start(t);
  lfo.start(t);
  o.stop(t + 1.25);
  lfo.stop(t + 1.25);
}

export function stopSfx() {
  timers.splice(0).forEach(clearTimeout);
  // Unplug the bus (silencing everything queued on it) rather than suspending or closing the context: a
  // closed context is gone for good, and resuming a suspended one outside a tap can fail on iOS. The context
  // itself stays running and unlocked for the next reveal.
  if (bus) {
    try {
      bus.disconnect();
    } catch {
      /* already disconnected */
    }
    bus = null;
  }
}
