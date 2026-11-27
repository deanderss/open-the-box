import { supabaseAdmin } from "@/lib/supabase-server";
import { handle, body, HttpError } from "@/lib/api";
import { json } from "@/lib/util";
import { getSessionByCode, getSession, currentVideoId, maybeAutoReveal, broadcast, getWindowSeconds } from "@/lib/game";

export const POST = handle(async (req) => {
  const { code, playerId, token, rating, guessId } = await body<{ code?: string; playerId?: string; token?: string; rating?: number; guessId?: string }>(req);
  const s = code ? await getSessionByCode(code) : null;
  if (!s) throw new HttpError(404, "Game not found");
  if (s.paused_at) throw new HttpError(409, "The game is paused. Hang tight!");
  const db = supabaseAdmin();
  const win = await getWindowSeconds();
  // Seat verification doesn't depend on (and isn't depended on by) the server-authoritative timer check —
  // run them together instead of paying for both round trips back to back.
  const [{ data: sp }, fresh, guessed] = await Promise.all([
    db.from("session_players").select("device_token").eq("session_id", s.id).eq("player_id", playerId || "").maybeSingle(),
    maybeAutoReveal(s, win),
    // The guess has to be someone on this box's roster.
    guessId ? db.from("players").select("id").eq("id", guessId).eq("group_id", s.group_id).maybeSingle() : null,
  ]);
  if (!sp || sp.device_token !== token) throw new HttpError(403, "Please re-join the game");
  if (fresh.state !== "playing") throw new HttpError(409, "Time's up for this one!");
  const vid = currentVideoId(fresh);
  if (!vid) throw new HttpError(409, "No video playing");
  const { data: v } = await db.from("videos").select("submitted_by").eq("id", vid).single();
  const isDecoy = v?.submitted_by === playerId;
  const r = Number(rating);
  if (!isDecoy && (!Number.isInteger(r) || r < 1 || r > 10)) throw new HttpError(400, "Rating must be 1–10");
  if (!isDecoy && !guessId) throw new HttpError(400, "Make a guess!");
  if (!isDecoy && !guessed?.data) throw new HttpError(400, "Pick someone from the list");
  const { error } = await db.from("responses").insert({
    session_id: s.id,
    video_id: vid,
    player_id: playerId,
    rating: isDecoy ? null : r,
    guessed_player_id: isDecoy ? null : guessId,
    is_correct: !isDecoy && guessId === v?.submitted_by,
    is_decoy: isDecoy,
  });
  if (error && error.code !== "23505") {
    console.error("save answer failed", error);
    throw new HttpError(500, "Couldn't save your answer. Try again!");
  }

  // The moderator can skip/advance the video in the moment between our check above and the insert landing.
  // If the game has moved on to a different video entirely, this answer arrived too late to belong to
  // anything on screen: pull it back out and say so plainly, instead of a false "ok". (Moving from "playing"
  // to "reveal" on the *same* video is fine either way — including when this very answer is the one that
  // completed the round — so only the index is checked here, not the state.)
  const current = await getSession(s.id);
  if (!current || current.current_index !== fresh.current_index) {
    await db.from("responses").delete().eq("session_id", s.id).eq("video_id", vid).eq("player_id", playerId || "");
    throw new HttpError(409, "Time's up for this one!");
  }
  // One realtime nudge either way: if this answer completed the round, maybeAutoReveal already broadcast
  // when it revealed; otherwise send our own nudge so everyone's "X/Y locked in" updates instantly.
  const after = await maybeAutoReveal(current, win);
  if (after.state === current.state) await broadcast(s.id);
  return json({ ok: true });
});
