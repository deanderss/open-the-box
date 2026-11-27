"use client";
import { useEffect, useState } from "react";

const QUERY = "(max-height: 500px)";

/** True on a short screen: a phone turned sideways (often the host phone mirroring to a TV). The full-screen
 *  reveal and awards shrink their biggest pieces so everything, including the buttons, still fits. */
export function useShortScreen(): boolean {
  // Read after mount only, so a server-rendered page and its first client render always agree.
  const [short, setShort] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const on = () => setShort(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return short;
}
