-- Runs AFTER our user migrations (Lovable's 14 migration files) and AFTER
-- GoTrue's bundled migrations. Locks down a few things and grants the
-- per-row privileges PostgREST needs to actually serve public tables.

-- Grant SELECT/INSERT/UPDATE/DELETE on all existing public tables to the
-- Supabase roles (RLS policies still gate which rows each role can touch).
grant select, insert, update, delete on all tables    in schema public to anon, authenticated, service_role;
grant usage, select                  on all sequences in schema public to anon, authenticated, service_role;
grant execute                        on all functions in schema public to anon, authenticated, service_role;

-- Same for the auth schema so PostgREST can read auth.users in JWT validation
grant select on all tables in schema auth to anon, authenticated, service_role;
