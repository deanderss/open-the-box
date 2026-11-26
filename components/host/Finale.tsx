"use client";
import { useEffect } from "react";
import Link from "next/link";
import { fireConfetti } from "@/lib/confetti";
import Avatar from "@/components/Avatar";
import type { GameState } from "@/components/useGameState";
import { fmtPoints } from "@/lib/points";

export default function Finale({ state, groupId }: { state: GameState; groupId: string }) {
  useEffect(() => {
    const end = Date.now() + 1500;
    const t = setInterval(() => {
      if (Date.now() > end) return clearInterval(t);
      fireConfetti({ particleCount: 40, spread: 100, origin: { x: Math.random(), y: 0.2 } });
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
