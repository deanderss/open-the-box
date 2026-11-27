"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import Avatar from "@/components/Avatar";
import LiveCountdown from "@/components/LiveCountdown";
import TimerBar from "@/components/TimerBar";
import EmbedPlayer from "@/components/EmbedPlayer";
import HostPlayerPanel from "@/components/HostPlayerPanel";
import type { useSeat } from "@/components/useSeat";
import type { GameState } from "@/components/useGameState";
import { enterNativeFullscreen } from "@/lib/fullscreen";
import RevealPanel from "./RevealPanel";
import MiniScores from "./MiniScores";

export default function StageView({
  state,
  fetchedAt,
  fullscreen,
  setWantFull,
  reloadN,
  setReloadN,
  busy,
  grandOpen,
  grandFor,
  finishPending,
  seatApi,
  act,
  onPauseExit,
  finishGame,
}: {
  state: GameState;
  fetchedAt: number;
  fullscreen: boolean;
  setWantFull: (v: boolean) => void;
  reloadN: number;
  setReloadN: (fn: (n: number) => number) => void;
  busy: boolean;
  grandOpen: boolean;
  grandFor: number | null;
  finishPending: boolean;
  seatApi: ReturnType<typeof useSeat>;
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

  // Skip deletes every answer already locked in for this video — fine as an "it won't load, move on" escape
  // hatch, risky as a slip of the thumb right next to Reveal now. Only interrupt with a confirm when there's
  // actually something to lose.
  const handleSkip = useCallback(() => {
    if (state.answered > 0 && typeof window !== "undefined") {
      const noun = state.answered === 1 ? "person has" : "people have";
      if (!window.confirm(`Skip this video? ${state.answered} ${noun} already answered — those answers will be lost.`)) return;
    }
    act("skip");
  }, [act, state.answered]);

  // StageView re-renders on every real state change (a lock-in, busy toggling, the menu opening), and an
  // inline `overlay={(visible) => ...}` prop would get a brand new identity every single one of those —
  // defeating EmbedPlayer's React.memo and forcing it to fully re-render even though nothing it actually
  // cares about changed. useCallback keeps the same function identity across renders where none of these
  // specific inputs changed.
  const renderOverlay = useCallback(
    (visible: boolean) => (
      <div className="text-white">
        <TimerBar remainingMs={s.remainingMs} fetchedAt={fetchedAt} totalSeconds={s.windowSeconds} active={s.state === "playing"} />
        {/* The timer bar and this small countdown stay up for the whole video — everything else here
            (the "locked in" count and the action buttons) fades out after a few seconds of no touches,
            and back in on a tap (see EmbedPlayer's `overlayVisible`), so there's less for screen
            mirroring/AirPlay to keep re-encoding while nobody's actually looking at the controls. */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-2">
          <div className="flex items-center gap-3 drop-shadow">
            <LiveCountdown remainingMs={s.remainingMs} fetchedAt={fetchedAt} total={s.windowSeconds} active={s.state === "playing"} size={40} />
            {visible && (
              <span className="font-display text-base">
                <span className="text-mint">{state.answered}</span>
                <span className="text-white/70"> / {state.eligible} locked in</span>
              </span>
            )}
          </div>
          <div
            className={`flex flex-wrap items-center justify-end gap-1.5 transition-opacity duration-200 ${visible ? "opacity-100" : "pointer-events-none opacity-0"}`}
            aria-hidden={!visible}
          >
            <button className="btn btn-pink btn-sm" disabled={busy} tabIndex={visible ? undefined : -1} onClick={() => act("reveal")}>
              Reveal now
            </button>
            {answerStatus.visible && (
              <button className="btn btn-yellow btn-sm" tabIndex={visible ? undefined : -1} onClick={() => setAnswerOpen(true)}>
                📝 Answer
              </button>
            )}
            {/* Skip / Reload / Pause: full buttons from sm up, folded into "More" below that so the
                bar doesn't wrap onto three lines on a phone. */}
            <div className="hidden items-center gap-1.5 sm:flex">
              <button className="btn btn-ghost btn-sm" disabled={busy} tabIndex={visible ? undefined : -1} title="Video won't load? Skip it." onClick={handleSkip}>
                Skip <span aria-hidden>⏭</span>
              </button>
              <button className="btn btn-ghost btn-sm" tabIndex={visible ? undefined : -1} title="Video stuck or black? Reload it (the timer keeps running)." aria-label="Reload video" onClick={() => setReloadN((n) => n + 1)}>
                <span aria-hidden>↻</span>
              </button>
              <button className="btn btn-sky btn-sm" disabled={busy} tabIndex={visible ? undefined : -1} title="Freeze the game and leave" aria-label="Pause and exit" onClick={onPauseExit}>
                <span aria-hidden>⏸</span>
              </button>
            </div>
            <div className="relative sm:hidden">
              <button
                className="btn btn-ghost btn-sm"
                tabIndex={visible ? undefined : -1}
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
                      handleSkip();
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
            <button className="btn btn-ghost btn-sm" tabIndex={visible ? undefined : -1} title="Back to the window view" onClick={() => setWantFull(false)}>
              <span aria-hidden>⤡</span> Exit
            </button>
          </div>
        </div>
      </div>
    ),
    [s.remainingMs, fetchedAt, s.windowSeconds, s.state, state.answered, state.eligible, busy, answerStatus.visible, moreOpen, act, handleSkip, setReloadN, onPauseExit, setWantFull]
  );

  // `state.upNext` is a freshly-parsed object on every poll response even when nothing about it actually
  // changed, which would otherwise give EmbedPlayer's `next` prop a new identity every ~2s and help defeat
  // its memo() the same way the inline overlay did. Only produce a new reference when the fields EmbedPlayer
  // actually reads from it change.
  const upNextKeyParts = state.upNext
    ? [state.upNext.embedUrl, state.upNext.directUrl ?? "", state.upNext.blocked ?? "", state.upNext.aspect ?? ""]
    : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nextMedia = useMemo(() => state.upNext, upNextKeyParts ? [upNextKeyParts.join("|")] : [null]);

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
          directUrl={state.video.directUrl}
          next={nextMedia}
          fullscreen={fullscreen}
          pinOverlay={answerOpen || moreOpen}
          overlay={renderOverlay}
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
            <HostPlayerPanel state={state} seatApi={seatApi} onStatus={handleAnswerStatus} />
          </div>
        )}
      </div>
      {/* Entirely covered by the fullscreen video (`fixed inset-0 z-50` in EmbedPlayer) the moment it's up —
          `fullscreen` is only ever true during "playing" anyway, so nothing here is reachable UI at that
          point (the overlay + the fullscreen Answer sheet already duplicate the one or two things that
          matter). Unmounted instead of just visually hidden so none of its own polling-driven re-renders or
          animations (MiniScores, the avatar "pop" on answering) keep running behind the video for nothing. */}
      {!fullscreen && (
        <div className="flex flex-col gap-4">
          {s.state === "playing" ? (
            // card-flat, not card: no backdrop-blur while a video is actually playing — one less thing behind
            // this panel that has to be re-blurred every frame for screen mirroring/AirPlay to re-encode.
            <div className="card-flat flex flex-col items-center gap-4">
              <p className="title text-2xl">Rate it &amp; guess who sent it!</p>
              <LiveCountdown remainingMs={s.remainingMs} fetchedAt={fetchedAt} total={s.windowSeconds} active={s.state === "playing"} size={150} />
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
            // No backdrop-blur here either, same reason as card-flat above — this bar sits over the video for
            // the whole clip.
            <div
              className="sticky bottom-0 z-20 -mx-6 flex gap-2 bg-night/95 px-6 py-3 lg:static lg:mx-0 lg:bg-transparent lg:px-0 lg:py-0"
              style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
            >
              <button className="btn btn-pink flex-1" disabled={busy} onClick={() => act("reveal")}>
                Reveal now
              </button>
              <button className="btn btn-ghost" disabled={busy} title="Video won't load? Skip it." onClick={handleSkip}>
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
          <HostPlayerPanel state={state} seatApi={seatApi} onStatus={handleAnswerStatus} />
          <MiniScores scores={state.scores} />
        </div>
      )}
    </section>
  );
}
