"use client";
import { useEffect, useState } from "react";
import Countdown from "./Countdown";

/**
 * Wraps the (purely presentational) `Countdown` ring with its own ticker, instead of the caller re-rendering
 * that often to recompute a "remaining" number itself. Ticks once a second — not every 250ms — scheduled to
 * land exactly when the displayed number is due to change rather than at a fixed 1000ms cadence from mount,
 * so it never lags behind. `Countdown`'s own transition is stretched to match that cadence, so the ring still
 * eases continuously between ticks instead of visibly jumping once a second. One render a second instead of
 * four matters here: it's one more re-encoded frame the phone has to produce for AirPlay/screen mirroring.
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
    if (!active || remainingMs == null) return;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      const msLeft = Math.max(0, remainingMs - (Date.now() - fetchedAt));
      setNow(Date.now());
      if (msLeft <= 0) return;
      t = setTimeout(tick, (msLeft % 1000) || 1000);
    };
    tick();
    return () => clearTimeout(t);
  }, [active, remainingMs, fetchedAt]);
  const ms = active && remainingMs != null ? Math.max(0, remainingMs - (now - fetchedAt)) : 0;
  return <Countdown ms={ms} total={total} size={size} />;
}
