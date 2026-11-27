import { supabaseAdmin } from "./supabase-server";
import { shuffle } from "./util";
import { checkMedia, type Media } from "./playable";
import { resolveInstagramVideo, hasSessionId } from "./igDirect";
import { purgeUpload } from "./uploads";
import { SENDER_BONUS } from "./points";
import { HttpError } from "./api";
import { background } from "./background";

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

// The answer window rarely changes mid-game, but buildState reads it on every single poll (every host and
// phone, every 2s). Caching it per server instance for a minute avoids paying for that round trip every time.
// 300s matches the actual default in app_settings (supabase/migrations/20250101000300_pause_and_limits.sql) —
// this fallback only matters when the read below fails, and a wrong value that's too SHORT would auto-reveal
// a video (and lock out any late answers) well before the timer on screen says time's up.
const DEFAULT_WINDOW_SECONDS = 300;
let windowCache: { v: number; until: number } | null = null;
export async function getWindowSeconds() {
  const now = Date.now();
  if (windowCache && windowCache.until > now) return windowCache.v;
  const { data, error } = await db().from("app_settings").select("answer_window_seconds").eq("id", 1).single();
  if (error || data == null) return DEFAULT_WINDOW_SECONDS; // don't cache a failure — retry on the very next poll
  const v = (data.answer_window_seconds as number) ?? DEFAULT_WINDOW_SECONDS;
  windowCache = { v, until: now + 60_000 };
  return v;
}

const DB_DOWN = "The game service is having trouble — try again in a moment";

export async function getSessionByCode(code: string, includeRecentlyEnded = false): Promise<SessionRow | null> {
  const { data, error } = await db()
    .from("sessions")
    .select("*")
    .eq("room_code", code.toUpperCase().trim())
    .is("ended_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new HttpError(503, DB_DOWN); // a real DB/network failure, not just "no rows"
  if (data || !includeRecentlyEnded) return (data as SessionRow) ?? null;
  const { data: ended, error: error2 } = await db()
    .from("sessions")
    .select("*")
    .eq("room_code", code.toUpperCase().trim())
    .gte("ended_at", new Date(Date.now() - 3 * 3600 * 1000).toISOString())
    .order("ended_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error2) throw new HttpError(503, DB_DOWN);
  return (ended as SessionRow) ?? null;
}

export async function getSession(id: string): Promise<SessionRow | null> {
  const { data, error } = await db().from("sessions").select("*").eq("id", id).maybeSingle();
  if (error) throw new HttpError(503, DB_DOWN);
  return (data as SessionRow) ?? null;
}

export function currentVideoId(s: SessionRow) {
  return s.current_index >= 0 ? s.video_order[s.current_index] ?? null : null;
}

/**
 * Fire-and-forget realtime nudge so screens refetch instantly. Payload carries no secrets. Never worth any
 * caller actually waiting on — polling is the fallback either way — so the HTTP call itself is handed to
 * `background()` instead of being awaited; every existing `await broadcast(...)` call site still works
 * unchanged (awaiting a non-promise just resolves immediately), it just no longer adds this call's latency
 * (up to 1.5s on a slow connection) to the action that triggered it.
 */
export function broadcast(sessionId: string) {
  background(async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    try {
      await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/realtime/v1/api/broadcast`, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ messages: [{ topic: `session-${sessionId}`, event: "update", payload: { t: Date.now() } }] }),
      });
    } finally {
      clearTimeout(t);
    }
  });
}

async function counts(s: SessionRow) {
  const vid = currentVideoId(s);
  // A kicked player's old answer row is never deleted, just orphaned from session_players — so "answered"
  // only counts responses from players still actually in the room, otherwise a kick could leave the round
  // stuck one answer short of ever auto-revealing (or, worse, reveal on a count that includes someone gone).
  const { data: sp } = await db().from("session_players").select("player_id").eq("session_id", s.id);
  const joinedIds = (sp || []).map((r) => r.player_id as string);
  const joined = joinedIds.length;
  let answered = 0;
  if (vid && joined > 0) {
    const { count } = await db()
      .from("responses")
      .select("*", { count: "exact", head: true })
      .eq("session_id", s.id)
      .eq("video_id", vid)
      .in("player_id", joinedIds);
    answered = count ?? 0;
  }
  return { joined, answered };
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

/**
 * Show the video at `index`. Videos are NEVER skipped automatically: one that can't play inside the game (an
 * Instagram reel with embedding off, a removed video, ...) is still shown, and the host screen replaces the black
 * frame with an "open it in the app" panel (see `video.blocked` in buildState).
 */
async function showVideoAt(s: SessionRow, index: number) {
  // Guarded on the exact index (and that the game hasn't ended) we expect to be moving on FROM: a double
  // "next"/"skip" tap, or two moderators pressing it at once, means two requests both compute `index` from
  // the same stale `s` — only the first one's write can match, so the second becomes a harmless no-op that
  // just reports back whatever the first one already did, instead of skipping an extra video.
  if (index >= s.video_order.length) {
    const { data } = await db()
      .from("sessions")
      .update({ state: "finished", current_index: s.video_order.length, ended_at: new Date().toISOString() })
      .eq("id", s.id)
      .eq("current_index", s.current_index)
      .is("ended_at", null)
      .select("*")
      .maybeSingle();
    if (!data) return (await getSession(s.id))!;
    await broadcast(s.id);
    return data as SessionRow;
  }
  const vid = s.video_order[index];
  const { data } = await db()
    .from("sessions")
    .update({ state: "playing", current_index: index, video_started_at: new Date().toISOString(), reveal_at: null })
    .eq("id", s.id)
    .eq("current_index", s.current_index)
    .is("ended_at", null)
    .select("*")
    .maybeSingle();
  if (!data) return (await getSession(s.id))!; // someone else already moved on; report the current truth
  // Only mark the video played once we know the session actually advanced — otherwise a failed/raced
  // update could leave a video flagged "played" without ever having been shown.
  await db().from("videos").update({ status: "played", played_at: new Date().toISOString() }).eq("id", vid);
  await broadcast(s.id);
  return data as SessionRow;
}

export async function beginSession(s: SessionRow) {
  if (s.state !== "lobby") return { error: "Session already started" };
  const { data: vids } = await db().from("videos").select("id").eq("group_id", s.group_id).eq("status", "queued");
  if (!vids || vids.length === 0) return { error: "The box is empty — no new videos yet!" };
  const order = shuffle(vids.map((v) => v.id as string));
  // Guarded on still being in the lobby, so a double "Start the show" tap can't re-shuffle the order twice.
  const { data: s2 } = await db().from("sessions").update({ video_order: order }).eq("id", s.id).eq("state", "lobby").select("*").maybeSingle();
  if (!s2) return { error: "Already started" };
  return { session: await showVideoAt(s2 as SessionRow, 0) };
}

export async function nextVideo(s: SessionRow) {
  if (s.state === "playing") s = await doReveal(s);
  if (s.state !== "reveal") return { error: "Not ready for next" };
  const justFinishedId = currentVideoId(s);
  // Show the next video FIRST — the moderator (and everyone else) is waiting on this write to see anything
  // happen at all. Deleting the just-finished video's uploaded file is real work (a storage API call) that
  // nobody needs to wait on; it happens just as reliably after the response is already on its way back.
  const session = await showVideoAt(s, s.current_index + 1);
  background(() => purgeUpload(justFinishedId));
  return { session };
}

export async function skipVideo(s: SessionRow) {
  const vid = currentVideoId(s);
  if (!vid || (s.state !== "playing" && s.state !== "reveal")) return { error: "Nothing to skip" };
  await db().from("responses").delete().eq("session_id", s.id).eq("video_id", vid);
  await db().from("videos").update({ status: "skipped", avg_rating: null, rating_count: 0 }).eq("id", vid);
  const session = await showVideoAt(s, s.current_index + 1);
  background(() => purgeUpload(vid)); // a skipped personal video is never shown again, so its file goes too
  return { session };
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
  if (s.state === "playing") s = await doReveal(s);
  const lastId = currentVideoId(s);
  const result = await endSession(s);
  background(() => purgeUpload(lastId)); // the last video has been played and rated
  return result;
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

type VideoRow = {
  id: string;
  platform: string;
  embed_url: string;
  source_url: string;
  submitted_by: string | null;
  avg_rating: number | null;
  rating_count: number | null;
  status: string;
  playability?: string | null;
  aspect?: number | null;
  direct_url?: string | null;
  direct_url_expires?: string | null;
};

/**
 * Host-only per-video extras: the restricted/gone flag, the clip's shape for the fullscreen crop, and (for
 * Instagram) a direct MP4 link for native playback (see lib/igDirect.ts). Uses whatever is already saved on
 * the row when it's still valid; only reaches out to the platform live when it isn't, writing the result back
 * so every poll after this one — for as long as it stays valid — skips the network call entirely.
 *
 * `blocked` and `directUrl` are not mutually exclusive: a reel resolved only via the spare account's session
 * is still "restricted" by Instagram's own rules, so both are sent together — the host plays it natively, but
 * if the spare account's session ever stops working (banned, rotated out, expired) and the native video fails
 * or can no longer be refreshed, EmbedPlayer falls back to the "open it in the app" panel instead of a dead
 * iframe. Only a reel confirmed *anonymously* playable (truly embeddable, no spare account involved) is ever
 * marked "ok" and left unblocked for good.
 */
async function mediaInfo(v: VideoRow): Promise<{ aspect?: number; blocked?: "restricted" | "gone"; directUrl?: string }> {
  const out: { aspect?: number; blocked?: "restricted" | "gone"; directUrl?: string } = {};
  if (v.aspect) out.aspect = v.aspect;

  // Instagram: a direct, CORS-enabled link means native <video> playback instead of the cross-origin embed —
  // strictly better whenever it's available. The link is signed and expires after roughly a day, so it's
  // cached on the row and re-resolved only once that runs out.
  let knownOk = false; // true only once genuinely confirmed embeddable (the anonymous path), not just "has a link right now"
  if (v.platform === "instagram") {
    const expires = v.direct_url_expires ? new Date(v.direct_url_expires).getTime() : 0;
    const knownDeadEnd = (v.playability === "restricted" || v.playability === "gone") && !hasSessionId();
    if (v.direct_url && expires > Date.now()) {
      out.directUrl = v.direct_url;
      // A cached link doesn't tell us which path it came from; fall through and trust the saved playability.
    } else if (knownDeadEnd) {
      // Already confirmed restricted/gone on a previous poll, and there's no spare-account session configured
      // to try instead — asking Instagram again can only ever fail the exact same way it did last time, so
      // don't: this is the single biggest source of per-poll latency and outbound Instagram traffic once a box
      // has a few restricted reels in it (every poll, for both the current video and the one warming up next).
    } else {
      const direct = await resolveInstagramVideo(v.embed_url, v.source_url).catch(() => null);
      if (direct) {
        out.directUrl = direct.url;
        knownOk = direct.source === "anonymous";
        background(async () => {
          await db()
            .from("videos")
            .update({
              direct_url: direct.url,
              direct_url_expires: new Date(direct.expiresAt).toISOString(),
              ...(knownOk ? { playability: "ok" } : {}),
            })
            .eq("id", v.id);
        });
      }
      // No direct link at all (restricted with no working spare-account session, or genuinely gone): fall
      // through to the saved/live playability check below, same as every other platform.
    }
  }

  if (knownOk) return out; // anonymously confirmed embeddable this poll — no need to also check playability

  if (v.playability) {
    if (v.playability === "restricted" || v.playability === "gone") out.blocked = v.playability;
    return out;
  }
  const m: Media | null = await checkMedia({ platform: v.platform, embedUrl: v.embed_url, sourceUrl: v.source_url }).catch(() => null);
  if (m) {
    background(async () => {
      await db().from("videos").update({ playability: m.playability, aspect: m.aspect ?? null }).eq("id", v.id);
    });
  }
  if (m?.aspect && !out.aspect) out.aspect = m.aspect;
  if (m?.playability === "restricted" || m?.playability === "gone") out.blocked = m.playability;
  return out;
}

const finaleCache = new Map<string, { v: Record<string, unknown>; until: number }>();

/** Build the public state snapshot. NEVER includes the sender before reveal. */
export async function buildState(sIn: SessionRow, viewer: Viewer) {
  const windowSeconds = await getWindowSeconds();
  const vid = currentVideoId(sIn); // stable: auto-reveal below only ever flips playing -> reveal, never the index
  const nextIdx = sIn.current_index + 1;
  const needsNext = viewer.kind === "host" && (sIn.state === "playing" || sIn.state === "reveal") && nextIdx < sIn.video_order.length;
  // Every video shown so far (for the sender bonus) plus the next one in line (host only, to preload it).
  // Skipped once the game is finished: `current_index` there points at the last video played, but the
  // response nulls `video`/`upNext` out anyway, so there is nothing to look up a live playability check for.
  const relevantIds = Array.from(new Set([...sIn.video_order.slice(0, Math.max(0, sIn.current_index + 1)), ...(needsNext ? [sIn.video_order[nextIdx]] : [])]));

  const [groupRes, rosterRes, spRes, respRes, vidsRes] = await Promise.all([
    db().from("groups").select("id,name,color,emoji").eq("id", sIn.group_id).single(),
    db().from("players").select("id,display_name,avatar_color").eq("group_id", sIn.group_id).eq("active", true).order("display_name"),
    db().from("session_players").select("player_id,device_token,joined_at").eq("session_id", sIn.id).order("joined_at"),
    db().from("responses").select("player_id,video_id,rating,guessed_player_id,is_correct,is_decoy").eq("session_id", sIn.id),
    relevantIds.length
      ? db()
          .from("videos")
          .select("id,platform,embed_url,source_url,submitted_by,avg_rating,rating_count,status,playability,aspect,direct_url,direct_url_expires")
          .in("id", relevantIds)
      : Promise.resolve({ data: [] as VideoRow[], error: null }),
  ]);
  if (groupRes.error || rosterRes.error || spRes.error || respRes.error || vidsRes.error) throw new HttpError(503, DB_DOWN);
  const group = groupRes.data;
  const roster = rosterRes.data;
  const sp = spRes.data;
  const resps = respRes.data;
  const vidsMap = new Map(((vidsRes.data as VideoRow[]) || []).map((v) => [v.id, v]));

  const joinedIds = new Set((sp || []).map((r) => r.player_id as string));

  // Decide auto-reveal from the data already fetched above, instead of the separate count queries that
  // maybeAutoReveal() runs when called on its own (from the answer route). Only the reveal write itself —
  // when it actually happens — still touches the database.
  let s = sIn;
  if (sIn.state === "playing" && sIn.video_started_at && !sIn.paused_at) {
    const elapsed = (Date.now() - new Date(sIn.video_started_at).getTime()) / 1000;
    const answeredNow = (resps || []).filter((r) => r.video_id === vid && joinedIds.has(r.player_id as string)).length;
    if (elapsed >= windowSeconds || (joinedIds.size > 0 && answeredNow >= joinedIds.size)) s = await doReveal(sIn);
  }

  const rosterMap = new Map((roster || []).map((p) => [p.id as string, p]));
  const nameOf = (id?: string | null) => (id ? (rosterMap.get(id)?.display_name as string) ?? "Someone" : null);
  const colorOf = (id?: string | null) => (id ? (rosterMap.get(id)?.avatar_color as string) ?? "#999" : null);
  const currentResps = (resps || []).filter((r) => r.video_id === vid);
  // A kicked player's old answer sticks around in `responses`, but they're no longer in `sp` — don't count
  // them as "locked in" (that number is shown to everyone still playing).
  const answeredSet = new Set(currentResps.filter((r) => joinedIds.has(r.player_id as string)).map((r) => r.player_id));

  let me: Record<string, unknown> | null = null;
  let myValid = false;
  if (viewer.kind === "player") {
    const row = (sp || []).find((r) => r.player_id === viewer.playerId);
    myValid = !!row && row.device_token === viewer.deviceToken;
  }

  let video: Record<string, unknown> | null = null;
  let sender: string | null = null;
  const v = vid ? vidsMap.get(vid) : undefined;
  if (v) {
    video = { id: v.id, platform: v.platform, embedUrl: v.embed_url, sourceUrl: v.source_url };
    sender = v.submitted_by;
    if (s.state === "reveal") Object.assign(video, { avgRating: v.avg_rating, ratingCount: v.rating_count });
  }

  // Host only: the next video in line, so the stage can load it in the background while this one plays.
  let upNext: Record<string, unknown> | null = null;
  const nv = needsNext ? vidsMap.get(sIn.video_order[nextIdx]) : undefined;
  if (nv && (s.state === "playing" || s.state === "reveal")) {
    upNext = { id: nv.id, platform: nv.platform, embedUrl: nv.embed_url, sourceUrl: nv.source_url };
  }

  // The two live-platform fallback checks (when a video predates the saved playability column) run together
  // rather than one after the other.
  if (viewer.kind === "host" && (s.state === "playing" || s.state === "reveal")) {
    const [infoV, infoN] = await Promise.all([v ? mediaInfo(v) : Promise.resolve(null), nv ? mediaInfo(nv) : Promise.resolve(null)]);
    if (video && infoV) {
      if (infoV.aspect) video.aspect = infoV.aspect;
      if (infoV.blocked) video.blocked = infoV.blocked;
      if (infoV.directUrl) video.directUrl = infoV.directUrl;
    }
    if (upNext && infoN) {
      if (infoN.aspect) upNext.aspect = infoN.aspect;
      if (infoN.blocked) upNext.blocked = infoN.blocked;
      if (infoN.directUrl) upNext.directUrl = infoN.directUrl;
    }
  }

  // Session scoreboard: correct guesses (decoys excluded) plus half a point to whoever sent each video that has
  // been revealed, so the person who filled the box still has a shot at winning.
  const scoreMap = new Map<string, number>();
  (sp || []).forEach((r) => scoreMap.set(r.player_id as string, 0));
  (resps || []).forEach((r) => {
    if (r.is_correct && !r.is_decoy && !(s.state === "playing" && r.video_id === vid)) {
      scoreMap.set(r.player_id as string, (scoreMap.get(r.player_id as string) || 0) + 1);
    }
  });
  const bonusMap = new Map<string, number>();
  if (s.state !== "lobby" && s.current_index >= 0) {
    const revealedUpTo = s.state === "playing" ? s.current_index : s.current_index + 1; // exclusive
    s.video_order.slice(0, revealedUpTo).forEach((id) => {
      const rv = vidsMap.get(id);
      const by = rv?.submitted_by ?? null;
      if (rv?.status === "played" && by && scoreMap.has(by)) bonusMap.set(by, (bonusMap.get(by) || 0) + SENDER_BONUS);
    });
  }
  const pointsOf = (pid: string) => (scoreMap.get(pid) || 0) + (bonusMap.get(pid) || 0);
  const scores = Array.from(scoreMap.entries())
    .map(([pid, correct]) => ({ playerId: pid, name: nameOf(pid), color: colorOf(pid), correct, bonus: bonusMap.get(pid) || 0, points: pointsOf(pid) }))
    .sort((a, b) => b.points - a.points || b.correct - a.correct);

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
      score: pointsOf(viewer.playerId),
    };
  }

  // The finale screen's figures almost never change once the game is over, but it stays polled at the same
  // interval as everything else — cache it per instance for a minute instead of re-querying every poll.
  let finale: Record<string, unknown> | null = null;
  if (s.state === "finished") {
    const cached = finaleCache.get(s.id);
    if (cached && cached.until > Date.now()) {
      finale = cached.v;
    } else {
      const shown = s.video_order.slice(0, Math.max(0, s.current_index + 1));
      let topVideo = null;
      if (shown.length) {
        const { data: tv } = await db()
          .from("videos")
          .select("id,platform,embed_url,source_url,avg_rating,rating_count,submitted_by")
          .in("id", shown)
          .eq("status", "played")
          .neq("platform", "upload") // personal videos are deleted after they play
          .not("avg_rating", "is", null)
          .order("avg_rating", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (tv) topVideo = { ...tv, senderName: nameOf(tv.submitted_by as string) };
      }
      const { data: allTime } = await db()
        .from("group_leaderboard")
        .select("player_id,display_name,avatar_color,correct,guesses,submitted,points")
        .eq("group_id", s.group_id)
        .order("points", { ascending: false })
        .order("correct", { ascending: false })
        .limit(5);
      const { count: remaining } = await db()
        .from("videos")
        .select("*", { count: "exact", head: true })
        .eq("group_id", s.group_id)
        .eq("status", "queued");
      finale = { topVideo, allTime: allTime || [], remaining: remaining ?? 0 };
      finaleCache.set(s.id, { v: finale, until: Date.now() + 60_000 });
    }
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
    answered: answeredSet.size,
    eligible: (sp || []).length,
    video: s.state === "playing" || s.state === "reveal" ? video : null,
    upNext,
    reveal,
    scores,
    finale,
    me,
    viewerValid: viewer.kind !== "player" || myValid,
  };
}
