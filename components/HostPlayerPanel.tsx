"use client";
import { useEffect, useState } from "react";
import Avatar from "./Avatar";
import type { GameState } from "./useGameState";

type Seat = { playerId: string; token: string };
/** Same localStorage key a phone uses for this room code, so the moderator's seat is just a normal player seat. */
const seatKey = (code: string) => `otb-seat-${code.toUpperCase()}`;

/**
 * Lets the moderator join as a player and play along from the host screen itself — pick a name in the lobby, then
 * rate and guess like anyone else. The screen is shared, so picking a rating or a name must look exactly the same
 * whether or not anything is selected; only the Lock in button's enabled state shows that choices have been made.
 *
 * Hidden whenever the video is full screen (the caller only renders this when `!fullscreen`).
 */
export default function HostPlayerPanel({ state }: { state: GameState }) {
  const code = state.session.code;
  const [seat, setSeat] = useState<Seat | null>(null);
  const [checked, setChecked] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [guess, setGuess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);

  // Load and verify any saved seat for this room code (same check a phone does on load).
  useEffect(() => {
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
        const res = await fetch("/api/session/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, ...st }),
        });
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

  // If the moderator's seat gets freed up server-side (e.g. kicked from the lobby), drop it here too.
  useEffect(() => {
    if (!seat || !checked) return;
    if (!state.players.some((p) => p.id === seat.playerId)) {
      localStorage.removeItem(seatKey(code));
      setSeat(null);
    }
  }, [state.players, seat, checked, code]);

  // Fresh choices for every new video.
  useEffect(() => {
    setRating(null);
    setGuess(null);
    setLocked(false);
    setErr(null);
  }, [state.session.index]);

  async function pick(playerId: string) {
    setErr(null);
    const res = await fetch("/api/session/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, playerId }),
    });
    const d = await res.json();
    if (!res.ok) {
      setErr(d.error);
      return;
    }
    const st = { playerId, token: d.token as string };
    localStorage.setItem(seatKey(code), JSON.stringify(st));
    setSeat(st);
  }

  async function lockIn() {
    if (!seat || rating == null || !guess) return;
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/session/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, playerId: seat.playerId, token: seat.token, rating, guessId: guess }),
    });
    const d = await res.json();
    if (!res.ok) setErr(d.error);
    else setLocked(true);
    setBusy(false);
  }

  if (!checked) return null;

  const taken = new Set(state.players.map((p) => p.id));
  const available = state.roster.filter((p) => !taken.has(p.id));

  if (!seat) {
    if (!available.length) return null;
    return (
      <div className="card p-4">
        <p className="label">Playing too? Pick your name</p>
        {err && <p className="mb-2 text-sm text-[#FFB3B3]">{err}</p>}
        <div className="grid grid-cols-2 gap-2">
          {available.map((p) => (
            <button
              key={p.id}
              onClick={() => pick(p.id)}
              className="flex items-center gap-2 rounded-2xl bg-black/30 p-2 text-left font-semibold active:scale-95"
            >
              <Avatar name={p.name} color={p.color} size={28} /> <span className="truncate">{p.name}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const me = state.roster.find((p) => p.id === seat.playerId);
  const answered = locked || !!state.players.find((p) => p.id === seat.playerId)?.answered;

  if (state.session.state !== "playing" || answered) {
    return (
      <div className="card p-3 text-center text-sm text-white/60">
        {answered && state.session.state === "playing" ? "🔒 Locked in" : "Playing as"}{" "}
        <span className="font-semibold text-white/80">{me?.name}</span>
      </div>
    );
  }

  const others = state.roster.filter((p) => p.id !== seat.playerId);

  return (
    <div className="card p-4">
      <p className="label">Your answers (hidden — this screen is shared)</p>
      <div className="mt-2 grid grid-cols-5 gap-1.5">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            onClick={() => setRating(n)}
            className="aspect-square rounded-xl bg-white/10 font-display text-lg font-bold shadow-chunkySm transition active:translate-y-1 active:scale-95"
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        {others.map((p) => (
          <button
            key={p.id}
            onClick={() => setGuess(p.id)}
            className="flex items-center gap-2 rounded-xl bg-black/30 p-2 text-left text-sm font-semibold active:scale-95"
          >
            <Avatar name={p.name} color={p.color} size={22} /> <span className="truncate">{p.name}</span>
          </button>
        ))}
      </div>
      {err && <p className="mt-2 text-center text-sm text-[#FFB3B3]">{err}</p>}
      <button className="btn btn-yellow mt-3 w-full" disabled={busy || rating == null || !guess} onClick={lockIn}>
        {busy ? "…" : "Lock in 🔒"}
      </button>
    </div>
  );
}
