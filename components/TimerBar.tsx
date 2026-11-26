"use client";
import { useEffect, useState } from "react";

/** The thin story-style progress bar over the fullscreen video. Ticks its own 250ms clock — see LiveCountdown. */
export default function TimerBar({
  remainingMs,
  fetchedAt,
  totalSeconds,
  active,
}: {
  remainingMs: number | undefined;
  fetchedAt: number;
  totalSeconds: number;
  active: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [active]);
  const ms = active && remainingMs != null ? Math.max(0, remainingMs - (now - fetchedAt)) : 0;
  const pct = totalSeconds > 0 ? Math.max(0, Math.min(100, (ms / (totalSeconds * 1000)) * 100)) : 0;
  const color = ms <= 15000 ? "#FF5E5E" : ms <= 45000 ? "#FFD23F" : "#3DDC97";
  return (
    <div className="mx-2 mt-2 h-1 overflow-hidden rounded-full bg-white/25">
      <div className="h-full rounded-full transition-[width] duration-300 ease-linear" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}
