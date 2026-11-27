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
