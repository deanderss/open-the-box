"use client";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { fireConfetti } from "@/lib/confetti";
import Avatar from "./Avatar";
import { useShortScreen } from "./useShortScreen";
import { useSmoothTv } from "@/lib/smoothTv";
import { isMuted, playDrumroll, playFanfare, setMuted, stopSfx } from "@/lib/sfx";
import { REVEAL_STEPS as STEPS, revealDelayFor as delayFor, REVEAL_SUSPENSE_MS as REEL_MS } from "@/lib/revealTiming";

type P = { id: string; name: string; color: string };

const BOOM_MS = 2742; // how long the winner screen stays up before the results panel

/** The reel and the winner card both show one name at a huge size — long ones need to shrink to still fit on one line. */
function reelNameClass(name: string, short = false) {
  if (short) return name.length <= 10 ? "text-3xl" : name.length <= 16 ? "text-2xl" : "text-xl";
  if (name.length <= 10) return "text-4xl sm:text-5xl";
  if (name.length <= 16) return "text-3xl sm:text-4xl";
  return "text-2xl sm:text-3xl";
}
function bigNameClass(name: string, short = false) {
  if (short) return name.length <= 9 ? "text-6xl" : name.length <= 13 ? "text-5xl" : "text-4xl";
  if (name.length <= 6) return "text-7xl sm:text-9xl";
  if (name.length <= 9) return "text-6xl sm:text-8xl";
  if (name.length <= 13) return "text-5xl sm:text-7xl";
  return "text-4xl sm:text-5xl";
}
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
  // Smooth TV mode: a still spotlight, since a spinning full-screen gradient changes every pixel every frame.
  const [smoothTv] = useSmoothTv();
  // A phone turned sideways: smaller reel and winner so nothing runs off the screen.
  const short = useShortScreen();

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
    const shoot = (x: number, angle: number) => fireConfetti({ particleCount: 90, spread: 70, startVelocity: 55, angle, origin: { x, y: 0.75 }, colors });
    shoot(0, 60);
    shoot(1, 120);
    const t1 = setTimeout(() => fireConfetti({ particleCount: 160, spread: 360, startVelocity: 35, origin: { x: 0.5, y: 0.35 }, colors }), 300);
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
        animate={smoothTv ? { rotate: 0 } : { rotate: 360 }}
        transition={smoothTv ? { duration: 0 } : { repeat: Infinity, duration: phase === "boom" ? 14 : 8, ease: "linear" }}
      />
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(circle at center, rgba(18,10,36,0) 25%, rgba(18,10,36,0.9) 85%)" }} />

      <div className="absolute right-4 top-4 z-10 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <button
          className="btn btn-ghost btn-sm"
          title={muted ? "Sound off" : "Sound on"}
          aria-label={muted ? "Unmute" : "Mute"}
          aria-pressed={muted}
          onClick={() => {
            setMuted(!muted);
            setMutedState(!muted);
          }}
        >
          <span aria-hidden>{muted ? "🔇" : "🔊"}</span>
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => doneRef.current()}>
          Skip <span aria-hidden>›</span>
        </button>
      </div>

      <div className="relative z-10 flex flex-col items-center px-6 text-center">
        <AnimatePresence mode="wait">
          {phase === "reel" && (
            <motion.div key="reel" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.1 }} className="flex flex-col items-center">
              <p className={`title text-white/80 ${short ? "text-2xl" : "text-4xl sm:text-5xl"}`}>And this video was sent by…</p>
              <div
                className={`relative flex items-center justify-center rounded-[2.5rem] border-8 border-night bg-black/40 shadow-chunky ${short ? "mt-3 h-[13rem] w-[13rem]" : "mt-8 h-[19rem] w-[19rem] sm:h-[22rem] sm:w-[22rem]"}`}
              >
                <motion.div key={step} initial={{ y: -40, opacity: 0.2, scale: 0.9 }} animate={{ y: 0, opacity: 1, scale: 1 }} transition={{ duration: 0.09 }} className={`flex flex-col items-center ${short ? "gap-2" : "gap-4"}`}>
                  <Avatar name={current.name} color={current.color} size={short ? 96 : 150} />
                  <p className={`title max-w-[85%] break-words text-center ${reelNameClass(current.name, short)}`}>{current.name}</p>
                </motion.div>
              </div>
              <motion.p animate={{ opacity: [1, 0.4, 1] }} transition={{ repeat: Infinity, duration: 0.6 }} className={`font-display text-2xl text-sunny ${short ? "mt-2" : "mt-6"}`}>
                🥁 🥁 🥁
              </motion.p>
            </motion.div>
          )}

          {phase === "boom" && (
            <motion.div key="boom" className="flex flex-col items-center">
              <motion.div className="pointer-events-none fixed inset-0 bg-white" initial={{ opacity: 0.5 }} animate={{ opacity: 0 }} transition={{ duration: 0.7 }} />
              <motion.p initial={{ y: -30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15 }} className={`font-display uppercase tracking-[0.4em] text-white/80 ${short ? "text-xl" : "text-3xl"}`}>
                Sent by
              </motion.p>
              <motion.div initial={{ scale: 0, rotate: -25 }} animate={{ scale: [0, 1.35, 1], rotate: [-25, 8, 0] }} transition={{ duration: 0.7, ease: "easeOut" }} className={short ? "mt-2" : "mt-6"}>
                <Avatar name={winner.name} color={winner.color} size={short ? 120 : 230} ring />
              </motion.div>
              <motion.p
                initial={{ scale: 0.3, opacity: 0 }}
                animate={{ scale: [0.3, 1.2, 1], opacity: 1 }}
                transition={{ delay: 0.35, duration: 0.6 }}
                className={`title max-w-[92vw] break-words text-center text-sunny drop-shadow-[0_6px_0_rgba(0,0,0,0.5)] ${short ? "mt-2" : "mt-6"} ${bigNameClass(winner.name, short)}`}
              >
                {winner.name}!
              </motion.p>
              {rating != null && (
                <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.8 }} className={`rounded-full bg-black/40 px-6 py-2 font-display ${short ? "mt-2 text-2xl" : "mt-6 text-3xl"}`}>
                  ⭐ {Number(rating).toFixed(1)} <span className="text-xl text-white/70">/ 10</span>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
