"use client";
import { useEffect, useRef, useState } from "react";

/**
 * The thin story-style progress bar over the fullscreen video. Animates as a CSS `transform` the browser's
 * compositor drives frame to frame, instead of re-rendering a `width` percentage on a 250ms ticker — one
 * continuous animation set up once per poll rather than ~4 state updates a second, which matters when
 * AirPlay or screen mirroring also has to re-encode every one of those frames. The colour (green/yellow/red)
 * only changes twice over a video's life, so those two moments are scheduled directly instead of polling for them.
 */
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
  const barRef = useRef<HTMLDivElement>(null);
  const [color, setColor] = useState("#3DDC97");

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const colorFor = (ms: number) => (ms <= 15000 ? "#FF5E5E" : ms <= 45000 ? "#FFD23F" : "#3DDC97");

    if (!active || remainingMs == null || totalSeconds <= 0) {
      bar.style.setProperty("transition", "none", "important");
      bar.style.transform = "scaleX(0)";
      setColor(colorFor(0));
      return;
    }

    const msLeft = Math.max(0, remainingMs - (Date.now() - fetchedAt));
    const frac = Math.max(0, Math.min(1, msLeft / (totalSeconds * 1000)));
    setColor(colorFor(msLeft));

    // Jump to the current fraction with no transition, force the browser to commit it, then switch the
    // transition back on and set the target: one linear animation all the way to empty over however long is
    // actually left, instead of a new style every 250ms.
    bar.style.setProperty("transition", "none", "important");
    bar.style.transform = `scaleX(${frac})`;
    void bar.offsetWidth; // flush the "none" transition before re-enabling it below
    // `important` so the global Reduce Motion rule (globals.css) can't shrink this to 0.01ms: the bar is the
    // game's clock, not decoration, and with that rule it emptied instantly the moment each video started.
    bar.style.setProperty("transition", `transform ${msLeft}ms linear`, "important");
    bar.style.transform = "scaleX(0)";

    const timers: ReturnType<typeof setTimeout>[] = [];
    if (msLeft > 45000) timers.push(setTimeout(() => setColor("#FFD23F"), msLeft - 45000));
    if (msLeft > 15000) timers.push(setTimeout(() => setColor("#FF5E5E"), msLeft - 15000));
    return () => timers.forEach(clearTimeout);
  }, [active, remainingMs, fetchedAt, totalSeconds]);

  return (
    <div className="mx-2 mt-2 h-1 overflow-hidden rounded-full bg-white/25">
      <div ref={barRef} className="h-full w-full origin-left rounded-full" style={{ background: color }} />
    </div>
  );
}
