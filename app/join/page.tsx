"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import Avatar from "@/components/Avatar";
import Countdown from "@/components/Countdown";
import { useGameState, useCountdown } from "@/components/useGameState";
import { REVEAL_SUSPENSE_MS } from "@/components/GrandReveal";

type Seat = { playerId: string; token: string };
const seatKey = (code: string) => `otb-seat-${code.toUpperCase()}`;

function JoinInner() {
  const initial = (useSearchParams().get("code") || "").toUpperCase();
  const [code, setCode] = useState(initial);
  const [confirmedCode, setConfirmedCode] = useState<string | null>(null);
  const [roster, setRoster] = useState<{ id: string; name: string; color: string; taken: boolean }[] | null>(null);
  const [group, setGroup] = useState<{ name: string; color: string; emoji: string } | null>(null);
  const [seat, setSeat] = useState<Seat | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function lookup(c: string) {
    setErr(null);
    const res = await fetch("/api/session/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: c }) });
    const d = await res.json();
    if (!res.ok) return setErr(d.error);
    setConfirmedCode(c);
    setRoster(d.roster);
    setGroup(d.group);
    const saved = localStorage.getItem(seatKey(c));
    if (saved) {
      try {
        const st = JSON.parse(saved) as Seat;
        const r2 = await fetch("/api/session/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: c, ...st }) });
        if (r2.ok) setSeat(st);
        else localStorage.removeItem(seatKey(c));
      } catch {
        localStorage.removeItem(seatKey(c));
      }
    }
  }

  useEffect(() => {
    if (initial.length === 4) lookup(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pick(playerId: string) {
    setErr(null);
    const res = await fetch("/api/session/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: confirmedCode, playerId }) });
    const d = await res.json();
    if (!res.ok) {
      setErr(d.error);
      lookup(confirmedCode!);
      return;
    }
    const st = { playerId, token: d.token };
    localStorage.setItem(seatKey(confirmedCode!), JSON.stringify(st));
    setSeat(st);
  }

  if (seat && confirmedCode)
    return (
      <Controller
        code={confirmedCode}
        seat={seat}
        onKicked={() => {
          localStorage.removeItem(seatKey(confirmedCode));
          setSeat(null);
          lookup(confirmedCode);
        }}
      />
    );

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-5 py-8">
      <h1 className="title text-center text-4xl text-sunny">📦 Open the Box</h1>
      {!confirmedCode ? (
        <form
          className="card mt-8 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            lookup(code.trim().toUpperCase());
          }}
        >
          <label className="label">Room code</label>
          <input
            className="input text-center font-display text-4xl uppercase tracking-[0.4em]"
            maxLength={4}
            value={code}
            autoCapitalize="characters"
            autoComplete="off"
            onChange={(e) => setCode(e.target.value.replace(/[^a-z]/gi, "").toUpperCase())}
            placeholder="ABCD"
          />
          {err && <p className="text-center text-[#FFB3B3]">{err}</p>}
          <button className="btn btn-yellow w-full text-2xl" disabled={code.length !== 4}>
            Join
          </button>
        </form>
      ) : (
        <div className="card mt-8">
          <p className="text-center text-4xl">{group?.emoji}</p>
          <p className="title text-center text-2xl" style={{ color: group?.color }}>
            {group?.name}
          </p>
          <p className="mb-4 mt-2 text-center text-white/70">Tap your name</p>
          {err && <p className="mb-3 text-center text-sm text-[#FFB3B3]">{err}</p>}
          <div className="grid grid-cols-2 gap-3">
            {(roster || []).map((p) => (
              <button
                key={p.id}
                disabled={p.taken}
                onClick={() => pick(p.id)}
                className="flex items-center gap-2 rounded-2xl bg-black/30 p-3 text-left font-semibold active:scale-95 disabled:opacity-30"
              >
                <Avatar name={p.name} color={p.color} size={36} /> {p.name}
              </button>
            ))}
          </div>
          <button className="mt-4 w-full text-sm text-white/50 underline" onClick={() => setConfirmedCode(null)}>
            Different code
          </button>
        </div>
      )}
    </main>
  );
}

function Controller({ code, seat, onKicked }: { code: string; seat: Seat; onKicked: () => void }) {
  const { state, refresh, fetchedAt } = useGameState({ code, playerId: seat.playerId, token: seat.token }, 2000);
  const [rating, setRating] = useState<number | null>(null);
  const [guess, setGuess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const s = state?.session;
  const remaining = useCountdown(s?.remainingMs, fetchedAt, s?.state === "playing");

  useEffect(() => {
    setRating(null);
    setGuess(null);
    setErr(null);
  }, [s?.index]);

  // Don't spoil the big screen: hold the result back while the grand reveal plays there.
  // (Only when we watch the round flip to reveal. Joining or refreshing mid-reveal shows it right away.)
  const prevState = useRef<string | null>(null);
  const [revealReady, setRevealReady] = useState(true);
  useEffect(() => {
    const cur = s?.state ?? null;
    let t: ReturnType<typeof setTimeout> | undefined;
    if (cur === "reveal" && prevState.current === "playing") {
      setRevealReady(false);
      t = setTimeout(() => setRevealReady(true), REVEAL_SUSPENSE_MS);
    } else if (cur !== "reveal") {
      setRevealReady(true);
    }
    prevState.current = cur;
    return () => {
      if (t) clearTimeout(t);
    };
  }, [s?.state]);

  useEffect(() => {
    if (state && !state.viewerValid && state.session.state !== "finished") onKicked();
  }, [state, onKicked]);

  if (!state || !s) return <main className="flex min-h-screen items-center justify-center text-white/60">Connecting…</main>;
  const me = state.me;

  async function lockIn() {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/session/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, playerId: seat.playerId, token: seat.token, rating, guessId: guess }),
    });
    const d = await res.json();
    if (!res.ok) setErr(d.error);
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(60);
    await refresh();
    setBusy(false);
  }

  const others = state.roster.filter((p) => p.id !== seat.playerId);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-4 py-4">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Avatar name={me?.name} color={me?.color} size={40} />
          <span className="font-display text-lg">{me?.name}</span>
        </div>
        <span className="rounded-full bg-black/30 px-3 py-1 font-display">🕵️ {me?.score ?? 0}</span>
      </header>

      {s.paused && s.state !== "finished" && (
        <Panel emoji="⏸" title="Game paused">
          The host paused the game. Keep this page open. It'll pick up right where it left off.
        </Panel>
      )}

      {!s.paused && s.state === "lobby" && (
        <Panel emoji="🎉" title="You're in!">
          Watch the big screen. The show starts soon.
        </Panel>
      )}

      {!s.paused && s.state === "playing" && me && (me.answered ? (
        <Panel emoji="🔒" title="Locked in!">
          Waiting for everyone else… ({state.answered}/{state.eligible})
        </Panel>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="font-display text-white/70">
              Video {s.index + 1} / {s.total}
            </p>
            <Countdown ms={remaining} total={s.windowSeconds} size={72} />
          </div>
          {me.isMine && (
            <div className="rounded-2xl bg-bubble/30 p-3 text-center font-display">This one&apos;s yours 🤫 Act natural… lock in anyway so nobody suspects!</div>
          )}
          <div className="card p-4">
            <p className="label">Rate it</p>
            <div className="grid grid-cols-5 gap-2">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  onClick={() => setRating(n)}
                  className={`aspect-square rounded-2xl font-display text-2xl font-bold shadow-chunkySm transition active:translate-y-1 ${rating === n ? "bg-sunny text-night scale-110" : "bg-white/10"}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="card p-4">
            <p className="label">Who sent it?</p>
            <div className="grid grid-cols-2 gap-2">
              {others.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setGuess(p.id)}
                  className={`flex items-center gap-2 rounded-2xl p-2 text-left font-semibold transition ${guess === p.id ? "bg-bubble ring-4 ring-sunny" : "bg-black/30"}`}
                >
                  <Avatar name={p.name} color={p.color} size={30} /> <span className="truncate">{p.name}</span>
                </button>
              ))}
            </div>
          </div>
          {err && <p className="text-center text-[#FFB3B3]">{err}</p>}
          <button className="btn btn-yellow sticky bottom-3 w-full text-2xl" disabled={busy || !rating || (!guess && !me.isMine)} onClick={lockIn}>
            {busy ? "…" : "Lock in 🔒"}
          </button>
        </div>
      ))}

      {!s.paused && s.state === "reveal" && state.reveal && !revealReady && (
        <Panel emoji="🥁" title="And the sender is…">
          Eyes on the big screen!
        </Panel>
      )}

      {!s.paused && s.state === "reveal" && state.reveal && revealReady && (
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="card mt-6 text-center">
          {me?.isMine ? (
            <>
              <p className="text-6xl">😎</p>
              <p className="title mt-2 text-2xl">Your video got revealed!</p>
            </>
          ) : me?.correct ? (
            <>
              <p className="text-6xl">✅</p>
              <p className="title mt-2 text-3xl text-mint">Nailed it! +1</p>
            </>
          ) : (
            <>
              <p className="text-6xl">❌</p>
              <p className="title mt-2 text-3xl text-[#FF8A8A]">{me?.answered ? "Not quite!" : "Missed this one!"}</p>
            </>
          )}
          <p className="mt-3 text-white/80">
            It was sent by <span className="font-display text-sunny">{state.reveal.senderName}</span>
          </p>
          <p className="mt-4 text-sm text-white/60">Watch the big screen for the next video…</p>
        </motion.div>
      )}

      {s.state === "finished" && (
        <Panel emoji="🎬" title="That's a wrap!">
          You got <b>{me?.score ?? 0}</b> correct guess{me?.score === 1 ? "" : "es"} tonight. See you next time!
        </Panel>
      )}
    </main>
  );
}

function Panel({ emoji, title, children }: { emoji: string; title: string; children: React.ReactNode }) {
  return (
    <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="card mt-10 text-center">
      <p className="animate-wobble text-7xl">{emoji}</p>
      <p className="title mt-4 text-3xl">{title}</p>
      <p className="mt-2 text-white/70">{children}</p>
    </motion.div>
  );
}

export default function JoinPage() {
  return (
    <Suspense>
      <JoinInner />
    </Suspense>
  );
}
