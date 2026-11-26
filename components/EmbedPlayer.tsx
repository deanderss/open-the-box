"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { layoutFor, place } from "@/lib/immersive";
import { openInApp } from "@/lib/openInApp";

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

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

const SITE: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", facebook: "Facebook" };

type Media = {
  embedUrl: string;
  platform: string;
  sourceUrl?: string;
  /** video height / width when the server knows it (Instagram) */
  aspect?: number;
  /** the site won't play this video inside other apps: show an "open it there" panel instead of a black frame */
  blocked?: "restricted" | "gone";
};

/** Which videos can be loaded invisibly ahead of time. Facebook is left out: its player can't be told to start later. */
const canPreload = (m: Media) => !m.blocked && m.platform !== "facebook";

/** The same embed, but told NOT to start by itself (a preloaded video must stay silent until it is shown). */
function preloadSrc(platform: string, url: string) {
  if (platform !== "youtube") return url; // TikTok / Instagram never autoplay, they wait for a tap
  try {
    const u = new URL(url);
    u.searchParams.set("autoplay", "0");
    u.searchParams.set("enablejsapi", "1");
    return u.toString();
  } catch {
    return url;
  }
}

function youtubePlay(frame: HTMLIFrameElement | null) {
  try {
    frame?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "playVideo", args: [] }), "*");
  } catch {
    /* ignore */
  }
}

/**
 * A personal video uploaded from someone's camera roll: a plain <video>, so unlike the social embeds nothing can be
 * restricted, there is no cross-origin chrome to crop away, and it can fill the stage. Tries to start with sound
 * (the host has just tapped something, so browsers usually allow it); if the browser refuses it starts muted and
 * offers a "Tap for sound" button. Loops, like a reel. While `active` is false it only buffers (preloading).
 */
function UploadVideo({ src, active }: { src: string; active: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const [cover, setCover] = useState(false);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (!active) {
      v.pause();
      return;
    }
    v.muted = false;
    v.play().catch(() => {
      v.muted = true;
      v.play().then(() => setNeedsTap(true)).catch(() => {});
    });
  }, [src, active]);
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
      {active && !ready && (
        <div className="pointer-events-none absolute inset-0 z-[5] flex flex-col items-center justify-center gap-3 bg-black text-center text-white">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-sunny" />
          <p className="font-display text-lg">Loading the video…</p>
        </div>
      )}
      {active && needsTap && (
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

/**
 * One video on the stage. The slot for a video is created once and keeps its iframe for its whole life: the video
 * that is "up next" sits in a slot that is laid out at full size but invisible, loading in the background; when its
 * turn comes the slot is simply switched on (`active`), so it appears instantly and nothing has to reload.
 */
function Slot({
  media,
  active,
  fullscreen,
  vp,
  reloadSignal,
  onSettled,
}: {
  media: Media;
  active: boolean;
  fullscreen: boolean;
  vp: { w: number; h: number };
  reloadSignal: number;
  onSettled: (embedUrl: string) => void;
}) {
  const { embedUrl, platform, sourceUrl, aspect, blocked } = media;
  const site = SITE[platform] ?? "the site";
  const [forced, setForced] = useState(false); // "try it here anyway"
  const showBlocked = !!blocked && !forced;
  const isUpload = platform === "upload"; // plays in a native <video>, no iframe, no slow-load timers
  const frameRef = useRef<HTMLIFrameElement>(null);

  // A slot that was loaded invisibly keeps its non-autoplaying embed; YouTube is then told to play when shown.
  const wasPreloaded = useRef(!active);
  const [reloads, setReloads] = useState(0);
  const src = wasPreloaded.current && reloads === 0 ? preloadSrc(platform, embedUrl) : embedUrl;

  // The "↻" button: reload the visible slot's iframe.
  const seenSignal = useRef(reloadSignal);
  if (!active) seenSignal.current = reloadSignal;
  useEffect(() => {
    if (active && reloadSignal !== seenSignal.current) {
      seenSignal.current = reloadSignal;
      setReloads((n) => n + 1);
    }
  }, [active, reloadSignal]);

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
  }, [reloads]);
  useEffect(() => {
    setSlow(false);
    if (!active || showBlocked || isUpload || loaded) return;
    const slowT = setTimeout(() => setSlow(true), 10000);
    const retryT = setTimeout(() => {
      if (!loadedRef.current && reloads === 0) setReloads((n) => n + 1);
    }, 16000);
    return () => {
      clearTimeout(slowT);
      clearTimeout(retryT);
    };
  }, [active, showBlocked, isUpload, loaded, reloads]);
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => setSettled(true), 1800);
    return () => clearTimeout(t);
  }, [loaded]);
  useEffect(() => {
    if (settled) onSettled(embedUrl);
  }, [settled, embedUrl, onSettled]);

  // Switched on after loading in the background: start playback where the embed allows it.
  useEffect(() => {
    if (!active || !wasPreloaded.current || platform !== "youtube" || reloads !== 0) return;
    youtubePlay(frameRef.current);
    const t = setTimeout(() => youtubePlay(frameRef.current), 700);
    return () => clearTimeout(t);
  }, [active, platform, reloads]);

  const layout = useMemo(() => layoutFor(platform, embedUrl, aspect), [platform, embedUrl, aspect]);
  const placed = useMemo(() => (vp.w && vp.h ? place(layout, vp.w, vp.h) : null), [layout, vp.w, vp.h]);
  const immersive = fullscreen && placed && !showBlocked && !isUpload;

  return (
    <div
      aria-hidden={!active}
      className={immersive ? "absolute overflow-hidden bg-black" : "absolute inset-0 overflow-hidden bg-black"}
      style={{
        ...(immersive ? { left: placed.box.left, top: placed.box.top, width: placed.box.width, height: placed.box.height } : null),
        zIndex: active ? 2 : 0,
        opacity: active ? 1 : 0,
        pointerEvents: active ? "auto" : "none",
      }}
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
      {isUpload && <UploadVideo src={embedUrl} active={active} />}
      {!showBlocked && !isUpload && (
        <iframe
          ref={frameRef}
          key={reloads}
          src={src}
          tabIndex={active ? undefined : -1}
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
      {active && !showBlocked && !isUpload && !settled && (
        <div className={`absolute inset-0 z-[5] flex flex-col items-center justify-center gap-3 bg-black p-4 text-center text-white ${slow ? "" : "pointer-events-none"}`}>
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-sunny" />
          <p className="font-display text-lg">{slow ? `Still loading from ${site}…` : "Loading the video…"}</p>
          <p className="max-w-[16rem] text-sm text-white/60">
            {slow ? "Slow connection, or the site is being fussy." : `The first one can take a few seconds. Tap play when it appears.`}
          </p>
          {slow && (
            <div className="flex flex-wrap justify-center gap-2">
              <button className="btn btn-yellow btn-sm" onClick={() => setReloads((n) => n + 1)}>
                ↻ Reload
              </button>
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
  );
}

/**
 * Vertical video player.
 *
 * Window mode: a rounded 9:16 phone frame.
 * `fullscreen`: an edge-to-edge, reels / TikTok style stage. The third-party embed is rendered at its
 * native size and cropped + scaled (see lib/immersive.ts) so just the video fills the screen.
 * `overlay` floats over the top as a translucent bar.
 *
 * The stage is one persistent element: videos live in keyed <Slot>s and are never re-parented, so toggling
 * fullscreen doesn't restart anything, and the `next` video (when given) is loaded invisibly behind the current one
 * after it has settled, then switched on the moment the game moves to it.
 * CSS overlay rather than the Fullscreen API alone so it also works on iPhone.
 */
export default function EmbedPlayer({
  embedUrl,
  platform,
  sourceUrl,
  aspect,
  blocked,
  next,
  className = "",
  fullscreen = false,
  overlay,
  reloadKey = 0,
}: {
  embedUrl: string;
  platform: string;
  sourceUrl?: string;
  aspect?: number;
  blocked?: "restricted" | "gone";
  /** the video that comes after this one: loaded invisibly so it is ready the moment we get there */
  next?: Media | null;
  className?: string;
  fullscreen?: boolean;
  overlay?: ReactNode;
  /** bump to reload the visible video's iframe (the "Reload video" button) */
  reloadKey?: number;
}) {
  const current = useMemo<Media>(() => ({ embedUrl, platform, sourceUrl, aspect, blocked }), [embedUrl, platform, sourceUrl, aspect, blocked]);
  const site = SITE[platform] ?? "the site";
  const isUpload = platform === "upload";

  const [settledUrls, setSettledUrls] = useState<ReadonlySet<string>>(() => new Set());
  const onSettled = useCallback((url: string) => setSettledUrls((s) => (s.has(url) ? s : new Set(s).add(url))), []);

  // Preload only once the current video has loaded and painted (so the two never compete for the connection),
  // and only one video ahead.
  const ahead = next && next.embedUrl !== embedUrl && canPreload(next) ? next : null;
  // (plus a short breather after a video takes the screen, so the one on screen has the connection to itself)
  const [warmFor, setWarmFor] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setWarmFor(embedUrl), 2500);
    return () => clearTimeout(t);
  }, [embedUrl]);
  const preloadNow = !!ahead && warmFor === embedUrl && (isUpload || !!blocked || settledUrls.has(embedUrl));

  const slots: Media[] = ahead && preloadNow ? [current, ahead] : [current];

  const vp = useViewport(fullscreen);

  // Whenever a video takes the screen, make sure the page behind it is scrolled to the top. On iPhone/iPad, taps
  // inside a cross-origin iframe get misplaced by however far the page is scrolled underneath, which is why play
  // buttons sometimes did nothing until a refresh.
  useIsoLayoutEffect(() => {
    if (fullscreen) window.scrollTo(0, 0);
  }, [fullscreen, embedUrl]);

  // lock page scroll / rubber-banding behind the stage
  useEffect(() => {
    if (!fullscreen) return;
    window.scrollTo(0, 0);
    const b = document.body;
    const h = document.documentElement;
    const prev = {
      overflow: b.style.overflow,
      ob: b.style.overscrollBehavior,
      position: b.style.position,
      top: b.style.top,
      left: b.style.left,
      right: b.style.right,
      hOverflow: h.style.overflow,
    };
    b.style.overflow = "hidden";
    b.style.overscrollBehavior = "none";
    b.style.position = "fixed";
    b.style.top = "0";
    b.style.left = "0";
    b.style.right = "0";
    h.style.overflow = "hidden";
    return () => {
      b.style.overflow = prev.overflow;
      b.style.overscrollBehavior = prev.ob;
      b.style.position = prev.position;
      b.style.top = prev.top;
      b.style.left = prev.left;
      b.style.right = prev.right;
      h.style.overflow = prev.hOverflow;
    };
  }, [fullscreen]);

  return (
    <div
      className={fullscreen ? "fixed inset-0 z-50 overflow-hidden bg-black" : `flex flex-col items-center ${className}`}
      style={fullscreen ? { animation: "otb-stage-in 220ms ease-out", touchAction: "manipulation" } : undefined}
    >
      <div
        key="frame"
        className={fullscreen ? "absolute inset-0 bg-black" : "relative overflow-hidden rounded-3xl border-8 border-night bg-black shadow-chunky"}
        style={fullscreen ? undefined : { height: "min(72vh, 760px)", aspectRatio: "9 / 16" }}
      >
        {/* one keyed list: when the game moves on, the invisible slot becomes the visible one without remounting */}
        {slots.map((m, i) => (
          <Slot key={m.embedUrl} media={m} active={i === 0} fullscreen={fullscreen} vp={vp} reloadSignal={reloadKey} onSettled={onSettled} />
        ))}
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

      {sourceUrl && !fullscreen && !blocked && !isUpload && (
        <a key="link" href={sourceUrl} target="_blank" rel="noreferrer" className="mt-2 text-sm text-white/50 underline hover:text-white/80">
          Not loading? Open on {site} ↗
        </a>
      )}
    </div>
  );
}
