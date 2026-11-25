import { supabaseAdmin } from "@/lib/supabase-server";
import { handle, body, HttpError, requireGroupMod } from "@/lib/api";
import { json } from "@/lib/util";
import { getSession, beginSession, doReveal, nextVideo, skipVideo, endSession, finishSession, pauseSession, resumeSession, broadcast } from "@/lib/game";

export const POST = handle(async (req) => {
  const { sessionId, action, playerId } = await body<{ sessionId?: string; action?: string; playerId?: string }>(req);
  const s = sessionId ? await getSession(sessionId) : null;
  if (!s) throw new HttpError(404, "Session not found");
  await requireGroupMod(s.group_id);
  if (s.ended_at && action !== "end") throw new HttpError(400, "This session has ended");
  // While paused, only resume / end / pause / kick make sense
  if (s.paused_at && !["resume", "end", "finish", "pause", "kick"].includes(action || "")) throw new HttpError(409, "The game is paused. Resume it first.");
  let r: { error?: string; session?: unknown; autoSkipped?: number } = {};
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
    case "pause":
      r = await pauseSession(s);
      break;
    case "resume":
      r = await resumeSession(s);
      break;
    case "end":
      r = await endSession(s);
      break;
    case "finish":
      r = await finishSession(s);
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
  return json({ ok: true, autoSkipped: r.autoSkipped ?? 0 });
});
