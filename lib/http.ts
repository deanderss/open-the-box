// Server-side fetches to the video platforms: one place for the timeout and the iPhone user agent they all use.

/** An iPhone Safari user agent: the platforms serve their mobile pages (and embed data) to it. */
export const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

/** GET with a time limit on the response arriving (redirects followed, never cached). Throws on timeout. */
export async function fetchWithTimeout(url: string, headers: Record<string, string> = {}, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, headers, redirect: "follow", cache: "no-store" });
  } finally {
    clearTimeout(t);
  }
}
