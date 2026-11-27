"use client";
// The post-game awards ceremony on the host screen: one award at a time, the moderator taps "Next award".
// Each award plays the same little show: the box wobbles, its lid pops, a drumroll, then the award springs
// out of the box with its own confetti and sound. Which award is showing lives on the server
// (`sessions.awards_step`), so a refreshed host screen picks up at the same award.
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { confettiShape, fireConfetti } from "@/lib/confetti";
import { isMuted, playDrumroll, playFanfare, playSadTrombone, setMuted, stopSfx } from "@/lib/sfx";
import { AWARD_INFO, type Award } from "@/lib/awards";
import Avatar from "@/components/Avatar";
import BoxMascot from "@/components/BoxMascot";
import { useSmoothTv } from "@/lib/smoothTv";
import { useShortScreen } from "@/components/useShortScreen";

const WOBBLE_MS = 900; // box shakes before the lid pops
const DRUM_MS = 1900; // drumroll before the winner appears

function bigNameClass(name: string, short = false) {
  if (short) return name.length <= 9 ? "text-5xl" : name.length <= 13 ? "text-4xl" : "text-3xl";
  if (name.length <= 6) return "text-6xl sm:text-8xl";
  if (name.length <= 9) return "text-5xl sm:text-7xl";
  if (name.length <= 13) return "text-4xl sm:text-6xl";
  return "text-3xl sm:text-5xl";
}

const RAYS: Record<"good" | "bad", string> = {
  good: "conic-gradient(from 0deg, transparent 0 8%, rgba(255,210,63,0.35) 10%, transparent 12% 20%, rgba(255,79,163,0.35) 22%, transparent 24% 32%, rgba(63,193,255,0.35) 34%, transparent 36% 44%, rgba(255,210,63,0.35) 46%, transparent 48% 56%, rgba(255,79,163,0.35) 58%, transparent 60% 68%, rgba(63,193,255,0.35) 70%, transparent 72% 80%, rgba(61,220,151,0.3) 82%, transparent 84% 100%)",
  bad: "conic-gradient(from 0deg, transparent 0 8%, rgba(120,200,80,0.28) 10%, transparent 12% 25%, rgba(140,110,60,0.28) 27%, transparent 29% 42%, rgba(120,200,80,0.28) 44%, transparent 46% 59%, rgba(140,110,60,0.28) 61%, transparent 63% 76%, rgba(120,200,80,0.28) 78%, transparent 80% 100%)",
};

/** Emoji that rain down (bad awards) or burst out (good ones) when each award lands. */
const SHAPES: Record<Award["kind"], string[]> = {
  hater: ["😤", "👎"],
  lover: ["💖", "😍"],
  stinker: ["🤢", "💩"],
  banger: ["🔥", "⭐"],
};

async function celebrate(kind: Award["kind"]) {
  const shapes = (await Promise.all(SHAPES[kind].map((e) => confettiShape(e, 2.5)))).filter((s): s is NonNullable<typeof s> => !!s);
  const colors = ["#FF4FA3", "#FFD23F", "#3DDC97", "#3FC1FF", "#B07CFF", "#FF8A3D"];
  if (kind === "hater" || kind === "stinker") {
    // a slow, sorry drizzle from the top of the screen
    for (let i = 0; i < 5; i++)
      setTimeout(
        () => fireConfetti({ shapes, scalar: 2.5, particleCount: 12, spread: 120, angle: 270, startVelocity: 8, gravity: 0.6, ticks: 300, flat: true, origin: { x: 0.1 + Math.random() * 0.8, y: -0.05 } }),
        i * 250,
      );
    return;
  }
  const shoot = (x: number, angle: number) => fireConfetti({ particleCount: 80, spread: 70, startVelocity: 55, angle, origin: { x, y: 0.8 }, colors });
  shoot(0, 60);
  shoot(1, 120);
  if (shapes.length) fireConfetti({ shapes, scalar: 2.5, particleCount: 30, spread: 360, startVelocity: 30, ticks: 220, flat: true, origin: { x: 0.5, y: 0.45 } });
  if (kind === "banger") {
    // the grand finale gets a few extra waves
    setTimeout(() => fireConfetti({ particleCount: 180, spread: 360, startVelocity: 40, origin: { x: 0.5, y: 0.35 }, colors }), 350);
    setTimeout(() => {
      shoot(0, 60);
      shoot(1, 120);
    }, 800);
    setTimeout(() => shapes.length && fireConfetti({ shapes, scalar: 3, particleCount: 40, spread: 360, startVelocity: 35, ticks: 260, flat: true, origin: { x: 0.5, y: 0.4 } }), 1300);
  }
}

export default function AwardsCeremony({
  awards,
  step,
  busy,
  onNext,
  onSkip,
}: {
  awards: Award[];
  step: number;
  busy: boolean;
  onNext: (step: number) => void;
  onSkip: () => void;
}) {
  const award = awards[Math.min(step, awards.length - 1)];
  const info = AWARD_INFO[award.kind];
  const [phase, setPhase] = useState<"wobble" | "drum" | "boom">("wobble");
  const [muted, setMutedState] = useState(false);
  useEffect(() => setMutedState(isMuted()), []);
  // Smooth TV mode: still spotlight (a spinning full-screen gradient changes every pixel every frame).
  const [smoothTv] = useSmoothTv();
  // A phone turned sideways (often the host phone mirroring to the TV): everything shrinks so the award and
  // its "Next award" button both fit, and the screen can scroll as a last resort.
  const short = useShortScreen();

  // Each new award replays the show from the top.
  const kindRef = useRef(award.kind);
  kindRef.current = award.kind;
  useEffect(() => {
    setPhase("wobble");
    let alive = true;
    const t1 = setTimeout(() => {
      if (!alive) return;
      setPhase("drum");
      playDrumroll(DRUM_MS);
    }, WOBBLE_MS);
    const t2 = setTimeout(() => {
      if (!alive) return;
      setPhase("boom");
      if (info.good) playFanfare();
      else playSadTrombone();
      void celebrate(kindRef.current);
    }, WOBBLE_MS + DRUM_MS);
    return () => {
      alive = false;
      clearTimeout(t1);
      clearTimeout(t2);
      stopSfx();
    };
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const last = step >= awards.length - 1;
  const isVideo = award.kind === "stinker" || award.kind === "banger";

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center overflow-y-auto overflow-x-hidden bg-[#120a24]">
      {/* Clipped in its own fixed layer: the rays are far bigger than the screen, and must never be what makes
          the ceremony scroll (only real content may, on a very short screen). */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <motion.div
          className="absolute left-1/2 top-1/2 h-[220vmax] w-[220vmax] -translate-x-1/2 -translate-y-1/2"
          style={{ background: RAYS[info.good ? "good" : "bad"] }}
          animate={{ rotate: smoothTv ? 0 : 360, opacity: phase === "boom" ? 0.45 : 0.2 }}
          transition={{ rotate: smoothTv ? { duration: 0 } : { repeat: Infinity, duration: phase === "boom" ? 14 : 8, ease: "linear" }, opacity: { duration: smoothTv ? 0 : 0.4 } }}
        />
        <div className="absolute inset-0" style={{ background: "radial-gradient(circle at center, rgba(18,10,36,0) 25%, rgba(18,10,36,0.9) 85%)" }} />
      </div>

      <div className="absolute left-4 top-4 z-10">
        <p className="label text-white/70">
          🏆 Award {Math.min(step, awards.length - 1) + 1} of {awards.length}
        </p>
      </div>
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
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
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={onSkip}>
          Skip ceremony <span aria-hidden>›</span>
        </button>
      </div>

      <div className={`relative z-10 my-auto flex w-full flex-col items-center px-6 text-center ${short ? "pb-2 pt-14" : "py-20"}`}>
        <motion.p
          key={`t-${step}`}
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className={`title text-white/80 ${short ? "text-2xl" : "text-3xl sm:text-4xl"}`}
        >
          {phase === "boom" ? (
            <>
              {info.emoji} {info.title} {info.emoji}
            </>
          ) : (
            <>And the award for {info.title} goes to…</>
          )}
        </motion.p>

        <div className={`relative flex w-full flex-col items-center justify-end ${short ? "mt-2 min-h-[11rem]" : "mt-6 min-h-[24rem]"}`}>
          <AnimatePresence mode="wait">
            {phase === "boom" ? (
              <motion.div
                key={`card-${step}`}
                initial={{ y: 160, scale: 0.3, opacity: 0 }}
                animate={{ y: 0, scale: 1, opacity: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ type: "spring", stiffness: 260, damping: 16 }}
                className={`card flex w-full max-w-2xl flex-col items-center !bg-night/80 ${short ? "!py-3" : "py-8"}`}
              >
                {isVideo ? (
                  <>
                    {/* On a short screen the emoji sits beside the score, and "Watch again" beside the sender. */}
                    <div className={short ? "flex items-center gap-3" : "contents"}>
                      <motion.p className={short ? "text-5xl" : "text-8xl"} animate={{ rotate: [0, -8, 8, -4, 0] }} transition={{ duration: 0.8, delay: 0.3 }}>
                        {info.emoji}
                      </motion.p>
                      <p className={`title ${short ? "text-4xl" : "mt-2 text-6xl sm:text-7xl"} ${info.good ? "text-sunny" : "text-mint"}`}>⭐ {award.avg.toFixed(1)}</p>
                    </div>
                    <p className="text-white/70">
                      average from {award.count} rating{award.count === 1 ? "" : "s"}
                    </p>
                    <div className={short ? "mt-2 flex items-center gap-3" : "contents"}>
                      <div className={`flex items-center gap-3 ${short ? "" : "mt-5"}`}>
                        <Avatar name={award.name} color={award.color} size={short ? 40 : 56} ring />
                        <p className={`title ${short ? "text-2xl" : "text-3xl sm:text-4xl"}`}>sent by {award.name}</p>
                      </div>
                      {award.video && award.video.platform !== "upload" && (
                        <a href={award.video.sourceUrl} target="_blank" rel="noreferrer" className={`btn btn-sky btn-sm ${short ? "" : "mt-5"}`}>
                          Watch again ↗
                        </a>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <Avatar name={award.name} color={award.color} size={short ? 64 : 120} ring />
                    <p className={`title max-w-[90vw] break-words ${short ? "mt-1" : "mt-4"} ${info.good ? "text-sunny" : "text-mint"} drop-shadow-[0_6px_0_rgba(0,0,0,0.5)] ${bigNameClass(award.name, short)}`}>
                      {award.name}
                    </p>
                    <p className={`font-display ${short ? "mt-1 text-2xl" : "mt-3 text-3xl"}`}>
                      ⭐ {award.avg.toFixed(1)} <span className="text-xl text-white/70">average rating</span>
                    </p>
                  </>
                )}
                <p className={`text-white/70 ${short ? "mt-1 text-base" : "mt-4 text-lg"}`}>{info.blurb}</p>
              </motion.div>
            ) : (
              <motion.div
                key={`box-${step}`}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={phase === "wobble" ? { scale: 1, opacity: 1, rotate: [0, -6, 6, -6, 6, 0] } : { scale: [1, 1.06, 1], opacity: 1, rotate: [-2, 2, -2] }}
                exit={{ y: -40, scale: 1.3, opacity: 0, transition: { duration: 0.25 } }}
                transition={phase === "wobble" ? { duration: 0.8 } : { repeat: Infinity, duration: 0.25 }}
              >
                <BoxMascot size={short ? 150 : 260} mood={phase === "drum" ? "chomp" : "idle"} open={phase === "drum"} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className={`flex shrink-0 items-center ${short ? "mt-2 h-14" : "mt-8 h-16"}`}>
          {phase === "boom" && (
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="btn btn-yellow text-2xl"
              disabled={busy}
              onClick={() => onNext(step)}
            >
              {last ? "See final scores 🎬" : "Next award ›"}
            </motion.button>
          )}
        </div>
      </div>
    </div>
  );
}
