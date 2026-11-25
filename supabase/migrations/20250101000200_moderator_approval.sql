-- Open the Box — moderator sign-ups require admin approval

-- Requests live separately from `moderators` so a denied request (whose auth
-- user is deleted) keeps its history.
create table public.moderator_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,                       -- auth user (no FK: deleted when denied)
  email text not null,
  display_name text not null,
  status text not null default 'pending' check (status in ('pending','approved','denied')),
  ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid
);
create index moderator_requests_status_idx on public.moderator_requests(status, created_at desc);

-- Server-only table: RLS on, no policies, no direct access for browser roles.
alter table public.moderator_requests enable row level security;
revoke all on public.moderator_requests from anon, authenticated;
grant select, insert, update, delete on public.moderator_requests to service_role;

-- Whether a moderator profile has been approved. Existing rows stay approved.
alter table public.moderators add column if not exists approved boolean not null default true;

-- New sign-ups start unapproved, except the admin account.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.moderators (id, display_name, email, is_admin, approved)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(new.email,'@',1)),
    new.email,
    lower(new.email) = 'dane.andersson.da@gmail.com',
    lower(new.email) = 'dane.andersson.da@gmail.com'
  );
  return new;
end $$;
