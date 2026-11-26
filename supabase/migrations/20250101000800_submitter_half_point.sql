-- The person who sent a video gets half a point for it (so whoever fills the box with the most videos
-- still has a fair shot at the detective crown). Counted for every video of theirs that was actually
-- shown in a game they were in (skipped videos don't count). New columns go last so `create or replace` works.
create or replace view public.group_leaderboard with (security_invoker = true) as
  select p.group_id, p.id as player_id, p.display_name, p.avatar_color,
         count(r.id) filter (where r.is_correct) as correct,
         count(r.id) as guesses,
         (
           select count(*) from public.videos v
           where v.submitted_by = p.id
             and v.status = 'played'
             and exists (
               select 1 from public.sessions s
               join public.session_players sp on sp.session_id = s.id and sp.player_id = p.id
               where v.id = any (s.video_order)
                 and s.current_index >= array_position(s.video_order, v.id) - 1
             )
         ) as submitted,
         count(r.id) filter (where r.is_correct) + 0.5 * (
           select count(*) from public.videos v
           where v.submitted_by = p.id
             and v.status = 'played'
             and exists (
               select 1 from public.sessions s
               join public.session_players sp on sp.session_id = s.id and sp.player_id = p.id
               where v.id = any (s.video_order)
                 and s.current_index >= array_position(s.video_order, v.id) - 1
             )
         ) as points
  from public.players p
  left join public.responses r on r.player_id = p.id and r.is_decoy = false
  group by p.group_id, p.id, p.display_name, p.avatar_color;
