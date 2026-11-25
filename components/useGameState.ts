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
  video: { id: string; platform: string; embedUrl: string; sourceUrl: string; avgRating?: number | null; ratingCount?: number } | null;
  reveal: {
    senderId: string | null;
    senderName: string;
    senderColor: string | null;
    guesses: { playerId: string; name: string; color: string; guessedName: string; correct: boolean; rating: number }[];
  } | null;
  scores: { playerId: string; name: string; color: string; correct: number }[];
  finale: {
    topVideo: { id: string; platform: string; embed_url: string; source_url: string; avg_rating: number; rating_count: number; senderName: string } | null;
    allTime: { player_id: string; display_name: string; avatar_color: string; correct: number; guesses: number }[];
    /** videos still waiting in the box for the next game */
    remaining: number;
  } | null;
  me: { playerId: string; name: string; color: string; answered: boolean; isMine: boolean; correct: boolean | null; score: number } | null;
  viewerValid: boolean;
};

/** Polls the state endpoint and refetches instantly on realtime nudges. */
export function useGameState(params: { code?: string | null; sessionId?: string | null; playerId?: string | null; token?: string | null }, pollMs = 2500) {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState(Date.now());
  const inflight = useRef(false);
  const { code, sessionId, playerId, token } = params;

  const refresh = useCallback(async () => {
    if (!code && !sessionId) return;
    if (inflight.current) return;
    inflight.current = true;
    try {
      const q = new URLSearchParams();
      if (sessionId) q.set("sessionId", sessionId);
      else if (code) q.set("code", code);
      if (playerId && token) {
        q.set("playerId", playerId);
        q.set("token", token);
      }
      const res = await fetch(`/api/session/state?${q}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Error");
      else {
        setState(data);
        setFetchedAt(Date.now());
        setError(null);
      }
    } catch {
      /* transient */
    } finally {
      inflight.current = false;
    }
  }, [code, sessionId, playerId, token]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);

  const sid = state?.session.id;
  useEffect(() => {
    if (!sid) return;
    const sb = supabaseBrowser();
    const ch = sb.channel(`session-${sid}`).on("broadcast", { event: "update" }, () => refresh()).subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [sid, refresh]);

  return { state, error, refresh, fetchedAt };
}

/** Live countdown derived from the last server snapshot. */
export function useCountdown(remainingMs: number | undefined, fetchedAt: number, active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [active]);
  if (!active || remainingMs == null) return 0;
  return Math.max(0, remainingMs - (now - fetchedAt));
}
