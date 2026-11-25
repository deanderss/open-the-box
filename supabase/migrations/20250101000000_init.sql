-- Open the Box — initial schema

-- ───────────────────────── settings ─────────────────────────
create table public.app_settings (
  id int primary key default 1 check (id = 1),
  max_moderators int not null default 10,
  max_groups_per_moderator int not null default 5,
  max_players_per_group int not null default 30,
  max_queued_videos_per_group int not null default 300,
  answer_window_seconds int not null default 150
);
insert into public.app_settings default values;

-- ───────────────────────── moderators ─────────────────────────
create table public.moderators (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  email text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- ───────────────────────── groups ─────────────────────────
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  color text not null default '#FF4FA3',
  emoji text not null default '📦',
  owner_id uuid references public.moderators(id) on delete set null,
  submit_token text not null unique,
  created_at timestamptz not null default now()
);

create table public.group_moderators (
  group_id uuid not null references public.groups(id) on delete cascade,
  moderator_id uuid not null references public.moderators(id) on delete cascade,
  role text not null check (role in ('owner','co')),
  created_at timestamptz not null default now(),
  primary key (group_id, moderator_id)
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  avatar_color text not null default '#3FC1FF',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (group_id, display_name)
);

create table public.videos (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  submitted_by uuid references public.players(id) on delete set null,
  platform text not null check (platform in ('tiktok','instagram','facebook')),
  source_url text not null,
  embed_url text not null,
  status text not null default 'queued' check (status in ('queued','played','skipped')),
  played_at timestamptz,
  avg_rating numeric(4,2),
  rating_count int not null default 0,
  created_at timestamptz not null default now(),
  unique (group_id, source_url)
);
create index videos_group_status_idx on public.videos(group_id, status);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  room_code text not null,
  state text not null default 'lobby' check (state in ('lobby','playing','reveal','finished')),
  video_order uuid[] not null default '{}',
  current_index int not null default -1,
  video_started_at timestamptz,
  reveal_at timestamptz,
  created_by uuid references public.moderators(id) on delete set null,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index sessions_active_code_idx on public.sessions(room_code) where ended_at is null;

create table public.session_players (
  session_id uuid not null references public.sessions(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  device_token text not null,
  joined_at timestamptz not null default now(),
  primary key (session_id, player_id)
);

create table public.responses (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  rating int check (rating between 1 and 10),
  guessed_player_id uuid references public.players(id) on delete set null,
  is_correct boolean not null default false,
  is_decoy boolean not null default false,
  created_at timestamptz not null default now(),
  unique (session_id, video_id, player_id)
);
create index responses_player_idx on public.responses(player_id);

-- ───────────────────────── helper functions ─────────────────────────
create or replace function public.is_group_mod(gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_moderators where group_id = gid and moderator_id = auth.uid());
$$;

create or replace function public.moderator_slots_remaining()
returns int language sql stable security definer set search_path = public, auth as $$
  select greatest(0, (select max_moderators from public.app_settings where id = 1) - (select count(*)::int from auth.users));
$$;
grant execute on function public.moderator_slots_remaining() to anon, authenticated;

-- Hard cap on moderator accounts (blocks ANY sign-up path once full)
create or replace function public.enforce_moderator_cap()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare cap int; cnt int;
begin
  perform pg_advisory_xact_lock(4242424242);
  select max_moderators into cap from public.app_settings where id = 1;
  select count(*) into cnt from auth.users;
  if cnt >= cap then
    raise exception 'moderator_cap_reached';
  end if;
  return new;
end $$;
create trigger enforce_moderator_cap before insert on auth.users
  for each row execute function public.enforce_moderator_cap();

-- Profile row for each new auth user; first one becomes admin
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.moderators (id, display_name, email, is_admin)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(new.email,'@',1)),
    new.email,
    not exists (select 1 from public.moderators)
  );
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Owner becomes group moderator automatically
create or replace function public.handle_new_group()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is not null then
    insert into public.group_moderators (group_id, moderator_id, role) values (new.id, new.owner_id, 'owner')
    on conflict do nothing;
  end if;
  return new;
end $$;
create trigger on_group_created after insert on public.groups
  for each row execute function public.handle_new_group();

-- All-time guessing leaderboard per group
create view public.group_leaderboard with (security_invoker = true) as
  select p.group_id, p.id as player_id, p.display_name, p.avatar_color,
         count(r.id) filter (where r.is_correct) as correct,
         count(r.id) as guesses
  from public.players p
  left join public.responses r on r.player_id = p.id and r.is_decoy = false
  group by p.group_id, p.id, p.display_name, p.avatar_color;

-- ───────────────────────── RLS ─────────────────────────
-- Moderators can READ only their own groups' data. All writes go through
-- server routes using the service role (which bypasses RLS) after auth checks.
alter table public.app_settings enable row level security;
alter table public.moderators enable row level security;
alter table public.groups enable row level security;
alter table public.group_moderators enable row level security;
alter table public.players enable row level security;
alter table public.videos enable row level security;
alter table public.sessions enable row level security;
alter table public.session_players enable row level security;
alter table public.responses enable row level security;

create policy "settings readable" on public.app_settings for select to authenticated using (true);
create policy "own profile" on public.moderators for select to authenticated using (id = auth.uid());
create policy "mod groups" on public.groups for select to authenticated using (public.is_group_mod(id));
create policy "mod group_moderators" on public.group_moderators for select to authenticated using (public.is_group_mod(group_id));
create policy "mod players" on public.players for select to authenticated using (public.is_group_mod(group_id));
create policy "mod videos" on public.videos for select to authenticated using (public.is_group_mod(group_id));
create policy "mod sessions" on public.sessions for select to authenticated using (public.is_group_mod(group_id));
create policy "mod session_players" on public.session_players for select to authenticated
  using (exists (select 1 from public.sessions s where s.id = session_id and public.is_group_mod(s.group_id)));
create policy "mod responses" on public.responses for select to authenticated
  using (exists (select 1 from public.sessions s where s.id = session_id and public.is_group_mod(s.group_id)));

-- keepalive
create or replace function public.ping() returns int language sql stable as $$ select 1 $$;
