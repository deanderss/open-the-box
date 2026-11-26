"use client";
import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import Avatar from "@/components/Avatar";
import Countdown from "@/components/Countdown";
import EmbedPlayer from "@/components/EmbedPlayer";
import HostPlayerPanel from "@/components/HostPlayerPanel";
import type { GameState } from "@/components/useGameState";
import { enterNativeFullscreen } from "@/lib/fullscreen";
import RevealPanel from "./RevealPanel";
import MiniScores from "./MiniScores";

export default function StageView({
  state,
  remaining,
  fullscreen,
  setWantFull,
  reloadN,
  setReloadN,
  busy,
  grandOpen,
  grandFor,
  finishPending,
  act,
  onPauseExit,
  finishGame,
}: {
  state: GameState;
  remaining: number;
  fullscreen: boolean;
  setWantFull: (v: boolean) => void;
  reloadN: number;
  setReloadN: (fn: (n: number) => number) => void;
  busy: boolean;
  grandOpen: boolean;
  grandFor: number | null;
  finishPending: boolean;
  act: (action: string, extra?: Record<string, string>) => void;
  onPauseExit: () => void;
  finishGame: () => void;
}) {
  const s = state.session;
  const [moreOpen, setMoreOpen] = useState(false);
  const [answerOpen, setAnswerOpen] = useState(false);
  const [answerStatus, setAnswerStatus] = useState({ visible: false, answered: false });
  // Stable reference: HostPlayerPanel re-reports its status on every real state change, and a fresh
  // callback identity each render would make that effect (and this one) re-fire forever.
  const handleAnswerStatus = useCallback((next: { visible: boolean; answered: boolean }) => {
    setAnswerStatus((prev) => (prev.visible === next.visible && prev.answered === next.answered ? prev : next));
  }, []);
  // Nothing left to do in the sheet once locked in — close it so it's not just sitting over the video.
  useEffect(() => {
    if (answerStatus.answered) setAnswerOpen(false);
  }, [answerStatus.answered]);
  // Collapse the "More" menu (and close the sheet) whenever we leave the moment they apply to.
  useEffect(() => {
    setMoreOpen(false);
    setAnswerOpen(false);
  }, [s.index, s.state]);

  if (!state.video) return null;
  return (
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
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-2">
                <div className="flex items-center gap-3 drop-shadow">
                  <Countdown ms={remaining} total={s.windowSeconds} size={40} />
                  <span className="font-display text-base">
                    <span className="text-mint">{state.answered}</span>
                    <span className="text-white/70"> / {state.eligible} locked in</span>
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <button className="btn btn-pink btn-sm" disabled={busy} onClick={() => act("reveal")}>
                    Reveal now
                  </button>
                  {answerStatus.visible && (
                    <button className="btn btn-yellow btn-sm" onClick={() => setAnswerOpen(true)}>
                      📝 Answer
                    </button>
                  )}
                  {/* Skip / Reload / Pause: full buttons from sm up, folded into "More" below that so the
                      bar doesn't wrap onto three lines on a phone. */}
                  <div className="hidden items-center gap-1.5 sm:flex">
                    <button className="btn btn-ghost btn-sm" disabled={busy} title="Video won't load? Skip it." onClick={() => act("skip")}>
                      Skip <span aria-hidden>⏭</span>
                    </button>
                    <button className="btn btn-ghost btn-sm" title="Video stuck or black? Reload it (the timer keeps running)." aria-label="Reload video" onClick={() => setReloadN((n) => n + 1)}>
                      <span aria-hidden>↻</span>
                    </button>
                    <button className="btn btn-sky btn-sm" disabled={busy} title="Freeze the game and leave" aria-label="Pause and exit" onClick={onPauseExit}>
                      <span aria-hidden>⏸</span>
                    </button>
                  </div>
                  <div className="relative sm:hidden">
                    <button
                      className="btn btn-ghost btn-sm"
                      aria-haspopup="true"
                      aria-expanded={moreOpen}
                      aria-label="More actions"
                      onClick={() => setMoreOpen((o) => !o)}
                    >
                      <span aria-hidden>⋯</span> More
                    </button>
                    {moreOpen && (
                      <div className="absolute right-0 top-full z-20 mt-1 flex flex-col gap-1 rounded-xl bg-night p-2 shadow-chunky">
                        <button
                          className="btn btn-ghost btn-sm whitespace-nowrap"
                          disabled={busy}
                          onClick={() => {
                            setMoreOpen(false);
                            act("skip");
                          }}
                        >
                          Skip <span aria-hidden>⏭</span>
                        </button>
                        <button
                          className="btn btn-ghost btn-sm whitespace-nowrap"
                          onClick={() => {
                            setMoreOpen(false);
                            setReloadN((n) => n + 1);
                          }}
                        >
                          <span aria-hidden>↻</span> Reload
                        </button>
                        <button
                          className="btn btn-sky btn-sm whitespace-nowrap"
                          disabled={busy}
                          onClick={() => {
                            setMoreOpen(false);
                            onPauseExit();
                          }}
                        >
                          <span aria-hidden>⏸</span> Pause
                        </button>
                      </div>
                    )}
                  </div>
                  <button className="btn btn-ghost btn-sm" title="Back to the window view" onClick={() => setWantFull(false)}>
                    <span aria-hidden>⤡</span> Exit
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
        {/* Fullscreen "Answer" bottom sheet: same HostPlayerPanel, just presented over the video instead of
            in the (hidden, while fullscreen) right column. Kept mounted-but-hidden rather than unmounted so
            its own seat check doesn't re-run every time the sheet opens. */}
        {fullscreen && (
          <div
            className={
              answerOpen
                ? "fixed inset-x-0 bottom-0 z-40 max-h-[75vh] overflow-y-auto rounded-t-3xl bg-night p-4 shadow-chunky"
                : "hidden"
            }
            style={answerOpen ? { paddingBottom: "max(1rem, env(safe-area-inset-bottom))" } : undefined}
          >
            <button className="mb-2 ml-auto block text-sm text-white/70 underline" onClick={() => setAnswerOpen(false)}>
              Close
            </button>
            <HostPlayerPanel state={state} onStatus={handleAnswerStatus} />
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
              <span className="text-white/70"> / {state.eligible} locked in</span>
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              {state.players.map((p) => (
                <motion.div key={p.id} animate={p.answered ? { scale: [1, 1.25, 1] } : {}} className="flex flex-col items-center">
                  <Avatar name={p.name} color={p.color} size={48} dim={!p.answered} ring={p.answered} />
                  <span className="mt-1 text-xs">{p.name}</span>
                </motion.div>
              ))}
            </div>
          </div>
        ) : grandOpen && grandFor === s.index ? (
          <div className="card py-10 text-center">
            <p className="text-6xl">🥁</p>
          </div>
        ) : (
          <RevealPanel state={state} instant={grandFor === s.index} />
        )}
        {/* Action buttons: inline in the flow from lg up (there's room beside the video); below that, a
            sticky bar pinned to the bottom of the screen so they're always one tap away without scrolling
            past scores or the guess list. */}
        {s.state === "playing" && (
          <div
            className="sticky bottom-0 z-20 -mx-6 flex gap-2 bg-night/95 px-6 py-3 backdrop-blur lg:static lg:mx-0 lg:bg-transparent lg:px-0 lg:py-0 lg:backdrop-blur-0"
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
          >
            <button className="btn btn-pink flex-1" disabled={busy} onClick={() => act("reveal")}>
              Reveal now
            </button>
            <button className="btn btn-ghost" disabled={busy} title="Video won't load? Skip it." onClick={() => act("skip")}>
              Skip ⏭
            </button>
          </div>
        )}
        {s.state === "reveal" && (
          <div
            className="sticky bottom-0 z-20 -mx-6 flex flex-col gap-2 bg-night/95 px-6 py-3 backdrop-blur lg:static lg:mx-0 lg:bg-transparent lg:px-0 lg:py-0 lg:backdrop-blur-0"
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
          >
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
        {!fullscreen && <HostPlayerPanel state={state} onStatus={handleAnswerStatus} />}
        <MiniScores scores={state.scores} />
      </div>
    </section>
  );
}
