"use client";
import type { ReactNode } from "react";

/**
 * Vertical 9:16 video frame.
 * `fullscreen` stretches it over the whole viewport (CSS overlay, so it also works on iPhone
 * where the browser Fullscreen API isn't available). The iframe element is never remounted when
 * toggling, so the video doesn't restart. `overlay` is a control bar shown only in fullscreen.
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
  return (
    <div className={fullscreen ? "fixed inset-0 z-50 flex flex-col bg-black" : `flex flex-col items-center ${className}`}>
      {fullscreen && (
        <div key="bar" className="shrink-0">
          {overlay}
        </div>
      )}
      <div key="frame" className={fullscreen ? "flex min-h-0 flex-1 items-center justify-center" : ""}>
        <div
          className={fullscreen ? "h-full overflow-hidden bg-black" : "overflow-hidden rounded-3xl border-8 border-night bg-black shadow-chunky"}
          style={fullscreen ? { aspectRatio: "9 / 16", maxWidth: "100%" } : { height: "min(72vh, 760px)", aspectRatio: "9 / 16" }}
        >
          <iframe
            key={embedUrl}
            src={embedUrl}
            className="h-full w-full"
            allow="autoplay; encrypted-media; picture-in-picture; clipboard-write; fullscreen"
            allowFullScreen
            scrolling="no"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      </div>
      {sourceUrl && !fullscreen && (
        <a key="link" href={sourceUrl} target="_blank" rel="noreferrer" className="mt-2 text-sm text-white/50 underline hover:text-white/80">
          Not loading? Open on {platform === "tiktok" ? "TikTok" : platform === "instagram" ? "Instagram" : platform === "youtube" ? "YouTube" : "Facebook"} ↗
        </a>
      )}
    </div>
  );
}
