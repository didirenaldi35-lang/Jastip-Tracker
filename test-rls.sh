#!/usr/bin/env bash
# Runs supabase/migrations/*.sql + supabase/tests/*.sql against a throwaway local
# PostgreSQL 15/16 (needs the postgres binaries; no Supabase account needed).
#   bash scripts/test-rls.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PGBIN/initdb" ] || { echo "PostgreSQL binaries not found. Set PGBIN=/path/to/bin"; exit 1; }
DIR="$(mktemp -d)"; PORT="${PGPORT:-54329}"
RUN=""; if [ "$(id -u)" = "0" ]; then id postgres >/dev/null 2>&1 || useradd -m postgres; chown postgres "$DIR"; RUN="su postgres -c"; fi
run() { if [ -n "$RUN" ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
cleanup() { run "$PGBIN/pg_ctl -D $DIR/data stop -m immediate >/dev/null 2>&1" || true; rm -rf "$DIR"; }
trap cleanup EXIT
run "$PGBIN/initdb -D $DIR/data -A trust -U postgres >/dev/null"
run "$PGBIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR -c listen_addresses=' -l $DIR/log -w start >/dev/null"
P="$PGBIN/psql -X -q -h $DIR -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1"
for f in supabase/tests/00_supabase_stub.sql supabase/migrations/*.sql supabase/tests/10_rls_test.sql; do
  echo "== $f"; chmod a+r "$f"; out="$(run "$P -f $PWD/$f" 2>&1)" || { echo "$out"; echo "FAILED in $f"; exit 1; }
  echo "$out" | grep -E "NOTICE:|ERROR|PASSED" | sed -E 's/^psql:[^ ]+ NOTICE: +//' || true
done
# migration must be re-runnable
echo "== re-run migration (idempotent)"; for f in supabase/migrations/*.sql; do run "$P -f $PWD/$f" >/dev/null; done; echo "idempotent: ok"
