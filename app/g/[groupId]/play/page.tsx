"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useGameState, type GameState } from "@/components/useGameState";
import { useSeat } from "@/components/useSeat";
import { useWakeLock } from "@/components/useWakeLock";
import { enterNativeFullscreen, exitNativeFullscreen, scrollToTop } from "@/lib/fullscreen";
import { unlockAudio } from "@/lib/sfx";
import HostHeader from "@/components/host/HostHeader";
import LobbyView from "@/components/host/LobbyView";
import PausedView from "@/components/host/PausedView";
import StageView from "@/components/host/StageView";
import Finale from "@/components/host/Finale";

// The grand-reveal slot machine (plus its confetti/sound effects) is only ever needed once per video, well
// after the page has loaded, so it's loaded on first use instead of sitting in the page's initial bundle.
const GrandReveal = dynamic(() => import("@/components/GrandReveal"), { ssr: false });
const AwardsCeremony = dynamic(() => import("@/components/host/AwardsCeremony"), { ssr: false });

function HostInner({ groupId }: { groupId: string }) {
  const router = useRouter();
  const sessionId = useSearchParams().get("session");
  // Widens to a 5s poll once the realtime broadcast channel is confirmed live (a nudge gets here faster
  // anyway) and drops straight back to 2s the instant it isn't — see useGameState's own comment.
  const { state, error, refresh, fetchedAt, reconnecting, applyState } = useGameState({ sessionId }, 2000, 5000);
  // GrandReveal's chunk (plus framer-motion/confetti/sfx) would otherwise only start downloading the first
  // time a reveal actually happens — right when the host most wants it to show up instantly. This is the
  // exact dynamic import `GrandReveal` (below) itself uses, so by the time that one actually runs it just
  // resolves from the already-fetched/cached chunk instead of starting a fresh network request.
  useEffect(() => {
    import("@/components/GrandReveal");
    import("@/components/host/AwardsCeremony");
  }, []);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [reloadN, setReloadN] = useState(0); // bumped to remount the video iframe ("Reload video")
  const [origin, setOrigin] = useState("");
  const [wantFull, setWantFull] = useState(true); // moderator can opt out of fullscreen for a video
  const [finishPending, setFinishPending] = useState(false); // "Finished" clicked mid-video: reveal it, then wrap up
  useEffect(() => setOrigin(window.location.origin), []);

  const s = state?.session;
  // Called once for the whole host page (not inside HostPlayerPanel, which renders in up to three different
  // spots across lobby/stage/fullscreen) so switching between those spots never re-runs the seat's own
  // join-verification request or drops a half-made rating/guess.
  const seatApi = useSeat(s?.code ?? null);
  useWakeLock(!!s && s.state !== "finished");

  // Instant "Next": the upcoming video is already sitting preloaded in a hidden slot (see EmbedPlayer), so
  // there's no technical reason the moderator has to watch a full action request *and then* a poll finish
  // before anything visibly happens. Set the instant the tap fires (inside `act`, below), cleared automatically
  // once the real poll genuinely reaches that index, or rolled back immediately if the action fails (someone
  // else already moved on, a dropped connection, a real server error). Everything below that reads game state
  // for what to actually render uses `view`/`vs` (state with this overlaid on top, when present) instead of
  // the raw `state`/`s` — the two effects further down that must react to real server transitions (the grand
  // reveal trigger, the end-of-timer poke) are the deliberate exception, and keep reading raw `s`.
  const [pendingNext, setPendingNext] = useState<{ index: number; video: NonNullable<GameState["upNext"]>; at: number } | null>(null);
  useEffect(() => {
    if (pendingNext && s && s.index >= pendingNext.index) setPendingNext(null);
  }, [pendingNext, s?.index]);
  // Safety net: if the real poll never catches up for some reason (a server hiccup that still returned ok,
  // a dropped realtime nudge), don't leave the stage showing a guess forever.
  useEffect(() => {
    if (!pendingNext) return;
    const t = setTimeout(() => setPendingNext(null), 6000);
    return () => clearTimeout(t);
  }, [pendingNext]);
  const view = useMemo<GameState | null>(() => {
    if (!state || !pendingNext || !s || s.index >= pendingNext.index) return state;
    const nv = pendingNext.video;
    return {
      ...state,
      session: { ...state.session, index: pendingNext.index, state: "playing", paused: false, remainingMs: state.session.windowSeconds * 1000 },
      video: { id: nv.id, platform: nv.platform, embedUrl: nv.embedUrl, sourceUrl: nv.sourceUrl, aspect: nv.aspect, blocked: nv.blocked, directUrl: nv.directUrl },
      upNext: null, // not known yet — filled back in by the next real poll
      reveal: null,
      answered: 0,
      players: state.players.map((p) => ({ ...p, answered: false })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, pendingNext, s?.index]);
  const vs = view?.session;

  // Fullscreen while a video is playing; back to the window view at the reveal (or when paused).
  const fullscreen = !!(vs && vs.state === "playing" && !vs.paused && view?.video && wantFull);
  useEffect(() => {
    if (!fullscreen) exitNativeFullscreen();
  }, [fullscreen, vs?.state, vs?.paused]);
  // Each new video starts fullscreen again
  useEffect(() => {
    setWantFull(true);
    setFinishPending(false);
  }, [vs?.index]);

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

  // Poke the server once right after the window should run out (it re-checks the time itself), scheduled
  // directly off the server snapshot instead of a locally-ticking value — so this effect (and HostInner)
  // only re-runs once per poll, not four times a second. Re-armed on every snapshot and cleared on
  // unmount/re-run, so a fast state change can't leave a stray poke scheduled for later.
  const pokedFor = useRef<number>(-1);
  useEffect(() => {
    if (!s || s.state !== "playing" || s.paused || pokedFor.current === s.index) return;
    const msLeft = s.remainingMs - (Date.now() - fetchedAt);
    const t = setTimeout(
      () => {
        pokedFor.current = s.index;
        refresh();
      },
      Math.max(0, msLeft) + 400,
    );
    return () => clearTimeout(t);
  }, [s?.remainingMs, fetchedAt, s?.state, s?.paused, s?.index, refresh]);

  /** Returns whether the action actually succeeded, so callers (e.g. "pause & exit") can decide what to do next. */
  async function act(action: string, extra: Record<string, unknown> = {}): Promise<boolean> {
    // Every call here starts synchronously from a real tap (every caller is a button onClick), which is
    // iOS Safari's only window to create/resume an AudioContext — by the time the grand reveal actually wants
    // to play its fanfare a few seconds later (sometimes with no tap at all, when the timer just runs out),
    // that window has long closed and the reveal would otherwise be silent on an iPhone host. Keeping the
    // context already running across every Next/Reveal/etc. tap covers the untapped auto-reveal case too.
    unlockAudio();
    // Starting a video is the moderator's "play": go fullscreen right inside this click
    // (browsers only allow it during a user gesture, so it has to happen before any await).
    if (action === "begin" || action === "next" || (action === "resume" && s?.state === "playing")) {
      // The Next button sits below the video, so the page may be scrolled. Bring it back to the top first: on phones a
      // scrolled page behind the full-screen stage makes taps inside the video land in the wrong place.
      scrollToTop();
      enterNativeFullscreen();
    }
    // See the `pendingNext` effects above — show the already-preloaded next video immediately rather than
    // waiting for this request (and then a poll) to confirm what we're already looking at anyway.
    if (action === "next" && state?.upNext && s) setPendingNext({ index: s.index + 1, video: state.upNext, at: Date.now() });
    setBusy(true);
    setActionErr(null);
    try {
      // next/skip/reveal carry the index the host screen was looking at, so a double-tap (or two moderators on
      // the same screen) can't advance past a video twice: the server rejects it if the game already moved on.
      const payload: Record<string, unknown> = { sessionId, action, ...extra };
      if (s && (action === "next" || action === "skip" || action === "reveal")) payload.expectIndex = s.index;
      const res = await fetch("/api/session/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionErr(d.error || "Something went wrong");
        if (action === "next") setPendingNext(null); // guess was wrong (or the request failed) — fall back to what's real
        await refresh();
        return false;
      }
      // The action route already computed and returned the resulting state server-side — apply it directly
      // instead of immediately firing a second request (a plain refresh()) to ask for the exact same thing.
      if (d.state) applyState(d.state);
      else await refresh();
      return true;
    } catch {
      setActionErr("Couldn't reach the server — check your connection and try again");
      if (action === "next") setPendingNext(null);
      await refresh();
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function pauseAndExit() {
    const ok = await act("pause");
    if (ok) router.push(`/g/${groupId}`); // if the pause itself failed, stay put rather than walk away from a game that's still running
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

  function endGame() {
    if (confirm("Close this game? Nothing has been played yet, so all videos stay in the box.")) act("end");
  }

  function kick(playerId: string, name: string) {
    if (confirm(`Remove ${name} from this game? (frees the name for another phone)`)) act("kick", { playerId });
  }

  if (!sessionId)
    return (
      <Centered>
        Missing session.{" "}
        <Link href={`/g/${groupId}`} className="underline">
          Back
        </Link>
      </Centered>
    );
  if (error && !state) return <Centered>{error}</Centered>;
  if (!state || !s) return <Centered>Opening the box…</Centered>;

  // `gs`/`gvs`: `state`/`s` with the optimistic "Next" overlay applied, when there is one (see `view` above).
  // By construction `view` is only ever null when `state` is, which was just ruled out, so this is purely to
  // satisfy the type-checker, not a real fallback branch.
  const gs = view ?? state;
  const gvs = gs.session;
  // TimerBar/LiveCountdown extrapolate the time left from `remainingMs` as of `fetchedAt` — while the
  // optimistic overlay above is active, that has to be "now" (the full window just started, from the stage's
  // point of view), not whenever the last real poll actually landed, or the timer would appear to jump
  // straight to having already ticked down.
  const effectiveFetchedAt = gs !== state && pendingNext ? pendingNext.at : fetchedAt;
  const joinUrl = `${origin}/join?code=${s.code}`;
  // After the last video: the awards, one at a time, before the final scoreboard (see AwardsCeremony).
  const inCeremony = s.state === "finished" && !!state.finale?.awards?.length && s.awardsStep < state.finale.awards.length;

  return (
    <main className="flex min-h-screen flex-col">
      <HostHeader groupId={groupId} state={gs} origin={origin} busy={busy} reconnecting={reconnecting} onPauseExit={pauseAndExit} onEnd={endGame} onFinish={finishGame} />
      {actionErr && <p className="mx-6 rounded-xl bg-[#FF5E5E]/20 p-2 text-center text-[#FFB3B3]">{actionErr}</p>}

      {gvs.state === "lobby" && <LobbyView state={gs} joinUrl={joinUrl} busy={busy} seatApi={seatApi} onBegin={() => act("begin")} onKick={kick} />}

      {gvs.paused && gvs.state !== "finished" && <PausedView groupId={groupId} index={gvs.index} total={gvs.total} busy={busy} onResume={() => act("resume")} />}

      {!gvs.paused && (gvs.state === "playing" || gvs.state === "reveal") && gs.video && (
        <StageView
          state={gs}
          fetchedAt={effectiveFetchedAt}
          fullscreen={fullscreen}
          setWantFull={setWantFull}
          reloadN={reloadN}
          setReloadN={setReloadN}
          busy={busy}
          grandOpen={grandOpen}
          grandFor={grandFor}
          finishPending={finishPending}
          seatApi={seatApi}
          act={act}
          onPauseExit={pauseAndExit}
          finishGame={finishGame}
        />
      )}

      {s.state === "finished" && inCeremony && (
        <AwardsCeremony
          awards={state.finale!.awards}
          step={s.awardsStep}
          busy={busy}
          onNext={(step) => act("award_next", { expectStep: step })}
          onSkip={() => act("award_skip")}
        />
      )}
      {s.state === "finished" && !inCeremony && <Finale state={state} groupId={groupId} />}

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
