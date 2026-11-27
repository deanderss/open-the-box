"use client";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { layoutFor, place } from "@/lib/immersive";
import { openInApp } from "@/lib/openInApp";
import { scrollToTop } from "@/lib/fullscreen";

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

// TEMPORARILY DISABLED (2026-11-26, by request): the "Play on TV" native-cast button is being revisited — for
// now every clip just relies on the host's normal iOS screen mirroring, same as before this feature existed.
// Flip back to `true` to re-enable; `useAirPlay` and all the readiness/casting plumbing below are left in
// place untouched so turning it back on is a one-line change, not a re-implementation.
const AIRPLAY_FEATURE_ENABLED = false;

type Media = {
  embedUrl: string;
  platform: string;
  sourceUrl?: string;
  /** video height / width when the server knows it (Instagram) */
  aspect?: number;
  /** the site won't play this video inside other apps: show an "open it there" panel instead of a black frame */
  blocked?: "restricted" | "gone";
  /** Instagram only: a direct, CORS-enabled MP4 link (lib/igDirect.ts) — played in a native <video> instead of the embed */
  directUrl?: string;
};

/** A personal upload, or an Instagram reel with a resolved direct link: plays in the single shared native
 *  <video> (see StageNativeVideo) instead of a cross-origin iframe. */
const isNativeCandidate = (m: Media) => m.platform === "upload" || (m.platform === "instagram" && !!m.directUrl);

/** Which non-native videos can be loaded invisibly ahead of time as an iframe. Facebook is left out: its
 *  player can't be told to start later. A `blocked` video can't be usefully preloaded as an iframe — it'll
 *  just show the panel — so it's left out too (a blocked video *with* a direct link is a native candidate
 *  above, and gets preloaded as a native video instead, not an iframe). */
const canPreloadIframe = (m: Media) => !m.blocked && m.platform !== "facebook";

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

/** The "open it in the app" fallback, shared by the iframe Slot (a restricted/gone embed) and the native stage
 *  (a resolved Instagram direct link that stopped working at runtime). */
function BlockedPanel({
  platform,
  blocked,
  sourceUrl,
  fullscreen,
  onTryAnyway,
}: {
  platform: string;
  blocked: "restricted" | "gone";
  sourceUrl?: string;
  fullscreen: boolean;
  onTryAnyway?: () => void;
}) {
  const site = SITE[platform] ?? "the site";
  return (
    <div
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
      <div className="flex flex-col items-center gap-1 text-xs text-white/70">
        {sourceUrl && (
          <a className="underline hover:text-white/80" href={sourceUrl} target="_blank" rel="noreferrer">
            Open in the browser instead
          </a>
        )}
        {onTryAnyway && (
          <button type="button" className="underline hover:text-white/80" onClick={onTryAnyway}>
            Try playing it here anyway
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The one native <video> element for the whole stage: a personal upload, or an Instagram reel resolved to a
 * direct link (lib/igDirect.ts), plays through it — only its `src` changes between clips — instead of a fresh
 * element per clip. This stays mounted for the entire game (see EmbedPlayer below), visible only while the
 * current clip is a native one, rather than being created and destroyed with each <Slot>: an AirPlay
 * connection is tied to a specific element, so swapping `src` in place gives the best chance it survives from
 * one native clip to the next instead of asking the host to pick the TV again every time (confirming that
 * actually holds across a real `src` swap needs a real device — if it doesn't, the "Play on TV" button is
 * still one tap away per clip).
 *
 * Tries to start with sound (the host has just tapped something, so browsers usually allow it); if the browser
 * refuses it starts muted and offers a "Tap for sound" button. Loops, like a reel. If the file never becomes
 * playable (bad/expired link, decode failure, or a stall) `onError` fires once, so a resolved-but-dead
 * Instagram link can fall back to the embed instead of a black screen — an upload has nowhere else to fall
 * back to, so it simply doesn't pass one.
 */
function StageNativeVideo({
  videoRef,
  src,
  onError,
}: {
  videoRef: RefObject<HTMLVideoElement>;
  /** null: nothing native to show right now — the element stays mounted, just paused and hidden by the caller */
  src: string | null;
  onError?: () => void;
}) {
  const [ready, setReady] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const [cover, setCover] = useState(false);
  const firedRef = useRef(false);
  const fail = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    onError?.();
  }, [onError]);
  // `onError` (and so `fail`) gets a brand new identity on every parent re-render — the caller passes an
  // inline arrow — but the play effect below must only ever restart playback when `src` itself changes, not
  // whenever some unrelated prop higher up causes a re-render. Reading `fail` through a ref instead of as a
  // dependency keeps the latest version callable without that effect re-running (and replaying/un-muting the
  // video from the top) on every re-render — this was causing the native stage to stutter.
  const failRef = useRef(fail);
  useEffect(() => {
    failRef.current = fail;
  }, [fail]);

  useEffect(() => {
    firedRef.current = false;
    setReady(false);
    setNeedsTap(false);
  }, [src]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!src) {
      v.pause();
      return;
    }
    if (v.getAttribute("src") !== src) {
      v.src = src;
      v.load();
    }
    v.muted = false;
    v.play().catch(() => {
      v.muted = true;
      v.play().then(() => setNeedsTap(true)).catch(() => failRef.current());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, videoRef]);

  // A dead/expired link, or a connection that never progresses, doesn't fire any event at all: give up and
  // let the caller fall back after a few seconds rather than sit on a black screen forever.
  useEffect(() => {
    if (!src || ready) return;
    const t = setTimeout(() => failRef.current(), 9000);
    return () => clearTimeout(t);
  }, [src, ready]);

  // Safari's proprietary AirPlay opt-out attribute — "allow" is already the default, but setting it explicitly
  // documents intent and survives if that default ever changes. Not in React's HTML attribute typings, so it's
  // spread in rather than written as a normal JSX prop.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const airplayAttr: any = { "x-webkit-airplay": "allow" };

  return (
    <>
      <video
        ref={videoRef}
        playsInline
        loop
        controls
        {...airplayAttr}
        preload="auto"
        onCanPlay={() => setReady(true)}
        onError={fail}
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
      {src && !ready && (
        <div className="pointer-events-none absolute inset-0 z-[5] flex flex-col items-center justify-center gap-3 bg-black text-center text-white">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-sunny" />
          <p className="font-display text-lg">Loading the video…</p>
        </div>
      )}
      {src && needsTap && (
        <button
          type="button"
          className="btn btn-yellow btn-sm absolute bottom-16 left-1/2 z-[6] -translate-x-1/2"
          onClick={() => {
            if (videoRef.current) videoRef.current.muted = false;
            setNeedsTap(false);
          }}
        >
          🔊 Tap for sound
        </button>
      )}
    </>
  );
}

/** A hidden, muted, never-played <video> that exists only to get the upcoming native clip's bytes into the
 *  browser's cache ahead of time — not a second playable element, so there's never a second AirPlay target on
 *  screen. Keyed by `src` in the caller, so a new upcoming clip just mounts a fresh one. */
function NativeBufferPreload({ src }: { src: string }) {
  return <video src={src} muted preload="auto" aria-hidden style={{ display: "none" }} />;
}

/**
 * Wires up the "Play on TV" button for `EmbedPlayer`'s single persistent native <video> (see
 * `StageNativeVideo` above — this hook just reads/triggers the same element through the ref `EmbedPlayer`
 * already holds, so no extra plumbing between the two components is needed).
 *
 * Two completely separate AirPlay/cast APIs exist and this picks one path per mount, rather than mixing them:
 *  - **Remote Playback API** (`video.remote`, Safari 13.1+ *and* Chrome/Cast): `remote.prompt()` opens
 *    the system picker; `remote.addEventListener("connect"/"disconnect"/"connecting", ...)` tracks state.
 *  - **Older WebKit AirPlay API** (iOS Safari only, still the only one on some older versions):
 *    `video.webkitShowPlaybackTargetPicker()` opens the picker; the `webkitcurrentplaybacktargetiswirelesschanged`
 *    event plus `video.webkitCurrentPlaybackTargetIsWireless` tracks state.
 * Neither is in React's typings, so both are read through small `any` casts. Everything here is wrapped so
 * that any feature-detection surprise just leaves `supported: false` (no button shown) rather than throwing —
 * normal local playback must never be put at risk by this.
 *
 * Also tracks `ready`: whether the *current* clip's media has actually loaded far enough
 * (`readyState >= HAVE_CURRENT_DATA`) for a cast picker to do anything useful. This used to be missing, and
 * was the main cause of "Play on TV" being flaky: the button's own visibility was driven only by `isNativeNow`
 * (a platform/URL check that flips the instant a new clip becomes "current"), while the `<video>` element's
 * `src` is assigned a render later, inside `StageNativeVideo`'s own effect. A tap landing in that gap called
 * `remote.prompt()`/`webkitShowPlaybackTargetPicker()` on a `<video>` with `networkState === NETWORK_EMPTY`,
 * which both APIs silently ignore (by design, this hook fails open) — so the very first tap after a clip
 * changes could do nothing, while a second tap a moment later worked. Listening directly on the element for
 * `loadedmetadata`/`loadeddata`/`canplay`/`emptied` (rather than re-deriving it from props) means `ready`
 * tracks the one persistent `<video>` element's actual state across every clip it ever plays, not just the
 * first one.
 */
function useAirPlay(videoRef: RefObject<HTMLVideoElement>) {
  const [supported, setSupported] = useState(false);
  const [casting, setCasting] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const updateReady = () => setReady(v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA);
    updateReady();
    v.addEventListener("loadedmetadata", updateReady);
    v.addEventListener("loadeddata", updateReady);
    v.addEventListener("canplay", updateReady);
    v.addEventListener("emptied", updateReady); // fires when a new `src` resets readiness back to zero
    return () => {
      v.removeEventListener("loadedmetadata", updateReady);
      v.removeEventListener("loadeddata", updateReady);
      v.removeEventListener("canplay", updateReady);
      v.removeEventListener("emptied", updateReady);
    };
  }, [videoRef]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyV = v as any;

    // Prefer the Remote Playback API when it's actually usable (some browsers expose `remote` but throw on
    // first touch if the feature is disabled by a permissions policy, so this doesn't just check `"remote" in v`).
    try {
      const remote = anyV.remote;
      if (remote && typeof remote.addEventListener === "function") {
        const onConnecting = () => setCasting(true);
        const onConnect = () => setCasting(true);
        const onDisconnect = () => setCasting(false);
        remote.addEventListener("connecting", onConnecting);
        remote.addEventListener("connect", onConnect);
        remote.addEventListener("disconnect", onDisconnect);
        setSupported(true);
        return () => {
          remote.removeEventListener("connecting", onConnecting);
          remote.removeEventListener("connect", onConnect);
          remote.removeEventListener("disconnect", onDisconnect);
        };
      }
    } catch {
      /* fall through to the WebKit fallback below */
    }

    // Fallback: the older WebKit-only AirPlay API (no `remote`, but this is still present on it).
    if (typeof anyV.webkitShowPlaybackTargetPicker === "function") {
      const onChange = () => setCasting(!!anyV.webkitCurrentPlaybackTargetIsWireless);
      v.addEventListener("webkitcurrentplaybacktargetiswirelesschanged", onChange);
      onChange(); // pick up a session already in progress (e.g. started from Control Center)
      setSupported(true);
      return () => v.removeEventListener("webkitcurrentplaybacktargetiswirelesschanged", onChange);
    }

    setSupported(false);
  }, [videoRef]);

  // Must run synchronously inside the button's own onClick — not after an `await` — or Safari won't treat it
  // as triggered by a user gesture and silently ignores it. The caller also gates the button itself on
  // `ready` (see above) so this normally never gets reached too early, but the check is kept here too in
  // case `trigger` is ever wired up to something else that doesn't check it first.
  const trigger = useCallback(() => {
    const v = videoRef.current;
    if (!v || v.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyV = v as any;
    try {
      const remote = anyV.remote;
      if (remote && typeof remote.prompt === "function") {
        remote.prompt().catch(() => {
          try {
            anyV.webkitShowPlaybackTargetPicker?.();
          } catch {
            /* nothing more to try — fail open, normal playback is unaffected either way */
          }
        });
        return;
      }
    } catch {
      /* fall through */
    }
    try {
      anyV.webkitShowPlaybackTargetPicker?.();
    } catch {
      /* fail open */
    }
  }, [videoRef]);

  return { supported, casting, ready, trigger };
}

/**
 * One *iframe* video on the stage (TikTok, YouTube, Facebook, or an Instagram embed with no direct link, or one
 * that's restricted/gone). The slot is created once and keeps its iframe for its whole life: the video that is
 * "up next" sits in a slot that is laid out at full size but invisible, loading in the background; when its
 * turn comes the slot is simply switched on (`active`), so it appears instantly and nothing has to reload.
 * Native videos (uploads, resolved Instagram links) never reach this component — see StageNativeVideo.
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
    if (!active || showBlocked || loaded) return;
    const slowT = setTimeout(() => setSlow(true), 10000);
    const retryT = setTimeout(() => {
      if (!loadedRef.current && reloads === 0) setReloads((n) => n + 1);
    }, 16000);
    return () => {
      clearTimeout(slowT);
      clearTimeout(retryT);
    };
  }, [active, showBlocked, loaded, reloads]);
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
  const immersive = fullscreen && placed && !showBlocked;

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
      {showBlocked && blocked && (
        <BlockedPanel platform={platform} blocked={blocked} sourceUrl={sourceUrl} fullscreen={fullscreen} onTryAnyway={() => setForced(true)} />
      )}
      {!showBlocked && (
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
      {active && !showBlocked && !settled && (
        <div className={`absolute inset-0 z-[5] flex flex-col items-center justify-center gap-3 bg-black p-4 text-center text-white ${slow ? "" : "pointer-events-none"}`}>
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-sunny" />
          <p className="font-display text-lg">{slow ? `Still loading from ${site}…` : "Loading the video…"}</p>
          <p className="max-w-[16rem] text-sm text-white/70">
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
 * The stage is one persistent element: iframe videos live in keyed <Slot>s that are never re-parented, native
 * videos (uploads, resolved Instagram links) all share the single <StageNativeVideo> below, and neither is ever
 * torn down just because `fullscreen` toggles or the game moves to the next video — only `next` (when given) is
 * loaded invisibly ahead of time (as an iframe, or a hidden buffering native <video>) and switched to the moment
 * the game gets there. CSS overlay rather than the Fullscreen API alone so it also works on iPhone.
 */
/** Wrapped in React.memo: its props (the current video, the one warming up next, the overlay) only ever
 *  change on a real poll, not on every tick of the countdown or every unrelated re-render higher up the
 *  tree, so there's no reason for this (fairly heavy — it owns a cross-origin iframe) tree to re-render
 *  along with those. */
function EmbedPlayer({
  embedUrl,
  platform,
  sourceUrl,
  aspect,
  blocked,
  directUrl,
  next,
  className = "",
  fullscreen = false,
  overlay,
  pinOverlay = false,
  reloadKey = 0,
}: {
  embedUrl: string;
  platform: string;
  sourceUrl?: string;
  aspect?: number;
  blocked?: "restricted" | "gone";
  /** Instagram only: a direct, CORS-enabled MP4 link (lib/igDirect.ts) — played natively instead of the embed */
  directUrl?: string;
  /** the video that comes after this one: loaded invisibly so it is ready the moment we get there */
  next?: Media | null;
  className?: string;
  fullscreen?: boolean;
  /** called with whether the overlay is currently in its full (true) or auto-hidden, minimal (false) state —
   *  see the `overlayVisible` effect below */
  overlay?: (visible: boolean) => ReactNode;
  /** keep the full overlay up regardless of the idle timer (e.g. a sheet or menu opened from it is still open) */
  pinOverlay?: boolean;
  /** bump to reload the visible video's iframe (the "Reload video" button) */
  reloadKey?: number;
}) {
  const current = useMemo<Media>(
    () => ({ embedUrl, platform, sourceUrl, aspect, blocked, directUrl }),
    [embedUrl, platform, sourceUrl, aspect, blocked, directUrl]
  );
  const site = SITE[platform] ?? "the site";
  const isUpload = platform === "upload";

  // The current clip plays natively unless it's an Instagram link that already failed once at runtime
  // (expired, or the CDN refused it) — then it falls back to the iframe Slot below (which shows the "open it
  // in the app" panel instead, if the reel is also known `blocked`). Resets whenever a new clip takes over.
  const [directFailed, setDirectFailed] = useState(false);
  useEffect(() => setDirectFailed(false), [embedUrl]);
  const useDirect = platform === "instagram" && !!directUrl && !directFailed;
  const isNativeNow = isUpload || useDirect;
  const nativeSrc = isNativeNow ? (isUpload ? embedUrl : directUrl!) : null;
  const onDirectError = useCallback(() => setDirectFailed(true), []);

  const [settledUrls, setSettledUrls] = useState<ReadonlySet<string>>(() => new Set());
  const onSettled = useCallback((url: string) => setSettledUrls((s) => (s.has(url) ? s : new Set(s).add(url))), []);

  // Preload only once the current video has loaded and painted (so the two never compete for the connection),
  // and only one video ahead — as a native buffer if it's a native candidate, otherwise as an iframe Slot.
  const ahead = next && next.embedUrl !== embedUrl ? next : null;
  const aheadNative = !!ahead && isNativeCandidate(ahead);
  const aheadIframe = !!ahead && !aheadNative && canPreloadIframe(ahead);
  // (plus a short breather after a video takes the screen, so the one on screen has the connection to itself)
  const [warmFor, setWarmFor] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setWarmFor(embedUrl), 2500);
    return () => clearTimeout(t);
  }, [embedUrl]);
  const preloadNow = (aheadNative || aheadIframe) && warmFor === embedUrl && (isNativeNow || !!blocked || settledUrls.has(embedUrl));

  // The current clip only needs an iframe Slot while it isn't playing natively (never for an upload; for
  // Instagram, until/unless it falls back) — StageNativeVideo covers it otherwise. The "ahead" iframe Slot (if
  // any) is included independently of that, since the current clip being native doesn't stop the *next* one —
  // if it's an iframe platform — from needing to warm up in the background.
  const slots: Media[] = [...(!isNativeNow ? [current] : []), ...(aheadIframe && preloadNow ? [ahead!] : [])];

  const vp = useViewport(fullscreen);

  // The one native <video> for the whole stage (see StageNativeVideo) — mounted for as long as EmbedPlayer is,
  // regardless of `fullscreen` or which video is current, so an AirPlay connection isn't torn down and
  // re-asked-for every time the game moves between native and non-native clips.
  const nativeVideoRef = useRef<HTMLVideoElement>(null);

  // "Play on TV": true single-tap AirPlay/Remote-Playback casting only works for the current clip while it's
  // actually playing through the native <video> above (an upload, or any platform resolved to a direct file
  // — today just Instagram reels via `directUrl`, but this isn't Reels-specific: the same `isNativeNow` check
  // covers every platform that has one). `casting` naturally flips back to false on disconnect, or stays
  // false if the next clip isn't native and this effect's listeners don't fire — no extra teardown needed for
  // either case, playback just continues locally exactly as it did before this feature existed.
  //
  // For every *iframe* platform (TikTok, YouTube, Facebook, or Instagram with no resolved direct link) there
  // is no `<video>` element on our side at all — the player lives inside a cross-origin iframe we can't reach
  // from JS — so the Remote Playback API and WebKit's AirPlay API have nothing to call `.prompt()`/
  // `.webkitShowPlaybackTargetPicker()` on. That's a real platform limitation, not a bug: there is no way for
  // this page to cast just those bytes to a TV. Rather than hiding "Play on TV" for four of the five accepted
  // media types (which is the bug being fixed here — it previously only ever appeared for a resolved
  // Instagram reel), the same button still shows for iframe clips on any browser that has *some* casting
  // capability, and tapping it explains the limitation and points at the OS-level fallback that does work for
  // any on-screen content: mirroring the whole screen (iOS Control Center's "Screen Mirroring", which still
  // sends the TikTok/YouTube/Facebook player to the TV, just as mirrored pixels instead of a native stream).
  const airplay = useAirPlay(nativeVideoRef);
  // `ready` guards against the race that made casting a *native* clip flaky: the clip becomes "current"
  // (isNativeNow flips true) a render before the <video>'s `src` is actually assigned, so a tap landing in
  // that gap used to silently no-op. There's no equivalent readiness gate needed for the iframe/mirroring
  // button below — it never touches the video element at all.
  const showNativeCastButton = AIRPLAY_FEATURE_ENABLED && isNativeNow && airplay.supported && airplay.ready;
  const showMirrorButton = AIRPLAY_FEATURE_ENABLED && !isNativeNow && !blocked && airplay.supported;
  const showAirplayButton = showNativeCastButton || showMirrorButton;
  const showCastingPlaceholder = AIRPLAY_FEATURE_ENABLED && isNativeNow && airplay.casting;
  const [showMirrorTip, setShowMirrorTip] = useState(false);
  useEffect(() => setShowMirrorTip(false), [embedUrl]);

  // Whenever a video takes the screen, make sure the page behind it is scrolled to the top. On iPhone/iPad, taps
  // inside a cross-origin iframe get misplaced by however far the page is scrolled underneath, which is why play
  // buttons sometimes did nothing until a refresh.
  useIsoLayoutEffect(() => {
    if (fullscreen) scrollToTop();
  }, [fullscreen, embedUrl]);

  // Auto-hide the fullscreen overlay (buttons, counts, the gradient behind them) after a few seconds of no
  // touches, down to just the thin timer bar and a small countdown (see StageView's overlay builder). There's
  // nothing visually wrong with leaving it all up, but every one of those is a pixel screen mirroring/AirPlay
  // has to keep re-encoding, so the stage is at its lightest right when the host isn't actually using it. Any
  // tap on the stage — including a tap on a now-faded button — brings it back; `pinOverlay` (an open sheet or
  // menu) holds it up regardless of the idle timer.
  const [overlayVisible, setOverlayVisible] = useState(true);
  // A counter, not just the boolean: tapping again while the overlay is *already* visible must still push the
  // 4s clock back out, but setting the same boolean value twice wouldn't re-run an effect keyed on it.
  const [wakeTick, setWakeTick] = useState(0);
  const wake = useCallback(() => {
    setOverlayVisible(true);
    setWakeTick((n) => n + 1);
  }, []);
  // Depend on `!!overlay`, not `overlay` itself: StageView passes an inline render-prop function whose
  // identity changes on every real state change (a lock-in, a "busy" toggle, a menu open) even when nothing
  // about the overlay's presence actually changed — keying on the function's identity re-armed this effect
  // (and so brought the full overlay back) on every one of those, defeating the auto-hide almost entirely.
  const hasOverlay = !!overlay;
  useEffect(() => {
    if (!fullscreen || !hasOverlay) return;
    wake(); // a fresh video (or entering fullscreen) always starts with the full overlay up
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen, hasOverlay, embedUrl]);
  useEffect(() => {
    if (!fullscreen || !hasOverlay || pinOverlay) return;
    const t = setTimeout(() => setOverlayVisible(false), 4000);
    return () => clearTimeout(t);
  }, [fullscreen, hasOverlay, pinOverlay, wakeTick]);
  useEffect(() => {
    if (pinOverlay) setOverlayVisible(true); // whatever opened (sheet/menu) should never appear already-fading
  }, [pinOverlay]);

  // lock page scroll / rubber-banding behind the stage
  useEffect(() => {
    if (!fullscreen) return;
    scrollToTop();
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
      onPointerDown={fullscreen && overlay ? wake : undefined}
    >
      <div
        key="frame"
        className={fullscreen ? "absolute inset-0 bg-black" : "relative overflow-hidden rounded-3xl border-8 border-night bg-black shadow-chunky"}
        style={fullscreen ? undefined : { height: "min(72vh, 760px)", aspectRatio: "9 / 16" }}
      >
        {/* one keyed list: when the game moves on, the invisible slot becomes the visible one without remounting.
            `active` is keyed by matching embedUrl, not array position — when the current clip is native, only
            an "ahead" iframe Slot (if any) is in this list at all, and it must stay marked inactive/preloading. */}
        {slots.map((m) => (
          <Slot key={m.embedUrl} media={m} active={m.embedUrl === embedUrl} fullscreen={fullscreen} vp={vp} reloadSignal={reloadKey} onSettled={onSettled} />
        ))}

        {/* The moment an Instagram direct link fails at runtime, `directFailed` flips `isNativeNow` false above,
            this wrapper hides, and the iframe Slot (re-added to `slots`) takes over — showing the blocked panel
            itself if the reel is also known restricted/gone, exactly as if it had never resolved a direct link
            at all. So this wrapper never needs its own copy of that fallback. */}
        <div
          aria-hidden={!isNativeNow}
          className="absolute inset-0 overflow-hidden bg-black"
          style={{ zIndex: isNativeNow ? 2 : 0, opacity: isNativeNow ? 1 : 0, pointerEvents: isNativeNow ? "auto" : "none" }}
        >
          <StageNativeVideo videoRef={nativeVideoRef} src={nativeSrc} onError={useDirect ? onDirectError : undefined} />

          {/* While AirPlay is actually streaming the file to the TV, the phone doesn't need to keep
              decoding and redrawing the same frames locally — swap the video's visible area for a plain
              placeholder (the <video> element itself, and everything else on screen, is untouched: it keeps
              playing, the overlay/controls/Answer sheet all stay exactly as usable as before). */}
          {showCastingPlaceholder && (
            <div className="pointer-events-none absolute inset-0 z-[6] flex flex-col items-center justify-center gap-2 bg-night text-center text-white">
              <p className="text-5xl">📺</p>
              <p className="font-display text-xl">Playing on your TV</p>
              <p className="max-w-[16rem] text-sm text-white/70">Streaming straight to the Apple TV over AirPlay.</p>
            </div>
          )}
        </div>

        {/* Not shown, not played — just gets the upcoming native clip's bytes warm in the browser's cache. */}
        {aheadNative && preloadNow && <NativeBufferPreload key={ahead!.embedUrl} src={(ahead!.directUrl ?? ahead!.embedUrl)!} />}
      </div>

      {fullscreen && overlay && (
        <div
          key="bar"
          className={`pointer-events-none absolute inset-x-0 top-0 z-10 pb-6 ${overlayVisible ? "bg-gradient-to-b from-black/80 via-black/40 to-transparent" : ""}`}
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <div className="pointer-events-auto">{overlay(overlayVisible)}</div>
        </div>
      )}

      {/* "Play on TV": deliberately NOT threaded through the `overlay` prop above — StageView doesn't need to
          know anything about AirPlay, EmbedPlayer already owns the native <video> and its ref. Lives in its
          own corner of the stage so it never competes for space with StageView's buttons row, but fades with
          the same `overlayVisible` idle timer so it doesn't sit there as one more static thing to re-encode
          while the host isn't touching the screen. For a native clip, tapping it again while already casting
          reopens the same system picker, which is where iOS puts the "Stop Mirroring"/disconnect option — no
          separate disconnect code path is needed here. For an iframe clip (see `showMirrorButton` above) it
          instead opens a small tip explaining the mirroring fallback, since there's nothing to hand a native
          picker. */}
      {fullscreen && showAirplayButton && (
        <div
          className={`absolute bottom-0 right-0 z-[8] flex flex-col items-end gap-2 pb-4 pr-4 transition-opacity duration-200 ${
            overlayVisible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
          }`}
          style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        >
          {showMirrorTip && (
            <div className="max-w-[15rem] rounded-2xl bg-night p-3 text-left text-xs text-white shadow-chunky">
              <p className="mb-1 font-display text-sm">📺 Playing {site} on a TV</p>
              <p className="text-white/70">
                {site} plays inside its own player here, so this can&apos;t send just the video to a TV. Open
                Control Center and tap <span className="text-white">Screen Mirroring</span> to show the whole
                screen instead.
              </p>
              <button type="button" className="mt-2 underline" onClick={() => setShowMirrorTip(false)}>
                Got it
              </button>
            </div>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            tabIndex={overlayVisible ? undefined : -1}
            aria-hidden={!overlayVisible}
            aria-label={showNativeCastButton ? (airplay.casting ? "Stop playing on TV" : "Play on TV") : "How to play on TV"}
            onClick={showNativeCastButton ? airplay.trigger : () => setShowMirrorTip((v) => !v)}
          >
            <span aria-hidden>📺</span> {showNativeCastButton && airplay.casting ? "On TV" : "Play on TV"}
          </button>
        </div>
      )}

      {sourceUrl && !fullscreen && !blocked && !isNativeNow && (
        <a key="link" href={sourceUrl} target="_blank" rel="noreferrer" className="mt-2 text-sm text-white/70 underline hover:text-white/80">
          Not loading? Open on {site} ↗
        </a>
      )}
    </div>
  );
}

export default memo(EmbedPlayer);
