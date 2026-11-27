import { supabaseAdmin } from "@/lib/supabase-server";
import { handle, body, HttpError, requireGroupMod, check } from "@/lib/api";
import { json } from "@/lib/util";
import {
  getSession,
  beginSession,
  doReveal,
  nextVideo,
  skipVideo,
  endSession,
  finishSession,
  pauseSession,
  resumeSession,
  advanceAwards,
  skipAwards,
  broadcast,
  buildState,
  type SessionRow,
} from "@/lib/game";

export const POST = handle(async (req) => {
  const { sessionId, action, playerId, expectIndex, expectStep } = await body<{
    sessionId?: string;
    action?: string;
    playerId?: string;
    expectIndex?: number;
    expectStep?: number;
  }>(req);
  const s = sessionId ? await getSession(sessionId) : null;
  if (!s) throw new HttpError(404, "Session not found");
  const { admin } = await requireGroupMod(s.group_id);
  // The awards ceremony runs after the game has ended, so its two actions are the exception.
  const isAwardAction = action === "award_next" || action === "award_skip";
  if (s.ended_at && action !== "end" && !isAwardAction) throw new HttpError(400, "This session has ended");
  // While paused, only resume / end / pause / kick make sense
  if (s.paused_at && !["resume", "end", "finish", "pause", "kick"].includes(action || "")) throw new HttpError(409, "The game is paused. Resume it first.");
  // A double-tap (or two moderators on the same screen) can fire "next"/"skip"/"reveal" twice for the same
  // video. The client sends the index it was looking at; if the session has already moved on, say so plainly
  // instead of quietly re-running the action against whatever is now current.
  if (typeof expectIndex === "number" && ["next", "skip", "reveal"].includes(action || "") && expectIndex !== s.current_index) {
    throw new HttpError(409, "Someone already moved on — refreshing");
  }
  let r: { error?: string; session?: SessionRow } = {};
  let finalSession: SessionRow = s;
  switch (action) {
    case "begin":
      r = await beginSession(s);
      break;
    case "reveal":
      if (s.state === "playing") finalSession = await doReveal(s);
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
    case "award_next":
      if (typeof expectStep !== "number") throw new HttpError(400, "Missing expectStep");
      r = await advanceAwards(s, expectStep);
      break;
    case "award_skip":
      r = await skipAwards(s);
      break;
    case "kick":
      if (playerId) {
        check(await supabaseAdmin().from("session_players").delete().eq("session_id", s.id).eq("player_id", playerId));
        broadcast(s.id);
      }
      break;
    default:
      throw new HttpError(400, "Unknown action");
  }
  if (r.error) throw new HttpError(400, r.error);
  if (r.session) finalSession = r.session;
  // The caller (the host screen) was about to immediately re-fetch this exact same state with a second
  // request anyway — hand it back directly instead, since every action here already ends with the session in
  // its final, settled shape (buildState reads whatever was just written, no extra delay needed for it to
  // "catch up").
  const state = await buildState(finalSession, { kind: "host", igSession: admin });
  return json({ ok: true, state });
});
