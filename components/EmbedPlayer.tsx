"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { layoutFor, place } from "@/lib/immersive";
import { openInApp } from "@/lib/openInApp";

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
const SITE: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", facebook: "Facebook" };

/**
 * A personal video uploaded from someone's camera roll: a plain <video>, so unlike the social embeds nothing can be
 * restricted, there is no cross-origin chrome to crop away, and it can fill the stage. Tries to start with sound
 * (the host has just tapped something, so browsers usually allow it); if the browser refuses it starts muted and
 * offers a "Tap for sound" button. Loops, like a reel.
 */
function UploadVideo({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const [cover, setCover] = useState(false);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = false;
    v.play().catch(() => {
      v.muted = true;
      v.play().then(() => setNeedsTap(true)).catch(() => {});
    });
  }, [src]);
  return (
    <>
      <video
        ref={ref}
        src={src}
        playsInline
        loop
        controls
        preload="auto"
        onCanPlay={() => setReady(true)}
        onLoadedMetadata={(e) => {
          // fill the screen when the video is close to the stage's shape, otherwise show all of it
          const v = e.currentTarget;
          const box = v.getBoundingClientRect();
          if (v.videoWidth && v.videoHeight && box.width && box.height) {
            const ratio = v.videoWidth / v.videoHeight / (box.width / box.height);
            setCover(ratio > 0.8 && ratio < 1.25);
          }
        }}
        className={`absolute inset-0 h-full w-full bg-black ${cover ? "object-cover" : "object-contain"}`}
      />
      {!ready && (
        <div className="pointer-events-none absolute inset-0 z-[5] flex flex-col items-center justify-center gap-3 bg-black text-center text-white">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-sunny" />
          <p className="font-display text-lg">Loading the video…</p>
        </div>
      )}
      {needsTap && (
        <button
          type="button"
          className="btn btn-yellow btn-sm absolute bottom-16 left-1/2 z-[6] -translate-x-1/2"
          onClick={() => {
            if (ref.current) ref.current.muted = false;
            setNeedsTap(false);
          }}
        >
          🔊 Tap for sound
        </button>
      )}
    </>
  );
}

export default function EmbedPlayer({
  embedUrl,
  platform,
  sourceUrl,
  aspect,
  blocked,
  className = "",
  fullscreen = false,
  overlay,
  reloadKey = 0,
  onReload,
}: {
  embedUrl: string;
  platform: string;
  sourceUrl?: string;
  /** video height / width when the server knows it (Instagram) */
  aspect?: number;
  /** the site won't play this video inside other apps: show an "open it there" panel instead of a black frame */
  blocked?: "restricted" | "gone";
  className?: string;
  fullscreen?: boolean;
  overlay?: ReactNode;
  /** bump to remount the iframe (the "Reload video" button) */
  reloadKey?: number;
  onReload?: () => void;
}) {
  const site = SITE[platform] ?? "the site";
  const [forced, setForced] = useState(false); // "try it here anyway"
  const showBlocked = !!blocked && !forced;
  const isUpload = platform === "upload"; // plays in a native <video>, no iframe, no slow-load timers
  const frameKey = `${embedUrl}#${reloadKey}`;

  // Loading state: the embed is a cross-origin iframe, so all we can see is its `load` event. Show a spinner until
  // it has loaded (plus a beat for the player to paint), offer Reload / Open-on-site if it is slow, and quietly
  // retry once if it never loads at all, so a first cold load is never just a black screen.
  const [loaded, setLoaded] = useState(false);
  const [settled, setSettled] = useState(false);
  const [slow, setSlow] = useState(false);
  const loadedRef = useRef(false);
  useEffect(() => {
    loadedRef.current = false;
    setLoaded(false);
    setSettled(false);
    setSlow(false);
    if (showBlocked || isUpload) return; // no iframe is loading, so no slow/retry timers
    const slowT = setTimeout(() => setSlow(true), 10000);
    const retryT = setTimeout(() => {
      if (!loadedRef.current && reloadKey === 0) onReload?.();
    }, 16000);
    return () => {
      clearTimeout(slowT);
      clearTimeout(retryT);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey, showBlocked, isUpload]);
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => setSettled(true), 1800);
    return () => clearTimeout(t);
  }, [loaded]);

  const vp = useViewport(fullscreen);
  const layout = useMemo(() => layoutFor(platform, embedUrl, aspect), [platform, embedUrl, aspect]);
  const placed = useMemo(() => (vp.w && vp.h ? place(layout, vp.w, vp.h) : null), [layout, vp.w, vp.h]);
  const immersive = fullscreen && placed && !showBlocked && !isUpload;

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
        {showBlocked && (
          <div
            key="blocked"
            className={`absolute inset-0 z-[5] flex flex-col items-center justify-center gap-4 overflow-y-auto bg-night p-6 text-center text-white ${fullscreen ? "pt-24" : ""}`}
          >
            <div className="grid h-20 w-20 place-items-center rounded-full bg-white/10 text-5xl shadow-chunky">📲</div>
            <h2 className="font-display text-2xl leading-tight sm:text-3xl">
              {blocked === "gone" ? "This one may be gone" : `This one plays on ${site}`}
            </h2>
            <p className="max-w-xs text-sm text-white/70">
              {blocked === "gone"
                ? `${site} says this video is removed or private. Open it in the app to check, and play it there if it still works, then come back here for the answers.`
                : `${site} only lets this video play in its own app. Tap the button to open it there, play it for everyone, then come back here for the answers.`}
            </p>
            {sourceUrl && (
              <button type="button" className="btn btn-yellow touch-manipulation" onClick={() => openInApp(platform, sourceUrl)}>
                Open in the {site} app ↗
              </button>
            )}
            <div className="flex flex-col items-center gap-1 text-xs text-white/50">
              {sourceUrl && (
                <a className="underline hover:text-white/80" href={sourceUrl} target="_blank" rel="noreferrer">
                  Open in the browser instead
                </a>
              )}
              <button type="button" className="underline hover:text-white/80" onClick={() => setForced(true)}>
                Try playing it here anyway
              </button>
            </div>
          </div>
        )}
        {isUpload && <UploadVideo key={frameKey} src={embedUrl} />}
        {!showBlocked && !isUpload && (
        <iframe
          key={frameKey}
          src={embedUrl}
          onLoad={() => {
            loadedRef.current = true;
            setLoaded(true);
          }}
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
        )}
        {!showBlocked && !isUpload && !settled && (
          <div className={`absolute inset-0 z-[5] flex flex-col items-center justify-center gap-3 bg-black p-4 text-center text-white ${slow ? "" : "pointer-events-none"}`}>
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-sunny" />
            <p className="font-display text-lg">{slow ? `Still loading from ${site}…` : "Loading the video…"}</p>
            <p className="max-w-[16rem] text-sm text-white/60">
              {slow ? "Slow connection, or the site is being fussy." : `The first one can take a few seconds. Tap play when it appears.`}
            </p>
            {slow && (
              <div className="flex flex-wrap justify-center gap-2">
                {onReload && (
                  <button className="btn btn-yellow btn-sm" onClick={onReload}>
                    ↻ Reload
                  </button>
                )}
                {sourceUrl && (
                  <a className="btn btn-ghost btn-sm" href={sourceUrl} target="_blank" rel="noreferrer">
                    Open on {site} ↗
                  </a>
                )}
              </div>
            )}
          </div>
        )}
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

      {sourceUrl && !fullscreen && !showBlocked && !isUpload && (
        <a key="link" href={sourceUrl} target="_blank" rel="noreferrer" className="mt-2 text-sm text-white/50 underline hover:text-white/80">
          Not loading? Open on {site} ↗
        </a>
      )}
    </div>
  );
}
