-- One live pay week per cutoff (2026-11-13). The morning cron made three open rows for the week ending 2026-11-08 in
-- 150 ms ("Week ending 2026-11-08", "(2)", "(3)", same cutoff_at): the only unique key was (org_id, period_label), so a
-- suffixed label slipped past it. This makes the database refuse a second non-cancelled week at the same cutoff;
-- cancelled weeks are left out so an emptied old week never blocks its replacement.
-- Safe on prod: zero duplicate (org_id, cutoff_at) among non-cancelled rows (checked 2026-11-13; the two extra rows from
-- that morning are cancelled). Additive, works before or after the code. Plain CREATE (CONCURRENTLY can't run in a
-- transaction); the table is small, so the share lock is brief.
begin;
set local lock_timeout = '5s';
create unique index if not exists payroll_periods_org_cutoff_live_key
  on public.payroll_periods (org_id, cutoff_at)
  where status <> 'cancelled';
commit;
