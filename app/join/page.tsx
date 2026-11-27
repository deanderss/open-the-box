"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Avatar from "@/components/Avatar";
import ModeratorPromo from "@/components/ModeratorPromo";
import { useGameState } from "@/components/useGameState";
import { useWakeLock } from "@/components/useWakeLock";
import LiveCountdown from "@/components/LiveCountdown";
import { useSeat, seatKey, type Seat, type SeatResult } from "@/components/useSeat";
import { REVEAL_SUSPENSE_MS } from "@/lib/revealTiming";
import { fmtPoints, SENDER_BONUS } from "@/lib/points";
import { AWARD_INFO } from "@/lib/awards";

function JoinInner() {
  const initial = (useSearchParams().get("code") || "").toUpperCase();
  const [code, setCode] = useState(initial);
  const [confirmedCode, setConfirmedCode] = useState<string | null>(null);
  const [roster, setRoster] = useState<{ id: string; name: string; color: string; taken: boolean }[] | null>(null);
  const [group, setGroup] = useState<{ name: string; color: string; emoji: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [kickedMsg, setKickedMsg] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const { seat, checked, pick, clear, submitAnswer } = useSeat(confirmedCode);

  async function lookup(c: string) {
    setErr(null);
    setLooking(true);
    try {
      const res = await fetch("/api/session/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: c }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(d.error || "Something went wrong");
        return;
      }
      setConfirmedCode(c);
      setRoster(d.roster);
      setGroup(d.group);
    } catch {
      setErr("Couldn't reach the server — check your connection and try again");
    } finally {
      setLooking(false);
    }
  }

  useEffect(() => {
    if (initial.length !== 4) return;
    // Reconnecting with a saved seat for this code is the common case (a refresh, a locked phone waking back
    // up, a flaky connection recovering) — `useSeat` below is about to make exactly the one network call that
    // actually matters (verify that seat), so let it start immediately instead of paying for a separate
    // "look up this code" round trip first just to get a roster nobody's about to pick from. If it turns out
    // the seat's no longer good, the effect further down falls back to a normal lookup() to get the picker.
    if (typeof localStorage !== "undefined" && localStorage.getItem(seatKey(initial))) {
      setConfirmedCode(initial);
    } else {
      lookup(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fallback for the skip-ahead above: the saved seat turned out to be no longer valid (useSeat already
  // dropped it), and we never actually fetched the roster — fetch it now so the name-picker has something
  // to show instead of sitting empty.
  useEffect(() => {
    if (confirmedCode && checked && !seat && !roster) lookup(confirmedCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmedCode, checked, seat, roster]);

  async function handlePick(playerId: string) {
    setErr(null);
    const r = await pick(playerId);
    if (!r.ok) {
      setErr(r.error);
      lookup(confirmedCode!);
    } else {
      setKickedMsg(null);
    }
  }

  // Memoized so Controller's "was I kicked?" effect doesn't tear down and re-subscribe on every unrelated
  // render of this page (e.g. while a stray `lookup()` from a previous pick is still resolving).
  const handleKicked = useCallback(() => {
    clear();
    setKickedMsg("The host removed you — pick your name again.");
    if (confirmedCode) lookup(confirmedCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clear, confirmedCode]);

  if (seat && confirmedCode) return <Controller code={confirmedCode} seat={seat} submitAnswer={submitAnswer} onKicked={handleKicked} />;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
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
          <button className="btn btn-yellow w-full text-2xl" disabled={code.length !== 4 || looking}>
            {looking ? "Joining…" : "Join"}
          </button>
        </form>
      ) : (
        <div className="card mt-8">
          <p className="text-center text-4xl">{group?.emoji}</p>
          <p className="title text-center text-2xl" style={{ color: group?.color }}>
            {group?.name}
          </p>
          <p className="mb-4 mt-2 text-center text-white/70">Tap your name</p>
          {kickedMsg && <p className="mb-3 text-center text-sm text-[#FFD23F]">{kickedMsg}</p>}
          {err && <p className="mb-3 text-center text-sm text-[#FFB3B3]">{err}</p>}
          {looking && <p className="mb-3 text-center text-sm text-white/70">Joining…</p>}
          <div className="grid grid-cols-2 gap-3">
            {(roster || []).map((p) => (
              <button
                key={p.id}
                disabled={p.taken}
                onClick={() => handlePick(p.id)}
                className="flex items-center gap-2 rounded-2xl bg-black/30 p-3 text-left font-semibold active:scale-95 disabled:opacity-30"
              >
                <Avatar name={p.name} color={p.color} size={36} /> <span className="break-words">{p.name}</span>
                {p.taken && <span className="text-sm font-normal text-white/70">(taken)</span>}
              </button>
            ))}
          </div>
          <button className="mt-4 w-full text-sm text-white/70 underline" onClick={() => setConfirmedCode(null)}>
            Different code
          </button>
        </div>
      )}
      <ModeratorPromo />
    </main>
  );
}

function Controller({
  code,
  seat,
  submitAnswer,
  onKicked,
}: {
  code: string;
  seat: Seat;
  submitAnswer: (rating: number | null, guessId: string | null) => Promise<SeatResult>;
  onKicked: () => void;
}) {
  // Widens to an 8s poll once the realtime broadcast channel is confirmed live (a nudge gets here faster
  // anyway) and drops straight back to 2s the instant it isn't — see useGameState's own comment.
  const { state, refresh, fetchedAt, reconnecting } = useGameState({ code, playerId: seat.playerId, token: seat.token }, 2000, 8000);
  const [rating, setRating] = useState<number | null>(null);
  const [guess, setGuess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const s = state?.session;
  useWakeLock(!!s && s.state !== "finished");

  // "You rated 7, guessed Sam": written once lock-in succeeds, read back here so it survives a refresh (the
  // answer is final either way, so there's nothing left to redo even if the page reloads).
  const [lockSummary, setLockSummary] = useState<{ rating: number; guessedName: string | null } | null>(null);
  useEffect(() => {
    if (typeof sessionStorage === "undefined" || s?.index == null) {
      setLockSummary(null);
      return;
    }
    const raw = sessionStorage.getItem(`otb-lockin-${code}-${s.index}`);
    setLockSummary(raw ? JSON.parse(raw) : null);
  }, [code, s?.index]);

  useEffect(() => {
    setRating(null);
    setGuess(null);
    setErr(null);
    setJustLocked(false);
  }, [s?.index]);

  // A 200 from `/api/session/answer` means the row is already in, for good — unlike the host's "Next" there's
  // no later step that could still reject this after the fact, so there's no reason to make a player wait out
  // a whole extra poll round trip just to see their own tap register.
  const [justLocked, setJustLocked] = useState(false);

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

  if (!state || !s) return <main className="flex min-h-screen items-center justify-center text-white/70">Connecting…</main>;
  const me = state.me;

  async function lockIn() {
    setBusy(true);
    setErr(null);
    const r = await submitAnswer(rating, guess);
    if (!r.ok) {
      setErr(r.error);
      setBusy(false);
      return;
    }
    if (rating != null) {
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(60);
      const guessedName = guess ? (state?.roster.find((p) => p.id === guess)?.name ?? null) : null;
      const summary = { rating, guessedName };
      setLockSummary(summary);
      if (typeof sessionStorage !== "undefined" && s) sessionStorage.setItem(`otb-lockin-${code}-${s.index}`, JSON.stringify(summary));
    }
    setJustLocked(true);
    setBusy(false);
    refresh(); // not awaited — the screen already shows "Locked in!"; this just pulls in everyone else's progress a little sooner than the next scheduled poll
  }

  const others = state.roster.filter((p) => p.id !== seat.playerId);
  // Hide the sign-up ad only while actively rating/guessing, so it can never be mis-tapped next to
  // the Lock in button — it's fine (and good exposure) on every other screen, including the wait.
  const answering = !s.paused && s.state === "playing" && !!me && !me.answered;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Avatar name={me?.name} color={me?.color} size={40} />
          <span className="font-display text-lg">{me?.name}</span>
        </div>
        <span className="rounded-full bg-black/30 px-3 py-1 font-display">🕵️ {fmtPoints(me?.score ?? 0)}</span>
      </header>

      {reconnecting && (
        <p className="mb-3 flex items-center justify-center gap-1.5 rounded-full bg-[#FFB84D]/20 px-3 py-1 text-center text-sm text-[#FFB84D]" role="status">
          <span className="h-2 w-2 animate-pulse rounded-full bg-[#FFB84D]" aria-hidden /> Reconnecting…
        </p>
      )}

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

      {!s.paused && s.state === "playing" && me && (me.answered || justLocked ? (
        <Panel emoji="🔒" title="Locked in!">
          {lockSummary && (
            <>
              You rated it {lockSummary.rating}
              {lockSummary.guessedName ? `, guessed ${lockSummary.guessedName}` : ""}.{" "}
            </>
          )}
          Waiting for everyone else… ({state.answered}/{state.eligible})
        </Panel>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="font-display text-white/70">
              Video {s.index + 1} / {s.total}
            </p>
            <LiveCountdown remainingMs={s.remainingMs} fetchedAt={fetchedAt} total={s.windowSeconds} active={s.state === "playing"} size={72} />
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
                  aria-pressed={rating === n}
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
                  aria-pressed={guess === p.id}
                  className={`flex items-center gap-2 rounded-2xl p-2 text-left font-semibold transition ${guess === p.id ? "bg-bubble ring-4 ring-sunny" : "bg-black/30"}`}
                >
                  <Avatar name={p.name} color={p.color} size={30} /> <span className="truncate">{p.name}</span>
                </button>
              ))}
            </div>
          </div>
          {err && <p className="text-center text-[#FFB3B3]">{err}</p>}
          <button
            className="btn btn-yellow sticky w-full text-2xl"
            style={{ bottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
            disabled={busy || !rating || (!guess && !me.isMine)}
            onClick={lockIn}
          >
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
        <div className="card mt-6 animate-pop-in text-center">
          {me?.isMine ? (
            <>
              <p className="text-6xl">😎</p>
              <p className="title mt-2 text-2xl">Your video got revealed!</p>
              <p className="mt-1 font-display text-lg text-mint">+{fmtPoints(SENDER_BONUS)} for sending it</p>
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
          <p className="mt-4 text-sm text-white/70">Watch the big screen for the next video…</p>
        </div>
      )}

      {s.state === "finished" && s.awardsStep < s.awardsCount && (
        <Panel emoji="🏆" title="Awards ceremony on the big screen!">
          Eyes up! Find out who the biggest hater and the biggest lover are, and which videos stunk or slapped.
        </Panel>
      )}

      {s.state === "finished" && s.awardsStep >= s.awardsCount && (
        <>
          <Panel emoji="🎬" title="That's a wrap!">
            You scored <b>{fmtPoints(me?.score ?? 0)}</b> point{me?.score === 1 ? "" : "s"} tonight. See you next time!
          </Panel>
          {state.scores.length > 0 && (
            <div className="card mt-4">
              <p className="title mb-2 text-lg text-mint">🕵️ Final scores</p>
              <ol className="space-y-1">
                {state.scores.slice(0, 8).map((sc, i) => (
                  <li key={sc.playerId} className={`flex items-center justify-between rounded-xl px-2 py-1 ${sc.playerId === me?.playerId ? "bg-white/15" : ""}`}>
                    <span className="flex items-center gap-2">
                      <span className="w-5 text-white/70">{i + 1}</span> {sc.name}
                    </span>
                    <span className="font-display text-lg">{fmtPoints(sc.points)}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {(state.finale?.awards?.length ?? 0) > 0 && (
            <div className="card mt-4">
              <p className="title mb-2 text-lg text-sunny">🏆 Tonight&apos;s awards</p>
              <ul className="space-y-2">
                {state.finale!.awards.map((a) => (
                  <li key={a.kind} className={`flex items-center gap-3 rounded-xl px-2 py-1 ${a.playerId && a.playerId === me?.playerId ? "bg-white/15" : ""}`}>
                    <span className="text-2xl" aria-hidden>
                      {AWARD_INFO[a.kind].emoji}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs text-white/60">{AWARD_INFO[a.kind].title}</span>
                      <span className="flex items-center gap-2">
                        <span className="truncate font-display">{a.name}</span>
                        {a.playerId && a.playerId === me?.playerId && <span className="rounded-full bg-sunny px-2 text-xs font-bold text-night">That&apos;s you!</span>}
                      </span>
                    </span>
                    <span className="font-display text-sunny">⭐ {a.avg.toFixed(1)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {!answering && <ModeratorPromo />}
    </main>
  );
}

function Panel({ emoji, title, children }: { emoji: string; title: string; children: React.ReactNode }) {
  return (
    <div className="card mt-10 animate-rise-in text-center">
      <p className="animate-wobble text-7xl">{emoji}</p>
      <p className="title mt-4 text-3xl">{title}</p>
      <p className="mt-2 text-white/70">{children}</p>
    </div>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center text-white/70">Loading…</main>}>
      <JoinInner />
    </Suspense>
  );
}
