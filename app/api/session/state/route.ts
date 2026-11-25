import { handle, HttpError } from "@/lib/api";
import { json } from "@/lib/util";
import { getSessionByCode, getSession, buildState } from "@/lib/game";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  if (!rateLimit("state:" + clientIp(req), 4000, 60 * 60 * 1000)) throw new HttpError(429, "Slow down");
  const q = new URL(req.url).searchParams;
  const code = q.get("code");
  const sessionId = q.get("sessionId");
  const s = sessionId ? await getSession(sessionId) : code ? await getSessionByCode(code, true) : null;
  if (!s) throw new HttpError(404, "No game found with that code");
  const playerId = q.get("playerId");
  const token = q.get("token");
  // The host screen polls by sessionId; phones poll by room code with a player token. Only the host screen needs the
  // per-video playability details (restricted flag, Instagram aspect), so phones never pay for that lookup.
  const viewer = playerId && token ? ({ kind: "player", playerId, deviceToken: token } as const) : sessionId ? ({ kind: "host" } as const) : ({ kind: "anon" } as const);
  const state = await buildState(s, viewer);
  return json(state);
});
