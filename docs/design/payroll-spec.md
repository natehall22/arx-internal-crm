# ARX Payroll: the simplest version

Date: 2026-10-21. Inputs: `scratchpad/audit-payroll.md`, the CRM code (`lib/commission-payroll.ts`, `lib/payroll-period-materialization.ts`, migration 121, `docs/payroll-*`) and about 30 web searches and fetches.
No code or database was changed.

**How to read the evidence.** Reviews come from Capterra, G2, Software Advice and TrustRadius pages, one page each, about 25 reviews per page. "Frequency" means how many independent sources raised the theme. It is **not** a statistical survey. Vendor blogs (CaptivateIQ, Everstage, Sales Cookie, Forma, Contractors Cloud) sell commission software, so treat their framing as biased. Items older than 2 years (before 2024-10-21) are marked **[old]**.

---

## 1. Top 10 pain points, ranked by how many sources raised them

| # | Pain point | Products and sources (paraphrased; dates) | One quote |
|---|---|---|---|
| 1 | **Reps can't see or follow how their pay was worked out.** Statements are opaque, have no line-level explanation, and history is hard to find. | CaptivateIQ Capterra: no explanation of pay inside the tool, "lack of granularity" (Nov–Dec 2025). Salesforce Spiff G2: statements "overwhelming", historical statements hard to find (Sep 2026). Salesforce *Trends in Sales Compensation* report: 74% of 500 US reps want more transparency in how comp is calculated, and 47% say it doesn't always seem fair (survey Aug–Sep 2025). AccuLynx blog: reps lack visibility into per-job earnings (Jan 2024, updated Apr 2026). ContractorPlus roofing blog: reps who rely on the owner's spreadsheet trust the plan less (Aug 2026). CaptivateIQ blog: reps "recheck the math themselves" (Apr 2026). | Salesforce report, a retail sales leader: "Every month is a mystery when I receive my checks." |
| 2 | **Setup and plan complexity, with a steep learning curve.** | Spiff G2 tags: Learning Curve (43), Complexity (39), Implementation Difficulty (29) (page seen Oct 2026). Everstage G2 tag: Learning Curve (32). QuotaPath Capterra: complex plans lack functionality, plans hard to understand (2022–23) **[old]**. Xactly Software Advice: "non-intuitive tool for regular users" (2018) **[old]**, record review "very complicated" (Apr 2025). Performio Capterra: rollout "growing pains" (2022) **[old]**. | Spiff G2, Sep 2026: "Implementation can be difficult, with a steep learning curve" |
| 3 | **Numbers lag or are missing, so data is out of sync with the CRM.** | Performio G2 tag Slow Updates (46). Everstage G2 tag Time Delays (24). CaptivateIQ Capterra: "occasional data sync delays" (Dec 2025). QuotaPath Capterra: deals don't all show up (Jun 2022) **[old]**. Xactly Software Advice: days without updates, and uploaded payments not reaching rep statements (2019) **[old]**. | Xactly SA, 2019 [old]: "There are days that go by that it still has not updated." |
| 4 | **Manual work, spreadsheets and workarounds stay in the process.** | QuotaPath Capterra: repeated data entry, sign-offs, Excel side-tracking (2022) **[old]**. CaptivateIQ Capterra: manual filtering "every single time", plus a second system to check pay (Dec 2025). Xactly SA: master data needs too much manual work (2019) **[old]**. Contractors Cloud roofing blog names "messy spreadsheets" (Sep 2025). Salesforce report: reps keep "shadow accounting". | CaptivateIQ Capterra, Dec 2025: "requires manually filtering (every single time)" |
| 5 | **Edge cases are painful.** Clawbacks, splits, mid-period changes and one-off adjustments are all hard. | Spiff G2: clawbacks and mid-period changes "difficult to model cleanly" (Sep 2026). CaptivateIQ Capterra: edge-case adjustments "clunky" (Dec 2025). Sales Cookie blog ranks split-assignment ambiguity as the #1 dispute cause, about 20% (May 2026; that share is **unsourced**). Performio Capterra: editing commission % per account is cumbersome (2022) **[old]**. | Spiff G2, Sep 2026: "clawbacks, or mid-period plan changes can be difficult to model" |
| 6 | **Reps can't see pending pay or when it will land** (pay-when-funded timing). | QuotaPath Capterra: hard to track when the customer is expected to pay vs. actually pays (Jul 2022) **[old]**. Contractors Cloud: timing gap between payouts and collections (Sep 2025). AccuLynx: pre-commission/draw at turn-in, rest at close-out (2024/2026). ContractorPlus: hold part of pay until install/final payment, and pay change orders only once collected (Aug 2026). JLC remodeling: long payout delays sap motivation (2007) **[old]**. | QuotaPath Capterra, 2022 [old]: "keeping track of dates, for example when a customer is expected to pay" |
| 7 | **Errors are hard to find before a run and hard to fix after one.** | Spiff G2: error messages "not always clear or actionable" (Sep 2026). Spiff Trailhead: statement errors don't appear in the export and must be checked at period end. Paychex Capterra: "untimely correction for errors" (Mar 2026). QuickBooks Payroll Capterra: taxes not withheld, bugs slow to fix (2025–26). Gusto Capterra: must "run a PDF report just to verify payroll" (Jan 2025). Gusto help: fixes go through a separate "fix a mistake" off-cycle run. | Paychex Capterra, Mar 2026: "Untimely correction for errors that were made." |
| 8 | **Disputes and "is this right?" questions eat time.** | CaptivateIQ blog citing its State of IC report: about 80% of teams get more than 10 rep inquiries per pay period, and 2 in 3 companies have over- or under-paid (Apr 2026, vendor survey). Sales Cookie: dispute SLAs, with adjustments paid on the next statement (May 2026). Performio Capterra: "missed opportunities and not getting paid" (2022) **[old]**. | Performio Capterra, 2022 [old]: "trouble with missed opportunities and not getting paid" |
| 9 | **Payroll processors don't fit commission sales and punish missed deadlines.** | ADP RUN Capterra: "doesn't work for sales companies very well" (Dec 2025). Gusto help: commission **draws aren't supported**, and commission-only staff on Autopilot go unpaid unless commission is entered first. QuickBooks Payroll Capterra: holiday cutoffs left "employees going without pay" (Jan 2026). Paychex and ADP Capterra: support hard to reach (2025–26). | ADP RUN Capterra, Dec 2025: "doesn't work for sales companies very well" |
| 10 | **Chargebacks, draws and negative balances surprise people, especially when a rep leaves.** | Everstage: clawbacks hurt morale, add admin work and carry legal risk if the policy is vague (updated Jul 2026). CaptivateIQ clawback guide: write the triggers down and apply them on the next payroll after notice; one option is a cap of 50% of earnings (May 2025). Forma: recovering a draw after a rep leaves is often impractical (2021) **[old]**. NC law: deductions need prior written authorization, and an amount not known in advance needs written notice before deduction (Parker Poe, 2019 **[old]**, the rule is still in effect). Commissions owed to a departed rep are due on the first regular payday after they become calculable, and can be forfeited only if the rep was notified of the policy (NCGS 95-25.7, current statute). | CaptivateIQ, May 2025: "Clawbacks will be applied to the next payroll cycle following cancellation notification." |

Gaps to keep in mind: none of the AccuLynx, JobNimbus, Leap or ServiceTitan pages I found carried user complaints about their commission features. JobNimbus review cons don't mention commissions at all. ServiceTitan's help docs (Sep/Oct 2026) describe per-job "Adjust splits" and say commission appears only once the invoice is posted, with no rule about post-close edits. I found no first-hand Reddit or forum threads from roofing reps. Searches returned court decisions and vendor blogs instead. None of the vendor blogs are quoted for statistics unless they cite a source.

---

## 2. Our answer to each, and whether ARX suffers from it today

| # | Pain point | Our answer (one line) | ARX today? |
|---|---|---|---|
| 1 | Opaque statements | Every line on the rep's phone shows its math in one sentence ("$18,400 sale × 5% setter = $920"). | **Yes.** iOS estimate always $0 (P9). Statement is empty until lock (P3). |
| 2 | Setup complexity | Rates stay in comp plans, which already exist. The weekly screen has no setup at all: periods are automatic, with no labels or cutoffs to type. | **Yes.** About 9 pages, a typed label, cutoff and pay date every week, and a 10-step run. |
| 3 | Lag / out of sync | The draft is computed live by **the same function** that approval uses, so there is one engine instead of four. | **Yes.** 3–4 competing answers to "what am I owed" (P2, P7, P9). |
| 4 | Manual work | Hours, bonuses and fixes are typed inline on the one screen. One "email all" happens automatically on approve. | **Yes.** One email per rep, hours on their own page, bonus approval in another hub. |
| 5 | Edge cases | Everything after approval is an **adjustment line** (+ or −) in the next run, using one mechanism for chargebacks, re-splits, top-ups and corrections. | **Yes.** Overrides are blocked after lock, and chargebacks can't be built (P3, P5). |
| 6 | Pending pay invisible | The rep sees each job as **Coming → This week → Paid**, with the blocker in plain English and the dollars still owed by the customer. | **Yes.** No pending view at all. |
| 7 | Errors found late | Anomaly flags appear above the Approve button (negative check, a line over $X, total over 27% on a job, a first-time payee). Database guard: a job's commission can be paid once only. | **Yes.** $18,901 potential double-pay (P1). Reopen stacks lines (P4). |
| 8 | Disputes | A "Something's wrong" button on every line shows up in the admin's "Needs you" box. Resolving it creates an adjustment line or a reply. | **Yes.** No dispute path exists. |
| 9 | Payroll processor misfit | The CRM is the **calculator** only. It exports one total per person (CSV, or later Gusto/QuickBooks) for whatever processor ARX uses. Draws live in the CRM, not the processor. | **Partly.** Today's CSV export uses a different job population than lock (P2). |
| 10 | Clawback and draw surprises | A written policy with a signed deduction authorization, a cap per check, the rep warned on the phone the moment a job cancels, and a running balance always shown. | **Yes.** No chargeback path. The cancel RPC refuses paid jobs and tells ops to "handle as chargeback" (P5). |

ARX already has 9 of the 10 problems. #9 is partly an issue: ARX's processor is unknown (see Decisions).

---

## 3. The simplest design (written for the owner)

### The big idea
- **Every dollar is a line.** Commission, hourly, bonus, OPP, chargeback, draw, and a correction are each just a line with a person, an amount (+ or −), and one sentence saying why.
- **Every line is in one of three states.** *Coming* (not payable yet, with the reason shown), *This week* (will be paid on Friday), or *Paid* (frozen forever).
- **Nothing blocks the Approve button.** If something isn't ready, such as a missing bonus approval, a cost under review, or a customer who hasn't finished paying, that line simply waits for next week. Nobody can get "stuck" running payroll.
- **Paid is permanent.** Weeks are never reopened. If something was wrong, the fix is a new line next week, and both the rep and the admin can see it.

### What the admin does each week (one screen, under 5 minutes)
Open **Payroll**. It is already set to this week: cutoff Wed 11:59 PM ET, payday Friday (decision D2). There is nothing to create.

1. **Top bar:** `Week ending Wed Oct 21 · Payday Fri Oct 23 · $14,380 to 7 people`.
2. **"Needs you" box.** It shows only when something is in it, and each item takes one tap.
   - Hourly people with no hours entered. Type the hours right there.
   - Bonuses waiting for approval (444, setter ramp). Approve or skip; a skipped bonus rolls to next week.
   - Disputes from reps. Reply, or "Add fix", which creates an adjustment line.
   - New chargebacks from cancelled jobs. Confirm the amount.
   - Warnings: someone's check is negative, a single line is over $3,000, a job's lines add up to more than 27%, or someone is being paid for the first time.
3. **People list.** Name, then commission, hourly, bonus, adjustments and net. Tap a name to see their lines, exactly as the rep sees them.
4. **One button: "Approve $14,380".** It freezes the lines, texts or emails every statement, and downloads the file for the payroll processor. Done.

Fixing a split or an amount **before** approving: tap the line, choose "Change", enter the new amount and a reason. It saves straight to the draft.

### What a rep sees on their phone ("My Pay")
- **Big number:** `Friday: $1,240` (approved), or `This week so far: $1,240` (draft).
- **Coming.** Each sold job with its estimated amount and **why it isn't payable yet**, in plain words:
  - "Install not marked complete"
  - "Customer still owes $4,200 of $18,400"
  - "Office is reviewing a cost on this job"
  - "Price info missing, office is fixing" (comp base missing)
- **This week.** Lines that will be on Friday's check.
- **Paid.** History by payday. Each line shows its math: `26-0041 Smith · $18,400 × 5% setter = $920`.
- **Balance**, shown only if non-zero: "You owe $460 from a cancelled job. Up to $X comes out per check."
- **"Something's wrong" on every line**, which opens a short note with a status (Open, Answered, Fixed in next check).

### Every situation, and how it's handled

| Situation | What happens |
|---|---|
| **Normal job** | Sold → installed → customer fully paid → (costs approved, if D4 keeps that gate). It appears in the next week's run: setter 5%, closer 7%, sales override 6% (all inside the existing 18% pool scaler), plus OPP (D3). |
| **Job cancelled after we paid** | Ops cancels as usual. The cancel no longer refuses paid jobs. The system drafts a **negative line for every person paid on that job** (setter, closer, override, OPP) and puts them in "Needs you". The rep's phone shows it right away. Recovery comes out of future checks, up to the cap (D6). |
| **Job cancelled before we paid** | Its *Coming* lines just disappear, with a note: "Job cancelled, no commission." That is today's behaviour. |
| **Partial payment** | Stays in *Coming* with "Customer still owes $X". Pays in full once fully funded (today's rule). The existing "close with balance" ops option still releases it (D5: pay on the full amount or on what was collected). |
| **Change order raises the price before pay** | The commission uses the new total once the CO is signed and the job is funded at the new total. The rep's *Coming* amount updates automatically. |
| **Change order raises the price after pay** | A positive **top-up line** for each person goes in the next run: (new base − old base) × their rate. A price drop after pay produces a negative line in the same way. (Note: today's snapshot hard-codes change orders to $0, `materialization.ts:562`.) |
| **Split deal** (two closers, a custom split) | Set it on the job before payday. The tool is the same per-job override that exists today, now also reachable from the payroll line. If it's changed after pay, "Re-split" writes a paired −/+ adjustment so the total stays the same. |
| **Rep leaves the company** | Their already-earned *Coming* jobs keep flowing. NC law requires commissions to be paid on the first regular payday after they become calculable, unless the rep was notified in writing of a forfeiture policy (D7). Any negative balance is shown on the final statement. It can be deducted only with a prior signed authorization and written notice of the amount (NC). Otherwise it's written off or billed separately (D7). |
| **Back-dated payment** (office enters a payment dated last month) | Payment *entry* time decides the week (today's code already uses `created_at`). Approved weeks never change. The job lands in the next open week. |
| **Cost added after the job was paid** | If commissions are on the sale amount (D1), costs don't change pay, so nothing happens. If D1 says costs reduce the base, the system drafts a negative adjustment next week, but only for costs flagged "reduces commission". |
| **Cost added before pay, not yet approved** | Line stays in *Coming*: "Office is reviewing a cost." It does not block anyone else's pay. |
| **Week with zero jobs** | Hourly, bonuses and adjustments still pay as usual. If there are no lines at all, the screen says "Nothing to pay this week" and there's nothing to approve. |
| **Rep's week nets negative** (chargeback bigger than earnings) | The check is $0, never negative. The remainder carries forward as a balance on their phone. W-2 hourly pay is never reduced below minimum wage (general federal rule; confirm with CPA). |
| **Hourly canvassers / field marketers** | Hours go in a column on the same screen, or are imported if a time tool is added later. Rate comes from the comp plan (`payroll-hourly-rate.ts`). Hourly pay never touches the 18% pool (existing rule). |
| **Bonuses** (444, setter ramp, spiffs) | They appear as lines once approved, wherever they were approved (the regional manager hub stays for managers). Unapproved bonuses wait. They **no longer block** the week. Paying the week marks them paid, so there is no second "paid" flag. |
| **Draws** (if used, D8) | A fixed weekly draw is a + line. Each later commission line is followed by an automatic "draw recovery" − line until the balance is zero. The balance is always visible. Recommendation: start with **no draws**. |
| **OPP (Steve and Andrew)** | Every funded job adds OPP lines for the two owners at the rate in D3, outside the 18% sales pool. It's shown on the owners' statements like any other line, unless D3 says OPP stays out of payroll entirely. |
| **Mistake found after approval** | "Add fix" on the line creates an adjustment in next week's run with a reason. For urgent cases, approve an off-cycle run the same way. |
| **Rep disputes a line** | It lands in "Needs you". The admin answers or adds a fix. The rep sees the status. Suggested target: answered within 1 business day, fix paid on the next check. |
| **Same job approved twice** (today's $18.9k bug) | Impossible. The database refuses a second commission line for the same job, person and role. |

---

## 4. What to delete, and the minimal data changes

### Delete (screens, routes, code)
| Delete | Replaced by |
|---|---|
| `app/admin/payroll/page.tsx` date-range export and its engine in `app/api/admin/payroll/export/route.ts` | CSV download of the week's lines on the Pay Run screen |
| `app/admin/payroll/weekly/page.tsx`, `app/api/admin/payroll/weekly/worksheet/route.ts`, `lib/weekly-payroll/eligibility.ts` | The *Coming* reasons, which come from the one `derivePayrollEligibility` |
| `app/admin/payroll/periods/page.tsx` (create form, label, typed cutoff) | Weeks generated automatically from `lib/weekly-payroll/cutoff.ts` |
| `app/admin/payroll/[periodId]/hours/page.tsx` | Hours column on the Pay Run screen (keep `PayrollPeriodHoursEditor` logic) |
| `app/admin/payroll/statements/page.tsx` (two dropdowns), per-rep email button | People list on the Pay Run screen, plus auto-send on approve |
| `reopen` and `cancel`-on-locked/paid in `app/api/admin/payroll/periods/[periodId]/route.ts` | Adjustment lines |
| Lock-blocks-on-pending-bonus check (`periods/[periodId]/route.ts:155-168`) | Pending bonuses roll forward |
| Separate bonus-line "paid" status update (`bonus-lines/[id]/status` paid transition) | Approve marks the bonus paid |
| `app/api/commissions/weekly/route.ts` (reads the empty legacy `commissions` table), the `lib/ai/chat-aggregates.ts:168` reader | The My Pay endpoint (same draft function) |
| Phantom statement fields `ntpCommission`, `holdStatus` and their unused columns' readers | Nothing (columns stay in the DB, unread) |
| Ops "Ready for payroll" button (`JobPayrollSentBanner`, `payroll_sent_at` writes), **or** make it the gate (D9) | One signal |
| `app/commissions/estimator` (545 lines), if usage confirms it's unused | The *Coming* list |
| `app/admin/incentives` redirect stub | Nothing |

What stays: `/admin/comp-plans` (rates), the job page's per-job override card (splits), `/admin/sisu/bonus-approval` (for regional managers only), and `/commissions/statement/[periodId]` (it becomes the shared line view).
Net result: about 9 payroll pages become 2 (Pay Run, My Pay), and 4 pay engines become 1.

### Data changes (additive and nullable only)
1. **Before anything else:** reconcile and void the duplicate payout lines from 2026-08-20 with Andrew. The unique index below **cannot be created until those duplicates are resolved**.
2. `payroll_payout_lines` gains:
   - `line_kind text null`, where null means commission (existing rows). Other values: `hourly | bonus | opp | adjustment | chargeback | draw | draw_recovery`.
   - `reason text null`, `adjusts_line_id uuid null` (references `payroll_payout_lines`), `created_by uuid null`.
   - Partial **unique index** on `(job_id, user_id, participant_role)` where `line_kind is null`, i.e. one commission per job, person and role, ever. Periods that are voided or cancelled need their lines voided first, or add `voided_at timestamptz null` and exclude voided rows from the index.
   - Relax `job_id` and `payroll_job_snapshot_id` to nullable, because a draw or manual adjustment has no job. Dropping a NOT NULL constraint is backward-compatible.
3. **New table `payroll_adjustments`.** It holds pending ± items not yet in a paid week: chargeback drafts from cancels, re-splits, top-ups, draws and fixes. Columns: `id, org_id, user_id, job_id null, amount numeric (signed), kind, reason, status (pending|approved|applied|void), source_line_id null, applied_period_id null, created_by, approved_by, created_at`. On approve, each pending row becomes a payout line. This **supersedes** `payroll_chargebacks` and `payroll_chargeback_applications`, which have 0 rows and no writer. Stop reading them now and drop them later after confirming 0 rows.
4. **New table `payroll_disputes`.** Columns: `id, org_id, user_id, payout_line_id null, job_id null, message, status (open|answered|fixed|rejected), reply, adjustment_id null, resolved_by, resolved_at, created_at`.
5. `payroll_periods` gains `approved_by uuid null` and `approved_total numeric null`. The status `locked` is reused and **labelled "Approved"** in the UI. `lock_at` becomes unread.
6. OPP, if kept in the CRM: `orgs.payroll_opp_rate numeric null` plus `orgs.payroll_opp_user_ids uuid[] null`. Alternatively, give Steve and Andrew a comp plan with an "every funded job" role. Either way it sits outside the 18% pool.
7. Draws, only if D8 = yes: `user_comp_plans.weekly_draw_amount numeric null` (or the equivalent field on the comp plan version).
8. `payroll_rep_hours`, `payroll_bonus_lines`, `deal_commission_roles` and `job_payroll_state`: no change.
9. Code-only (no schema): wrap materialization in a per-period advisory lock, and set status before writing (audit P1 fix).

---

## 5. Decisions the owner must make

| # | Decision | Recommendation |
|---|---|---|
| **D1** | **Commission base.** The owner says "full sale amount". The code pays on pre-tax subtotal **minus dealer fee**, and 14 jobs were paid on an estimated fallback (audit P10). Which is right? Do change orders count? | Pick one in writing. If "full sale amount", the cost gate and `deductible_costs_total` can be deleted entirely. |
| **D2** | Pay cadence and day: weekly, cutoff Wed 11:59 PM ET, payday which day? | Weekly, cutoff Wed, paid Fri. Match it to the processor's deadline. |
| **D3** | **OPP.** Is it 9% each to Steve and Andrew, or 9% total (4.5% each)? CLAUDE.md says the stack totals 27%, which implies 9% total. Should OPP run through payroll at all? As LLC members they may need to be paid as guaranteed payments or distributions rather than wages. | Ask the CPA first. Show it on owner statements either way, so it isn't paid by hand. |
| **D4** | Keep "costs approved" as a condition for paying? It matters only if costs reduce the base (D1). | Drop the gate if D1 = sale amount. |
| **D5** | Partial or closed-with-balance jobs: pay on the full sale or on what was collected? | Pay on collected when closed with a balance. Pay the full amount otherwise. |
| **D6** | **Chargeback policy.** Which events trigger it (cancel, refund, a customer who never pays after N days)? Recover 100%? Is there a time limit after install? What is the cap per check (for example 50%)? | Cancel or refund only. 100%. Capped at 50% of a check. Written into the rep agreement. |
| **D7** | **Rep leaves.** Do earned-but-unfunded jobs still pay out? Does a negative balance get deducted from final pay (needs a prior signed NC authorization), written off, or billed? | Pay what becomes payable, under NC 95-25.7 unless a written forfeiture policy was given. Get deduction authorizations signed at onboarding. Confirm with an employment attorney. |
| **D8** | Draws for new closers or setters: yes or no? Recoverable or not? | No draws to start. If yes, use small and recoverable draws, with the balance shown on the phone. |
| **D9** | Ops "Ready for payroll" button: delete it, or make it the gate? | Delete it. Eligibility is computed. |
| **D10** | Which payroll processor actually pays people today (Gusto, QuickBooks, ADP, or by hand)? Are reps W-2 or 1099? | This decides the export format and whether minimum-wage and deduction rules apply. |
| **D11** | Should approval require a second person (for example Nathan approves, Andrew confirms the bank side)? | One approver, plus a weekly email of the total to the other owners. |
| **D12** | Who reconciles the $18.9k potential double-pay from 2026-08-20 before the new guard ships? | Andrew, before any build work starts. |

---

## Sources
- Capterra, QuotaPath reviews: https://www.capterra.com/p/203718/QuotaPath/reviews/ (mostly 2022 [old], some 2023–25)
- Capterra, CaptivateIQ reviews: https://capterra.com/p/182174/CaptivateIQ/reviews/ (Oct 2024 – Dec 2025)
- Software Advice, Xactly Incent reviews: https://www.softwareadvice.com/hr/xactly-incent-profile/reviews (2018–2025; most [old])
- TrustRadius, Xactly review: https://trustradius.com/reviews/xactly-incent-2023-12-07-13-59-45 (Dec 2023 [old])
- G2, Salesforce Spiff reviews p.3: https://g2.com/products/salesforce-spiff/reviews?page=3 (Sep 2026; most marked incentivized)
- Salesforce Trailhead, Spiff commission page: https://trailhead.salesforce.com/es/content/learn/modules/statements-for-salesforce-spiff-admins/learn-about-the-commission-page
- G2, Everstage vs Performio: https://www.g2.com/compare/everstage-vs-performio (tag counts, page updated Aug 2026)
- Capterra, Performio reviews: https://www.capterra.com/p/171921/Performio/reviews (2018–2022 [old])
- Capterra, Gusto reviews p.10: https://www.capterra.com/p/131882/Gusto/reviews/?page=10 (Dec 2024 – Mar 2026)
- Gusto help, off-cycle payrolls: https://support.gusto.com/article/999908231000000/Off-cycle-payrolls
- Capterra, QuickBooks Payroll reviews p.2: https://capterra.com/p/174981/QuickBooks/reviews/?page=2 (2025–26)
- Capterra, RUN by ADP reviews p.3: https://www.capterra.com/p/185859/RUN/reviews/?page=3 (Dec 2025 – Aug 2026)
- Capterra, Paychex Flex reviews: https://www.capterra.com/p/119841/Paychex-Flex/reviews (Oct 2025 – Aug 2026)
- Capterra, JobNimbus reviews p.3: https://capterra.com/p/126797/JobNimbus/reviews/?page=3 (2018–2022 [old]; no commission complaints)
- AccuLynx, managing roofing commissions: https://acculynx.com/using-acculynx-to-manage-your-commissions-structure/ (Jan 2024, updated Apr 2026)
- ServiceTitan help, job splits and spiffs: https://help.servicetitan.com/roofing/docs/enter-technician-commission-job-splits-and-spiffs-for-a-job-or-project (Sep 2026)
- ServiceTitan help, Performance Pay: https://help.servicetitan.com/v1/docs/performance-pay-overview (updated Oct 2026)
- Contractors Cloud, roofing commission models: https://contractorscloud.com/blog/roofing-sales-commissions-models-examples-payouts-and-how-to-automate-them (Sep 2025)
- ContractorPlus, roofing closer commissions: https://contractorplus.app/blog/how-roofing-sales-commissions-keep-closers-loyal (Aug 2026)
- JLC, "Where's My Money?": https://www.jlconline.com/remodeling/wheres-my-money_o/ (May 2007 [old])
- Salesforce, Trends in Sales Compensation report: https://www.salesforce.com/en-us/wp-content/uploads/sites/4/documents/Sales/Salesforce-Trends-in-Sales-Compensation-Report.pdf (2026; survey Aug–Sep 2025)
- CaptivateIQ, reps don't trust their numbers: https://www.captivateiq.com/multiplier/stories/dear-calcy-our-reps-dont-trust-their-commission-numbers (Apr 2026; vendor)
- CaptivateIQ, clawback best practices: https://www.captivateiq.com/blog/navigating-clawbacks-best-practices (May 2025; vendor)
- Sales Cookie, anatomy of commission disputes: https://blog.salescookie.com/2026/05/15/sales-commission-disputes-anatomy-cut-in-half/ (May 2026; vendor; most figures unsourced)
- Everstage, commission clawback: https://www.everstage.com/sales-commission/sales-commission-clawback (updated Jul 2026; vendor)
- Forma.ai, recoverable and non-recoverable draws: https://www.forma.ai/resources/article/recoverable-and-non-recoverable-draws (2021 [old]; vendor)
- Parker Poe, NC deduction authorization: https://www.parkerpoe.com/news/2019/04/reminder-nc-requires-authorization-for-amount-deducted-from (Apr 2019 [old])
- NC General Statute 95-25.7, final pay: https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_95/GS_95-25.7.html (current)

Not legal or tax advice. D3, D7 and D10 should go to the CPA or an employment attorney.
