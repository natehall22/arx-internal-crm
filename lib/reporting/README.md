# lib/reporting — company numbers, one way

Pure, client-safe modules that turn existing data into owner-level numbers. **Nothing imports these
yet** — adding them changed no page, API, payroll or pay. They are ready to wire.

| Module | Answers | Reuses (does not re-implement) |
|---|---|---|
| `overhead-allocation.ts` | "Each job completed in a month carries an equal share of that month's overhead" (5 jobs, $1,200 → $240 each) | `roundMoney`, `getEasternDateIso` |
| `job-ledger.ts` | Per job: revenue, cost, sales comp, OPP 9% (job cost), gross profit, owner draw (20%, 4-way), allocated overhead, net profit | `summarizeJobCosts`, `summarizeJobEconomics` |
| `sub-scorecard.ts` | Which crew (sub) is most profitable: jobs, margin, avg GP/job, labor $/sq, operating profit (before owner draw) | `job-ledger` rows |
| `partner-buyout.ts` | Evan Pay & Exit: fixed amount + % of net cash on named jobs, split into installments | `job-ledger` net profit as input |
| `partner-earn-in.ts` | Cam earn-in: months served, qualifying revenue, vest dates, Section 7 sale credit | — (agreement terms in `EARN_IN_TERMS`) |

Tests: `lib/reporting/__tests__/` (incl. both worked examples from the Cam agreement, and
`job-cost-sql-parity.test.ts`, which runs the same fixtures as `supabase/proposed/test/run_parity.sh`).

## Wiring order (each step its own PR, with the mandatory reviews)

1. **Job ledger on `/admin/job-profit-tracker`.** Load with `loadJobCostInputs` (already batched), call
   `buildJobLedger`, delete the page's local cost math (Known Redundancy #11 reader). Overhead input = `{}`
   (no overhead figures yet, Oct 9); the page shows gross profit with net blank until overhead is entered.
2. **`org_expenses` table** (nullable/additive; see docs/SURVEY_TO_CRM_SPEC.md module 1) → monthly
   overhead map → net profit per job appears.
3. **Sub scorecard on `/admin/subs`** — job-level now; trade-level after `job_cost_lines.work_order_id`.
4. **Owner obligations page** (owners only, `PAYROLL_ADMIN_ROLES` gate — never widen it): Evan buyout from
   `computeBuyout` with the four named jobs' ledger net profit; Cam quarterly statement from
   `computeEarnIn` (agreement §4 requires a quarterly statement).

## Things to confirm with the owners before showing partner numbers

- Evan: exact fixed amount, share %, job list, installment count, and whether a losing job reduces the
  total (`lossesReduceTotal`) — read them from the signed agreement, not from code.
- Evan "net cash" = what's left after everyone has been paid (Nathan, Oct 9) (incl. the 4-way owners draw, as the Google sheet does) = ledger `netProfit`.
- OPP 9% IS a job cost (Nathan, Oct 9). Open: base is sale amount (tracker today) vs commissionable (CLAUDE.md).
- Cam: Section 7 stage-2 "post-vesting Revenue" is read as the best 12-month window after vesting.
- Cam: team credit (which recruits' jobs count) is decided before calling `computeEarnIn`.

## Known limits

- Sales comp is the Goals estimate (commission pool cap from the payroll snapshot), not paid actuals.
- Overhead is split only across jobs **completed** in the month; months with overhead and no completed
  jobs are reported in `unallocatedMonths` rather than silently dropped.
- Dates: timestamps are bucketed in Eastern time via `getEasternDateIso`; bare DATE strings are used as-is
  (passing a DATE through `new Date()` shifts it a day earlier in Eastern — a trap in the existing helper).
