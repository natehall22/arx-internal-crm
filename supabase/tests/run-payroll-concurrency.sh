#!/usr/bin/env bash
# REAL two-session concurrency tests for the payroll writer guard and the atomic commit (migration 202610280010).
# Two separate database connections race on committed fixtures; a transaction in one session is held open with pg_sleep so the other
# session genuinely blocks on the row lock. Needs a LOCAL Postgres that already holds the production schema + the release migrations
# (see run-release-2026-10-batch.sh). Never run against Supabase: it refuses non-local hosts.
#
#   PSQL="psql -U postgres -d postgres" supabase/tests/run-payroll-concurrency.sh
#   PSQL="docker exec -i arxpg psql -U postgres" supabase/tests/run-payroll-concurrency.sh     # container
set -uo pipefail
PSQL="${PSQL:-psql}"
case "${PGHOST:-localhost}" in /*|localhost|127.0.0.1|::1) ;; *) echo "refusing: PGHOST=${PGHOST} is not local" >&2; exit 2 ;; esac
Q() { $PSQL -X -q -At -v ON_ERROR_STOP=1 "$@"; }
fail() { echo "FAIL $*" >&2; cleanup; exit 1; }
pass() { echo "PASS $*"; }

ORG=$(Q -c "select gen_random_uuid()")
U1=$(Q -c "select gen_random_uuid()"); U2=$(Q -c "select gen_random_uuid()")
now_s() { date +%s; }
cleanup() {
  Q -c "begin; select set_config('arx.payroll_commit','on',true);
    delete from payroll_adjustments where org_id='$ORG'; delete from payroll_rep_hours where org_id='$ORG';
    delete from payroll_unit_earnings where org_id='$ORG'; delete from payroll_periods where org_id='$ORG';
    delete from users where org_id='$ORG'; delete from auth.users where id in ('$U1','$U2'); delete from orgs where id='$ORG'; commit;" >/dev/null 2>&1
}
trap cleanup EXIT

Q -c "insert into orgs (id, name) values ('$ORG','Concurrency Test');
      insert into auth.users (id, email) values ('$U1','c1-$U1@t.test'),('$U2','c2-$U2@t.test');
      insert into users (id, org_id, email, full_name, role, active) values ('$U1','$ORG','c1-$U1@t.test','Admin One','admin',true),('$U2','$ORG','c2-$U2@t.test','Rep Two','sales_rep',true);" >/dev/null || fail setup
period() { # id cutoff
  Q -c "insert into payroll_periods (id, org_id, period_label, cutoff_at, lock_at, scheduled_pay_date) values ('$1','$ORG','L-$1','$2','$2','2031-01-01')" >/dev/null || fail "period $1"
}
EMPTY='{"jobs":[],"units":[]}'

# ---- S1: a writer that WAITED for the claim+commit must be refused once the week is committed (locked) ----
P=$(Q -c "select gen_random_uuid()"); period "$P" '2031-02-06 04:59:59+00'
TOK=$(Q -c "select gen_random_uuid()")
( Q -c "begin; select payroll_claim_period_lock('$ORG','$P','$TOK'); select payroll_commit_week('$ORG','$P','$TOK','$U1',0,'$EMPTY'::jsonb); select pg_sleep(4); commit;" >/dev/null 2>&1 & )
sleep 1
T0=$(now_s); OUT=$(Q -c "insert into payroll_rep_hours (org_id,payroll_period_id,user_id,regular_hours,hourly_earnings) values ('$ORG','$P','$U2',3,30)" 2>&1 || true); T1=$(now_s)
echo "$OUT" | grep -q 'payroll_period_not_open' || fail "S1 waiting writer was not refused after the commit: $OUT"
[ $((T1-T0)) -ge 2 ] || fail "S1 writer did not actually wait (waited $((T1-T0))s)"
[ "$(Q -c "select count(*) from payroll_rep_hours where payroll_period_id='$P'")" = "0" ] || fail "S1 hours row exists"
[ "$(Q -c "select status from payroll_periods where id='$P'")" = "locked" ] || fail "S1 period not locked"
pass "S1 writer blocked behind the claim+commit for $((T1-T0))s, then refused (week is locked); no hours row written"

# ---- S2: a claim waits for a writer that is already in flight, and the writer's row is in the plan the claim computes ----
P=$(Q -c "select gen_random_uuid()"); period "$P" '2031-02-13 04:59:59+00'
( Q -c "begin; insert into payroll_rep_hours (org_id,payroll_period_id,user_id,regular_hours,hourly_earnings) values ('$ORG','$P','$U2',2,20); select pg_sleep(4); commit;" >/dev/null 2>&1 & )
sleep 1
T0=$(now_s); R=$(Q -c "select payroll_claim_period_lock('$ORG','$P',gen_random_uuid())"); T1=$(now_s)
[ "$R" = "t" ] || fail "S2 claim result $R"
[ $((T1-T0)) -ge 2 ] || fail "S2 claim did not wait for the in-flight writer ($((T1-T0))s)"
[ "$(Q -c "select count(*) from payroll_rep_hours where payroll_period_id='$P'")" = "1" ] || fail "S2 in-flight hours row missing for the claim holder"
OUT=$(Q -c "insert into payroll_rep_hours (org_id,payroll_period_id,user_id,regular_hours,hourly_earnings) values ('$ORG','$P','$U1',1,10)" 2>&1 || true)
echo "$OUT" | grep -q 'payroll_period_claimed' || fail "S2 new writer not refused under the live claim: $OUT"
pass "S2 claim waited $((T1-T0))s for the in-flight writer, then held the week; the next writer was refused"

# ---- S3: commit locks the carry target; a claim on that target waits for the commit and then sees the carried balance ----
P=$(Q -c "select gen_random_uuid()"); N=$(Q -c "select gen_random_uuid()")
period "$P" '2031-03-06 05:59:59+00'; period "$N" '2031-03-13 04:59:59+00'   # (clock change on 2031-03-09: next Wed cutoff is 11:59:59 PM EDT)
Q -c "insert into payroll_adjustments (org_id,payroll_period_id,user_id,amount,reason) values ('$ORG','$P','$U2',-25,'clawback')" >/dev/null || fail "S3 fixture"
TOK=$(Q -c "select gen_random_uuid()")
( Q -c "begin; select payroll_claim_period_lock('$ORG','$P','$TOK'); select payroll_commit_week('$ORG','$P','$TOK','$U1',0,'$EMPTY'::jsonb); select pg_sleep(4); commit;" >/dev/null 2>&1 & )
sleep 1
T0=$(now_s); R=$(Q -c "select payroll_claim_period_lock('$ORG','$N',gen_random_uuid())"); T1=$(now_s)
[ "$R" = "t" ] || fail "S3 claim of next week returned $R"
[ $((T1-T0)) -ge 2 ] || fail "S3 claim on the carry target did not wait for the commit ($((T1-T0))s)"
[ "$(Q -c "select count(*) from payroll_adjustments where source_period_id='$P' and kind='balance' and payroll_period_id='$N' and amount=-25")" = "1" ] || fail "S3 carry missing from next week"
Q -c "update payroll_periods set lock_claimed_at=null, lock_claim_token=null where id='$N'; update payroll_adjustments set status='applied' where source_period_id='$P' and kind='balance'" >/dev/null || fail "S3 settle"   # so it cannot block S4's earlier-week rule
pass "S3 claim on the carry target waited $((T1-T0))s for the commit, then saw the carried balance (one row)"

# ---- S4: the target already claimed by someone else (held across the race): the commit refuses and writes nothing ----
P=$(Q -c "select gen_random_uuid()"); N=$(Q -c "select gen_random_uuid()")
period "$P" '2031-04-03 04:59:59+00'; period "$N" '2031-04-10 04:59:59+00'
Q -c "insert into payroll_adjustments (org_id,payroll_period_id,user_id,amount,reason) values ('$ORG','$P','$U2',-12,'clawback')" >/dev/null || fail "S4 fixture"
( Q -c "begin; select payroll_claim_period_lock('$ORG','$N',gen_random_uuid()); select pg_sleep(4); commit;" >/dev/null 2>&1 & )
sleep 1
TOK=$(Q -c "select gen_random_uuid()")
T0=$(now_s); OUT=$(Q -c "begin; select payroll_claim_period_lock('$ORG','$P','$TOK'); select payroll_commit_week('$ORG','$P','$TOK','$U1',0,'$EMPTY'::jsonb); commit;" 2>&1 || true); T1=$(now_s)
echo "$OUT" | grep -q 'next_week_busy' || fail "S4 commit was not refused with next_week_busy: $OUT"
[ $((T1-T0)) -ge 2 ] || fail "S4 commit did not wait on the target lock ($((T1-T0))s)"
[ "$(Q -c "select count(*) from payroll_adjustments where source_period_id='$P'")" = "0" ] || fail "S4 carry rows survived"
[ "$(Q -c "select status from payroll_periods where id='$P'")" = "open" ] || fail "S4 week not still open"
pass "S4 commit waited $((T1-T0))s on the carry target, found it mid-approval, refused (next_week_busy) and wrote nothing"

# ---- S5: users cannot probe other people's access (wrappers bound to auth.uid()) ----
# Needs a NON-superuser login that behaves like PostgREST's `authenticator` (session_user is not postgres): PSQL_PROBE, e.g.
#   PSQL_PROBE="docker exec -i arxpg psql -U probe_login -d postgres"
Q -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname='probe_login') then create role probe_login login; end if; end \$\$; grant authenticated to probe_login; grant usage on schema auth to probe_login;" >/dev/null || fail "S5 role"
PROBE_PSQL="${PSQL_PROBE:-}"
[ -n "$PROBE_PSQL" ] || { echo "SKIP S5 (set PSQL_PROBE to a probe_login connection)"; echo "ALL CONCURRENCY TESTS PASSED (S5 skipped)"; exit 0; }
PROBE() { $PROBE_PSQL -X -q -At -c "begin; set local role authenticated; select set_config('request.jwt.claim.sub','$1',true), set_config('request.jwt.claim.role','authenticated',true); select $2; commit;" 2>&1 | tail -1; }
[ "$(PROBE "$U2" "public.can_view_job_board('$U1')")" = "f" ] || fail "S5 user probed an admin's job-board access"
[ "$(PROBE "$U1" "public.can_view_job_board('$U1')")" = "t" ] || fail "S5 admin cannot ask about themselves"
[ "$(PROBE "$U2" "public.message_visible_to('$U1','team',false,'$ORG',null)")" = "f" ] || fail "S5 user probed another person's message access"
[ "$(PROBE "$U1" "public.message_visible_to('$U1','team',false,'$ORG',null)")" = "t" ] || fail "S5 admin cannot ask about their own message access"
OUT=$($PROBE_PSQL -X -q -At -c "begin; set local role authenticated; select arx_private.can_view_job_board('$U1'); commit;" 2>&1 || true)
echo "$OUT" | grep -qi 'permission denied' || fail "S5 authenticated can reach the private evaluator: $OUT"
pass "S5 signed-in users cannot probe other people's permissions and cannot reach the private evaluators"

echo "ALL CONCURRENCY TESTS PASSED"
