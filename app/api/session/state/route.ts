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
  const state = await buildState(s, playerId && token ? { kind: "player", playerId, deviceToken: token } : { kind: "anon" });
  return json(state);
});
