"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

export type GameState = {
  session: { id: string; code: string; state: "lobby" | "playing" | "reveal" | "finished"; paused: boolean; index: number; total: number; windowSeconds: number; remainingMs: number; serverNow: number };
  group: { id: string; name: string; color: string; emoji: string } | null;
  roster: { id: string; name: string; color: string }[];
  players: { id: string; name: string; color: string; answered: boolean }[];
  answered: number;
  eligible: number;
  video: { id: string; platform: string; embedUrl: string; sourceUrl: string; aspect?: number; blocked?: "restricted" | "gone"; avgRating?: number | null; ratingCount?: number } | null;
  /** host only: the next video in line, loaded invisibly in the background so it is ready the moment we get there */
  upNext?: { id: string; platform: string; embedUrl: string; sourceUrl: string; aspect?: number; blocked?: "restricted" | "gone" } | null;
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

/** Polls the state endpoint and refetches instantly on realtime nudges. */
export function useGameState(params: { code?: string | null; sessionId?: string | null; playerId?: string | null; token?: string | null }, pollMs = 2500) {
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
    if (typeof document !== "undefined" && document.hidden) return;
    if (liveState.current === "finished") return;
    const ms = liveState.current === "lobby" ? Math.max(pollMs, 4000) : pollMs;
    timer.current = setTimeout(async () => {
      await refresh();
      schedule();
    }, ms);
  }, [pollMs, refresh]);

  useEffect(() => {
    refresh().then(schedule);
    const onVisible = () => {
      if (typeof document !== "undefined" && !document.hidden) refresh();
      schedule();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, schedule]);

  const sid = state?.session.id;
  useEffect(() => {
    if (!sid) return;
    const sb = supabaseBrowser();
    const ch = sb
      .channel(`session-${sid}`)
      .on("broadcast", { event: "update" }, () => refresh().then(schedule))
      .subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [sid, refresh, schedule]);

  return { state, error, refresh, fetchedAt, reconnecting };
}
