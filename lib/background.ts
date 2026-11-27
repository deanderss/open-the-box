import { waitUntil } from "@vercel/functions";

/**
 * Run work that must still finish even though the response is already on its way back to the client — Vercel
 * can freeze a serverless function's execution the instant its response is sent, which otherwise silently cuts
 * an un-awaited promise off partway through (a realtime broadcast, a cache write-back, a file cleanup). This
 * keeps the function alive until `work()` settles, without the caller having to await it (and so without
 * adding its latency to the response).
 *
 * Errors are swallowed: by the time they'd happen nothing is left to hand them to, and every current use here
 * (broadcasts, best-effort cache write-backs, post-play upload cleanup) is itself best-effort already.
 */
export function background(work: () => Promise<unknown>) {
  const p = work().catch(() => {});
  try {
    waitUntil(p);
  } catch {
    /* not running somewhere that supports it (e.g. local `next dev`) — the promise above still runs, it just
       isn't guaranteed to survive past the response the way it is in production */
  }
}
