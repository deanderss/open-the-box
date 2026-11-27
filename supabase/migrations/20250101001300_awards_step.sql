-- Awards ceremony: which award the host screen is on after a game finishes. Server-side (not just the host's
-- local state) so a refreshed host screen resumes at the same award and phones know when the ceremony is over.
-- 0 = first award; any value >= the number of awards means the ceremony is done and the final scoreboard shows.
alter table public.sessions add column if not exists awards_step smallint not null default 0;

-- Games that finished before this feature existed go straight to the final scoreboard.
update public.sessions set awards_step = 99 where state = 'finished';
