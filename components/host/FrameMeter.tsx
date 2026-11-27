"use client";
// A tiny frame-drop readout for testing on the real phone: open the host screen with ?fps=1.
// "slow frames" = gaps over 25ms between animation frames; "long tasks" = the page hogging the main thread
// for 50ms or more. Drops here mean the app itself is the bottleneck; a clean meter with a choppy TV points
// at the Wi-Fi or the Apple TV instead.
import { useEffect, useState } from "react";

export default function FrameMeter() {
  const [stats, setStats] = useState({ fps: 0, slow: 0, longTasks: 0, worstMs: 0 });
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let frames = 0;
    let slow = 0;
    let longTasks = 0;
    let worst = 0;
    let winStart = last;
    const loop = (t: number) => {
      const gap = t - last;
      last = t;
      frames++;
      if (gap > 25) slow++;
      if (gap > worst) worst = gap;
      if (t - winStart >= 2000) {
        setStats({ fps: Math.round((frames * 1000) / (t - winStart)), slow, longTasks, worstMs: Math.round(worst) });
        frames = 0;
        slow = 0;
        longTasks = 0;
        worst = 0;
        winStart = t;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    let po: PerformanceObserver | null = null;
    try {
      po = new PerformanceObserver((list) => {
        longTasks += list.getEntries().length;
      });
      po.observe({ entryTypes: ["longtask"] });
    } catch {
      /* longtask isn't supported everywhere (Safari) */
    }
    return () => {
      cancelAnimationFrame(raf);
      po?.disconnect();
    };
  }, []);
  const bad = stats.slow > 3;
  return (
    <div className={`pointer-events-none fixed bottom-2 left-2 z-[100] rounded-lg px-2 py-1 font-mono text-xs text-white ${bad ? "bg-[#FF5E5E]/80" : "bg-black/70"}`}>
      {stats.fps} fps · {stats.slow} slow · worst {stats.worstMs}ms{stats.longTasks ? ` · ${stats.longTasks} long tasks` : ""}
    </div>
  );
}
