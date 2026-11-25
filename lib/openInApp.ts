/**
 * "Open this video in the real app" for videos that can't play inside the game.
 *
 * A plain https link only opens the website in a browser tab. On a phone we try the app itself:
 *  - Android: an `intent://` URL for the app's package (the app handles the https link; if it isn't installed
 *    Android falls back to the website by itself).
 *  - iOS: the app's URL scheme (Instagram needs the numeric media id, which is the shortcode read as base 64).
 *  - Anything else (desktop): the website in a new tab.
 * Must be called from a click handler (browsers block navigation that isn't a user gesture).
 */

const IG_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Instagram shortcode -> numeric media id (the first 11 characters carry the id). */
export function instagramMediaId(code: string): string | null {
  let id = BigInt(0);
  for (const ch of code.slice(0, 11)) {
    const i = IG_ALPHABET.indexOf(ch);
    if (i < 0) return null;
    id = id * BigInt(64) + BigInt(i);
  }
  return id.toString();
}

const ANDROID_PACKAGE: Record<string, string> = {
  instagram: "com.instagram.android",
  tiktok: "com.zhiliaoapp.musically",
  youtube: "com.google.android.youtube",
  facebook: "com.facebook.katana",
};

/** The URL-scheme link for iOS, or null if we don't know one for this video. */
export function iosAppLink(platform: string, sourceUrl: string): string | null {
  try {
    const u = new URL(sourceUrl);
    if (platform === "instagram") {
      const code = u.pathname.match(/\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/)?.[1];
      const id = code ? instagramMediaId(code) : null;
      return id ? `instagram://media?id=${id}` : null;
    }
    if (platform === "youtube") {
      const id = u.pathname.match(/\/shorts\/([A-Za-z0-9_-]{11})/)?.[1];
      return id ? `youtube://www.youtube.com/shorts/${id}` : null;
    }
    if (platform === "tiktok") {
      const id = u.pathname.match(/\/(?:video|photo)\/(\d+)/)?.[1];
      return id ? `snssdk1233://aweme/detail/${id}` : null;
    }
    if (platform === "facebook") return `fb://facewebmodal/f?href=${encodeURIComponent(sourceUrl)}`;
  } catch {
    /* fall through */
  }
  return null;
}

/** Android intent link that opens the app on this https URL, with the website as the fallback. */
export function androidIntentLink(platform: string, sourceUrl: string): string | null {
  const pkg = ANDROID_PACKAGE[platform];
  if (!pkg) return null;
  try {
    const u = new URL(sourceUrl);
    return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=${pkg};S.browser_fallback_url=${encodeURIComponent(sourceUrl)};end`;
  } catch {
    return null;
  }
}

export function openInApp(platform: string, sourceUrl: string) {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  const link = ios ? iosAppLink(platform, sourceUrl) : android ? androidIntentLink(platform, sourceUrl) : null;
  if (link) window.location.href = link;
  else window.open(sourceUrl, "_blank", "noopener");
}
