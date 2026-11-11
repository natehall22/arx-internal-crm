# Payroll cutover — turning on the new pay-week path

Status 2026-11-12 (branch `feat/payroll-solid`): built and tested, **not turned on**. Live payroll is still the legacy path
(`PAYROLL_PAY_WEEK_ENABLED` unset). ARX has paid outside the CRM since 2026-08-20.

## What phase 1 added (new path only)

| | Where |
|---|---|
| Pay week per company (start day, cutoff time, payday, optional late-money window) in the company's time zone | `lib/payroll-week-schedule.ts` (pure), `lib/payroll-week-schedule-server.ts` (one reader / one writer), `orgs.settings.payWeek`; owners change it on the Pay screen ("Pay week: … · Change"), dates shown before Save |
| Weekly minimum — "greater of $X or the commission", generic pay-plan rule, one line with its math | `comp_plans.weekly_minimum`, `lib/payroll-weekly-minimum.ts`, office answers yes/no in Needs you, frozen at Approve (`payroll_week_minimums`) |
| Approve = owners (super admins) only; office prepares | `approvePayWeek` (checked from the database for every caller) |
| One "Change who gets what" sheet per job (who gets what %, one reason, one transaction, audited) | `lib/payroll-job-split.ts`, `POST /api/admin/payroll/pay-week/job-split`, SQL `payroll_set_job_split` |
| One weekly-total definition (Known Redundancy #15) | `PAY_LINE_SOURCES` in `lib/payroll-week-total.ts`; SQL parity test `payroll-week-total-parity.test.ts` |
| Side-by-side dry run for chosen weeks | `npm run payroll:side-by-side -- --org <id> --week-ending 2026-11-08,2026-11-15 --template out.csv` |

ARX's agreements (`lib/employee-comp-agreements.ts`): weeks run **Monday–Sunday, paid the following Friday**; financed money that
reaches the bank by **Wednesday 11:59:59 PM ET** of the payroll week still pays that Friday. The late-money window implements the
second rule for every job (not only financed ones — see Open questions). It did not exist in code before.

## Turn-on checklist (in order)

1. **Apply migration `202611120010_payroll_pay_week_minimums_job_split.sql`** (after 202610280010, already applied in prod). Local
   proof: `PGHOST=/var/run/postgresql PGUSER=postgres supabase/tests/run-payroll-pay-week-phase1.sh`.
2. **Deploy the code** (flag still off: nothing changes for anyone).
3. **Cancel the stale July week**: run `supabase/data-fixes/2026-11-12_close_stale_payroll_week.sql` (previews ARX only), then
   `SELECT release_backups.close_stale_payroll_weeks('<ARX org id>', 'apply');` (one company per run). Prod today: one week, `2026-W27`, with 36 h / $180.00 of hours
   (entered 2026-07-06) and a rejected bonus. **Confirm the $180 was paid outside first.** Undo:
   `SELECT release_backups.undo_close_stale_payroll_weeks('<ARX org id>');` (company or run id required).
4. **Set ARX's pay week** (owner, on the Pay screen once the flag is on — or before, with the same values in SQL):
   Monday start, closes Sunday 11:59 PM, payday Friday, late money Wednesday 11:59 PM. ARX's last CRM week was 2026-08-16, so the
   first new week is a normal 7-day week (no in-between week).
5. **Side-by-side, 2 weeks, to the cent**: `--week-ending` the two most recent Sundays; fill `paid` from what was paid outside;
   rerun with `--paid`. Every difference is listed. Known gaps of the dry run: no hourly / per-unit / bonuses / fixes (ARX reps are
   commission/bonus only). Two finished, unpaid jobs exist today: 26-0048 (installed 11-05) and 26-0043 (installed 11-09) — check
   both against what was paid.
6. **Set `PAYROLL_PAY_WEEK_ENABLED=true` in Vercel and redeploy** (the old-URL redirects in `next.config.js` are read at build).
   Do it at a week boundary (Monday), so the first Approve is a fresh week.
7. Owner approves the first week; check the emailed statement matches the screen.

## Delete after it has been on for one clean month (Known Redundancy #15, second entry)

- `lib/legacy-payroll-lock.ts`, `lib/legacy-payroll-materialization.ts`
- `app/admin/payroll/{periods,weekly,statements,[periodId]}`, `app/admin/payroll/LegacyPayrollPage.tsx` and their API routes
  (`app/api/admin/payroll/{periods,weekly,statements,export,[periodId]}` — grep each for other callers first)
- `lib/weekly-payroll/{commission-base,eligibility,explicit-rules,index}.ts` and `lib/weekly-payroll/cutoff.ts` (the new path no
  longer imports it; `lib/comp-plan-period-unit-earnings.ts` and `app/api/admin/comp-rates` still do — move them to
  `lib/payroll-week-schedule.ts` first)
- the second rep screen `/commissions/statement/[periodId]` (My pay replaces it) and the second CSV (`/api/admin/payroll/export`;
  Pay this week's CSV replaces it)
- the `isPayWeekEnabled()` checks and the build-time redirect conditional in `next.config.js`
- `PATCH /api/admin/payroll/deal-commission-roles` once the legacy statements page is gone (the Change sheet is the one writer)
- SQL `payroll_discard_lineless_job_snapshot` (dead since the atomic approve)

## Rules settled in review (2026-11-12)

- An unanswered weekly-minimum question **blocks Approve** ("Answer the weekly minimum for N people first.").
- What counts toward the minimum: commission lines + fixes tied to a job. Not hourly, per-unit, bonuses, carried balances, or fixes
  with no job. $180 commission + $200 job fix vs $500 → $120 top-up, $500 check.
- A week that is not 7 days (the in-between week after a pay-week change) pro-rates the minimum (amount × days / 7) unless the plan
  turns that off.
- Changing the pay week closes old-schedule open weeks: their hours, bonuses and pending fixes move to the new week covering their
  last day (one SQL step each, `payroll_move_open_week`); only a week with pay lines already written blocks it. Next week / carry-over
  always follow the current schedule; a week matches only on its exact calendar date (a Wednesday week never stands in for Thursday).
- Legacy statements are unchanged while the flag is off.

## Open questions for Nathan

- **Late money for every job or financed only?** The agreement says financed; the setting applies to any job whose money clears in
  the window. Restricting it needs a "financed" flag on the payment.
- **Field Marketer weekly minimum:** the rule is built and generic; no plan has it set (FM 2.0 has 0 people; the new FM agreement is
  pending). Set "Weekly minimum $500, office confirms" on the FM plan when the terms are final.
- **Weekly minimum vs. a separate weekly-floor program:** the setter-ramp sync (`lib/sync-setter-ramp-core.ts`) still writes its own
  `setter_weekly_floor` bonus on locked weeks with Sunday–Saturday windows. Do not use both for the same person; retire the ramp
  floor when the plan rule is used (it is a second implementation of the same idea).
