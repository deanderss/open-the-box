import type { Options, Shape } from "canvas-confetti";

type ConfettiFn = ((options?: Options) => Promise<undefined> | null) & {
  shapeFromText: (opts: { text: string; scalar?: number }) => Shape;
};

let mod: ConfettiFn | null = null;

async function load(): Promise<ConfettiFn> {
  if (!mod) {
    const m = await import("canvas-confetti");
    // canvas-confetti's own types don't line up cleanly with how a dynamic import resolves its CJS
    // default export — the runtime shape (a callable function with .shapeFromText etc. attached) is right
    // either way.
    mod = (m.default ?? (m as unknown)) as ConfettiFn;
  }
  return mod;
}

/**
 * canvas-confetti is a few dozen KB that's only ever needed at a reveal, so it's loaded on first use
 * instead of sitting in every page's initial bundle. `disableForReducedMotion` makes the library itself
 * turn this into a no-op for anyone who has asked their device for reduced motion.
 */
export async function fireConfetti(options: Options = {}) {
  const confetti = await load();
  confetti({ disableForReducedMotion: true, ...(lightMode ? lighten(options) : options) });
}

// "Smooth TV mode" (lib/smoothTv.ts): when the host screen is being mirrored to a TV, a third of the pieces
// and a shorter fall is far lighter to encode. Switched on by the host page only, so phones are unaffected.
let lightMode = false;
export function setLightConfetti(on: boolean) {
  lightMode = on;
}
function lighten(o: Options): Options {
  return { ...o, particleCount: Math.max(10, Math.round((o.particleCount ?? 50) / 3)), ticks: Math.min(o.ticks ?? 200, 140) };
}

/** For effects that build a custom particle shape (e.g. the submit page's "stink" rain of flies). */
export async function confettiShape(text: string, scalar = 2) {
  const confetti = await load();
  return confetti.shapeFromText ? confetti.shapeFromText({ text, scalar }) : undefined;
}
