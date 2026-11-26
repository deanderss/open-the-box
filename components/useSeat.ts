"use client";
import { useCallback, useEffect, useState } from "react";

export type Seat = { playerId: string; token: string };
export type SeatResult = { ok: true } | { ok: false; error: string };

/** Same localStorage key a phone and the host-screen panel both use for a given room code. */
export const seatKey = (code: string) => `otb-seat-${code.toUpperCase()}`;

/**
 * Shared seat lifecycle for anyone joining a room as a player — a phone on /join, or the moderator playing
 * along from the host screen. Restores and verifies a saved seat for this room code on mount/code change,
 * and exposes `pick` (claim a name), `clear` (drop the seat) and `submitAnswer` (lock in a rating + guess).
 *
 * Each caller decides what "kicked" means for its own UI (a phone watches `viewerValid` from its own poll;
 * the host panel watches whether its player id is still in `state.players`) and calls `clear()` itself when
 * that happens — this hook only owns the seat value, not polling or game state.
 */
export function useSeat(code: string | null) {
  const [seat, setSeat] = useState<Seat | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!code) {
      setSeat(null);
      setChecked(false);
      return;
    }
    let cancelled = false;
    setChecked(false);
    const saved = localStorage.getItem(seatKey(code));
    if (!saved) {
      setSeat(null);
      setChecked(true);
      return;
    }
    (async () => {
      try {
        const st = JSON.parse(saved) as Seat;
        const res = await fetch("/api/session/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, ...st }) });
        if (cancelled) return;
        if (res.ok) setSeat(st);
        else {
          localStorage.removeItem(seatKey(code));
          setSeat(null);
        }
      } catch {
        /* transient network hiccup; leave the seat alone and try again next mount */
      } finally {
        if (!cancelled) setChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  const pick = useCallback(
    async (playerId: string): Promise<SeatResult> => {
      if (!code) return { ok: false, error: "No room code" };
      const res = await fetch("/api/session/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, playerId }) });
      const d = await res.json();
      if (!res.ok) return { ok: false, error: d.error };
      const st: Seat = { playerId, token: d.token as string };
      localStorage.setItem(seatKey(code), JSON.stringify(st));
      setSeat(st);
      return { ok: true };
    },
    [code]
  );

  const clear = useCallback(() => {
    if (code) localStorage.removeItem(seatKey(code));
    setSeat(null);
  }, [code]);

  const submitAnswer = useCallback(
    async (rating: number | null, guessId: string | null): Promise<SeatResult> => {
      if (!code || !seat) return { ok: false, error: "Not seated" };
      const res = await fetch("/api/session/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, playerId: seat.playerId, token: seat.token, rating, guessId }),
      });
      const d = await res.json();
      if (!res.ok) return { ok: false, error: d.error };
      return { ok: true };
    },
    [code, seat]
  );

  return { seat, checked, pick, clear, submitAnswer };
}
