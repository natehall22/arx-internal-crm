#!/usr/bin/env bash
# Empties the LOCAL throwaway database (schemas public, auth, storage, extensions, arx_private, release_backups, payroll_backup) and recreates the Supabase stub.
set -euo pipefail
case "${PGHOST:-localhost}" in /*|localhost|127.0.0.1|::1) ;; *) echo "refusing: PGHOST=${PGHOST} is not local" >&2; exit 2 ;; esac
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
psql -X -q -c 'drop schema if exists public cascade; create schema public; drop schema if exists auth cascade; drop schema if exists storage cascade; drop schema if exists extensions cascade; drop schema if exists arx_private cascade; drop schema if exists release_backups cascade; drop schema if exists payroll_backup cascade; grant all on schema public to public' >/dev/null 2>&1
psql -X -q -v ON_ERROR_STOP=1 -f "$HERE/00_supabase_stub.sql" >/dev/null 2>&1
