-- Reverts 0002: logged-out visitors get nothing again.
do $$
declare t text;
begin
  foreach t in array array['items', 'shipments', 'batches', 'config'] loop
    execute format('drop policy if exists "public read" on public.%I', t);
    execute format('drop policy if exists "public insert" on public.%I', t);
    execute format('drop policy if exists "public update" on public.%I', t);
    execute format('drop policy if exists "public delete" on public.%I', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
