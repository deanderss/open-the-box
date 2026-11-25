-- Open the Box — YouTube Shorts + admin account suspension

-- Allow 'youtube' as a video platform.
alter table public.videos drop constraint if exists videos_platform_check;
alter table public.videos
  add constraint videos_platform_check check (platform in ('tiktok','instagram','facebook','youtube'));

-- Admin can suspend a moderator without deleting them or their boxes.
alter table public.moderators add column if not exists suspended boolean not null default false;
