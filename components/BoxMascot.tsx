"use client";
import { motion } from "framer-motion";

export type Mood = "idle" | "hungry" | "chomp" | "rock" | "meh" | "stink";

/** Non-interactive cartoon box with a face that reacts. */
export default function BoxMascot({ size = 160, mood = "idle", open = false }: { size?: number; mood?: Mood; open?: boolean }) {
  const mouth: Record<Mood, JSX.Element> = {
    idle: <path d="M84 152 Q100 166 116 152" stroke="#1B0F3B" strokeWidth="6" fill="none" strokeLinecap="round" />,
    hungry: <ellipse cx="100" cy="156" rx="14" ry="11" fill="#1B0F3B" />,
    chomp: <path d="M82 154 L118 154" stroke="#1B0F3B" strokeWidth="7" strokeLinecap="round" />,
    rock: <path d="M78 148 Q100 178 122 148 Z" fill="#1B0F3B" stroke="#1B0F3B" strokeWidth="5" strokeLinejoin="round" />,
    meh: <path d="M84 156 L116 152" stroke="#1B0F3B" strokeWidth="6" strokeLinecap="round" />,
    stink: <path d="M84 162 Q100 146 116 162" stroke="#1B0F3B" strokeWidth="6" fill="none" strokeLinecap="round" />,
  };
  const eyes =
    mood === "rock" ? (
      <>
        {/* star eyes */}
        <text x="58" y="142" fontSize="26">⭐</text>
        <text x="114" y="142" fontSize="26">⭐</text>
      </>
    ) : mood === "stink" ? (
      <>
        <path d="M62 126 L82 136 M62 136 L82 126" stroke="#1B0F3B" strokeWidth="6" strokeLinecap="round" />
        <path d="M118 126 L138 136 M118 136 L138 126" stroke="#1B0F3B" strokeWidth="6" strokeLinecap="round" />
      </>
    ) : mood === "meh" ? (
      <>
        <path d="M62 132 L82 132" stroke="#1B0F3B" strokeWidth="6" strokeLinecap="round" />
        <path d="M118 132 L138 132" stroke="#1B0F3B" strokeWidth="6" strokeLinecap="round" />
      </>
    ) : (
      <>
        <circle cx="72" cy="132" r="8" fill="#1B0F3B" />
        <circle cx="128" cy="132" r="8" fill="#1B0F3B" />
        <circle cx="75" cy="129" r="3" fill="#fff" />
        <circle cx="131" cy="129" r="3" fill="#fff" />
      </>
    );

  const bodyAnim =
    mood === "chomp"
      ? { rotate: [0, -5, 5, -5, 0], y: [0, -6, 0], transition: { repeat: Infinity, duration: 0.5 } }
      : mood === "rock"
      ? { y: [0, -18, 0], rotate: [0, -4, 4, 0], transition: { repeat: Infinity, duration: 0.7 } }
      : mood === "stink"
      ? { x: [0, -4, 4, -4, 0], transition: { repeat: Infinity, duration: 1.2 } }
      : { y: [0, -8, 0], transition: { repeat: Infinity, duration: 3 } };

  return (
    <motion.div animate={bodyAnim} style={{ width: size, height: size }} className="relative select-none">
      <svg viewBox="0 0 200 200" width={size} height={size} className="overflow-visible drop-shadow-[0_10px_0_rgba(0,0,0,0.35)]">
        {(open || mood === "hungry" || mood === "chomp") && <ellipse cx="100" cy="88" rx="70" ry="14" fill="#1B0F3B" />}
        <path d="M28 85 L172 85 L162 185 Q160 192 152 192 L48 192 Q40 192 38 185 Z" fill="#C8894B" stroke="#1B0F3B" strokeWidth="6" strokeLinejoin="round" />
        <rect x="84" y="85" width="32" height="107" fill="#E8C48A" opacity="0.55" />
        {eyes}
        {mouth[mood]}
        <ellipse cx="58" cy="150" rx="9" ry="5" fill="#FF4FA3" opacity="0.6" />
        <ellipse cx="142" cy="150" rx="9" ry="5" fill="#FF4FA3" opacity="0.6" />
        {mood === "stink" && (
          <>
            <text x="150" y="70" fontSize="26">💨</text>
            <text x="20" y="60" fontSize="22">🪰</text>
          </>
        )}
      </svg>
      {/* lid: flipped open when hungry/chomping, closed otherwise */}
      <motion.svg
        viewBox="0 0 200 200"
        width={size}
        height={size}
        className="absolute inset-0 overflow-visible"
        style={{ transformOrigin: "15% 38%" }}
        animate={{ rotate: open || mood === "hungry" || mood === "chomp" ? -28 : 0, y: open || mood === "hungry" || mood === "chomp" ? -14 : 0 }}
        transition={{ type: "spring", bounce: 0.5 }}
      >
        <path d="M18 62 L182 62 L178 90 L22 90 Z" fill="#D99A5B" stroke="#1B0F3B" strokeWidth="6" strokeLinejoin="round" />
        <path d="M100 62 C80 30 60 40 70 58 Z" fill="#FF4FA3" stroke="#1B0F3B" strokeWidth="5" strokeLinejoin="round" />
        <path d="M100 62 C120 30 140 40 130 58 Z" fill="#FF4FA3" stroke="#1B0F3B" strokeWidth="5" strokeLinejoin="round" />
        <circle cx="100" cy="60" r="8" fill="#FFD23F" stroke="#1B0F3B" strokeWidth="5" />
      </motion.svg>
    </motion.div>
  );
}
