"use client";

/**
 * A POST+JSON helper that never throws — a dropped connection or a non-JSON error page (e.g. a Vercel 504)
 * used to leave callers awaiting a rejected promise forever, which is how "Lock in"/"Pick a name"/"Open the
 * box" could get stuck on their busy state until the page was reloaded (see useSeat, join/page.tsx,
 * OpenBoxButton). Every caller gets a plain `{ ok, data } | { ok, error }` back no matter what goes wrong.
 */
export type PostJsonResult<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

export async function postJson<T = unknown>(
  url: string,
  body: unknown,
  headers?: Record<string, string>
): Promise<PostJsonResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: "Couldn't reach the server — check your connection and try again" };
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response (e.g. a gateway error page) — fall through with data left null */
  }
  if (!res.ok) {
    const error = (data as { error?: string } | null)?.error || `Something went wrong (${res.status})`;
    return { ok: false, error, status: res.status };
  }
  return { ok: true, data: data as T };
}
