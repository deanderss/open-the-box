"use client";
import { useRef } from "react";

export default function Countdown({ ms, total, size = 120 }: { ms: number; total: number; size?: number }) {
  const secs = Math.ceil(ms / 1000);
  const frac = total > 0 ? ms / (total * 1000) : 0;
  const r = 44;
  const c = 2 * Math.PI * r;
  const color = secs <= 15 ? "#FF5E5E" : secs <= 45 ? "#FFD23F" : "#3DDC97";

  // LiveCountdown only feeds a new `ms` about once a second now (not every 250ms), so a normal tick is eased
  // with a matching ~1s transition instead of snapping — it still reads as continuous motion. A bigger jump
  // (a new video starting, pause/resume, the timer resetting) snaps instantly instead of visibly "catching up".
  const prevMs = useRef(ms);
  const jumped = Math.abs(ms - prevMs.current) > 1300;
  prevMs.current = ms;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} className="-rotate-90">
        <circle cx="50" cy="50" r={r} stroke="rgba(255,255,255,0.15)" strokeWidth="10" fill="none" />
        <circle
          cx="50"
          cy="50"
          r={r}
          stroke={color}
          strokeWidth="10"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          style={{ transition: jumped ? "none" : "stroke-dashoffset 1s linear, stroke 0.3s" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center font-display font-bold" style={{ fontSize: size * 0.26, color }}>
        {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
      </div>
    </div>
  );
}
