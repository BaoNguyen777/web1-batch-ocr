-- Web2 is read-only.
-- Web1 uses the server-side service-role/secret key and therefore bypasses RLS.
-- Web2 uses the publishable key and is restricted by these policies.

alter table public.plate_records enable row level security;

-- This policy is intentionally SELECT-only. Do not add INSERT/UPDATE/DELETE
-- policies for anon/authenticated roles on this table.
drop policy if exists "Web2 can read plate records" on public.plate_records;
create policy "Web2 can read plate records"
on public.plate_records
for select
to anon, authenticated
using (true);

-- Keep the bucket private. Web2 can read objects only through Supabase's
-- authorized Storage API and signed URLs; it cannot upload, update, or delete.
drop policy if exists "Web2 can read plate images" on storage.objects;
create policy "Web2 can read plate images"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'plate-images');

-- There are deliberately no INSERT/UPDATE/DELETE policies for anon/authenticated.
-- Web1's service-role/secret key bypasses RLS for writes and cleanup.
