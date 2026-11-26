"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import confetti from "canvas-confetti";
import Avatar from "@/components/Avatar";
import Countdown from "@/components/Countdown";
import EmbedPlayer from "@/components/EmbedPlayer";
import GrandReveal from "@/components/GrandReveal";
import HostPlayerPanel from "@/components/HostPlayerPanel";
import { useGameState, useCountdown } from "@/components/useGameState";
import { fmtPoints, SENDER_BONUS } from "@/lib/points";

/** Real browser fullscreen where supported (Android, desktop, iPad). Must be called from a click. */
function enterNativeFullscreen() {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
  try {
    if (document.fullscreenElement) return;
    const p = el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen?.();
    (p as Promise<void> | undefined)?.catch?.(() => {});
  } catch {
    /* iPhone Safari has no element fullscreen; the CSS overlay still fills the screen */
  }
}
function exitNativeFullscreen() {
  const d = document as Document & { webkitExitFullscreen?: () => Promise<void> | void };
  try {
    if (!document.fullscreenElement) return;
    const p = document.exitFullscreen ? document.exitFullscreen() : d.webkitExitFullscreen?.();
    (p as Promise<void> | undefined)?.catch?.(() => {});
  } catch {
    /* ignore */
  }
}

function HostInner({ groupId }: { groupId: string }) {
  const router = useRouter();
  const sessionId = useSearchParams().get("session");
  const { state, error, refresh, fetchedAt } = useGameState({ sessionId }, 2000);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [reloadN, setReloadN] = useState(0); // bumped to remount the video iframe ("Reload video")
  const [origin, setOrigin] = useState("");
  const [wantFull, setWantFull] = useState(true); // moderator can opt out of fullscreen for a video
  const [finishPending, setFinishPending] = useState(false); // "Finished" clicked mid-video: reveal it, then wrap up
  useEffect(() => setOrigin(window.location.origin), []);

  const s = state?.session;
  const remaining = useCountdown(s?.remainingMs, fetchedAt, s?.state === "playing" && !s?.paused);

  // Fullscreen while a video is playing; back to the window view at the reveal (or when paused).
  const fullscreen = !!(s && s.state === "playing" && !s.paused && state?.video && wantFull);
  useEffect(() => {
    if (!fullscreen) exitNativeFullscreen();
  }, [fullscreen, s?.state, s?.paused]);
  // Each new video starts fullscreen again
  useEffect(() => {
    setWantFull(true);
    setFinishPending(false);
  }, [s?.index]);

  // Grand reveal: only when we actually watch the round flip from playing to reveal
  // (a page refresh mid-reveal just shows the results).
  const prevState = useRef<string | null>(null);
  const [grandFor, setGrandFor] = useState<number | null>(null);
  const [grandOpen, setGrandOpen] = useState(false);
  useEffect(() => {
    const cur = s?.state ?? null;
    if (s && cur === "reveal" && prevState.current === "playing") {
      setGrandFor(s.index);
      setGrandOpen(true);
    }
    prevState.current = cur;
  }, [s?.state, s?.index]); // eslint-disable-line react-hooks/exhaustive-deps
  const closeGrand = useCallback(() => setGrandOpen(false), []);
  // Leaving the page should never leave the browser stuck in fullscreen
  useEffect(() => () => exitNativeFullscreen(), []);

  // When the local countdown hits 0, poke the server (it re-checks the time itself)
  const pokedFor = useRef<number>(-1);
  useEffect(() => {
    if (s?.state === "playing" && remaining <= 0 && pokedFor.current !== s.index) {
      pokedFor.current = s.index;
      setTimeout(refresh, 400);
    }
  }, [remaining, s?.state, s?.index, refresh]);

  async function act(action: string, extra: Record<string, string> = {}) {
    // Starting a video is the moderator's "play": go fullscreen right inside this click
    // (browsers only allow it during a user gesture, so it has to happen before any await).
    if (action === "begin" || action === "next" || (action === "resume" && s?.state === "playing")) {
      // The Next button sits below the video, so the page may be scrolled. Bring it back to the top first: on phones a
      // scrolled page behind the full-screen stage makes taps inside the video land in the wrong place.
      window.scrollTo(0, 0);
      enterNativeFullscreen();
    }
    setBusy(true);
    setActionErr(null);
    // next/skip/reveal carry the index the host screen was looking at, so a double-tap (or two moderators on
    // the same screen) can't advance past a video twice: the server rejects it if the game already moved on.
    const payload: Record<string, unknown> = { sessionId, action, ...extra };
    if (s && (action === "next" || action === "skip" || action === "reveal")) payload.expectIndex = s.index;
    const res = await fetch("/api/session/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await res.json();
    if (!res.ok) setActionErr(d.error);
    await refresh();
    setBusy(false);
  }

  /** "Finished": wrap up on the current video. Unplayed videos stay in the box for the next game. */
  async function finishGame() {
    if (s?.state === "playing") {
      // reveal this video first (with the normal big reveal), then the moderator wraps up
      setFinishPending(true);
      await act("reveal");
      return;
    }
    if (confirm("Finish the game here? Everyone sees the scores as normal. Any videos you haven't played stay in the box for your next game.")) act("finish");
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
          {(s.state === "playing" || s.state === "reveal") && !s.paused && (
            <button
              className="btn btn-sky btn-sm"
              disabled={busy}
              title="Freeze the game and leave. Come back and resume any time."
              onClick={async () => {
                await act("pause");
                router.push(`/g/${groupId}`);
              }}
            >
              ⏸ Pause &amp; exit
            </button>
          )}
          {s.state === "lobby" && (
            <button
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => {
                if (confirm("Close this game? Nothing has been played yet, so all videos stay in the box.")) act("end");
              }}
            >
              End game
            </button>
          )}
          {(s.state === "playing" || s.state === "reveal") && (
            <button
              className="btn btn-mint btn-sm"
              disabled={busy}
              title="Wrap up on this video. Scores are shown as normal and the rest of the videos stay in the box for next time."
              onClick={finishGame}
            >
              {s.state === "playing" ? "✅ Finish after this video" : "✅ Finished"}
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
          <div className="flex w-full max-w-md flex-col gap-4">
            <div className="card">
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
            <HostPlayerPanel state={state} />
          </div>
        </section>
      )}

      {s.paused && s.state !== "finished" && (
        <section className="flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-10 text-center">
          <p className="text-7xl">⏸</p>
          <h1 className="title text-5xl text-sunny">Game paused</h1>
          <p className="max-w-md text-xl text-white/80">
            Video {s.index + 1} of {s.total}. Players see a &ldquo;paused&rdquo; screen and the timer is frozen. Resume whenever you&apos;re ready, even later or from another device.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <button className="btn btn-yellow text-2xl" disabled={busy} onClick={() => act("resume")}>
              ▶ Resume game
            </button>
            <Link href={`/g/${groupId}`} className="btn btn-ghost">
              Back to the box
            </Link>
          </div>
        </section>
      )}

      {!s.paused && (s.state === "playing" || s.state === "reveal") && state.video && (
        <section className="grid flex-1 gap-6 px-6 pb-8 lg:grid-cols-[1fr_minmax(340px,420px)]">
          <div className="flex flex-col items-center justify-start gap-2">
            <EmbedPlayer
              reloadKey={reloadN}
              embedUrl={state.video.embedUrl}
              platform={state.video.platform}
              sourceUrl={state.video.sourceUrl}
              aspect={state.video.aspect}
              blocked={state.video.blocked}
              next={state.upNext}
              fullscreen={fullscreen}
              overlay={
                <div className="text-white">
                  {/* story-style timer bar */}
                  <div className="mx-2 mt-2 h-1 overflow-hidden rounded-full bg-white/25">
                    <div
                      className="h-full rounded-full transition-[width] duration-300 ease-linear"
                      style={{
                        width: `${s.windowSeconds > 0 ? Math.max(0, Math.min(100, (remaining / (s.windowSeconds * 1000)) * 100)) : 0}%`,
                        background: remaining <= 15000 ? "#FF5E5E" : remaining <= 45000 ? "#FFD23F" : "#3DDC97",
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 px-3 pt-2">
                    <div className="flex items-center gap-3 drop-shadow">
                      <Countdown ms={remaining} total={s.windowSeconds} size={40} />
                      <span className="font-display text-base">
                        <span className="text-mint">{state.answered}</span>
                        <span className="text-white/70"> / {state.eligible} locked in</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button className="btn btn-pink btn-sm" disabled={busy} onClick={() => act("reveal")}>
                        Reveal now
                      </button>
                      <button className="btn btn-ghost btn-sm" disabled={busy} title="Video won't load? Skip it." onClick={() => act("skip")}>
                        Skip ⏭
                      </button>
                      <button className="btn btn-ghost btn-sm" title="Video stuck or black? Reload it (the timer keeps running)." onClick={() => setReloadN((n) => n + 1)}>
                        ↻
                      </button>
                      <button className="btn btn-sky btn-sm" disabled={busy} title="Freeze the game and leave" onClick={async () => { await act("pause"); router.push(`/g/${groupId}`); }}>
                        ⏸
                      </button>
                      <button className="btn btn-ghost btn-sm" title="Back to the window view" onClick={() => setWantFull(false)}>
                        ⤡ Exit
                      </button>
                    </div>
                  </div>
                </div>
              }
            />
            {s.state === "playing" && !fullscreen && (
              <div className="flex gap-2">
                <button
                  className="btn btn-yellow btn-sm"
                  onClick={() => {
                    enterNativeFullscreen();
                    setWantFull(true);
                  }}
                >
                  ⛶ Full screen
                </button>
                <button className="btn btn-ghost btn-sm" title="Video stuck or black? Reload it (the timer keeps running)." onClick={() => setReloadN((n) => n + 1)}>
                  ↻ Reload video
                </button>
              </div>
            )}
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
            ) : grandOpen && grandFor === s.index ? (
              <div className="card py-10 text-center">
                <p className="text-6xl">🥁</p>
              </div>
            ) : (
              <RevealPanel state={state} instant={grandFor === s.index} />
            )}
            {s.state === "reveal" && (
              <div className="flex flex-col gap-2">
                {finishPending && <p className="text-center text-sm text-white/70">Wrapping up after this video. Hit Finished when you&apos;re ready.</p>}
                {s.index + 1 < s.total && (
                  <button className={`btn w-full text-2xl ${finishPending ? "btn-ghost" : "btn-yellow"}`} disabled={busy} onClick={() => act("next")}>
                    Next video ▶
                  </button>
                )}
                <button
                  className={`btn w-full ${finishPending || s.index + 1 >= s.total ? "btn-yellow text-2xl" : "btn-mint"}`}
                  disabled={busy}
                  title="Wrap up on this video. The remaining videos stay in the box for next time."
                  onClick={finishGame}
                >
                  {s.index + 1 >= s.total ? "🏁 Finish" : "✅ Finished"}
                </button>
              </div>
            )}
            {!fullscreen && <HostPlayerPanel state={state} />}
            <MiniScores scores={state.scores} />
          </div>
        </section>
      )}

      {s.state === "finished" && <Finale state={state} groupId={groupId} />}

      {grandOpen && grandFor === s.index && s.state === "reveal" && state.reveal && (
        <GrandReveal
          players={state.roster}
          sender={{ id: state.reveal.senderId, name: state.reveal.senderName, color: state.reveal.senderColor }}
          rating={state.video?.avgRating != null ? Number(state.video.avgRating) : null}
          onDone={closeGrand}
        />
      )}
    </main>
  );
}

function RevealPanel({ state, instant = false }: { state: NonNullable<ReturnType<typeof useGameState>["state"]>; instant?: boolean }) {
  const [shown, setShown] = useState(instant);
  const r = state.reveal!;
  useEffect(() => {
    if (instant) {
      // the grand reveal already did the drumroll: go straight to the results
      setShown(true);
      return;
    }
    setShown(false);
    const t = setTimeout(() => {
      setShown(true);
      confetti({ particleCount: 120, spread: 80, origin: { x: 0.8, y: 0.3 } });
    }, 600);
    return () => clearTimeout(t);
  }, [state.session.index]);
  const avg = state.video?.avgRating != null ? Number(state.video.avgRating) : null;
  const senderScores = !!r.senderId && state.scores.some((sc) => sc.playerId === r.senderId);
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
              {senderScores && <p className="mt-1 font-display text-lg text-mint">🕵️ +{fmtPoints(SENDER_BONUS)} for sending it</p>}
              <div className="mt-3 flex items-center gap-2 rounded-full bg-black/30 px-4 py-2 font-display text-2xl">
                ⭐ {avg != null ? avg.toFixed(1) : "–"} <span className="text-base text-white/60">/ 10 · {state.video?.ratingCount ?? 0} ratings</span>
              </div>
            </div>
            <ul className="mt-4 max-h-56 space-y-1 overflow-y-auto">
              {r.guesses.map((g, i) => (
                <motion.li
                  key={g.playerId}
                  initial={instant ? { opacity: 0, x: 40 } : false}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: instant ? 0.2 + i * 0.1 : 0, type: "spring", bounce: 0.35 }}
                  className={`flex items-center justify-between rounded-xl px-3 py-1.5 ${g.correct ? "bg-mint/25" : "bg-black/25"}`}
                >
                  <span className="flex items-center gap-2">
                    <Avatar name={g.name} color={g.color} size={28} />
                    <span className="font-semibold">{g.name}</span>
                    <span className="text-sm text-white/60">guessed {g.guessedName}</span>
                  </span>
                  <span className="font-display">
                    {g.correct ? "✅ +1" : "❌"} <span className="ml-2 text-white/60">{g.rating}★</span>
                  </span>
                </motion.li>
              ))}
              {r.guesses.length === 0 && <li className="text-center text-white/50">No guesses this time!</li>}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MiniScores({ scores }: { scores: { playerId: string; name: string; color: string; points: number }[] }) {
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
            <span className="font-display text-lg">{fmtPoints(sc.points)}</span>
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
          {top && top.points > 0 ? (
            <>
              <Avatar name={top.name} color={top.color} size={96} ring />
              <p className="title mt-3 text-3xl">{top.name}</p>
              <p className="font-display text-2xl text-sunny">{fmtPoints(top.points)} points</p>
              <p className="text-sm text-white/70">
                {top.correct} correct guess{top.correct === 1 ? "" : "es"}
                {top.bonus > 0 ? ` + ${fmtPoints(top.bonus)} for sending videos` : ""}
              </p>
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
                <span className="font-display text-lg">{fmtPoints(p.points)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      {(state.finale?.remaining ?? 0) > 0 && (
        <p className="mx-auto mt-8 max-w-xl rounded-2xl bg-black/30 p-4 text-center text-lg">
          📦 <b>{state.finale?.remaining}</b> video{state.finale?.remaining === 1 ? " is" : "s are"} still waiting in the box. Open it again any time to pick up where you left off.
        </p>
      )}
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
