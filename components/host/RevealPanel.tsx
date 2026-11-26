"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { fireConfetti } from "@/lib/confetti";
import Avatar from "@/components/Avatar";
import type { GameState } from "@/components/useGameState";
import { fmtPoints, SENDER_BONUS } from "@/lib/points";

/** The sender's name is shown at a big, celebratory size — a long one needs to shrink to still fit on one line. */
function senderNameClass(name: string) {
  if (name.length <= 10) return "text-4xl";
  if (name.length <= 16) return "text-3xl";
  return "text-2xl";
}

export default function RevealPanel({ state, instant = false }: { state: GameState; instant?: boolean }) {
  const [shown, setShown] = useState(instant);
  const r = state.reveal!;
  useEffect(() => {
    if (instant) {
      // the grand reveal already did the drumroll: go straight to the results
      setShown(true);
      return;
    }
    setShown(false);
    const t = setTimeout(() => {
      setShown(true);
      fireConfetti({ particleCount: 120, spread: 80, origin: { x: 0.8, y: 0.3 } });
    }, 600);
    return () => clearTimeout(t);
  }, [state.session.index, instant]);
  const avg = state.video?.avgRating != null ? Number(state.video.avgRating) : null;
  const senderScores = !!r.senderId && state.scores.some((sc) => sc.playerId === r.senderId);
  return (
    <div className="card">
      <AnimatePresence mode="wait">
        {!shown ? (
          <motion.div key="drum" initial={{ opacity: 0 }} animate={{ opacity: 1, rotate: [-3, 3, -3] }} transition={{ rotate: { repeat: Infinity, duration: 0.25 } }} className="py-10 text-center">
            <p className="text-6xl">🥁</p>
            <p className="title mt-2 text-2xl">And it was sent by…</p>
          </motion.div>
        ) : (
          <motion.div key="who" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", bounce: 0.5 }}>
            <div className="flex flex-col items-center text-center">
              <Avatar name={r.senderName} color={r.senderColor} size={96} ring />
              <p className={`title mt-3 max-w-full break-words text-sunny ${senderNameClass(r.senderName)}`}>{r.senderName}!</p>
              {senderScores && <p className="mt-1 font-display text-lg text-mint">🕵️ +{fmtPoints(SENDER_BONUS)} for sending it</p>}
              <div className="mt-3 flex items-center gap-2 rounded-full bg-black/30 px-4 py-2 font-display text-2xl">
                ⭐ {avg != null ? avg.toFixed(1) : "–"} <span className="text-base text-white/70">/ 10 · {state.video?.ratingCount ?? 0} ratings</span>
              </div>
            </div>
            {/* Below lg: a short scrolling list (it's a phone/tablet, so vertical space is tight). From lg up
                (a TV screen being watched from across the room) it unfolds into two columns with no cap, so
                nobody ever needs to scroll to see every guess. */}
            <ul className="mt-4 max-h-56 space-y-1 overflow-y-auto lg:max-h-none lg:grid lg:grid-cols-2 lg:gap-x-4 lg:gap-y-1 lg:space-y-0 lg:overflow-visible">
              {r.guesses.map((g, i) => (
                <motion.li
                  key={g.playerId}
                  initial={instant ? { opacity: 0, x: 40 } : false}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: instant ? 0.2 + i * 0.1 : 0, type: "spring", bounce: 0.35 }}
                  className={`flex items-center justify-between rounded-xl px-3 py-1.5 ${g.correct ? "bg-mint/25" : "bg-black/25"}`}
                >
                  <span className="flex items-center gap-2">
                    <Avatar name={g.name} color={g.color} size={28} />
                    <span className="break-words font-semibold">{g.name}</span>
                    <span className="break-words text-sm text-white/70">guessed {g.guessedName}</span>
                  </span>
                  <span className="font-display">
                    {g.correct ? "✅ +1" : "❌"} <span className="ml-2 text-white/70">{g.rating}★</span>
                  </span>
                </motion.li>
              ))}
              {r.guesses.length === 0 && <li className="text-center text-white/70">No guesses this time!</li>}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
