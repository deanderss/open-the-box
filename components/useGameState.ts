"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export type GameState = {
  session: { id: string; code: string; state: "lobby" | "playing" | "reveal" | "finished"; paused: boolean; index: number; total: number; windowSeconds: number; remainingMs: number; serverNow: number };
  group: { id: string; name: string; color: string; emoji: string } | null;
  roster: { id: string; name: string; color: string }[];
  players: { id: string; name: string; color: string; answered: boolean }[];
  answered: number;
  eligible: number;
  video: {
    id: string;
    platform: string;
    embedUrl: string;
    sourceUrl: string;
    aspect?: number;
    blocked?: "restricted" | "gone";
    /** host only, Instagram only: a direct CORS-enabled MP4 link, played natively instead of the embed — see lib/igDirect.ts */
    directUrl?: string;
    avgRating?: number | null;
    ratingCount?: number;
  } | null;
  /** host only: the next video in line, loaded invisibly in the background so it is ready the moment we get there */
  upNext?: { id: string; platform: string; embedUrl: string; sourceUrl: string; aspect?: number; blocked?: "restricted" | "gone"; directUrl?: string } | null;
  reveal: {
    senderId: string | null;
    senderName: string;
    senderColor: string | null;
    guesses: { playerId: string; name: string; color: string; guessedName: string; correct: boolean; rating: number }[];
  } | null;
  /** `correct` right guesses + `bonus` half-points for videos they sent = `points` */
  scores: { playerId: string; name: string; color: string; correct: number; bonus: number; points: number }[];
  finale: {
    topVideo: { id: string; platform: string; embed_url: string; source_url: string; avg_rating: number; rating_count: number; senderName: string } | null;
    allTime: { player_id: string; display_name: string; avatar_color: string; correct: number; guesses: number; submitted: number; points: number }[];
    /** videos still waiting in the box for the next game */
    remaining: number;
  } | null;
  me: { playerId: string; name: string; color: string; answered: boolean; isMine: boolean; correct: boolean | null; score: number } | null;
  viewerValid: boolean;
};

/**
 * Deep-equal, ignoring the two fields that legitimately differ on every single poll (the live countdown
 * snapshot) — so a poll where nothing actually happened doesn't force a full re-render of the page.
 */
function sameExceptTimers(a: GameState | null, b: GameState): boolean {
  if (!a) return false;
  const strip = (x: GameState) => ({ ...x, session: { ...x.session, remainingMs: 0, serverNow: 0 } });
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

/**
 * Polls the state endpoint and refetches instantly on realtime nudges.
 *
 * `widePollMs` (defaults to `pollMs`, i.e. no widening) is the interval used instead of `pollMs` whenever the
 * realtime broadcast channel is confirmed `SUBSCRIBED` — a nudge gets there faster than the next poll would
 * fire anyway, so the regular poll only needs to be a safety net while the channel is actually live. The
 * moment the channel errors, times out, or closes, polling drops straight back to `pollMs` — no game state
 * is ever allowed to depend on realtime alone.
 */
export function useGameState(
  params: { code?: string | null; sessionId?: string | null; playerId?: string | null; token?: string | null },
  pollMs = 2500,
  widePollMs = pollMs
) {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState(Date.now());
  const [reconnecting, setReconnecting] = useState(false);
  const inflight = useRef(false);
  const dirty = useRef(false); // a realtime nudge arrived while a fetch was already in flight
  const misses = useRef(0);
  const lastRaw = useRef<GameState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveState = useRef<GameState["session"]["state"] | undefined>(undefined);
  const channelSubscribed = useRef(false);
  // A poll already in flight when the component unmounts (e.g. "Pause & exit", or a kicked phone navigating
  // away) finishes after the unmount's cleanup has already cleared the timer — its own `.then(schedule)`
  // would otherwise start a brand new timer that nothing is left to clear, so the old loop just keeps polling
  // every tick forever with stale credentials. Checked before every refresh and before every re-schedule.
  const mounted = useRef(true);
  const { code, sessionId, playerId, token } = params;

  const refresh = useCallback(async () => {
    if (!code && !sessionId) return;
    if (inflight.current) {
      dirty.current = true; // coalesce: whoever is already in flight will pick this up when it finishes
      return;
    }
    inflight.current = true;
    try {
      const q = new URLSearchParams();
      if (sessionId) q.set("sessionId", sessionId);
      else if (code) q.set("code", code);
      if (playerId && token) q.set("playerId", playerId);
      // The player token moves to a header instead of the URL, so it never shows up in server access logs
      // or browser history.
      const res = await fetch(`/api/session/state?${q}`, { cache: "no-store", headers: playerId && token ? { "x-otb-token": token } : undefined });
      const data = await res.json();
      if (!res.ok) {
        misses.current++;
        setError(data.error || "Error");
      } else {
        misses.current = 0;
        setReconnecting(false);
        liveState.current = data.session.state;
        if (!sameExceptTimers(lastRaw.current, data)) {
          setState(data);
          setFetchedAt(Date.now());
        }
        lastRaw.current = data;
        setError(null);
      }
    } catch {
      misses.current++;
      /* transient */
    } finally {
      inflight.current = false;
      if (misses.current >= 2 || (typeof navigator !== "undefined" && navigator.onLine === false)) setReconnecting(true);
      if (dirty.current) {
        dirty.current = false;
        refresh();
      }
    }
  }, [code, sessionId, playerId, token]);

  // Self-rescheduling poll instead of a fixed setInterval: a longer gap in the lobby (nothing to watch for
  // yet), none at all once the tab is hidden or the game is finished (a realtime nudge still refetches
  // either way), and the wait always restarts fresh right after a fetch finishes — so a realtime-triggered
  // refresh never leaves an almost-immediate duplicate poll right behind it.
  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!mounted.current) return;
    if (typeof document !== "undefined" && document.hidden) return;
    if (liveState.current === "finished") return;
    const ms = liveState.current === "lobby" ? Math.max(pollMs, 4000) : channelSubscribed.current ? widePollMs : pollMs;
    timer.current = setTimeout(async () => {
      if (!mounted.current) return;
      await refresh();
      schedule();
    }, ms);
  }, [pollMs, widePollMs, refresh]);

  useEffect(() => {
    mounted.current = true;
    refresh().then(schedule);
    const onVisible = () => {
      if (typeof document !== "undefined" && !document.hidden) refresh();
      schedule();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, schedule]);

  // `supabaseBrowser` pulls in the whole `@supabase/ssr` client just to open one realtime broadcast channel —
  // dynamically imported so every page using this hook (every player's phone, the host screen) doesn't pay
  // for that in its *initial* bundle before there's even a session id to subscribe with. Polling is the
  // fallback either way, so a tick or two of delay here before the channel opens costs nothing real.
  const sid = state?.session.id;
  useEffect(() => {
    if (!sid) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    // A burst of nudges (e.g. Skip, which deletes responses *and* advances the video — two broadcasts a few
    // ms apart) only needs to trigger one refetch, not one per message; coalesced the same way `dirty`
    // already coalesces a nudge that arrives mid-fetch. The 0-300ms jitter spreads out the exact moment
    // every connected phone refetches at once right after a broadcast — otherwise every device in the room
    // would hit `/api/session/state` in the same instant.
    let nudgeTimer: ReturnType<typeof setTimeout> | null = null;
    import("@/lib/supabase-browser").then(({ supabaseBrowser }) => {
      if (cancelled) return;
      const sb = supabaseBrowser();
      const ch = sb
        .channel(`session-${sid}`)
        .on("broadcast", { event: "update" }, () => {
          if (nudgeTimer) return; // already about to refetch — this one would just see the same data
          nudgeTimer = setTimeout(() => {
            nudgeTimer = null;
            refresh().then(schedule);
          }, Math.random() * 300);
        })
        .subscribe((status: string) => {
          channelSubscribed.current = status === "SUBSCRIBED";
          // React immediately either way: drop back to fast polling the instant the channel stops being
          // reliable, and only start trusting it (widening the poll) once it's actually confirmed live —
          // never assume realtime is working, the poll is always the fallback that actually ships state.
          schedule();
        });
      cleanup = () => {
        if (nudgeTimer) clearTimeout(nudgeTimer);
        channelSubscribed.current = false;
        sb.removeChannel(ch);
      };
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [sid, refresh, schedule]);

  // Feed in a state snapshot obtained some other way — specifically, the host action route now returns the
  // resulting state directly in its own response, since it just computed exactly that server-side anyway.
  // Applying it here skips the extra `refresh()` round trip that used to run right after every Next/Reveal/
  // Skip tap just to re-fetch the same thing a moment later. Goes through the same "did anything actually
  // change" + reconnecting bookkeeping as a real poll result, so it behaves identically either way.
  const applyState = useCallback((data: GameState) => {
    liveState.current = data.session.state;
    if (!sameExceptTimers(lastRaw.current, data)) {
      setState(data);
      setFetchedAt(Date.now());
    }
    lastRaw.current = data;
    setError(null);
    misses.current = 0;
    setReconnecting(false);
  }, []);

  return { state, error, refresh, fetchedAt, reconnecting, applyState };
}
