/**
 * Server-only: resolve an Instagram reel/post to a direct, CORS-enabled MP4 URL so the game can play it in a
 * native <video> instead of Instagram's cross-origin embed iframe (which can't autoplay, never reports when it
 * ends, and for some reels refuses to play inline at all — see lib/playable.ts).
 *
 * Step 1 (always, no login): Instagram's public embed page. A reel that is playable inline ships a `video_url`
 * in the page's inline JSON. Instagram's own video CDN (`*.cdninstagram.com`) answers with
 * `access-control-allow-origin: *` and `accept-ranges: bytes`, so the browser can play (and seek) the file
 * directly — verified against a real, currently-playable reel.
 *
 * Step 2 (only when step 1 finds nothing, and only when IG_SESSIONID is set): a logged-in lookup using a spare
 * account's session cookie. This is the only way found to get a *restricted* reel's file — every anonymous
 * route (the embed page, the captioned embed, fetching as Facebook's/Twitter's/WhatsApp's link-preview bot,
 * `?__a=1`, and GraphQL without a session) was tried against a real restricted reel and all failed.
 *
 * This is against Instagram's terms of service: the account doing the lookup can be challenged, rate-limited
 * or banned, and the endpoints can change without notice. Used sparingly (at most the current video and the
 * next one, from the host's poll only — never at submit time), the result is cached on the video row so a
 * given reel is only ever looked up again after its link expires, and a dead session backs off for a while
 * instead of being retried on every poll.
 */

export interface DirectVideo {
  url: string;
  expiresAt: number; // epoch ms
  /**
   * "anonymous": the reel is genuinely embeddable, so this link (and the plain iframe) will keep working
   * regardless of the spare account. "session": the reel is still restricted by Instagram's own rules and
   * this link only exists because the spare account's session is currently working — if that session ever
   * stops working (banned, rotated out, expired), this reel goes back to needing the "open it in the app"
   * fallback, so its playability must keep reflecting that instead of being locked in as "ok" forever.
   */
  source: "anonymous" | "session";
}

/** What `extractVideoUrl` can tell from the page/response text alone, before either caller tags the source. */
interface RawVideo {
  url: string;
  expiresAt: number;
}

const EMBED_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
// A real Instagram Android app user agent: the private app API checks for one of these before anything else.
const APP_UA = "Instagram 309.0.0.41.111 Android (30/11; 420dpi; 1080x2130; samsung; SM-G973F; beyond1; exynos9820; en_US; 458229237)";
const IG_APP_ID = "936619743392459";
const EXPIRY_MARGIN_MS = 2 * 60 * 60 * 1000; // don't hand out a link that's about to expire mid-game

async function get(url: string, headers: Record<string, string>, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, headers, redirect: "follow", cache: "no-store" });
  } finally {
    clearTimeout(t);
  }
}

/** The expiry on Instagram's signed CDN links is the `oe=` query param: hex seconds since epoch. */
function expiryOf(url: string): number {
  const oe = url.match(/[?&]oe=([0-9A-Fa-f]+)/)?.[1];
  return oe ? parseInt(oe, 16) * 1000 : Date.now() + 60 * 60 * 1000;
}

/**
 * Pull `"video_url":"https://..."` out of any page/response body that contains it. The value is JSON-escaped,
 * sometimes doubly (the whole blob is itself embedded as a JS string literal), so every `/` inside the URL can
 * show up as one or more backslashes followed by a slash. A URL never legitimately contains a backslash, so
 * stripping every backslash out of the captured run — rather than trying to count escape levels — recovers it.
 */
export function extractVideoUrl(html: string): RawVideo | null {
  const key = html.indexOf("video_url");
  if (key < 0) return null;
  const start = html.indexOf("https:", key);
  if (start < 0 || start - key > 20) return null; // the value should start right after the key
  const end = html.indexOf('"', start);
  if (end < 0) return null;
  const url = html.slice(start, end).replace(/\\/g, "");
  if (!/^https:\/\/[^/\s]+\//.test(url)) return null;
  const expiresAt = expiryOf(url) - EXPIRY_MARGIN_MS;
  if (expiresAt <= Date.now()) return null; // already expired (or about to), don't hand it out
  return { url, expiresAt };
}

/** Shortcode out of a canonical /reel/, /reels/, /p/ or /tv/ URL (see lib/embeds.ts parseVideoUrl). */
function shortcodeOf(sourceUrl: string): string | null {
  return sourceUrl.match(/\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]{5,})/)?.[1] ?? null;
}

/** Instagram's shortcode -> numeric media id: big-endian base-64 digits over its own (base64url) alphabet. */
function shortcodeToMediaId(code: string): string | null {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let id = 0n;
  for (const ch of code) {
    const v = alphabet.indexOf(ch);
    if (v < 0) return null;
    id = id * 64n + BigInt(v);
  }
  return id.toString();
}

async function anonymous(embedUrl: string): Promise<DirectVideo | null> {
  try {
    const res = await get(embedUrl, { "User-Agent": EMBED_UA, "Accept-Language": "en-US,en;q=0.9" });
    if (!res.ok) return null;
    const raw = extractVideoUrl(await res.text());
    return raw ? { ...raw, source: "anonymous" } : null;
  } catch {
    return null;
  }
}

function sessionId(): string | null {
  const v = process.env.IG_SESSIONID;
  return v && v.trim() ? v.trim() : null;
}

// A dead or challenged session shouldn't be retried on every video on every poll; back off for a while.
let sessionDeadUntil = 0;

async function loggedInViaAppApi(shortcode: string, sid: string): Promise<DirectVideo | "dead" | null> {
  const mediaId = shortcodeToMediaId(shortcode);
  if (!mediaId) return null;
  try {
    const res = await get(`https://i.instagram.com/api/v1/media/${mediaId}/info/`, {
      "User-Agent": APP_UA,
      Cookie: `sessionid=${sid}`,
      "X-IG-App-ID": IG_APP_ID,
      Accept: "*/*",
    });
    if (res.status === 401 || res.status === 403) return "dead";
    if (!res.ok) return null;
    const j = (await res.json().catch(() => null)) as { items?: { video_versions?: { url: string }[] }[] } | null;
    const url = j?.items?.[0]?.video_versions?.[0]?.url;
    if (!url) return null;
    const expiresAt = expiryOf(url) - EXPIRY_MARGIN_MS;
    return expiresAt > Date.now() ? { url, expiresAt, source: "session" } : null;
  } catch {
    return null;
  }
}

/** Fallback for the logged-in step: the same embed page, but with the session cookie attached. */
async function loggedInViaEmbed(embedUrl: string, sid: string): Promise<DirectVideo | "dead" | null> {
  try {
    const res = await get(embedUrl, { "User-Agent": EMBED_UA, Cookie: `sessionid=${sid}`, "X-IG-App-ID": IG_APP_ID });
    if (res.status === 401 || res.status === 403) return "dead";
    if (!res.ok) return null;
    const raw = extractVideoUrl(await res.text());
    return raw ? { ...raw, source: "session" } : null;
  } catch {
    return null;
  }
}

async function loggedIn(embedUrl: string, shortcode: string): Promise<DirectVideo | null> {
  const sid = sessionId();
  if (!sid || Date.now() < sessionDeadUntil) return null;
  const app = await loggedInViaAppApi(shortcode, sid);
  if (app === "dead") {
    sessionDeadUntil = Date.now() + 10 * 60 * 1000;
    return null;
  }
  if (app) return app;
  const embed = await loggedInViaEmbed(embedUrl, sid);
  if (embed === "dead") {
    sessionDeadUntil = Date.now() + 10 * 60 * 1000;
    return null;
  }
  return embed;
}

// One lookup per shortcode at a time: the host polls every ~2s for two videos (current + upNext), so without
// this a slow lookup could be kicked off again before the first one finishes.
const inFlight = new Map<string, Promise<DirectVideo | null>>();

/** Resolve a reel/post to a direct playable URL, or null if it can't be. Fails open: never throws. */
export async function resolveInstagramVideo(embedUrl: string, sourceUrl: string): Promise<DirectVideo | null> {
  const shortcode = shortcodeOf(sourceUrl) ?? shortcodeOf(embedUrl);
  const key = shortcode ?? embedUrl;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const p = (async () => {
    const direct = await anonymous(embedUrl);
    if (direct) return direct;
    if (!shortcode) return null;
    return await loggedIn(embedUrl, shortcode);
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}
