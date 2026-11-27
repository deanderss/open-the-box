"use client";
import { useEffect, useRef } from "react";

interface WakeLockSentinelLike {
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
  removeEventListener: (type: "release", listener: () => void) => void;
}
interface NavigatorWithWakeLock {
  wakeLock: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
}

/**
 * Keeps the screen awake while `active` is true (phone controller while the game's running, host screen
 * until it's finished) — important for AirPlay/mirroring, where the phone dimming or auto-locking cuts the
 * session. Browsers release the lock whenever the tab goes into the background, so we re-request it the
 * moment the tab becomes visible again if we're still supposed to be holding it. Quietly does nothing on
 * browsers without the API (iOS Safari added support in 16.4; older versions just skip it).
 */
export function useWakeLock(active: boolean) {
  const lock = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let cancelled = false;
    const nav = navigator as unknown as NavigatorWithWakeLock;

    const onReleased = () => {
      // The OS/browser itself releases the lock for reasons that aren't just "we gave it up" — some devices
      // drop it on any trip to Control Center/the app switcher, not only when the tab is actually hidden. The
      // visibilitychange re-request below only fires if it ever notices the lock is gone; this keeps the ref
      // itself in sync with reality so that check actually has something to notice.
      lock.current = null;
    };

    async function request() {
      try {
        const l = await nav.wakeLock.request("screen");
        if (cancelled) {
          l.release().catch(() => {});
          return;
        }
        l.addEventListener("release", onReleased);
        lock.current = l;
      } catch {
        /* denied, unsupported right now, or page not visible yet — harmless to just skip */
      }
    }

    request();
    const onVisible = () => {
      if (typeof document !== "undefined" && !document.hidden && !lock.current) request();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      lock.current?.removeEventListener("release", onReleased);
      lock.current?.release().catch(() => {});
      lock.current = null;
    };
  }, [active]);
}
