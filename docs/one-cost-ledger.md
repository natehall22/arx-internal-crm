# One job cost ledger — before / after

`job_cost_lines` is now the only place a job's cost lives; every screen reads it through `lib/job-cost-ledger.ts`
(job Financials card, ops board, `/admin/job-profit-tracker`, goals economics, payroll materialization, payroll worksheet).
Writes: Materials "+ Job Cost" and Photos & files "+ Add cost line" both POST `/api/ops/jobs/[id]/cost-lines`.

## Deploy order
1. Migration `202610220001_job_cost_ledger_source_order.sql` (additive; no-ops on prod except the new `source` enum column).
2. Data fix `supabase/data-fixes/2026-10-21_one_cost_ledger.sql`: run PART 1 preview, review, then PART 2, deploy the app, then PART 2b (catch-up). PART 3 rolls back.
3. Deploy.

## Reporting fields
- `job_cost_lines.source` (enum manual | product_order_mirror | legacy_column_import | dealer_fee_sync; NULL = unclassified) — where the line came from.
- `job_cost_lines.source_product_order_id` — legacy order a line was mirrored from.

## Total cost per job: what each screen showed BEFORE vs the one number AFTER
Read from prod 2026-10-22 (read-only simulation of the data fix). Only jobs where a number changes. Cost includes dealer fee. Profit = sale − cost.

| Job | Sale | Job page | Ops board | Profit tracker | **After (all screens)** | **Profit after** |
|---|---|---|---|---|---|---|
| 26-0002 | $25,932.00 | $10,793.00 | $9,458.09 | $9,458.09 | **$10,793.00** | **$15,139.00** |
| 26-0008 | $17,020.47 | $8,871.94 | $7,904.94 | $7,904.94 | **$8,871.94** | **$8,148.53** |
| 26-0010 | $15,501.00 | $4,216.55 | $10,340.17 | $10,202.62 | **$10,604.17** | **$4,896.83** |
| 26-0011 | $11,280.00 | $5,723.64 | $6,249.86 | $6,249.86 | **$5,723.64** | **$5,556.36** |
| 26-0012 | $11,409.17 | $1,563.17 | $3,849.70 | $3,746.43 | **$3,879.60** | **$7,529.57** |
| 26-0013 | $17,981.46 | $5,383.65 | $9,538.92 | $9,088.27 | **$10,456.92** | **$7,524.54** |
| 26-0014 | $18,959.39 | $3,790.48 | $8,791.76 | $8,035.28 | **$8,791.76** | **$10,167.63** |
| 26-0015 | $25,894.28 | $5,051.86 | $10,858.53 | $9,501.67 | **$10,858.53** | **$15,035.75** |
| 26-0016 | $24,225.11 | $4,465.00 | $10,836.44 | $10,836.44 | **$10,836.44** | **$13,388.67** |
| 26-0017 | $12,523.79 | $2,118.68 | $5,407.88 | $5,407.88 | **$5,441.56** | **$7,082.23** |
| 26-0018 | $12,421.63 | $2,160.00 | $5,120.23 | $5,570.23 | **$5,570.23** | **$6,851.40** |
| 26-0019 | $2,239.76 | $0.00 | $1,292.97 | $1,292.97 | **$1,292.97** | **$946.79** |
| 26-0020 | $12,998.56 | $3,829.12 | $8,547.60 | $7,866.48 | **$8,547.60** | **$4,450.96** |
| 26-0022 | $10,815.28 | $2,152.00 | $5,112.91 | $6,143.71 | **$6,143.71** | **$4,671.57** |
| 26-0023 | $10,900.00 | $2,760.00 | $6,779.49 | $6,779.49 | **$6,779.49** | **$4,120.51** |
| 26-0024 | $1,100.00 | $2,100.46 | $2,107.07 | $2,107.07 | **$2,100.46** | **$-1,000.46** |
| 26-0025 | $5,968.47 | $1,672.00 | $4,068.47 | $4,068.47 | **$4,068.47** | **$1,900.00** |
| 26-0026 | $34,706.31 | $12,975.00 | $26,971.53 | $26,971.53 | **$26,971.53** | **$7,734.78** |
| 26-0027 | $7,442.54 | $2,306.96 | $5,009.55 | $4,712.59 | **$5,009.55** | **$2,432.99** |
| 26-0028 | $7,075.58 | $2,210.00 | $4,559.61 | $4,559.61 | **$4,559.61** | **$2,515.97** |
| 26-0029 | $5,736.80 | $1,943.76 | $4,607.21 | $4,607.21 | **$4,663.97** | **$1,072.83** |
| 26-0030 | $15,351.20 | $2,880.00 | $7,545.63 | $7,545.63 | **$7,545.63** | **$7,805.57** |
| 26-0031 | $11,574.64 | $2,856.51 | $7,102.88 | $6,496.37 | **$7,102.88** | **$4,471.76** |
| 26-0032 | $18,865.00 | $4,270.00 | $11,667.78 | $11,667.78 | **$11,667.78** | **$7,197.22** |
| 26-0033 | $6,622.79 | $2,282.76 | $4,148.59 | $4,148.59 | **$4,148.59** | **$2,474.20** |
| 26-0034 | $7,700.00 | $5,396.00 | $7,384.37 | $7,384.37 | **$7,384.37** | **$315.63** |
| 26-0035 | $20,802.71 | $6,775.00 | $13,852.91 | $13,852.91 | **$13,852.91** | **$6,949.80** |
| 26-0036 | $19,826.71 | $4,407.00 | $11,328.29 | $11,328.29 | **$11,328.29** | **$8,498.42** |
| 26-0037 | $34,957.69 | $26,542.48 | $19,101.52 | $19,101.52 | **$19,182.48** | **$15,775.21** |
| 26-0041 | $26,792.00 | $10,010.58 | $10,917.05 | $16,338.08 | **$16,338.08** | **$10,453.92** |
| 26-0042 | $8,679.57 | $1,583.45 | $4,471.04 | $4,471.04 | **$4,471.04** | **$4,208.53** |
| 26-0043 | $22,551.19 | $0.00 | $3,623.39 | $3,623.39 | **$3,623.39** | **$18,927.80** |
| 26-0044 | $23,998.89 | $4,318.00 | $10,033.15 | $10,033.15 | **$10,033.15** | **$13,965.74** |
| 26-0045 | $8,516.83 | $0.00 | $43.72 | $43.72 | **$43.72** | **$8,473.11** |
| 26-0046 | $43,633.42 | $0.00 | $11,318.09 | $19,368.09 | **$19,368.09** | **$24,265.33** |
| 26-0047 | $9,900.14 | $2,775.00 | $6,806.64 | $6,806.64 | **$6,806.64** | **$3,093.50** |

## Specific corrections
- **26-0041**: the same $5,421.03 was in both tables; one ledger line, counted once (tracker already said $16,338.08; job page said $10,010.58).
- **26-0013**: the $918 lender fee typed twice — the extra lines are already archived; counted once.
- **26-0011**: duplicate QXO line ($3,028.16 typed 47s before the $3,028.64 order) archived (soft) — ops board and tracker drop $526.22.
- **26-0040**: its $5,707.87 Materials-tab order is mirrored into the ledger.
- 26-0017 / 26-0029: two non-material mirrors retyped to misc (totals unchanged).
- 5 live lines had `deduct_from_commission_base = true` (read by no payout; its only effect was blocking payroll on 26-0041). Turned off; new lines are born off (`NEW_COST_LINE_PAYROLL_FLAGS`).

## Needs a decision
- Jobs where the ledger and the 2026-07-08 spreadsheet columns disagree: the ledger wins (what ops sees on the job); listed by the PART 1 preview ("Needs a look").
- Deliberately **not** done: wiring costs into the commission base (changes pay — separate decision).
- Conflict risk: `lib/payroll-period-materialization.ts` is also touched by `fix/money-inputs` (#54) and `fix/payroll-no-double-pay` (#53); whichever merges second needs a rebase.
