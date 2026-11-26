"use client";
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
                  <button className="btn btn-sky btn-sm" disabled={busy} title="Freeze the game and leave" onClick={onPauseExit}>
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
  );
}
