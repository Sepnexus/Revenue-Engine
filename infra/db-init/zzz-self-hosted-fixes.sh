#!/bin/bash
# Runs once on first DB boot (and never again, because /docker-entrypoint-initdb.d
# only fires on an empty data dir). Fixes two things the supabase/postgres
# image leaves in a state our other services can't use:
#
#   1. Internal roles (supabase_auth_admin, authenticator, supabase_storage_admin,
#      pgbouncer, etc.) are created with random passwords. We align them with
#      POSTGRES_PASSWORD so the gotrue / postgrest / storage-api containers can
#      connect using a single shared secret.
#
#   2. The auth + storage schemas are owned by `postgres`. The bundled GoTrue
#      migrations try to redefine functions in auth (e.g. auth.uid) and fail
#      with "must be owner of function uid". We transfer ownership of the
#      schemas and their objects to the matching *_admin roles.
#
# Named "zzz-" so it sorts after any other init scripts on the same volume.
set -euo pipefail

psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<EOSQL
ALTER USER supabase_auth_admin       WITH PASSWORD '${POSTGRES_PASSWORD}';
ALTER USER supabase_storage_admin    WITH PASSWORD '${POSTGRES_PASSWORD}';
ALTER USER authenticator             WITH PASSWORD '${POSTGRES_PASSWORD}';
ALTER USER supabase_admin            WITH PASSWORD '${POSTGRES_PASSWORD}';
ALTER USER pgbouncer                 WITH PASSWORD '${POSTGRES_PASSWORD}';
ALTER USER supabase_read_only_user   WITH PASSWORD '${POSTGRES_PASSWORD}';
ALTER USER supabase_replication_admin WITH PASSWORD '${POSTGRES_PASSWORD}';

ALTER SCHEMA auth    OWNER TO supabase_auth_admin;
ALTER SCHEMA storage OWNER TO supabase_storage_admin;

DO \$\$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'auth' LOOP
    EXECUTE format('ALTER TABLE auth.%I OWNER TO supabase_auth_admin', r.tablename);
  END LOOP;
  FOR r IN
    SELECT routine_name FROM information_schema.routines
    WHERE specific_schema = 'auth' AND routine_type = 'FUNCTION'
  LOOP
    EXECUTE format('ALTER FUNCTION auth.%I OWNER TO supabase_auth_admin', r.routine_name);
  END LOOP;
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'storage' LOOP
    EXECUTE format('ALTER TABLE storage.%I OWNER TO supabase_storage_admin', r.tablename);
  END LOOP;
END
\$\$;
EOSQL
