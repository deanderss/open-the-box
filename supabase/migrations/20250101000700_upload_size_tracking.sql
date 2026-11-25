-- Open the Box: remember how big each uploaded file is, so the app can keep the total under the plan's storage quota.
alter table public.videos add column if not exists file_bytes bigint;
