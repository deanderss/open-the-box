-- Open the Box — pause/resume sessions + higher limits

-- A paused session keeps its state; the answer timer is frozen until resume.
alter table public.sessions add column if not exists paused_at timestamptz;

-- 10 boxes per moderator, up to 50 moderator accounts.
alter table public.app_settings alter column max_groups_per_moderator set default 10;
alter table public.app_settings alter column max_moderators set default 50;
update public.app_settings set max_groups_per_moderator = 10, max_moderators = 50 where id = 1;
