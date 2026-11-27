import { supabaseAdmin } from "./supabase-server";

/** The app-wide limits the admin can change (the `app_settings` row). These defaults match the column defaults in
 *  the database and are only used when the row can't be read. */
export const DEFAULTS = {
  max_moderators: 50,
  max_groups_per_moderator: 10,
  max_players_per_group: 30,
  max_queued_videos_per_group: 300,
  // Too SHORT a fallback would auto-reveal a video (and lock out late answers) before the on-screen timer ends.
  answer_window_seconds: 300,
};
export type Settings = typeof DEFAULTS;

// Read on every poll (the answer window), so cached per server instance for a minute. A change by the admin
// reaches every instance within that minute (immediately on the instance that saved it).
let cache: { v: Settings; until: number } | null = null;

export async function getSettings(): Promise<Settings> {
  const now = Date.now();
  if (cache && cache.until > now) return cache.v;
  const { data, error } = await supabaseAdmin().from("app_settings").select("*").eq("id", 1).single();
  if (error || !data) return DEFAULTS; // not cached, so the next call retries
  const v = { ...DEFAULTS };
  (Object.keys(DEFAULTS) as (keyof Settings)[]).forEach((k) => {
    if (typeof data[k] === "number") v[k] = data[k] as number;
  });
  cache = { v, until: now + 60_000 };
  return v;
}

export function clearSettingsCache() {
  cache = null;
}
