-- Public mode: NO login. Anyone who has your site link can read AND edit/delete data.
-- Run AFTER 0001_init.sql, in Supabase -> SQL Editor. Safe to re-run.
-- Also set VITE_PUBLIC_MODE=true in Cloudflare Pages and redeploy.
-- To go back to private: run supabase/migrations/0003_private_mode.sql (reverts this).

do $$
declare t text;
begin
  foreach t in array array['items', 'shipments', 'batches', 'config'] loop
    execute format('grant select, insert, update, delete on public.%I to anon', t);
    execute format('drop policy if exists "public read" on public.%I', t);
    execute format('create policy "public read" on public.%I for select to anon using (true)', t);
    execute format('drop policy if exists "public insert" on public.%I', t);
    execute format('create policy "public insert" on public.%I for insert to anon with check (true)', t);
    execute format('drop policy if exists "public update" on public.%I', t);
    execute format('create policy "public update" on public.%I for update to anon using (true) with check (true)', t);
    execute format('drop policy if exists "public delete" on public.%I', t);
    execute format('create policy "public delete" on public.%I for delete to anon using (true)', t);
  end loop;
end $$;
