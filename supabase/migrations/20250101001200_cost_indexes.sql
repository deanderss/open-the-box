-- Cost/speed: three small missing indexes found in the full build review.
--
-- `groups.owner_id` and `group_moderators.moderator_id` are both foreign keys that were never indexed on
-- their own. `group_moderators`'s primary key is (group_id, moderator_id), which only helps a lookup that
-- already knows group_id — every "which boxes does this moderator own/co-mod" query (admin moderator detail
-- page, moderator-removal heir lookup) filters by moderator_id alone and was doing a full table scan to do it.
-- Same story for `groups.owner_id`: the groups-list page's per-moderator count and the "how many boxes do I
-- own" cap check both filter on it directly with no index backing either one.
create index if not exists groups_owner_idx on public.groups (owner_id);

create index if not exists group_moderators_moderator_idx on public.group_moderators (moderator_id);

-- No query filters sessions by group_id + created_at today, but every admin/debugging look at "this group's
-- session history" naturally wants both, and a plain `group_id` index would already partly overlap with the
-- existing partial index on open sessions — this composite index covers both without duplicating it.
create index if not exists sessions_group_created_idx on public.sessions (group_id, created_at);
