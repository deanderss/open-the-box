"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import confetti from "canvas-confetti";
import Avatar from "@/components/Avatar";
import Countdown from "@/components/Countdown";
import EmbedPlayer from "@/components/EmbedPlayer";
import { useGameState, useCountdown } from "@/components/useGameState";

function HostInner({ groupId }: { groupId: string }) {
  const sessionId = useSearchParams().get("session");
  const { state, error, refresh, fetchedAt } = useGameState({ sessionId }, 2000);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const s = state?.session;
  const remaining = useCountdown(s?.remainingMs, fetchedAt, s?.state === "playing");

  // When the local countdown hits 0, poke the server (it re-checks the time itself)
  const pokedFor = useRef<number>(-1);
  useEffect(() => {
    if (s?.state === "playing" && remaining <= 0 && pokedFor.current !== s.index) {
      pokedFor.current = s.index;
      setTimeout(refresh, 400);
    }
  }, [remaining, s?.state, s?.index, refresh]);

  async function act(action: string, extra: Record<string, string> = {}) {
    setBusy(true);
    setActionErr(null);
    const res = await fetch("/api/session/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, action, ...extra }),
    });
    const d = await res.json();
    if (!res.ok) setActionErr(d.error);
    await refresh();
    setBusy(false);
  }

  if (!sessionId) return <Centered>Missing session. <Link href={`/g/${groupId}`} className="underline">Back</Link></Centered>;
  if (error && !state) return <Centered>{error}</Centered>;
  if (!state || !s) return <Centered>Opening the box…</Centered>;

  const joinUrl = `${origin}/join?code=${s.code}`;

  return (
    <main className="flex min-h-screen flex-col">
      {/* top strip */}
      <header className="flex items-center justify-between gap-4 px-6 py-3">
        <Link href={`/g/${groupId}`} className="title flex items-center gap-2 text-xl text-sunny">
          <span className="text-2xl">{state.group?.emoji}</span> {state.group?.name}
        </Link>
        <div className="flex items-center gap-4">
          {s.state !== "finished" && (
            <div className="rounded-2xl bg-black/30 px-4 py-2 text-center">
              <span className="text-sm text-white/60">Join at </span>
              <span className="font-mono text-white/90">{origin.replace(/^https?:\/\//, "")}/join</span>
              <span className="ml-3 font-display text-2xl tracking-[0.3em] text-sunny">{s.code}</span>
            </div>
          )}
          {s.state !== "lobby" && s.state !== "finished" && (
            <span className="font-display text-white/70">
              Video {s.index + 1} / {s.total}
            </span>
          )}
          {s.state !== "finished" && (
            <button
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => {
                if (confirm("End the game now? Unplayed videos stay in the box for next time.")) act("end");
              }}
            >
              End game
            </button>
          )}
        </div>
      </header>
      {actionErr && <p className="mx-6 rounded-xl bg-[#FF5E5E]/20 p-2 text-center text-[#FFB3B3]">{actionErr}</p>}

      {s.state === "lobby" && (
        <section className="flex flex-1 flex-col items-center justify-center gap-8 px-6 pb-10 lg:flex-row lg:gap-16">
          <div className="flex flex-col items-center text-center">
            <motion.h1 initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="title text-5xl text-sunny sm:text-7xl">
              The box is open!
            </motion.h1>
            <p className="mt-4 text-xl text-white/80">Grab your phone and join the game</p>
            <div className="mt-6 rounded-3xl bg-white p-5 shadow-chunky">
              <QRCodeSVG value={joinUrl || "https://"} size={220} />
            </div>
            <p className="mt-4 font-display text-6xl tracking-[0.35em] text-white">{s.code}</p>
          </div>
          <div className="card w-full max-w-md">
            <p className="title text-2xl">Players in ({state.players.length})</p>
            <div className="mt-4 flex min-h-[120px] flex-wrap gap-3">
              <AnimatePresence>
                {state.players.map((p) => (
                  <motion.button
                    key={p.id}
                    initial={{ scale: 0, rotate: -20 }}
                    animate={{ scale: 1, rotate: 0 }}
                    exit={{ scale: 0 }}
                    title="Click to remove"
                    onClick={() => confirm(`Remove ${p.name} from this game? (frees the name for another phone)`) && act("kick", { playerId: p.id })}
                    className="flex flex-col items-center gap-1"
                  >
                    <Avatar name={p.name} color={p.color} size={64} />
                    <span className="text-sm font-semibold">{p.name}</span>
                  </motion.button>
                ))}
              </AnimatePresence>
              {state.players.length === 0 && <p className="text-white/50">Waiting for players…</p>}
            </div>
            <button className="btn btn-yellow mt-6 w-full text-2xl" disabled={busy || state.players.length === 0} onClick={() => act("begin")}>
              ▶ Start the show
            </button>
          </div>
        </section>
      )}

      {(s.state === "playing" || s.state === "reveal") && state.video && (
        <section className="grid flex-1 gap-6 px-6 pb-8 lg:grid-cols-[1fr_minmax(340px,420px)]">
          <div className="flex items-start justify-center">
            <EmbedPlayer embedUrl={state.video.embedUrl} platform={state.video.platform} sourceUrl={state.video.sourceUrl} />
          </div>
          <div className="flex flex-col gap-4">
            {s.state === "playing" ? (
              <div className="card flex flex-col items-center gap-4">
                <p className="title text-2xl">Rate it &amp; guess who sent it!</p>
                <Countdown ms={remaining} total={s.windowSeconds} size={150} />
                <p className="font-display text-3xl">
                  <span className="text-mint">{state.answered}</span>
                  <span className="text-white/50"> / {state.eligible} locked in</span>
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  {state.players.map((p) => (
                    <motion.div key={p.id} animate={p.answered ? { scale: [1, 1.25, 1] } : {}} className="flex flex-col items-center">
                      <Avatar name={p.name} color={p.color} size={48} dim={!p.answered} ring={p.answered} />
                      <span className="mt-1 text-xs">{p.name}</span>
                    </motion.div>
                  ))}
                </div>
                <div className="mt-2 flex w-full gap-2">
                  <button className="btn btn-pink flex-1" disabled={busy} onClick={() => act("reveal")}>
                    Reveal now
                  </button>
                  <button className="btn btn-ghost" disabled={busy} title="Video won't load? Skip it." onClick={() => act("skip")}>
                    Skip ⏭
                  </button>
                </div>
              </div>
            ) : (
              <RevealPanel state={state} />
            )}
            {s.state === "reveal" && (
              <button className="btn btn-yellow w-full text-2xl" disabled={busy} onClick={() => act("next")}>
                {s.index + 1 >= s.total ? "🏁 Finish" : "Next video ▶"}
              </button>
            )}
            <MiniScores scores={state.scores} />
          </div>
        </section>
      )}

      {s.state === "finished" && <Finale state={state} groupId={groupId} />}
    </main>
  );
}

function RevealPanel({ state }: { state: NonNullable<ReturnType<typeof useGameState>["state"]> }) {
  const [shown, setShown] = useState(false);
  const r = state.reveal!;
  useEffect(() => {
    setShown(false);
    const t = setTimeout(() => {
      setShown(true);
      confetti({ particleCount: 120, spread: 80, origin: { x: 0.8, y: 0.3 } });
    }, 1600);
    return () => clearTimeout(t);
  }, [state.session.index]);
  const avg = state.video?.avgRating != null ? Number(state.video.avgRating) : null;
  return (
    <div className="card">
      <AnimatePresence mode="wait">
        {!shown ? (
          <motion.div key="drum" initial={{ opacity: 0 }} animate={{ opacity: 1, rotate: [-3, 3, -3] }} transition={{ rotate: { repeat: Infinity, duration: 0.25 } }} className="py-10 text-center">
            <p className="text-6xl">🥁</p>
            <p className="title mt-2 text-2xl">And it was sent by…</p>
          </motion.div>
        ) : (
          <motion.div key="who" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", bounce: 0.5 }}>
            <div className="flex flex-col items-center text-center">
              <Avatar name={r.senderName} color={r.senderColor} size={96} ring />
              <p className="title mt-3 text-4xl text-sunny">{r.senderName}!</p>
              <div className="mt-3 flex items-center gap-2 rounded-full bg-black/30 px-4 py-2 font-display text-2xl">
                ⭐ {avg != null ? avg.toFixed(1) : "–"} <span className="text-base text-white/60">/ 10 · {state.video?.ratingCount ?? 0} ratings</span>
              </div>
            </div>
            <ul className="mt-4 max-h-56 space-y-1 overflow-y-auto">
              {r.guesses.map((g) => (
                <li key={g.playerId} className={`flex items-center justify-between rounded-xl px-3 py-1.5 ${g.correct ? "bg-mint/25" : "bg-black/25"}`}>
                  <span className="flex items-center gap-2">
                    <Avatar name={g.name} color={g.color} size={28} />
                    <span className="font-semibold">{g.name}</span>
                    <span className="text-sm text-white/60">guessed {g.guessedName}</span>
                  </span>
                  <span className="font-display">
                    {g.correct ? "✅ +1" : "❌"} <span className="ml-2 text-white/60">{g.rating}★</span>
                  </span>
                </li>
              ))}
              {r.guesses.length === 0 && <li className="text-center text-white/50">No guesses this time!</li>}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MiniScores({ scores }: { scores: { playerId: string; name: string; color: string; correct: number }[] }) {
  if (!scores.length) return null;
  return (
    <div className="card py-4">
      <p className="title mb-2 text-lg text-mint">🕵️ Tonight&apos;s detectives</p>
      <ol className="space-y-1">
        {scores.slice(0, 6).map((sc, i) => (
          <li key={sc.playerId} className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className="w-5 text-white/50">{i + 1}</span>
              <Avatar name={sc.name} color={sc.color} size={26} /> {sc.name}
            </span>
            <span className="font-display text-lg">{sc.correct}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Finale({ state, groupId }: { state: NonNullable<ReturnType<typeof useGameState>["state"]>; groupId: string }) {
  useEffect(() => {
    const end = Date.now() + 1500;
    const t = setInterval(() => {
      if (Date.now() > end) return clearInterval(t);
      confetti({ particleCount: 40, spread: 100, origin: { x: Math.random(), y: 0.2 } });
    }, 200);
    return () => clearInterval(t);
  }, []);
  const top = state.scores[0];
  const tv = state.finale?.topVideo;
  return (
    <section className="mx-auto w-full max-w-6xl flex-1 px-6 pb-12">
      <h1 className="title mt-4 text-center text-5xl text-sunny sm:text-6xl">That&apos;s a wrap! 🎬</h1>
      <div className="mt-8 grid gap-6 md:grid-cols-3">
        <div className="card flex flex-col items-center text-center">
          <p className="label">Top detective tonight</p>
          {top && top.correct > 0 ? (
            <>
              <Avatar name={top.name} color={top.color} size={96} ring />
              <p className="title mt-3 text-3xl">{top.name}</p>
              <p className="text-white/70">{top.correct} correct guess{top.correct === 1 ? "" : "es"}</p>
            </>
          ) : (
            <p className="mt-6 text-white/70">Nobody guessed right. Sneaky team! 🕶</p>
          )}
        </div>
        <div className="card flex flex-col items-center text-center">
          <p className="label">Best video tonight</p>
          {tv ? (
            <>
              <p className="text-6xl">🏆</p>
              <p className="title mt-2 text-3xl">⭐ {Number(tv.avg_rating).toFixed(1)}</p>
              <p className="text-white/70">sent by {tv.senderName}</p>
              <a href={tv.source_url} target="_blank" rel="noreferrer" className="btn btn-sky btn-sm mt-3">
                Watch again ↗
              </a>
            </>
          ) : (
            <p className="mt-6 text-white/70">No ratings yet</p>
          )}
        </div>
        <div className="card">
          <p className="label text-center">All-time leaderboard</p>
          <ol className="mt-2 space-y-2">
            {(state.finale?.allTime || []).map((p, i) => (
              <li key={p.player_id} className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className="w-6 font-display text-xl">{["🥇", "🥈", "🥉"][i] || i + 1}</span>
                  <Avatar name={p.display_name} color={p.avatar_color} size={30} /> {p.display_name}
                </span>
                <span className="font-display text-lg">{p.correct}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="mt-8 flex flex-wrap justify-center gap-4">
        <Link href={`/g/${groupId}/top`} className="btn btn-yellow">
          🏆 Top 100
        </Link>
        <Link href={`/g/${groupId}/leaderboard`} className="btn btn-mint">
          🕵️ Full leaderboard
        </Link>
        <Link href={`/g/${groupId}`} className="btn btn-ghost">
          Back to the box
        </Link>
      </div>
    </section>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center text-xl text-white/70">{children}</main>;
}

export default function HostPage({ params }: { params: { groupId: string } }) {
  return (
    <Suspense>
      <HostInner groupId={params.groupId} />
    </Suspense>
  );
}
