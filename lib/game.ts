import { supabaseAdmin } from "./supabase-server";
import { shuffle } from "./util";

export type SessionRow = {
  id: string;
  group_id: string;
  room_code: string;
  state: "lobby" | "playing" | "reveal" | "finished";
  video_order: string[];
  current_index: number;
  video_started_at: string | null;
  reveal_at: string | null;
  created_at: string;
  ended_at: string | null;
  paused_at: string | null;
};

const db = () => supabaseAdmin();

export async function getWindowSeconds() {
  const { data } = await db().from("app_settings").select("answer_window_seconds").eq("id", 1).single();
  return (data?.answer_window_seconds as number) ?? 150;
}

export async function getSessionByCode(code: string, includeRecentlyEnded = false): Promise<SessionRow | null> {
  const { data } = await db()
    .from("sessions")
    .select("*")
    .eq("room_code", code.toUpperCase().trim())
    .is("ended_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data || !includeRecentlyEnded) return (data as SessionRow) ?? null;
  const { data: ended } = await db()
    .from("sessions")
    .select("*")
    .eq("room_code", code.toUpperCase().trim())
    .gte("ended_at", new Date(Date.now() - 3 * 3600 * 1000).toISOString())
    .order("ended_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (ended as SessionRow) ?? null;
}

export async function getSession(id: string): Promise<SessionRow | null> {
  const { data } = await db().from("sessions").select("*").eq("id", id).maybeSingle();
  return (data as SessionRow) ?? null;
}

export function currentVideoId(s: SessionRow) {
  return s.current_index >= 0 ? s.video_order[s.current_index] ?? null : null;
}

/** Fire-and-forget realtime nudge so screens refetch instantly. Payload carries no secrets. */
export async function broadcast(sessionId: string) {
  try {
    await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ messages: [{ topic: `session-${sessionId}`, event: "update", payload: { t: Date.now() } }] }),
    });
  } catch {
    /* polling fallback covers it */
  }
}

async function counts(s: SessionRow) {
  const vid = currentVideoId(s);
  const [{ count: joined }, { count: answered }] = await Promise.all([
    db().from("session_players").select("*", { count: "exact", head: true }).eq("session_id", s.id),
    vid
      ? db().from("responses").select("*", { count: "exact", head: true }).eq("session_id", s.id).eq("video_id", vid)
      : Promise.resolve({ count: 0 }),
  ]);
  return { joined: joined ?? 0, answered: answered ?? 0 };
}

/** Move to reveal (idempotent). Recomputes the video's rating. */
export async function doReveal(s: SessionRow) {
  const { data: updated } = await db()
    .from("sessions")
    .update({ state: "reveal", reveal_at: new Date().toISOString() })
    .eq("id", s.id)
    .eq("state", "playing")
    .eq("current_index", s.current_index)
    .select("*")
    .maybeSingle();
  if (!updated) return (await getSession(s.id))!;
  const vid = currentVideoId(s);
  if (vid) {
    const { data: rs } = await db().from("responses").select("rating").eq("video_id", vid).eq("is_decoy", false);
    const ratings = (rs || []).map((r) => r.rating as number).filter((x) => typeof x === "number");
    const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
    await db().from("videos").update({ avg_rating: avg, rating_count: ratings.length }).eq("id", vid);
  }
  await broadcast(s.id);
  return updated as SessionRow;
}

/** Auto-reveal when everyone answered or the timer ran out (server-authoritative). */
export async function maybeAutoReveal(s: SessionRow, windowSeconds?: number): Promise<SessionRow> {
  if (s.state !== "playing" || !s.video_started_at || s.paused_at) return s;
  const win = windowSeconds ?? (await getWindowSeconds());
  const elapsed = (Date.now() - new Date(s.video_started_at).getTime()) / 1000;
  if (elapsed >= win) return doReveal(s);
  const { joined, answered } = await counts(s);
  if (joined > 0 && answered >= joined) return doReveal(s);
  return s;
}

async function showVideoAt(s: SessionRow, index: number) {
  if (index >= s.video_order.length) {
    const { data } = await db()
      .from("sessions")
      .update({ state: "finished", current_index: s.video_order.length, ended_at: new Date().toISOString() })
      .eq("id", s.id)
      .select("*")
      .single();
    await broadcast(s.id);
    return data as SessionRow;
  }
  const vid = s.video_order[index];
  await db().from("videos").update({ status: "played", played_at: new Date().toISOString() }).eq("id", vid);
  const { data } = await db()
    .from("sessions")
    .update({ state: "playing", current_index: index, video_started_at: new Date().toISOString(), reveal_at: null })
    .eq("id", s.id)
    .select("*")
    .single();
  await broadcast(s.id);
  return data as SessionRow;
}

export async function beginSession(s: SessionRow) {
  if (s.state !== "lobby") return { error: "Session already started" };
  const { data: vids } = await db().from("videos").select("id").eq("group_id", s.group_id).eq("status", "queued");
  if (!vids || vids.length === 0) return { error: "The box is empty — no new videos yet!" };
  const order = shuffle(vids.map((v) => v.id as string));
  const { data: s2 } = await db().from("sessions").update({ video_order: order }).eq("id", s.id).select("*").single();
  return { session: await showVideoAt(s2 as SessionRow, 0) };
}

export async function nextVideo(s: SessionRow) {
  if (s.state === "playing") s = await doReveal(s);
  if (s.state !== "reveal") return { error: "Not ready for next" };
  return { session: await showVideoAt(s, s.current_index + 1) };
}

export async function skipVideo(s: SessionRow) {
  const vid = currentVideoId(s);
  if (!vid || (s.state !== "playing" && s.state !== "reveal")) return { error: "Nothing to skip" };
  await db().from("responses").delete().eq("session_id", s.id).eq("video_id", vid);
  await db().from("videos").update({ status: "skipped", avg_rating: null, rating_count: 0 }).eq("id", vid);
  return { session: await showVideoAt(s, s.current_index + 1) };
}

/** Freeze the game so the moderator can leave and come back later. */
export async function pauseSession(s: SessionRow) {
  if (s.ended_at || s.state === "finished") return { error: "This game has already ended" };
  if (s.paused_at) return { session: s };
  const { data } = await db()
    .from("sessions")
    .update({ paused_at: new Date().toISOString() })
    .eq("id", s.id)
    .is("paused_at", null)
    .select("*")
    .maybeSingle();
  await broadcast(s.id);
  return { session: (data as SessionRow) ?? (await getSession(s.id)) };
}

/** Unfreeze: push the video start time forward so the answer timer continues where it stopped. */
export async function resumeSession(s: SessionRow) {
  if (!s.paused_at) return { session: s };
  const pausedMs = Date.now() - new Date(s.paused_at).getTime();
  const patch: { paused_at: null; video_started_at?: string } = { paused_at: null };
  if (s.state === "playing" && s.video_started_at) {
    patch.video_started_at = new Date(new Date(s.video_started_at).getTime() + pausedMs).toISOString();
  }
  const { data } = await db().from("sessions").update(patch).eq("id", s.id).eq("paused_at", s.paused_at).select("*").maybeSingle();
  await broadcast(s.id);
  return { session: (data as SessionRow) ?? (await getSession(s.id)) };
}

/**
 * "Finished": wrap the game up on the current video. If it's still playing it is revealed first so its
 * ratings and guesses count. Videos that haven't been shown stay `queued` in the box for the next game
 * (only videos that were actually shown are marked played), and the normal finale/scoreboard appears.
 */
export async function finishSession(s: SessionRow) {
  if (s.state === "lobby") return endSession(s);
  if (s.state === "playing") await doReveal(s);
  return endSession(s);
}

export async function endSession(s: SessionRow) {
  const { data } = await db()
    .from("sessions")
    .update({ state: "finished", ended_at: new Date().toISOString() })
    .eq("id", s.id)
    .select("*")
    .single();
  await broadcast(s.id);
  return { session: data as SessionRow };
}

type Viewer = { kind: "host" } | { kind: "player"; playerId: string; deviceToken: string } | { kind: "anon" };

/** Build the public state snapshot. NEVER includes the sender before reveal. */
export async function buildState(sIn: SessionRow, viewer: Viewer) {
  const windowSeconds = await getWindowSeconds();
  const s = await maybeAutoReveal(sIn, windowSeconds);
  const vid = currentVideoId(s);

  const [{ data: group }, { data: roster }, { data: sp }, { data: resps }] = await Promise.all([
    db().from("groups").select("id,name,color,emoji").eq("id", s.group_id).single(),
    db().from("players").select("id,display_name,avatar_color").eq("group_id", s.group_id).eq("active", true).order("display_name"),
    db().from("session_players").select("player_id,device_token,joined_at").eq("session_id", s.id).order("joined_at"),
    db().from("responses").select("player_id,video_id,rating,guessed_player_id,is_correct,is_decoy").eq("session_id", s.id),
  ]);

  const rosterMap = new Map((roster || []).map((p) => [p.id as string, p]));
  const nameOf = (id?: string | null) => (id ? (rosterMap.get(id)?.display_name as string) ?? "Someone" : null);
  const colorOf = (id?: string | null) => (id ? (rosterMap.get(id)?.avatar_color as string) ?? "#999" : null);
  const currentResps = (resps || []).filter((r) => r.video_id === vid);
  const answeredSet = new Set(currentResps.map((r) => r.player_id));

  let me: Record<string, unknown> | null = null;
  let myValid = false;
  if (viewer.kind === "player") {
    const row = (sp || []).find((r) => r.player_id === viewer.playerId);
    myValid = !!row && row.device_token === viewer.deviceToken;
  }

  let video: Record<string, unknown> | null = null;
  let sender: string | null = null;
  if (vid) {
    const { data: v } = await db().from("videos").select("id,platform,embed_url,source_url,submitted_by,avg_rating,rating_count").eq("id", vid).single();
    if (v) {
      video = { id: v.id, platform: v.platform, embedUrl: v.embed_url, sourceUrl: v.source_url };
      sender = v.submitted_by as string | null;
      if (s.state === "reveal") Object.assign(video, { avgRating: v.avg_rating, ratingCount: v.rating_count });
    }
  }

  // Session scoreboard (correct guesses this session, decoys excluded)
  const scoreMap = new Map<string, number>();
  (sp || []).forEach((r) => scoreMap.set(r.player_id as string, 0));
  (resps || []).forEach((r) => {
    if (r.is_correct && !r.is_decoy && !(s.state === "playing" && r.video_id === vid)) {
      scoreMap.set(r.player_id as string, (scoreMap.get(r.player_id as string) || 0) + 1);
    }
  });
  const scores = Array.from(scoreMap.entries())
    .map(([pid, correct]) => ({ playerId: pid, name: nameOf(pid), color: colorOf(pid), correct }))
    .sort((a, b) => b.correct - a.correct);

  let reveal: Record<string, unknown> | null = null;
  if (s.state === "reveal" && vid) {
    reveal = {
      senderId: sender,
      senderName: nameOf(sender) ?? "A mystery guest",
      senderColor: colorOf(sender),
      guesses: currentResps
        .filter((r) => !r.is_decoy)
        .map((r) => ({
          playerId: r.player_id,
          name: nameOf(r.player_id as string),
          color: colorOf(r.player_id as string),
          guessedName: nameOf(r.guessed_player_id as string) ?? "—",
          correct: r.is_correct,
          rating: r.rating,
        })),
    };
  }

  if (viewer.kind === "player" && myValid) {
    const mine = currentResps.find((r) => r.player_id === viewer.playerId);
    me = {
      playerId: viewer.playerId,
      name: nameOf(viewer.playerId),
      color: colorOf(viewer.playerId),
      answered: !!mine,
      isMine: !!vid && sender === viewer.playerId,
      correct: s.state === "reveal" && mine ? !!mine.is_correct && !mine.is_decoy : null,
      score: scoreMap.get(viewer.playerId) || 0,
    };
  }

  let finale: Record<string, unknown> | null = null;
  if (s.state === "finished") {
    const shown = s.video_order.slice(0, Math.max(0, s.current_index + 1));
    let topVideo = null;
    if (shown.length) {
      const { data: tv } = await db()
        .from("videos")
        .select("id,platform,embed_url,source_url,avg_rating,rating_count,submitted_by")
        .in("id", shown)
        .eq("status", "played")
        .not("avg_rating", "is", null)
        .order("avg_rating", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (tv) topVideo = { ...tv, senderName: nameOf(tv.submitted_by as string) };
    }
    const { data: allTime } = await db()
      .from("group_leaderboard")
      .select("player_id,display_name,avatar_color,correct,guesses")
      .eq("group_id", s.group_id)
      .order("correct", { ascending: false })
      .limit(5);
    const { count: remaining } = await db()
      .from("videos")
      .select("*", { count: "exact", head: true })
      .eq("group_id", s.group_id)
      .eq("status", "queued");
    finale = { topVideo, allTime: allTime || [], remaining: remaining ?? 0 };
  }

  const startedMs = s.video_started_at ? new Date(s.video_started_at).getTime() : null;
  const clockNow = s.paused_at ? new Date(s.paused_at).getTime() : Date.now(); // timer is frozen while paused
  const remainingMs = s.state === "playing" && startedMs ? Math.max(0, startedMs + windowSeconds * 1000 - clockNow) : 0;

  return {
    session: {
      id: s.id,
      code: s.room_code,
      state: s.state,
      paused: !!s.paused_at && s.state !== "finished",
      index: s.current_index,
      total: s.video_order.length,
      windowSeconds,
      remainingMs,
      serverNow: Date.now(),
    },
    group: group ? { id: group.id, name: group.name, color: group.color, emoji: group.emoji } : null,
    roster: (roster || []).map((p) => ({ id: p.id, name: p.display_name, color: p.avatar_color })),
    players: (sp || []).map((r) => ({
      id: r.player_id,
      name: nameOf(r.player_id as string),
      color: colorOf(r.player_id as string),
      answered: answeredSet.has(r.player_id),
    })),
    answered: currentResps.length,
    eligible: (sp || []).length,
    video: s.state === "playing" || s.state === "reveal" ? video : null,
    reveal,
    scores,
    finale,
    me,
    viewerValid: viewer.kind !== "player" || myValid,
  };
}
