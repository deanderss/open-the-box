-- "Full app hardening" (Nov 2026): indexes for the hottest queries, one open session per box enforced in the
-- database, the leaderboard's submitted-video count computed once instead of twice per row, and a place to
-- save each video's playability/aspect at submit time so the host screen doesn't re-check it live every poll.

create index if not exists responses_video_idx on public.responses(video_id) where is_decoy = false;
create index if not exists videos_submitted_by_played_idx on public.videos(submitted_by) where status = 'played';
create index if not exists session_players_player_idx on public.session_players(player_id);
create index if not exists sessions_room_code_ended_idx on public.sessions(room_code, ended_at desc);

-- One open (not-yet-ended) session per box. Guards the rare double "Start the show" race that could otherwise
-- re-shuffle the same box's video order out from under itself. Any pre-existing duplicates are ended (not
-- deleted) by the deploy script immediately before this migration runs, so this never fails to apply.
create unique index if not exists sessions_one_open_per_group_idx on public.sessions(group_id) where ended_at is null;

alter table public.videos add column if not exists playability text check (playability is null or playability in ('ok', 'restricted', 'gone', 'unknown'));
alter table public.videos add column if not exists aspect numeric(6, 4);

-- Same output columns as before; the "half a point per video sent" count is now computed once per
-- submitter in a CTE instead of being written out twice in the same select (correct + points).
create or replace view public.group_leaderboard
with
  (security_invoker = true) as
with
  submitted_counts as (
    select v.submitted_by as player_id, count(*) as submitted
    from public.videos v
    where
      v.status = 'played'
      and v.submitted_by is not null
      and exists (
        select 1
        from public.sessions s
          join public.session_players sp on sp.session_id = s.id
          and sp.player_id = v.submitted_by
        where
          v.id = any (s.video_order)
          and s.current_index >= array_position(s.video_order, v.id) - 1
      )
    group by
      v.submitted_by
  )
select
  p.group_id,
  p.id as player_id,
  p.display_name,
  p.avatar_color,
  count(r.id) filter (
    where
      r.is_correct
  ) as correct,
  count(r.id) as guesses,
  coalesce(sc.submitted, 0) as submitted,
  count(r.id) filter (
    where
      r.is_correct
  ) + 0.5 * coalesce(sc.submitted, 0) as points
from
  public.players p
  left join public.responses r on r.player_id = p.id
  and r.is_decoy = false
  left join submitted_counts sc on sc.player_id = p.id
group by
  p.group_id,
  p.id,
  p.display_name,
  p.avatar_color,
  sc.submitted;
