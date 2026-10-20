-- Jastip China Desk: initial schema
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- (Or `supabase db push` if you use the Supabase CLI.)
--
-- Model
--   * items / shipments / batches / config are "document" tables: one row per
--     record, the record itself lives in the `data` jsonb column. This keeps the
--     app's data shape identical to what it already uses.
--   * profiles holds one row per signed-in person plus their role:
--       pending  signed up but not approved yet: sees nothing
--       viewer   read only
--       editor   read + write
--       owner    editor + manages the team (Settings -> Team)
--   * The FIRST person to ever sign in becomes the owner. Anyone invited by the
--     owner (Supabase -> Authentication -> Invite) starts as editor. Anyone else
--     (for example a future Google sign-in) starts as pending until the owner
--     approves them.

create extension if not exists pgcrypto;

-- ───────────────────────── profiles ─────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  name        text not null default '',
  avatar_url  text not null default '',
  role        text not null default 'pending' check (role in ('pending', 'viewer', 'editor', 'owner')),
  created_at  timestamptz not null default now()
);

-- Role of the caller. SECURITY DEFINER so RLS policies can use it without recursion.
create or replace function public.app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'none');
$$;

-- Create a profile whenever someone is added to auth.users.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  first_role text;
  display text;
begin
  perform pg_advisory_xact_lock(7731);
  if not exists (select 1 from public.profiles where role = 'owner') then
    first_role := 'owner';
  elsif new.invited_at is not null then
    first_role := 'editor';
  else
    first_role := 'pending';
  end if;
  display := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    split_part(coalesce(new.email, ''), '@', 1)
  );
  insert into public.profiles (id, email, name, avatar_url, role)
  values (
    new.id,
    new.email,
    display,
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture', ''),
    first_role
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- If someone already signed up before this script ran, give them a profile.
insert into public.profiles (id, email, name, role)
select u.id, u.email, split_part(coalesce(u.email, ''), '@', 1), 'pending'
from auth.users u
on conflict (id) do nothing;
update public.profiles set role = 'owner'
where id = (select id from public.profiles order by created_at, id limit 1)
  and not exists (select 1 from public.profiles where role = 'owner');

alter table public.profiles enable row level security;

drop policy if exists "profiles: read own or team" on public.profiles;
create policy "profiles: read own or team" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.app_role() in ('viewer', 'editor', 'owner'));
-- No insert/update/delete policies on purpose: roles only change through the
-- functions below, so nobody can promote themselves.

-- Owner changes someone's role. Protects the last owner.
create or replace function public.set_member_role(target uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.app_role() <> 'owner' then
    raise exception 'Only the owner can change roles' using errcode = '42501';
  end if;
  if new_role not in ('pending', 'viewer', 'editor', 'owner') then
    raise exception 'Unknown role %', new_role using errcode = '22023';
  end if;
  if (select role from public.profiles where id = target) = 'owner'
     and new_role <> 'owner'
     and not exists (select 1 from public.profiles where role = 'owner' and id <> target) then
    raise exception 'There must always be at least one owner' using errcode = '23514';
  end if;
  update public.profiles set role = new_role where id = target;
end;
$$;

-- Anyone can change their own display name.
create or replace function public.set_my_name(new_name text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set name = left(trim(new_name), 80) where id = auth.uid() and trim(new_name) <> '';
$$;

-- ───────────────────────── data tables ─────────────────────────
create sequence if not exists public.rev_seq;

create or replace function public.touch_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.rev := nextval('public.rev_seq');
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['items', 'shipments', 'batches', 'config'] loop
    execute format($f$
      create table if not exists public.%1$I (
        id         text primary key,
        data       jsonb not null default '{}'::jsonb check (pg_column_size(data) < 500000),
        rev        bigint not null default 0,
        updated_at timestamptz not null default now(),
        updated_by uuid references auth.users (id) on delete set null
      )$f$, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop trigger if exists touch_row on public.%I', t);
    execute format('create trigger touch_row before insert or update on public.%I for each row execute function public.touch_row()', t);
    execute format('drop policy if exists "read" on public.%I', t);
    execute format('create policy "read" on public.%I for select to authenticated using (public.app_role() in (''viewer'', ''editor'', ''owner''))', t);
    execute format('drop policy if exists "insert" on public.%I', t);
    execute format('create policy "insert" on public.%I for insert to authenticated with check (public.app_role() in (''editor'', ''owner''))', t);
    execute format('drop policy if exists "update" on public.%I', t);
    execute format('create policy "update" on public.%I for update to authenticated using (public.app_role() in (''editor'', ''owner'')) with check (public.app_role() in (''editor'', ''owner''))', t);
    execute format('drop policy if exists "delete" on public.%I', t);
    execute format('create policy "delete" on public.%I for delete to authenticated using (public.app_role() in (''editor'', ''owner''))', t);
  end loop;
end $$;

-- ───────────────────────── privileges ─────────────────────────
-- Logged-out visitors (anon) get nothing at all.
revoke all on public.profiles, public.items, public.shipments, public.batches, public.config from anon;
revoke all on function public.set_member_role(uuid, text), public.set_my_name(text), public.app_role() from public, anon;
grant execute on function public.set_member_role(uuid, text), public.set_my_name(text), public.app_role() to authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.items, public.shipments, public.batches, public.config to authenticated;

-- ───────────────────────── realtime ─────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.items;     exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.shipments; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.batches;   exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.config;    exception when duplicate_object then null; end;
  end if;
end $$;
