-- Minimal stand-in for the parts of Supabase that the migration relies on.
-- ONLY used by scripts/test-rls.sh against a throwaway local Postgres.
-- Do NOT run this on a real Supabase project.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  invited_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant usage on schema public to authenticated, anon;
create publication supabase_realtime;
