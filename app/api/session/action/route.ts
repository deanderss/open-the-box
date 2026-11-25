import { supabaseAdmin } from "@/lib/supabase-server";
import { handle, body, HttpError, requireGroupMod } from "@/lib/api";
import { json } from "@/lib/util";
import { getSession, beginSession, doReveal, nextVideo, skipVideo, endSession, broadcast } from "@/lib/game";

export const POST = handle(async (req) => {
  const { sessionId, action, playerId } = await body<{ sessionId?: string; action?: string; playerId?: string }>(req);
  const s = sessionId ? await getSession(sessionId) : null;
  if (!s) throw new HttpError(404, "Session not found");
  await requireGroupMod(s.group_id);
  if (s.ended_at && action !== "end") throw new HttpError(400, "This session has ended");
  let r: { error?: string; session?: unknown } = {};
  switch (action) {
    case "begin":
      r = await beginSession(s);
      break;
    case "reveal":
      if (s.state === "playing") await doReveal(s);
      break;
    case "next":
      r = await nextVideo(s);
      break;
    case "skip":
      r = await skipVideo(s);
      break;
    case "end":
      r = await endSession(s);
      break;
    case "kick":
      if (playerId) {
        await supabaseAdmin().from("session_players").delete().eq("session_id", s.id).eq("player_id", playerId);
        await broadcast(s.id);
      }
      break;
    default:
      throw new HttpError(400, "Unknown action");
  }
  if (r.error) throw new HttpError(400, r.error);
  return json({ ok: true });
});
