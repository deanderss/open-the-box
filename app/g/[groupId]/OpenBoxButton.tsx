"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Box from "@/components/Box";

type InProgress = { sessionId: string; paused: boolean; videoNumber: number; total: number } | null;

export default function OpenBoxButton({ groupId, count, inProgress }: { groupId: string; count: number; inProgress?: InProgress }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-center py-6">
      {inProgress && (
        <div className="mb-6 w-full max-w-md rounded-3xl border-2 border-sunny/50 bg-black/30 p-4 text-center">
          <p className="title text-2xl text-sunny">{inProgress.paused ? "⏸ Game paused" : "🎬 Game in progress"}</p>
          <p className="mt-1 text-white/70">
            Video {inProgress.videoNumber} of {inProgress.total}
            {inProgress.paused ? ". Your players are waiting on a paused screen." : ""}
          </p>
          <Link href={`/g/${groupId}/play?session=${inProgress.sessionId}`} className="btn btn-yellow mt-3 w-full text-xl">
            ▶ {inProgress.paused ? "Resume game" : "Rejoin game"}
          </Link>
        </div>
      )}
      <Box
        size={inProgress ? 220 : 300}
        count={count}
        disabled={count === 0 || !!inProgress}
        label={
          inProgress
            ? "Finish or resume the current game first"
            : count === 0
              ? "The box is empty. Share the link to collect videos!"
              : "Click the box to open it!"
        }
        onOpened={async () => {
          const res = await fetch("/api/session/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupId }) });
          const d = await res.json();
          if (!res.ok) return setErr(d.error);
          router.push(`/g/${groupId}/play?session=${d.sessionId}`);
        }}
      />
      {err && <p className="mt-3 text-[#FFB3B3]">{err}</p>}
    </div>
  );
}
