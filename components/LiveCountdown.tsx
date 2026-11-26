"use client";
import { useEffect, useState } from "react";
import Countdown from "./Countdown";

/**
 * Wraps the (purely presentational) `Countdown` ring with its own 250ms ticker, instead of the caller
 * re-rendering that often to recompute a "remaining" number itself. The parent only passes down the raw
 * server snapshot (`remainingMs` + the wall-clock time it was fetched at), which only changes once per
 * poll — so this is the only thing in the tree re-rendering 4 times a second.
 */
export default function LiveCountdown({
  remainingMs,
  fetchedAt,
  total,
  active,
  size = 120,
}: {
  remainingMs: number | undefined;
  fetchedAt: number;
  total: number;
  active: boolean;
  size?: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [active]);
  const ms = active && remainingMs != null ? Math.max(0, remainingMs - (now - fetchedAt)) : 0;
  return <Countdown ms={ms} total={total} size={size} />;
}
