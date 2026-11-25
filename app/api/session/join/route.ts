import { supabaseAdmin } from "@/lib/supabase-server";
import { handle, body, HttpError } from "@/lib/api";
import { json, randomToken } from "@/lib/util";
import { getSessionByCode, broadcast } from "@/lib/game";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const POST = handle(async (req) => {
  if (!rateLimit("join:" + clientIp(req), 60, 60 * 60 * 1000)) throw new HttpError(429, "Too many tries");
  const { code, playerId, token } = await body<{ code?: string; playerId?: string; token?: string }>(req);
  const s = code ? await getSessionByCode(code) : null;
  if (!s || s.state === "finished") throw new HttpError(404, "No live game with that code");
  const db = supabaseAdmin();
  if (!playerId) {
    const { data: g } = await db.from("groups").select("name,color,emoji").eq("id", s.group_id).single();
    const { data: roster } = await db.from("players").select("id,display_name,avatar_color").eq("group_id", s.group_id).eq("active", true).order("display_name");
    const { data: taken } = await db.from("session_players").select("player_id").eq("session_id", s.id);
    const takenSet = new Set((taken || []).map((t) => t.player_id));
    return json({
      group: g,
      roster: (roster || []).map((p) => ({ id: p.id, name: p.display_name, color: p.avatar_color, taken: takenSet.has(p.id) })),
    });
  }
  const { data: p } = await db.from("players").select("id").eq("id", playerId).eq("group_id", s.group_id).eq("active", true).maybeSingle();
  if (!p) throw new HttpError(400, "That name isn't on this box's roster");
  const { data: existing } = await db.from("session_players").select("device_token").eq("session_id", s.id).eq("player_id", playerId).maybeSingle();
  if (existing) {
    if (token && existing.device_token === token) return json({ token, sessionId: s.id });
    throw new HttpError(409, "Someone already joined as that name. Ask the moderator to free it up.");
  }
  const newToken = randomToken();
  const { error } = await db.from("session_players").insert({ session_id: s.id, player_id: playerId, device_token: newToken });
  if (error) throw new HttpError(409, "Someone already joined as that name.");
  await broadcast(s.id);
  return json({ token: newToken, sessionId: s.id });
});
