-- Instagram direct MP4 playback: a reel is resolved to a direct, CORS-enabled video URL (see lib/igDirect.ts)
-- and cached here so it's only looked up again after the link expires, not on every host poll.
alter table public.videos add column if not exists direct_url text;
alter table public.videos add column if not exists direct_url_expires timestamptz;
