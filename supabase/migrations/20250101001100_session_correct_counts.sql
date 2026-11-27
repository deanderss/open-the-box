-- Cost/speed: `buildState` (polled every ~2s by every connected player AND the host, for the whole length
-- of a game) used to pull every single response row ever recorded for a session just to re-sum "how many has
-- each player gotten right so far" in JavaScript on every single poll — a payload, and a table scan, that
-- only grows for the entire rest of the game. Postgres can do that sum once, server-side, and hand back one
-- tiny row per player instead.
--
-- `p_exclude_video_id` exists because the currently-*playing* video's answers are already scored the moment
-- they're submitted (`is_correct` is set at insert time), but must not show up in anyone's live score until
-- the official reveal — otherwise a ticking-up scoreboard mid-round would itself give away who the sender is.
create or replace function public.session_correct_counts(p_session_id uuid, p_exclude_video_id uuid default null)
returns table (player_id uuid, correct_count bigint)
language sql
stable
security invoker
as $$
  select player_id, count(*) as correct_count
  from public.responses
  where session_id = p_session_id
    and is_correct = true
    and is_decoy = false
    and (p_exclude_video_id is null or video_id <> p_exclude_video_id)
  group by player_id;
$$;
