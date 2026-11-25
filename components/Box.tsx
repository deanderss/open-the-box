"use client";
import { motion, useAnimationControls } from "framer-motion";
import { useState } from "react";
import confetti from "canvas-confetti";

/** Cartoony cardboard box. Click to pop the lid. */
export default function Box({
  size = 280,
  count,
  onOpened,
  disabled,
  label = "Click to open!",
}: {
  size?: number;
  count?: number;
  onOpened?: () => void;
  disabled?: boolean;
  label?: string;
}) {
  const lid = useAnimationControls();
  const body = useAnimationControls();
  const [opening, setOpening] = useState(false);

  async function open() {
    if (opening || disabled) return;
    setOpening(true);
    await body.start({ rotate: [0, -6, 6, -8, 8, -4, 0], transition: { duration: 0.7 } });
    confetti({ particleCount: 160, spread: 90, startVelocity: 45, origin: { y: 0.55 }, colors: ["#FF4FA3", "#FFD23F", "#3DDC97", "#3FC1FF", "#FF8A3D"] });
    await lid.start({ y: -size * 0.9, rotate: -35, x: -size * 0.25, opacity: 0, transition: { duration: 0.7, ease: "easeOut" } });
    onOpened?.();
  }

  return (
    <div className="flex flex-col items-center select-none">
      <motion.button
        type="button"
        onClick={open}
        disabled={disabled}
        aria-label="Open the box"
        animate={body}
        whileHover={!disabled && !opening ? { scale: 1.05, rotate: [-2, 2, -2] } : {}}
        whileTap={{ scale: 0.95 }}
        className={`relative ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"} ${!opening && !disabled ? "animate-floaty" : ""}`}
        style={{ width: size, height: size }}
      >
        <svg viewBox="0 0 200 200" width={size} height={size} className="overflow-visible drop-shadow-[0_12px_0_rgba(0,0,0,0.35)]">
          {/* glow from inside when opening */}
          {opening && <ellipse cx="100" cy="88" rx="70" ry="16" fill="#FFD23F" opacity="0.9" />}
          {/* body */}
          <path d="M28 85 L172 85 L162 185 Q160 192 152 192 L48 192 Q40 192 38 185 Z" fill="#C8894B" stroke="#1B0F3B" strokeWidth="6" strokeLinejoin="round" />
          <path d="M100 85 L100 192" stroke="#9C6634" strokeWidth="5" />
          <rect x="84" y="85" width="32" height="107" fill="#E8C48A" opacity="0.55" />
          {/* face */}
          <circle cx="72" cy="132" r="8" fill="#1B0F3B" />
          <circle cx="128" cy="132" r="8" fill="#1B0F3B" />
          <circle cx="75" cy="129" r="3" fill="#fff" />
          <circle cx="131" cy="129" r="3" fill="#fff" />
          <path d="M84 152 Q100 168 116 152" stroke="#1B0F3B" strokeWidth="6" fill="none" strokeLinecap="round" />
          <ellipse cx="58" cy="150" rx="9" ry="5" fill="#FF4FA3" opacity="0.6" />
          <ellipse cx="142" cy="150" rx="9" ry="5" fill="#FF4FA3" opacity="0.6" />
          {/* question marks */}
          <text x="10" y="70" fontSize="28" fontWeight="800" fill="#FFD23F" stroke="#1B0F3B" strokeWidth="2">?</text>
          <text x="176" y="60" fontSize="24" fontWeight="800" fill="#3FC1FF" stroke="#1B0F3B" strokeWidth="2">?</text>
        </svg>
        {/* lid */}
        <motion.svg
          animate={lid}
          viewBox="0 0 200 200"
          width={size}
          height={size}
          className="absolute inset-0 overflow-visible"
          style={{ transformOrigin: "50% 40%" }}
        >
          <path d="M18 62 L182 62 L178 90 L22 90 Z" fill="#D99A5B" stroke="#1B0F3B" strokeWidth="6" strokeLinejoin="round" />
          <rect x="82" y="62" width="36" height="28" fill="#E8C48A" opacity="0.7" />
          {/* bow */}
          <path d="M100 62 C80 30 60 40 70 58 Z" fill="#FF4FA3" stroke="#1B0F3B" strokeWidth="5" strokeLinejoin="round" />
          <path d="M100 62 C120 30 140 40 130 58 Z" fill="#FF4FA3" stroke="#1B0F3B" strokeWidth="5" strokeLinejoin="round" />
          <circle cx="100" cy="60" r="8" fill="#FFD23F" stroke="#1B0F3B" strokeWidth="5" />
        </motion.svg>
        {typeof count === "number" && (
          <span className="absolute -right-2 top-6 flex h-16 w-16 items-center justify-center rounded-full border-4 border-night bg-sunny font-display text-2xl font-bold text-night shadow-chunkySm">
            {count}
          </span>
        )}
      </motion.button>
      <p className="mt-4 font-display text-xl text-white/80">{opening ? "Opening…" : label}</p>
    </div>
  );
}
