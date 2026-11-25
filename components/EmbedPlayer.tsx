"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { layoutFor, place } from "@/lib/immersive";

function useViewport(active: boolean) {
  const [v, setV] = useState(() =>
    typeof window === "undefined" ? { w: 0, h: 0 } : { w: window.innerWidth, h: window.innerHeight }
  );
  useEffect(() => {
    if (!active) return;
    const update = () => setV({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, [active]);
  return v;
}

/**
 * Vertical video player.
 *
 * Window mode: a rounded 9:16 phone frame.
 * `fullscreen`: an edge-to-edge, reels / TikTok style stage. The third-party embed is rendered at its
 * native size and cropped + scaled (see lib/immersive.ts) so just the video fills the screen, with a
 * slide-up entrance like swiping to the next reel. `overlay` floats over the top as a translucent bar.
 *
 * It's the same iframe element in both modes (never remounted when toggling), so the video doesn't
 * restart. CSS overlay rather than the Fullscreen API alone so it also works on iPhone.
 */
export default function EmbedPlayer({
  embedUrl,
  platform,
  sourceUrl,
  className = "",
  fullscreen = false,
  overlay,
}: {
  embedUrl: string;
  platform: string;
  sourceUrl?: string;
  className?: string;
  fullscreen?: boolean;
  overlay?: ReactNode;
}) {
  const vp = useViewport(fullscreen);
  const layout = useMemo(() => layoutFor(platform, embedUrl), [platform, embedUrl]);
  const placed = useMemo(() => (vp.w && vp.h ? place(layout, vp.w, vp.h) : null), [layout, vp.w, vp.h]);
  const immersive = fullscreen && placed;

  // lock page scroll / rubber-banding behind the stage
  useEffect(() => {
    if (!fullscreen) return;
    const b = document.body;
    const prev = { overflow: b.style.overflow, ob: b.style.overscrollBehavior };
    b.style.overflow = "hidden";
    b.style.overscrollBehavior = "none";
    return () => {
      b.style.overflow = prev.overflow;
      b.style.overscrollBehavior = prev.ob;
    };
  }, [fullscreen]);

  return (
    <div
      className={fullscreen ? "fixed inset-0 z-50 overflow-hidden bg-black" : `flex flex-col items-center ${className}`}
      style={fullscreen ? { animation: "otb-reel-in 480ms cubic-bezier(0.22, 1, 0.36, 1)", touchAction: "none" } : undefined}
    >
      <div
        key="frame"
        className={
          immersive
            ? "absolute overflow-hidden bg-black"
            : fullscreen
              ? "absolute inset-0 bg-black"
              : "overflow-hidden rounded-3xl border-8 border-night bg-black shadow-chunky"
        }
        style={
          immersive
            ? { left: placed.box.left, top: placed.box.top, width: placed.box.width, height: placed.box.height }
            : fullscreen
              ? undefined
              : { height: "min(72vh, 760px)", aspectRatio: "9 / 16", position: "relative" }
        }
      >
        <iframe
          key={embedUrl}
          src={embedUrl}
          className={immersive ? "absolute max-w-none border-0" : "absolute inset-0 h-full w-full border-0"}
          style={
            immersive
              ? {
                  left: placed.frame.left,
                  top: placed.frame.top,
                  width: placed.frame.width,
                  height: placed.frame.height,
                  transform: `scale(${placed.frame.scale})`,
                  transformOrigin: "0 0",
                }
              : undefined
          }
          allow="autoplay; encrypted-media; picture-in-picture; clipboard-write; fullscreen"
          allowFullScreen
          scrolling="no"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>

      {fullscreen && overlay && (
        <div
          key="bar"
          className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/80 via-black/40 to-transparent pb-6"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <div className="pointer-events-auto">{overlay}</div>
        </div>
      )}

      {sourceUrl && !fullscreen && (
        <a key="link" href={sourceUrl} target="_blank" rel="noreferrer" className="mt-2 text-sm text-white/50 underline hover:text-white/80">
          Not loading? Open on {platform === "tiktok" ? "TikTok" : platform === "instagram" ? "Instagram" : platform === "youtube" ? "YouTube" : "Facebook"} ↗
        </a>
      )}
    </div>
  );
}
