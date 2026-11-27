-- group_leaderboard is always read for one box, but its "videos sent" step counted played videos for every box
-- in the database (and checked every session for each one) before the box filter applied. Grouping that step by
-- box and joining on it lets the box filter reach it; the session check is also limited to the video's own box.
-- Same columns, same results.
create or replace view public.group_leaderboard with (security_invoker = true) as
with submitted_counts as (
  select v.group_id, v.submitted_by as player_id, count(*) as submitted
  from public.videos v
  where v.status = 'played'
    and v.submitted_by is not null
    and exists (
      select 1
      from public.sessions s
      join public.session_players sp on sp.session_id = s.id and sp.player_id = v.submitted_by
      where s.group_id = v.group_id
        and v.id = any (s.video_order)
        and s.current_index >= array_position(s.video_order, v.id) - 1
    )
  group by v.group_id, v.submitted_by
)
select p.group_id,
  p.id as player_id,
  p.display_name,
  p.avatar_color,
  count(r.id) filter (where r.is_correct) as correct,
  count(r.id) as guesses,
  coalesce(sc.submitted, 0::bigint) as submitted,
  count(r.id) filter (where r.is_correct)::numeric + 0.5 * coalesce(sc.submitted, 0::bigint)::numeric as points
from public.players p
left join public.responses r on r.player_id = p.id and r.is_decoy = false
left join submitted_counts sc on sc.group_id = p.group_id and sc.player_id = p.id
group by p.group_id, p.id, p.display_name, p.avatar_color, sc.submitted;

-- Deleting a box or a player looks these up through foreign keys; without an index each one is a full scan.
create index if not exists responses_guessed_player_idx on public.responses (guessed_player_id);
create index if not exists videos_submitted_by_idx on public.videos (submitted_by);
