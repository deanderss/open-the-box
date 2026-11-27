import { currentUserId, isGroupMod } from "./supabase-server";

/**
 * The host screen's `sessionId` is handed to every phone on join (it's how they subscribe to the realtime
 * channel), so it isn't a secret — anyone who inspects a phone's network traffic, or just finds an old QR
 * code, could otherwise request the "host" view and see upcoming videos, restricted/gone flags, etc.
 *
 * Gating that on a real login means checking Supabase Auth, which is a network round trip, plus a DB query
 * to confirm the logged-in user actually moderates this box. Doing that on every 2-second host poll would
 * make the host screen noticeably slower, so the result is cached per server instance for a minute, keyed by
 * the session plus a hash of the request's cookies (never the raw cookie value, so nothing sensitive sits in
 * memory any longer than it takes to hash it).
 */
const cache = new Map<string, { ok: boolean; until: number }>();
// A real "no, you're not a moderator of this box" is worth caching for a while (it won't flip true on its
// own). But a brief Supabase Auth hiccup fails closed into that same `ok: false` — caching that for a full
// minute used to drop the host to the plain anonymous player view for a minute on every poll: no `directUrl`
// (a native Instagram video falls back to the iframe and restarts), no `blocked`/`upNext` (no preloading).
// Genuine denials get the long TTL; anything that threw gets a much shorter one so a transient blip clears
// itself within a couple of polls instead of a whole minute.
const DENY_TTL_MS = 60_000;
const ERROR_TTL_MS = 5_000;

function hashCookies(req: Request) {
  const raw = req.headers.get("cookie") || "";
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
  return h.toString(36);
}

export async function isHostAuthorized(sessionId: string, groupId: string, req: Request): Promise<boolean> {
  const key = `${sessionId}:${hashCookies(req)}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.until > now) return hit.ok;

  let ok = false;
  let ttl = DENY_TTL_MS;
  try {
    const uid = await currentUserId();
    if (uid) ok = !!(await isGroupMod(uid, groupId));
  } catch {
    ok = false; // fail closed: an auth hiccup should never leak the host view
    ttl = ERROR_TTL_MS; // ...but shouldn't look like a real, stable "no" for a whole minute either
  }

  cache.set(key, { ok, until: now + ttl });
  if (cache.size > 5000) {
    cache.forEach((v, k) => {
      if (v.until < now) cache.delete(k);
    });
  }
  return ok;
}
