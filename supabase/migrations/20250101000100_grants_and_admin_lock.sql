-- Open the Box — fix table privileges + lock admin to a single account

-- ───────────────────────── 1. Privileges ─────────────────────────
-- Tables created through the Supabase Management API did not receive the usual
-- data privileges, so server routes (service_role) failed with
-- "permission denied for table groups". Grant them explicitly.

-- Server routes (service role): full data access. RLS is bypassed; every route
-- checks requireUser / requireGroupMod / requireAdmin before writing.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Logged-in moderators: SELECT only, and RLS limits rows to their own boxes.
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant execute on function public.is_group_mod(uuid) to authenticated;
grant execute on function public.moderator_slots_remaining() to authenticated;

-- Anonymous visitors get nothing directly (public pages go through server routes).
revoke all on all tables in schema public from anon;

-- Keep future tables consistent for objects created by postgres.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges for role postgres in schema public
  grant select on tables to authenticated;
alter default privileges for role postgres in schema public
  grant execute on functions to service_role;

-- ───────────────────────── 2. Single admin ─────────────────────────
-- Only dane.andersson.da@gmail.com may ever be an admin. Everyone else who signs
-- up is a regular moderator (sees only their own boxes, no /admin access).
-- To change the admin later, write a new migration that updates both the
-- trigger below and the constraint.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.moderators (id, display_name, email, is_admin)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(new.email,'@',1)),
    new.email,
    lower(new.email) = 'dane.andersson.da@gmail.com'
  );
  return new;
end $$;

update public.moderators
   set is_admin = (lower(email) = 'dane.andersson.da@gmail.com');

alter table public.moderators drop constraint if exists moderators_admin_email_lock;
alter table public.moderators
  add constraint moderators_admin_email_lock
  check (not is_admin or lower(email) = 'dane.andersson.da@gmail.com');
