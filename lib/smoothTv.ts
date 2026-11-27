"use client";
// "Smooth TV mode": host-screen settings that keep the phone from doing extra work while it is screen
// mirroring to a TV (every frame of the page is re-encoded and sent over Wi-Fi, so anything else that
// competes for the CPU or the radio shows up as dropped frames). Only the host screen reads this.
//
// Stored per device like the mute setting. Unset means "on for iPhone/iPad" (the devices that mirror) and
// "off" everywhere else, so a laptop on HDMI keeps the instant next-video preload.
import { useCallback, useSyncExternalStore } from "react";

const KEY = "otb-smooth-tv";
const listeners = new Set<() => void>();

function defaultOn() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iPadOS reports itself as a Mac, but a Mac has no touch screen.
  return /iPhone|iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function isSmoothTv(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    /* ignore */
  }
  return defaultOn();
}

export function setSmoothTv(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** `[on, setOn]`. Server render and first paint say "off", then the real value is read on the client. */
export function useSmoothTv(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, isSmoothTv, () => false);
  const set = useCallback((v: boolean) => setSmoothTv(v), []);
  return [on, set];
}
