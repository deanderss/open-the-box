-- Open the Box: personal videos uploaded from a phone's camera roll.
--
-- A new 'upload' video type. The file lives in Storage (bucket box-videos, random file names, public read).
-- Once an uploaded video has been played and rated the file is deleted and storage_path is cleared; the (tiny)
-- videos row stays so the answers and scores that point at it survive, and it is left out of the Top 100.

alter table public.videos drop constraint if exists videos_platform_check;
alter table public.videos
  add constraint videos_platform_check check (platform in ('tiktok','instagram','facebook','youtube','upload'));

alter table public.videos add column if not exists storage_path text;

-- Free plan allows 50 MB per file; the bucket enforces it (and only accepts video types) even if the app didn't.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'box-videos', 'box-videos', true, 52428800,
  array['video/mp4','video/quicktime','video/webm','video/x-m4v','video/3gpp','video/3gpp2']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
