import Link from "next/link";
import type { GameState } from "@/components/useGameState";

export default function HostHeader({
  groupId,
  state,
  origin,
  busy,
  onPauseExit,
  onEnd,
  onFinish,
}: {
  groupId: string;
  state: GameState;
  origin: string;
  busy: boolean;
  onPauseExit: () => void;
  onEnd: () => void;
  onFinish: () => void;
}) {
  const s = state.session;
  return (
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
          <button className="btn btn-sky btn-sm" disabled={busy} title="Freeze the game and leave. Come back and resume any time." onClick={onPauseExit}>
            ⏸ Pause &amp; exit
          </button>
        )}
        {s.state === "lobby" && (
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={onEnd}>
            End game
          </button>
        )}
        {(s.state === "playing" || s.state === "reveal") && (
          <button
            className="btn btn-mint btn-sm"
            disabled={busy}
            title="Wrap up on this video. Scores are shown as normal and the rest of the videos stay in the box for next time."
            onClick={onFinish}
          >
            {s.state === "playing" ? "✅ Finish after this video" : "✅ Finished"}
          </button>
        )}
      </div>
    </header>
  );
}
