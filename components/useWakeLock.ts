"use client";
import { useEffect, useRef } from "react";

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}
interface NavigatorWithWakeLock {
  wakeLock: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
}

/**
 * Keeps the screen awake while `active` is true (phone controller while the game's running, host screen
 * until it's finished). Browsers release the lock whenever the tab goes into the background, so we
 * re-request it the moment the tab becomes visible again if we're still supposed to be holding it. Quietly
 * does nothing on browsers without the API (notably iOS Safari, as of this writing).
 */
export function useWakeLock(active: boolean) {
  const lock = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let cancelled = false;
    const nav = navigator as unknown as NavigatorWithWakeLock;

    async function request() {
      try {
        const l = await nav.wakeLock.request("screen");
        if (cancelled) {
          l.release().catch(() => {});
          return;
        }
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
      lock.current?.release().catch(() => {});
      lock.current = null;
    };
  }, [active]);
}
