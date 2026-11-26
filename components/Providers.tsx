"use client";
import { MotionConfig } from "framer-motion";

/**
 * Honors the OS/browser-level "reduce motion" preference for every framer-motion animation in the app
 * (the confetti/CSS-driven effects have their own separate opt-outs — see lib/confetti.ts and the
 * `prefers-reduced-motion` rule in globals.css).
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
