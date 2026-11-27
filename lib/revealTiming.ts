// Pure timing math for the grand-reveal slot machine, split out of `components/GrandReveal.tsx` itself so a
// page that only needs to know *how long* to hold something back (currently just `/join`, deciding when to
// stop hiding a player's own result) doesn't have to import that component's module to get it — that module
// is `"use client"` and pulls in framer-motion, confetti and sound effects, none of which a plain constant
// needs, but a bundler can't always tell that from a named import alone.

// The whole reveal is about 6.5 seconds: a slot-machine reel (~3.8s), then the winner (~2.7s).
export const REVEAL_STEPS = 16; // how many names the slot reel flips through

/** Delay before flip i: fast at first, easing off so the last name lands with a little suspense. */
export const revealDelayFor = (i: number) => 97 + 517 * (i / (REVEAL_STEPS - 1)) ** 3;

const REEL_MS = Array.from({ length: REVEAL_STEPS }, (_, i) => revealDelayFor(i)).reduce((a, b) => a + b, 0);

/** Phones hold their own reveal back this long so they don't spoil the big screen. */
export const REVEAL_SUSPENSE_MS = REEL_MS;
