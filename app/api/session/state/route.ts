import { handle, HttpError } from "@/lib/api";
import { json } from "@/lib/util";
import { getSessionByCode, getSession, buildState, type SessionRow } from "@/lib/game";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { isHostAuthorized } from "@/lib/hostAuth";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const q = new URL(req.url).searchParams;
  const code = q.get("code");
  const sessionId = q.get("sessionId");
  const playerId = q.get("playerId");
  const token = req.headers.get("x-otb-token") || q.get("token");
  const ip = clientIp(req);

  // One generous budget per device — a player's phone, or the host screen's own session — plus a looser
  // per-IP ceiling so a room full of phones on one Wi-Fi network never trips a single shared limit.
  const deviceKey = playerId ? `state:p:${playerId}` : sessionId ? `state:s:${sessionId}` : `state:ip:${ip}`;
  if (!rateLimit(deviceKey, 6000, 60 * 60 * 1000)) throw new HttpError(429, "Slow down");
  if (!rateLimit(`state:ipcap:${ip}`, 60000, 60 * 60 * 1000)) throw new HttpError(429, "Slow down");

  let s: SessionRow | null = null;
  if (sessionId) {
    s = await getSession(sessionId);
  } else if (code) {
    s = await getSessionByCode(code, true);
    if (!s && !rateLimit(`codemiss:${ip}`, 30, 10 * 60 * 1000)) {
      throw new HttpError(429, "Too many tries — wait a bit and try again");
    }
  }
  if (!s) throw new HttpError(404, "No game found with that code");

  // The host screen's extra per-video details (the restricted/gone flag, the Instagram crop aspect, and the
  // next video in line) are only for a logged-in moderator of THIS box. A sessionId alone isn't a secret —
  // every phone is handed one on join to subscribe to the realtime channel — so anyone else with it just
  // gets the plain anonymous view instead.
  const viewer =
    playerId && token
      ? ({ kind: "player", playerId, deviceToken: token } as const)
      : sessionId && (await isHostAuthorized(sessionId, s.group_id, req))
        ? ({ kind: "host" } as const)
        : ({ kind: "anon" } as const);
  const state = await buildState(s, viewer);
  return json(state);
});
