-- Moderators sign in with the public anon key, so anything the `authenticated` role can SELECT they can read
-- straight from Supabase, outside the app. Until now that included the game's secrets:
--   * responses           — live guesses and ratings, mid-game
--   * session_players     — every player's device_token (lets you answer as that player)
--   * videos.submitted_by — who sent every upcoming video
--   * videos.direct_url   — Instagram links made with the admin's session (bypasses the admin-only rule)
-- The app reads all of these server-side with the service role, after its own permission checks, so the
-- signed-in role only keeps what the pages read directly: video counts and public video details.

revoke select on public.responses from authenticated;
revoke select on public.session_players from authenticated;

revoke select on public.videos from authenticated;
grant select (id, group_id, platform, source_url, embed_url, status, played_at, avg_rating, rating_count, created_at, playability, aspect)
  on public.videos to authenticated;

-- Supabase's default grants also hand `authenticated` TRUNCATE/TRIGGER/REFERENCES on every table. The API can't
-- use them, and nothing in the app needs them; drop them as a safety net. (TRUNCATE ignores row-level security.)
revoke truncate, trigger, references on all tables in schema public from authenticated;
alter default privileges in schema public revoke truncate, trigger, references on tables from authenticated;

-- Where a saved Instagram direct link came from: 'anonymous' (anyone may reuse it) or 'session' (made with the
-- admin's Instagram session; only the admin's games may reuse it). Links saved before this have no source and
-- keep the old rule (reusable when the reel's playability is 'ok') until they expire, within a day.
alter table public.videos add column if not exists direct_url_source text
  check (direct_url_source is null or direct_url_source in ('anonymous', 'session'));
