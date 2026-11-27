"use client";
import { useCallback, useEffect, useState } from "react";
import { postJson } from "@/lib/clientFetch";

export type Seat = { playerId: string; token: string };
export type SeatResult = { ok: true } | { ok: false; error: string };

/** Same localStorage key a phone and the host-screen panel both use for a given room code. */
export const seatKey = (code: string) => `otb-seat-${code.toUpperCase()}`;

/** Status codes that genuinely mean "this seat is no longer valid" — a seat should only ever be dropped for
 *  one of these, never for a transient 429 (rate limited) or 5xx (server hiccup), which would otherwise force
 *  a real player to re-pick their name (and hit "someone already joined as that name", since the server still
 *  has their old token) just because of a brief network/server blip. */
const SEAT_INVALID_STATUSES = new Set([403, 404, 409]);
const SEAT_RETRIES = 3;

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
    let st: Seat | null = null;
    try {
      const v = JSON.parse(saved) as Seat;
      if (v && typeof v.playerId === "string" && typeof v.token === "string") st = v;
    } catch {
      /* corrupt value — treated as no seat below */
    }
    if (!st) {
      localStorage.removeItem(seatKey(code));
      setSeat(null);
      setChecked(true);
      return;
    }
    const seatToCheck = st;
    (async () => {
      // A phone that just woke up often has a flaky connection for a second or two. A failed check used to
      // leave the player on the name picker with their own name shown as "(taken)" (the server still holds
      // their seat). Retry a few times, then fall back to the saved seat: if it really is gone, the regular
      // poll reports `viewerValid: false` and sends them back to the picker anyway.
      for (let attempt = 0; attempt < SEAT_RETRIES; attempt++) {
        const r = await postJson<{ token: string }>("/api/session/join", { code, ...seatToCheck });
        if (cancelled) return;
        if (r.ok) break;
        if (r.status !== undefined && SEAT_INVALID_STATUSES.has(r.status)) {
          localStorage.removeItem(seatKey(code));
          setSeat(null);
          setChecked(true);
          return;
        }
        if (attempt < SEAT_RETRIES - 1) await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
        if (cancelled) return;
      }
      setSeat(seatToCheck);
      setChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  const pick = useCallback(
    async (playerId: string): Promise<SeatResult> => {
      if (!code) return { ok: false, error: "No room code" };
      const r = await postJson<{ token: string }>("/api/session/join", { code, playerId });
      if (!r.ok) return { ok: false, error: r.error };
      const st: Seat = { playerId, token: r.data.token };
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
      const r = await postJson("/api/session/answer", { code, playerId: seat.playerId, token: seat.token, rating, guessId });
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true };
    },
    [code, seat]
  );

  return { seat, checked, pick, clear, submitAnswer };
}
