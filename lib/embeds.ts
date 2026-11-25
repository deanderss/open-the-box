export type Platform = "tiktok" | "instagram" | "facebook" | "youtube";
export interface ParsedVideo {
  platform: Platform;
  sourceUrl: string; // canonical
  embedUrl: string;
}

/** Pull every http(s) URL out of a blob of text. */
export function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"']+/gi) || [];
  return Array.from(new Set(matches.map((u) => u.replace(/[),.;!]+$/, ""))));
}

function safeUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  } catch {
    return null;
  }
}

function host(u: URL) {
  return u.hostname.toLowerCase().replace(/^(www|m|mobile|web)\./, "");
}

const SHORT_HOSTS = ["vm.tiktok.com", "vt.tiktok.com", "fb.watch"];

/** Facebook's "Share" button gives facebook.com/share/r/CODE (or /v/, /p/): a redirect page, not the video. */
function isFacebookShare(u: URL) {
  const h = host(u);
  return (h === "facebook.com" || h === "fb.com") && /^\/share\/(r|v|p)\//.test(u.pathname);
}

/** Instagram's Share button gives instagram.com/share/CODE (or /share/reel/CODE, /share/p/CODE): a redirect, and CODE is not the shortcode. */
function isInstagramShare(u: URL) {
  const h = host(u);
  return (h === "instagram.com" || h === "instagr.am") && u.pathname.startsWith("/share/");
}

export function needsExpansion(raw: string) {
  const u = safeUrl(raw);
  if (!u) return false;
  const h = host(u);
  return SHORT_HOSTS.includes(h) || (h === "tiktok.com" && u.pathname.startsWith("/t/")) || isFacebookShare(u) || isInstagramShare(u);
}

/** True when a redirect chain ended on a login wall instead of the content. */
function isLoginWall(raw: string) {
  const u = safeUrl(raw);
  return !!u && /^\/(accounts\/)?login(\/|$)/.test(u.pathname);
}

/**
 * Facebook share links only redirect in JavaScript, and the video plugin refuses them ("Video Unavailable").
 * Facebook's own link-preview crawler is served the real reel URL in og:url, so ask the way it does.
 */
async function resolveFacebookShare(raw: string): Promise<string> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(raw, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)" },
    });
    const html = await res.text();
    clearTimeout(t);
    const m = html.match(/og:url"\s+content="([^"]+)"/) || html.match(/canonical"\s+href="([^"]+)"/);
    const found = m?.[1]?.replace(/&amp;/g, "&");
    const fu = found ? safeUrl(found) : null;
    if (fu && /(^|\.)facebook\.com$/.test(fu.hostname.toLowerCase())) return fu.toString();
  } catch {
    /* fall through to the original link */
  }
  return raw;
}

/** Follow redirects for short links (server-side only). */
export async function expandUrl(raw: string): Promise<string> {
  const su = safeUrl(raw);
  if (su && isFacebookShare(su)) return resolveFacebookShare(raw);
  const isFbWatch = !!su && host(su) === "fb.watch";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(raw, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" },
    });
    clearTimeout(t);
    const final = res.url || raw;
    if (isLoginWall(final)) {
      // fb.watch bounces scripts to a login page; Facebook's own crawler is shown the real URL.
      return isFbWatch ? resolveFacebookShare(raw) : raw;
    }
    return final;
  } catch {
    return raw;
  }
}

/** Parse a (possibly already-expanded) URL into a playable embed. */
export function parseVideoUrl(raw: string): ParsedVideo | null {
  const u = safeUrl(raw);
  if (!u) return null;
  const h = host(u);
  const path = u.pathname;

  // TikTok: tiktok.com/@user/video/1234567890  or /embed/v2/123
  if (h === "tiktok.com" || h.endsWith(".tiktok.com")) {
    const m =
      path.match(/\/video\/(\d{8,25})/) ||
      path.match(/\/embed(?:\/v2)?\/(\d{8,25})/) ||
      path.match(/\/photo\/(\d{8,25})/) ||
      path.match(/^\/v\/(\d{8,25})(?:\.html)?\/?$/); // m.tiktok.com/v/ID.html
    if (!m) return null;
    const id = m[1];
    const user = path.match(/\/@([^/]+)/)?.[1];
    return {
      platform: "tiktok",
      sourceUrl: user ? `https://www.tiktok.com/@${user}/video/${id}` : `https://www.tiktok.com/video/${id}`,
      embedUrl: `https://www.tiktok.com/embed/v2/${id}`,
    };
  }

  // Instagram: /reel/CODE, /reels/CODE, /p/CODE, /tv/CODE (optionally /username/reel/CODE)
  if (h === "instagram.com" || h === "instagr.am") {
    // /share/... must be expanded first; its code is not a shortcode, so never guess.
    if (path.startsWith("/share/")) return null;
    const m = path.match(/\/(reel|reels|p|tv)\/([A-Za-z0-9_-]{5,})/);
    if (!m) return null;
    const kind = m[1] === "reels" ? "reel" : m[1];
    const code = m[2];
    return {
      platform: "instagram",
      sourceUrl: `https://www.instagram.com/${kind}/${code}/`,
      embedUrl: `https://www.instagram.com/${kind}/${code}/embed/`,
    };
  }

  // YouTube Shorts: youtube.com/shorts/ID (the link the Share button gives you).
  // Regular watch links are not accepted: this is a Shorts game.
  if (h === "youtube.com" || h === "music.youtube.com") {
    const m = path.match(/^\/shorts\/([A-Za-z0-9_-]{11})(?:[/?#]|$)/);
    if (!m) return null;
    const id = m[1];
    return {
      platform: "youtube",
      sourceUrl: `https://www.youtube.com/shorts/${id}`,
      embedUrl: `https://www.youtube.com/embed/${id}?autoplay=1&playsinline=1&rel=0&modestbranding=1&loop=1&playlist=${id}`,
    };
  }

  // Facebook: /reel/ID, /watch/?v=ID, /<page>/videos/ID, /share/r/..., /share/v/...
  if (h === "facebook.com" || h === "fb.com" || h === "fb.watch") {
    let canonical: string | null = null;
    const reel = path.match(/\/reel\/(\d+)/);
    const vid = path.match(/\/videos\/(?:[^/]+\/)?(\d+)/);
    const watchV = u.searchParams.get("v");
    if (reel) canonical = `https://www.facebook.com/reel/${reel[1]}`;
    else if (vid) canonical = `https://www.facebook.com${path.replace(/\/$/, "")}`;
    else if ((path.startsWith("/watch") || path.startsWith("/video.php")) && watchV && /^\d+$/.test(watchV)) canonical = `https://www.facebook.com/watch/?v=${watchV}`;
    else if (h === "fb.watch" && path.length > 2 && !isLoginWall(raw)) canonical = `https://fb.watch${path}`;
    else if (path.startsWith("/share/r/") || path.startsWith("/share/v/")) canonical = `https://www.facebook.com${path}`;
    if (!canonical) return null;
    return {
      platform: "facebook",
      sourceUrl: canonical,
      embedUrl: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(canonical)}&show_text=false&autoplay=true&width=500`,
    };
  }
  return null;
}
