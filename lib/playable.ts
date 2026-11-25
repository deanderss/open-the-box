/**
 * Server-side "will this video actually play inside the game?" check.
 *
 * Third-party embeds fail in ways the page can't see (the player is a cross-origin iframe):
 *  - Instagram: some reels are never playable inline. The embed shows "Watch on Instagram" and tapping
 *    play opens instagram.com in a new tab. Deleted reels show "link may be broken". Both are visible in the
 *    embed page itself: playable reels ship a `video_url`; restricted ones have a WatchOnInstagram button.
 *  - YouTube: oEmbed answers 401 when the owner disabled embedding and 404 when the video is gone.
 *  - TikTok: oEmbed fails for removed/private videos.
 * Everything fails OPEN: if a check errors, times out or is ambiguous we say "unknown" and play the video.
 */

export type Playability = "ok" | "restricted" | "gone" | "unknown";

type Cached = { v: Playability; t: number };
const cache = new Map<string, Cached>();
const TTL_MS = 30 * 60 * 1000;
const UNKNOWN_TTL_MS = 2 * 60 * 1000;

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

async function get(url: string, headers: Record<string, string> = {}, ms = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, headers, redirect: "follow", cache: "no-store" });
  } finally {
    clearTimeout(t);
  }
}

async function instagram(embedUrl: string): Promise<Playability> {
  // photo posts (/p/) have no video to look for
  if (!/\/(reel|tv)\//.test(embedUrl)) return "ok";
  const res = await get(embedUrl, { "User-Agent": MOBILE_UA, "Accept-Language": "en-US,en;q=0.9" });
  if (res.status === 404) return "gone";
  const html = await res.text();
  if (/may be broken, or the post may have been removed/i.test(html)) return "gone";
  if (/"video_url"/.test(html) || /\\"video_url\\"/.test(html)) return "ok";
  if (/class="WatchOnInstagram"/.test(html)) return "restricted";
  return "unknown";
}

async function youtube(sourceUrl: string): Promise<Playability> {
  const res = await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(sourceUrl)}`);
  if (res.status === 200) return "ok";
  if (res.status === 401 || res.status === 403) return "restricted"; // embedding disabled by the owner
  if (res.status === 404 || res.status === 400) return "gone";
  return "unknown";
}

async function tiktok(sourceUrl: string): Promise<Playability> {
  const res = await get(`https://www.tiktok.com/oembed?url=${encodeURIComponent(sourceUrl)}`, { "User-Agent": MOBILE_UA });
  if (res.status === 200) {
    const j = (await res.json().catch(() => null)) as { html?: string; code?: number } | null;
    return j && j.html ? "ok" : "unknown";
  }
  if (res.status === 400 || res.status === 404) return "gone";
  return "unknown";
}

export async function checkPlayable(v: { platform: string; embedUrl: string; sourceUrl: string }): Promise<Playability> {
  const key = v.embedUrl;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < (hit.v === "unknown" ? UNKNOWN_TTL_MS : TTL_MS)) return hit.v;
  let result: Playability = "unknown";
  try {
    if (v.platform === "instagram") result = await instagram(v.embedUrl);
    else if (v.platform === "youtube") result = await youtube(v.sourceUrl);
    else if (v.platform === "tiktok") result = await tiktok(v.sourceUrl);
  } catch {
    result = "unknown"; // fail open
  }
  cache.set(key, { v: result, t: Date.now() });
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return result;
}

/** Plain-English reason shown to whoever submitted the link. */
export function playabilityMessage(p: Playability, platform: string) {
  const name = platform === "instagram" ? "Instagram" : platform === "youtube" ? "YouTube" : platform === "tiktok" ? "TikTok" : "that site";
  if (p === "gone") return `${name} says this video is gone or private, so it can't be played`;
  return platform === "instagram"
    ? "Instagram won't play this reel inside other apps (only on Instagram). Pick a different one!"
    : `${name} doesn't allow this video to be played inside other apps. Pick a different one!`;
}
