import { supabaseAdmin } from "@/lib/supabase-server";
import { handle, body, HttpError } from "@/lib/api";
import { json, randomToken } from "@/lib/util";
import { getSessionByCode, broadcast } from "@/lib/game";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const POST = handle(async (req) => {
  const { code, playerId, token } = await body<{ code?: string; playerId?: string; token?: string }>(req);
  const ip = clientIp(req);
  // A whole room's phones (plus the moderator's own play-along panel, which re-verifies its seat on every
  // remount) share one Wi-Fi network and one room code — a flat per-IP limit used to let one busy game lock
  // every device in the room out for the rest of the hour. Key the generous budget by room code instead (a
  // bounded set — only one session can own a code), and keep a much looser per-IP ceiling only as a backstop
  // against one device hammering many different rooms.
  if (code && !rateLimit(`join:code:${code.toUpperCase()}`, 500, 60 * 60 * 1000)) throw new HttpError(429, "Too many tries — wait a bit and try again");
  if (!rateLimit(`join:ip:${ip}`, 1500, 60 * 60 * 1000)) throw new HttpError(429, "Too many tries — wait a bit and try again");
  const s = code ? await getSessionByCode(code) : null;
  if (!s || s.state === "finished") {
    // A wrong/mistyped code is expected now and then, but repeated misses look like someone guessing codes.
    if (!rateLimit(`codemiss:${ip}`, 30, 10 * 60 * 1000)) throw new HttpError(429, "Too many tries — wait a bit and try again");
    throw new HttpError(404, "No live game with that code");
  }
  const db = supabaseAdmin();
  if (!playerId) {
    // None of these three depend on each other — fetch them together instead of back to back.
    const [{ data: g }, { data: roster }, { data: taken }] = await Promise.all([
      db.from("groups").select("name,color,emoji").eq("id", s.group_id).single(),
      db.from("players").select("id,display_name,avatar_color").eq("group_id", s.group_id).eq("active", true).order("display_name"),
      db.from("session_players").select("player_id").eq("session_id", s.id),
    ]);
    const takenSet = new Set((taken || []).map((t) => t.player_id));
    return json({
      group: g,
      roster: (roster || []).map((p) => ({ id: p.id, name: p.display_name, color: p.avatar_color, taken: takenSet.has(p.id) })),
    });
  }
  // Same here: whether this name is actually on the roster, and whether someone's already sitting in its seat,
  // are two independent questions — ask both at once.
  const [{ data: p }, { data: existing }] = await Promise.all([
    db.from("players").select("id").eq("id", playerId).eq("group_id", s.group_id).eq("active", true).maybeSingle(),
    db.from("session_players").select("device_token").eq("session_id", s.id).eq("player_id", playerId).maybeSingle(),
  ]);
  if (!p) throw new HttpError(400, "That name isn't on this box's roster");
  if (existing) {
    if (token && existing.device_token === token) return json({ token, sessionId: s.id });
    throw new HttpError(409, "Someone already joined as that name. Ask the moderator to free it up.");
  }
  const newToken = randomToken();
  const { error } = await db.from("session_players").insert({ session_id: s.id, player_id: playerId, device_token: newToken });
  if (error) {
    // Only a genuine race on the same name/session is "taken" — anything else (a dropped connection, a
    // transient DB error) should look like a retry-able failure, not a permanent "someone beat you to it".
    if (error.code === "23505") throw new HttpError(409, "Someone already joined as that name. Ask the moderator to free it up.");
    throw new HttpError(503, "Couldn't join right now — try again");
  }
  await broadcast(s.id);
  return json({ token: newToken, sessionId: s.id });
});
