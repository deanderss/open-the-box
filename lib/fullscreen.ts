/** Real browser fullscreen where supported (Android, desktop, iPad). Must be called from a click. */
export function enterNativeFullscreen() {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
  try {
    if (document.fullscreenElement) return;
    const p = el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen?.();
    (p as Promise<void> | undefined)?.catch?.(() => {});
  } catch {
    /* iPhone Safari has no element fullscreen; the CSS overlay still fills the screen */
  }
}

export function exitNativeFullscreen() {
  const d = document as Document & { webkitExitFullscreen?: () => Promise<void> | void };
  try {
    if (!document.fullscreenElement) return;
    const p = document.exitFullscreen ? document.exitFullscreen() : d.webkitExitFullscreen?.();
    (p as Promise<void> | undefined)?.catch?.(() => {});
  } catch {
    /* ignore */
  }
}

/**
 * On iPhone/iPad, taps inside a cross-origin iframe get misplaced by however far the page is scrolled
 * underneath it — the root cause of the "play button does nothing until a refresh" bug. Call this right
 * before anything goes fullscreen (or full-bleed), and again once it has, to be safe either way.
 */
export function scrollToTop() {
  window.scrollTo(0, 0);
}
