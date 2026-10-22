#!/usr/bin/env bash
# Runs the DB tests for migration 202610210002_payroll_no_cross_period_double_pay.sql
# against a LOCAL Postgres (>= 14). It creates a throwaway database
# payroll_guard_test_<pid>, runs supabase/tests/payroll_no_double_pay.sql (sequential
# cases), then the concurrency cases below (two real sessions each); then, in a second
# throwaway database, the data fix (supabase/data-fixes/20261021_...) and migration
# 202610210003 (unique indexes) end to end, including the fix's rollback (F cases).
# Both databases are dropped. Never point this at Supabase: it refuses non-local hosts.
#
#   PGHOST=/tmp PGPORT=5432 PGUSER=postgres supabase/tests/run-payroll-no-double-pay.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "${PGHOST:-localhost}" in
  /*|localhost|127.0.0.1|::1) ;;
  *) echo "refusing: PGHOST=${PGHOST} is not local" >&2; exit 2 ;;
esac

DB="payroll_guard_test_$$"
DB2="payroll_guard_test_$$_fix"
createdb "$DB"
trap 'dropdb --if-exists "$DB" >/dev/null 2>&1 || true; dropdb --if-exists "$DB2" >/dev/null 2>&1 || true' EXIT
Q() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
fail() { echo "FAIL $*" >&2; exit 1; }
pass() { echo "PASS $*"; }

# The sequential file prints its marker only if every case passed (ON_ERROR_STOP).
SEQ=$(Q -tA -f "$HERE/payroll_no_double_pay.sql" 2>&1) || { echo "$SEQ" >&2; fail "sequential cases"; }
echo "$SEQ" | grep -oE '(PASS|FAIL).*' || true
echo "$SEQ" | grep -q 'ALL SEQUENTIAL TESTS PASSED' || { echo "$SEQ" >&2; fail "sequential cases"; }

ORG=00000000-0000-0000-0000-0000000000e1
P3=00000000-0000-0000-0000-0000000000a3   # open
P6=00000000-0000-0000-0000-0000000000a6
P7=00000000-0000-0000-0000-0000000000a7
P8=00000000-0000-0000-0000-0000000000a8
Q -c "insert into payroll_periods (id, org_id, status) values ('$P6','$ORG','open'),('$P7','$ORG','open'),('$P8','$ORG','open');"

# R1: two writers put the same never-paid job into two different open periods.
JOB=00000000-0000-0000-0000-0000000000ca
( Q -c "begin; insert into payroll_job_snapshots (org_id,payroll_period_id,job_id) values ('$ORG','$P6','$JOB'); select pg_sleep(2); commit;" >/dev/null 2>&1 & )
sleep 0.5
OUT=$(Q -c "insert into payroll_job_snapshots (org_id,payroll_period_id,job_id) values ('$ORG','$P7','$JOB')" 2>&1 || true); sleep 2
echo "$OUT" | grep -q 'payroll_already_paid' || fail "R1 second writer not rejected: $OUT"
[ "$(Q -tAc "select string_agg(payroll_period_id::text, ',') from payroll_job_snapshots where job_id='$JOB'")" = "$P6" ] || fail "R1 rows"
pass "R1 concurrent cross-period snapshot: second writer waited, then rejected"
Q -c "delete from payroll_job_snapshots where job_id='$JOB'"

# R2: lock claims P8 (transaction still open) while cancel runs -> cancel waits, then refuses.
( Q -c "begin; select payroll_claim_period_lock('$ORG','$P8','00000000-0000-0000-0000-0000000000f1'); select pg_sleep(2); commit;" >/dev/null 2>&1 & )
sleep 0.5
R=$(Q -tAc "select payroll_cancel_or_reopen_period('$ORG','$P8','cancel','00000000-0000-0000-0000-0000000000d9')->>'code'"); sleep 2
[ "$R" = "lock_in_progress" ] || fail "R2 cancel during lock claim returned '$R'"
[ "$(Q -tAc "select status from payroll_periods where id='$P8'")" = "open" ] || fail "R2 status"
pass "R2 lock-vs-cancel: cancel waited for the claim, then refused; period still open"

# R2b: with the claim held, lock writes debris then cancel still refuses (nothing deleted).
Q -c "insert into payroll_job_snapshots (org_id,payroll_period_id,job_id) values ('$ORG','$P8','00000000-0000-0000-0000-0000000000cb')"
R=$(Q -tAc "select payroll_cancel_or_reopen_period('$ORG','$P8','reopen','00000000-0000-0000-0000-0000000000d9')->>'code'")
[ "$R" = "lock_in_progress" ] && [ "$(Q -tAc "select count(*) from payroll_job_snapshots where payroll_period_id='$P8'")" = "1" ] || fail "R2b"
pass "R2b reopen during an in-progress lock refuses and deletes nothing"
# lock finishes: flip conditional on its token, then release
[ "$(Q -tAc "with f as (update payroll_periods set status='locked' where id='$P8' and status='open' and lock_claim_token='00000000-0000-0000-0000-0000000000f1' returning 1) select count(*) from f")" = "1" ] || fail "R2 flip"
R=$(Q -tAc "select payroll_cancel_or_reopen_period('$ORG','$P8','cancel','00000000-0000-0000-0000-0000000000d9')->>'code'")
[ "$R" = "lock_in_progress" ] || fail "R2c cancel before claim release returned '$R'"
Q -c "update payroll_periods set lock_claimed_at=null, lock_claim_token=null where id='$P8' and lock_claim_token='00000000-0000-0000-0000-0000000000f1'"
R=$(Q -tAc "select payroll_cancel_or_reopen_period('$ORG','$P8','cancel','00000000-0000-0000-0000-0000000000d9')->>'code'")
[ "$R" = "period_has_payout_lines" ] || fail "R2d cancel after lock returned '$R'"
pass "R2c/d after the flip, cancel refuses (claim, then locked-with-lines); lock result intact"

# R3: cancel holds the period row; a lock claim racing it waits, then sees 'cancelled' and loses.
( Q -c "begin; select payroll_cancel_or_reopen_period('$ORG','$P7','cancel','00000000-0000-0000-0000-0000000000d9'); select pg_sleep(2); commit;" >/dev/null 2>&1 & )
sleep 0.5
R=$(Q -tAc "select payroll_claim_period_lock('$ORG','$P7','00000000-0000-0000-0000-0000000000f2')"); sleep 2
[ "$R" = "f" ] && [ "$(Q -tAc "select status from payroll_periods where id='$P7'")" = "cancelled" ] || fail "R3 claim returned '$R'"
pass "R3 cancel-vs-lock: claim waited for the cancel, then refused; period stays cancelled"

# R4: two lock claims at once -> exactly one wins.
( Q -tAc "begin; select payroll_claim_period_lock('$ORG','$P6','00000000-0000-0000-0000-0000000000f3'); select pg_sleep(2); commit;" > "/tmp/$DB.r4" 2>&1 & )
sleep 0.5
R=$(Q -tAc "select payroll_claim_period_lock('$ORG','$P6','00000000-0000-0000-0000-0000000000f4')"); sleep 2
grep -qx 't' "/tmp/$DB.r4" && [ "$R" = "f" ] || fail "R4 first=$(cat /tmp/$DB.r4) second=$R"
[ "$(Q -tAc "select lock_claim_token from payroll_periods where id='$P6'")" = "00000000-0000-0000-0000-0000000000f3" ] || fail "R4 token"
rm -f "/tmp/$DB.r4"
pass "R4 concurrent lock claims: exactly one wins"

# R5: discard of a "lineless" snapshot while its line insert is in flight -> keeps both.
SNAP=00000000-0000-0000-0000-0000000000bc
Q -c "insert into payroll_job_snapshots (id,org_id,payroll_period_id,job_id) values ('$SNAP','$ORG','$P3','00000000-0000-0000-0000-0000000000cc')"
( Q -c "begin; insert into payroll_payout_lines (org_id,payroll_period_id,payroll_job_snapshot_id,job_id,user_id,participant_role) values ('$ORG','$P3','$SNAP','00000000-0000-0000-0000-0000000000cc','00000000-0000-0000-0000-0000000000d1','sales_rep'); select pg_sleep(2); commit;" >/dev/null 2>&1 & )
sleep 0.5
R=$(Q -tAc "select payroll_discard_lineless_job_snapshot('$ORG','$SNAP')"); sleep 2
[ "$R" = "f" ] || fail "R5 discard returned '$R'"
[ "$(Q -tAc "select count(*) from payroll_payout_lines where payroll_job_snapshot_id='$SNAP'")" = "1" ] || fail "R5 line lost"
pass "R5 discard-vs-line-insert: discard waited, saw the committed line, deleted nothing"

# ---- F: data fix + unique indexes (second throwaway DB) -----------------------------
MIG2="$HERE/../migrations/202610210002_payroll_no_cross_period_double_pay.sql"
MIG3="$HERE/../migrations/202610210003_payroll_unique_pay_per_job.sql"
FIX="$HERE/../data-fixes/20261021_remove_cross_period_duplicate_payouts.sql"
createdb "$DB2"
F() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB2" "$@"; }
FV() { F -tAc "$1"; }
F -f "$HERE/payroll_dupfix_fixture.sql" >/dev/null
COUNTS="select (select count(*) from payroll_job_snapshots)||'/'||(select count(*) from payroll_payout_lines)"
NOBACKUP="select count(*) from pg_namespace where nspname='payroll_backup'"
FINGERPRINT="select md5(coalesce((select string_agg(t::text,'|' order by t.id) from payroll_job_snapshots t),'')
  ||coalesce((select string_agg(t::text,'|' order by t.id) from payroll_payout_lines t),'')
  ||coalesce((select string_agg(t::text,'|' order by t.job_id) from job_payroll_state t),''))"
[ "$(FV "$COUNTS")" = "9/11" ] || fail "F fixture counts $(FV "$COUNTS")"

# F1: the fix refuses to run before migration 0002 (and changes nothing).
OUT=$(F -f "$FIX" 2>&1 || true)
echo "$OUT" | grep -q 'apply migration 202610210002 first' || fail "F1 fix ran without 0002: $OUT"
[ "$(FV "$COUNTS")" = "9/11" ] && [ "$(FV "$NOBACKUP")" = "0" ] || fail "F1 changed data"
pass "F1 data fix refuses without migration 0002; nothing changed"

F -f "$MIG2" >/dev/null

# F2: 0003 refuses while duplicates exist, with a pointer to the data fix.
OUT=$(F -f "$MIG3" 2>&1 || true)
echo "$OUT" | grep -q '3 job(s) / 4 job-user-role key(s) still in more than one period' || fail "F2 0003 built on duplicates: $OUT"
[ "$(FV "select count(*) from pg_indexes where indexname like 'payroll_%one_period_per%'")" = "0" ] || fail "F2 index exists"
pass "F2 migration 0003 refuses while duplicates exist (no index built)"

# F3: a removed line whose kept twin has a different amount -> whole fix rolled back.
F -c "update payroll_payout_lines set net_amount = 1 where payroll_job_snapshot_id='00000000-0000-0000-0000-000000017a00'"
OUT=$(F -f "$FIX" 2>&1 || true)
echo "$OUT" | grep -q 'no identical twin in the kept period' || fail "F3 mismatch not refused: $OUT"
[ "$(FV "$COUNTS")" = "9/11" ] && [ "$(FV "$NOBACKUP")" = "0" ] || fail "F3 partial changes left"
F -c "update payroll_payout_lines set net_amount = 876.67 where payroll_job_snapshot_id='00000000-0000-0000-0000-000000017a00'"
pass "F3 fix refuses (and rolls back) when a duplicate's amount differs from the kept copy"

# F4: the real run.
BEFORE=$(FV "$FINGERPRINT")
OUT=$(F -tA -f "$FIX" 2>&1) || { echo "$OUT" >&2; fail "F4 fix failed"; }
[ "$(echo "$OUT" | grep -c '|DELETE|')" = "5" ] && [ "$(echo "$OUT" | grep -c '|KEEP|')" = "4" ] || fail "F4 preview rows: $OUT"
echo "$OUT" | grep -q '26-0029|sales_rep|2026-W33|locked|DELETE|364.37|364.37' || fail "F4 preview content: $OUT"
echo "$OUT" | grep -q 'removed 4 snapshot(s) / 5 line(s) (net 3249.97), repointed 2 job_payroll_state row(s); 0 cross-period duplicates remain' || fail "F4 notice: $OUT"
[ "$(FV "$COUNTS")" = "5/6" ] || fail "F4 counts $(FV "$COUNTS")"
[ "$(FV "select string_agg(p.period_label, ',' order by j.job_number) from payroll_job_snapshots s join payroll_periods p on p.id=s.payroll_period_id join production_jobs j on j.id=s.job_id")" = "2026-W29,2026-30,2026-30,2026-w32,2026-W34" ] || fail "F4 kept periods"
[ "$(FV "select string_agg(p.period_label||':'||(st.payroll_cutoff_at=p.cutoff_at and st.scheduled_pay_date=p.scheduled_pay_date), ',' order by j.job_number) from job_payroll_state st join payroll_periods p on p.id=st.current_payroll_period_id join production_jobs j on j.id=st.job_id")" = "2026-W29:true,2026-30:true,2026-30:true,2026-w32:true,2026-W34:true" ] || fail "F4 job_payroll_state"
[ "$(FV "select updated_at='2026-08-20 22:14:12+00' from job_payroll_state where job_id='00000000-0000-0000-0000-000000000c29'")" = "t" ] || fail "F4 j29 state touched"
[ "$(FV "select (select count(*) from payroll_backup.dupfix_20261021_job_snapshots)||'/'||(select count(*) from payroll_backup.dupfix_20261021_payout_lines)||'/'||(select count(*) from payroll_backup.dupfix_20261021_job_payroll_state)||'/'||(select count(*) from payroll_backup.dupfix_20261021_map)")" = "4/5/2/4" ] || fail "F4 backup counts"
[ "$(FV "select bool_or(has_schema_privilege(r,'payroll_backup','USAGE')) or bool_or(has_table_privilege(r,'payroll_backup.dupfix_20261021_payout_lines','SELECT')) from unnest(array['anon','authenticated']) r")" = "f" ] || fail "F4 backup readable by API roles"
pass "F4 data fix: earliest period kept per job, 4 snapshots/5 lines removed, state repointed, backup private"

# F5: a second run refuses (backup already exists) and changes nothing.
OUT=$(F -f "$FIX" 2>&1 || true)
echo "$OUT" | grep -q 'already exists' || fail "F5 rerun not refused: $OUT"
[ "$(FV "$COUNTS")" = "5/6" ] || fail "F5 rerun changed data"
pass "F5 data fix re-run refused, nothing changed"

# F6: 0003 now builds (and is re-runnable).
F -f "$MIG3" >/dev/null && F -f "$MIG3" >/dev/null || fail "F6 0003 failed after fix"
[ "$(FV "select count(*) from pg_indexes i join pg_class c on c.relname=i.indexname join pg_index x on x.indexrelid=c.oid where x.indisunique and i.indexname in ('payroll_job_snapshots_one_period_per_job','payroll_payout_lines_one_period_per_job_user_role')")" = "2" ] || fail "F6 indexes"
pass "F6 migration 0003 builds both unique indexes after the fix (twice)"

# F7: with triggers on, the trigger still answers first (app's payroll_already_paid);
#     with triggers off, the indexes alone reject a second period.
OUT=$(F -c "insert into payroll_job_snapshots (org_id,payroll_period_id,job_id) values ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a7','00000000-0000-0000-0000-000000000c00')" 2>&1 || true)
echo "$OUT" | grep -q 'payroll_already_paid' || fail "F7 trigger not first: $OUT"
F >/dev/null <<'SQL' || fail "F7 index backstop"
BEGIN;
ALTER TABLE payroll_job_snapshots DISABLE TRIGGER trg_payroll_job_snapshots_single_period_ins;
ALTER TABLE payroll_payout_lines DISABLE TRIGGER trg_payroll_payout_lines_single_period_ins;
DO $$ DECLARE c text; BEGIN
  BEGIN
    INSERT INTO payroll_job_snapshots (org_id,payroll_period_id,job_id) VALUES ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a7','00000000-0000-0000-0000-000000000c00');
    RAISE EXCEPTION 'FAIL snapshot index allowed a second period';
  EXCEPTION WHEN unique_violation THEN GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
    IF c <> 'payroll_job_snapshots_one_period_per_job' THEN RAISE EXCEPTION 'FAIL wrong constraint %', c; END IF;
  END;
  INSERT INTO payroll_job_snapshots (id,org_id,payroll_period_id,job_id) VALUES ('00000000-0000-0000-0000-0000000000ff','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a7','00000000-0000-0000-0000-0000000000cf');
  BEGIN
    INSERT INTO payroll_payout_lines (org_id,payroll_period_id,payroll_job_snapshot_id,job_id,user_id,participant_role) VALUES ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a7','00000000-0000-0000-0000-0000000000ff','00000000-0000-0000-0000-000000000c34','00000000-0000-0000-0000-0000000000d1','sales_rep');
    RAISE EXCEPTION 'FAIL line index allowed a second period';
  EXCEPTION WHEN unique_violation THEN GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
    IF c <> 'payroll_payout_lines_one_period_per_job_user_role' THEN RAISE EXCEPTION 'FAIL wrong constraint %', c; END IF;
  END;
END $$;
ROLLBACK;
SQL
[ "$(FV "select string_agg(tgenabled::text,'') from pg_trigger where tgname like 'trg_payroll_%single_period%'")" = "OOOO" ] || fail "F7 triggers left disabled"
pass "F7 trigger answers first (payroll_already_paid); unique indexes reject on their own when triggers are off"

# F8: the rollback block in the data-fix file (run exactly as written) restores every row.
ROLLBACK_SQL=$(sed -n '/^-- ROLLBACK-BEGIN$/,/^-- ROLLBACK-END$/p' "$FIX" | sed '1d;$d' | sed 's/^-- //')
echo "$ROLLBACK_SQL" | grep -q '^COMMIT;$' || fail "F8 could not extract rollback block"
echo "$ROLLBACK_SQL" | F >/dev/null || fail "F8 rollback failed"
[ "$(FV "$FINGERPRINT")" = "$BEFORE" ] || fail "F8 rollback did not restore rows byte-for-byte"
[ "$(FV "$COUNTS")" = "9/11" ] || fail "F8 counts"
[ "$(FV "select count(*) from pg_indexes where indexname like 'payroll_%one_period_per%'")" = "0" ] || fail "F8 indexes still present"
[ "$(FV "select string_agg(tgenabled::text,'') from pg_trigger where tgname like 'trg_payroll_%single_period%'")" = "OOOO" ] || fail "F8 triggers left disabled"
pass "F8 rollback restores snapshots, lines and job_payroll_state exactly; triggers re-enabled"

echo "ALL PAYROLL GUARD DB TESTS PASSED"
