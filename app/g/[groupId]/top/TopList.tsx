"use client";
import { useState } from "react";
import Avatar from "@/components/Avatar";
import EmbedPlayer from "@/components/EmbedPlayer";

type Item = { id: string; platform: string; sourceUrl: string; embedUrl: string; avg: number; count: number; playedAt: string | null; sender: string; senderColor: string };
const PLATFORM = { tiktok: "🎵 TikTok", instagram: "📸 Instagram", facebook: "📘 Facebook" } as Record<string, string>;

export default function TopList({ items }: { items: Item[] }) {
  const [open, setOpen] = useState<Item | null>(null);
  if (!items.length)
    return (
      <div className="card mt-8 text-center">
        <p className="text-5xl">🎬</p>
        <p className="mt-2 font-display text-xl">No rated videos yet. Open the box first!</p>
      </div>
    );
  return (
    <>
      <ol className="mt-6 space-y-3">
        {items.map((v, i) => (
          <li key={v.id}>
            <button onClick={() => setOpen(v)} className="card flex w-full items-center gap-4 p-4 text-left transition hover:-translate-y-0.5">
              <span className="w-12 text-center font-display text-3xl">{["🥇", "🥈", "🥉"][i] || <span className="text-white/60">{i + 1}</span>}</span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-lg">{PLATFORM[v.platform] || v.platform}</p>
                <p className="flex items-center gap-2 text-sm text-white/70">
                  <Avatar name={v.sender} color={v.senderColor} size={22} /> sent by {v.sender}
                  {v.playedAt && <span className="text-white/40">· {new Date(v.playedAt).toLocaleDateString()}</span>}
                </p>
              </div>
              <div className="text-right">
                <p className="font-display text-3xl text-sunny">⭐ {v.avg.toFixed(1)}</p>
                <p className="text-xs text-white/50">{v.count} ratings</p>
              </div>
              <span className="btn btn-sky btn-sm hidden sm:inline-flex">▶ Watch</span>
            </button>
          </li>
        ))}
      </ol>
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-4" onClick={() => setOpen(null)}>
          <div onClick={(e) => e.stopPropagation()} className="flex flex-col items-center">
            <EmbedPlayer embedUrl={open.embedUrl} platform={open.platform} sourceUrl={open.sourceUrl} />
            <button className="btn btn-yellow mt-4" onClick={() => setOpen(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
