"use client";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import confetti from "canvas-confetti";
import Avatar from "./Avatar";
import { isMuted, playDrumroll, playFanfare, setMuted, stopSfx } from "@/lib/sfx";

type P = { id: string; name: string; color: string };

// The whole reveal is about 4 seconds: a slot-machine reel (~2.3s), then the winner (~1.7s).
const STEPS = 16; // how many names the slot reel flips through
const BOOM_MS = 1700; // how long the winner screen stays up before the results panel

/** Delay before flip i: fast at first, easing off so the last name lands with a little suspense. */
const delayFor = (i: number) => 60 + 320 * (i / (STEPS - 1)) ** 3;
const REEL_MS = Array.from({ length: STEPS }, (_, i) => delayFor(i)).reduce((a, b) => a + b, 0);

/** Phones hold their own reveal back this long so they don't spoil the big screen. */
export const REVEAL_SUSPENSE_MS = REEL_MS;

export default function GrandReveal({
  players,
  sender,
  rating,
  onDone,
}: {
  players: P[];
  sender: { id: string | null; name: string; color: string | null };
  rating?: number | null;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<"reel" | "boom">("reel");
  const [step, setStep] = useState(0);
  const [muted, setMutedState] = useState(false);
  useEffect(() => setMutedState(isMuted()), []);

  // The parent re-renders on every poll, so keep the latest callback in a ref and freeze the reel at mount.
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  // The reel flips through the roster and always lands on the real sender.
  const [{ winner, reel }] = useState(() => {
    const w: P = players.find((p) => p.id === sender.id) || { id: "?", name: sender.name, color: sender.color || "#B07CFF" };
    const pool = players.length ? players : [w];
    const seq: P[] = [];
    for (let i = 0; i < STEPS - 1; i++) {
      let pick = pool[Math.floor(Math.random() * pool.length)];
      if (pool.length > 1) while (seq.length && pick.id === seq[seq.length - 1].id) pick = pool[Math.floor(Math.random() * pool.length)];
      seq.push(pick);
    }
    seq.push(w);
    return { winner: w, reel: seq };
  });

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let alive = true;
    playDrumroll(REEL_MS);
    let at = 0;
    for (let i = 0; i < STEPS; i++) {
      const idx = i;
      timers.push(setTimeout(() => alive && setStep(idx), at));
      at += delayFor(i);
    }
    timers.push(setTimeout(() => alive && setPhase("boom"), at));
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
      stopSfx();
    };
  }, []);

  // The big moment
  useEffect(() => {
    if (phase !== "boom") return;
    playFanfare();
    const colors = ["#FF4FA3", "#FFD23F", "#3DDC97", "#3FC1FF", "#B07CFF", "#FF8A3D"];
    const shoot = (x: number, angle: number) => confetti({ particleCount: 90, spread: 70, startVelocity: 55, angle, origin: { x, y: 0.75 }, colors });
    shoot(0, 60);
    shoot(1, 120);
    const t1 = setTimeout(() => confetti({ particleCount: 160, spread: 360, startVelocity: 35, origin: { x: 0.5, y: 0.35 }, colors }), 300);
    const t2 = setTimeout(() => {
      shoot(0, 60);
      shoot(1, 120);
    }, 700);
    const done = setTimeout(() => doneRef.current(), BOOM_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(done);
    };
  }, [phase]);

  const current = reel[Math.min(step, reel.length - 1)];

  return (
    <div className="fixed inset-0 z-[60] flex cursor-pointer flex-col items-center justify-center overflow-hidden bg-[#120a24]" onClick={() => doneRef.current()}>
      {/* spotlight rays */}
      <motion.div
        className="pointer-events-none absolute left-1/2 top-1/2 h-[220vmax] w-[220vmax] -translate-x-1/2 -translate-y-1/2 opacity-40"
        style={{ background: "conic-gradient(from 0deg, transparent 0 8%, rgba(255,210,63,0.35) 10%, transparent 12% 20%, rgba(255,79,163,0.35) 22%, transparent 24% 32%, rgba(63,193,255,0.35) 34%, transparent 36% 44%, rgba(255,210,63,0.35) 46%, transparent 48% 56%, rgba(255,79,163,0.35) 58%, transparent 60% 68%, rgba(63,193,255,0.35) 70%, transparent 72% 80%, rgba(61,220,151,0.3) 82%, transparent 84% 100%)" }}
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: phase === "boom" ? 14 : 8, ease: "linear" }}
      />
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(circle at center, rgba(18,10,36,0) 25%, rgba(18,10,36,0.9) 85%)" }} />

      <div className="absolute right-4 top-4 z-10 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <button
          className="btn btn-ghost btn-sm"
          title={muted ? "Sound off" : "Sound on"}
          onClick={() => {
            setMuted(!muted);
            setMutedState(!muted);
          }}
        >
          {muted ? "🔇" : "🔊"}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => doneRef.current()}>
          Skip ›
        </button>
      </div>

      <div className="relative z-10 flex flex-col items-center px-6 text-center">
        <AnimatePresence mode="wait">
          {phase === "reel" && (
            <motion.div key="reel" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.1 }} className="flex flex-col items-center">
              <p className="title text-4xl text-white/80 sm:text-5xl">And this video was sent by…</p>
              <div className="relative mt-8 flex h-[19rem] w-[19rem] items-center justify-center rounded-[2.5rem] border-8 border-night bg-black/40 shadow-chunky sm:h-[22rem] sm:w-[22rem]">
                <motion.div key={step} initial={{ y: -40, opacity: 0.2, scale: 0.9 }} animate={{ y: 0, opacity: 1, scale: 1 }} transition={{ duration: 0.09 }} className="flex flex-col items-center gap-4">
                  <Avatar name={current.name} color={current.color} size={150} />
                  <p className="title text-4xl sm:text-5xl">{current.name}</p>
                </motion.div>
              </div>
              <motion.p animate={{ opacity: [1, 0.4, 1] }} transition={{ repeat: Infinity, duration: 0.6 }} className="mt-6 font-display text-2xl text-sunny">
                🥁 🥁 🥁
              </motion.p>
            </motion.div>
          )}

          {phase === "boom" && (
            <motion.div key="boom" className="flex flex-col items-center">
              <motion.div className="pointer-events-none fixed inset-0 bg-white" initial={{ opacity: 0.95 }} animate={{ opacity: 0 }} transition={{ duration: 0.7 }} />
              <motion.p initial={{ y: -30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15 }} className="font-display text-3xl uppercase tracking-[0.4em] text-white/80">
                Sent by
              </motion.p>
              <motion.div initial={{ scale: 0, rotate: -25 }} animate={{ scale: [0, 1.35, 1], rotate: [-25, 8, 0] }} transition={{ duration: 0.7, ease: "easeOut" }} className="mt-6">
                <Avatar name={winner.name} color={winner.color} size={230} ring />
              </motion.div>
              <motion.p
                initial={{ scale: 0.3, opacity: 0 }}
                animate={{ scale: [0.3, 1.2, 1], opacity: 1 }}
                transition={{ delay: 0.35, duration: 0.6 }}
                className="title mt-6 text-7xl text-sunny drop-shadow-[0_6px_0_rgba(0,0,0,0.5)] sm:text-9xl"
              >
                {winner.name}!
              </motion.p>
              {rating != null && (
                <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.8 }} className="mt-6 rounded-full bg-black/40 px-6 py-2 font-display text-3xl">
                  ⭐ {Number(rating).toFixed(1)} <span className="text-xl text-white/60">/ 10</span>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
