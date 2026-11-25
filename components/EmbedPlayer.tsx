"use client";
export default function EmbedPlayer({ embedUrl, platform, sourceUrl, className = "" }: { embedUrl: string; platform: string; sourceUrl?: string; className?: string }) {
  // Vertical 9:16 frame sized to the viewport height
  return (
    <div className={`flex flex-col items-center ${className}`}>
      <div className="overflow-hidden rounded-3xl border-8 border-night bg-black shadow-chunky" style={{ height: "min(72vh, 760px)", aspectRatio: platform === "facebook" ? "9 / 16" : "9 / 16" }}>
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
      {sourceUrl && (
        <a href={sourceUrl} target="_blank" rel="noreferrer" className="mt-2 text-sm text-white/50 underline hover:text-white/80">
          Not loading? Open on {platform === "tiktok" ? "TikTok" : platform === "instagram" ? "Instagram" : "Facebook"} ↗
        </a>
      )}
    </div>
  );
}
