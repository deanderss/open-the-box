"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useGameState } from "@/components/useGameState";
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

function HostInner({ groupId }: { groupId: string }) {
  const router = useRouter();
  const sessionId = useSearchParams().get("session");
  const { state, error, refresh, fetchedAt, reconnecting } = useGameState({ sessionId }, 2000);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [reloadN, setReloadN] = useState(0); // bumped to remount the video iframe ("Reload video")
  const [origin, setOrigin] = useState("");
  const [wantFull, setWantFull] = useState(true); // moderator can opt out of fullscreen for a video
  const [finishPending, setFinishPending] = useState(false); // "Finished" clicked mid-video: reveal it, then wrap up
  useEffect(() => setOrigin(window.location.origin), []);

  const s = state?.session;
  useWakeLock(!!s && s.state !== "finished");

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
  async function act(action: string, extra: Record<string, string> = {}): Promise<boolean> {
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
        return false;
      }
      return true;
    } catch {
      setActionErr("Couldn't reach the server — check your connection and try again");
      return false;
    } finally {
      // Always refresh and always clear busy, even if the request never made it out (offline, timeout, etc.)
      await refresh();
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

  const joinUrl = `${origin}/join?code=${s.code}`;

  return (
    <main className="flex min-h-screen flex-col">
      <HostHeader groupId={groupId} state={state} origin={origin} busy={busy} reconnecting={reconnecting} onPauseExit={pauseAndExit} onEnd={endGame} onFinish={finishGame} />
      {actionErr && <p className="mx-6 rounded-xl bg-[#FF5E5E]/20 p-2 text-center text-[#FFB3B3]">{actionErr}</p>}

      {s.state === "lobby" && <LobbyView state={state} joinUrl={joinUrl} busy={busy} onBegin={() => act("begin")} onKick={kick} />}

      {s.paused && s.state !== "finished" && <PausedView groupId={groupId} index={s.index} total={s.total} busy={busy} onResume={() => act("resume")} />}

      {!s.paused && (s.state === "playing" || s.state === "reveal") && state.video && (
        <StageView
          state={state}
          fetchedAt={fetchedAt}
          fullscreen={fullscreen}
          setWantFull={setWantFull}
          reloadN={reloadN}
          setReloadN={setReloadN}
          busy={busy}
          grandOpen={grandOpen}
          grandFor={grandFor}
          finishPending={finishPending}
          act={act}
          onPauseExit={pauseAndExit}
          finishGame={finishGame}
        />
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
