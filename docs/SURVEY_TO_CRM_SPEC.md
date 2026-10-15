# Survey → CRM build spec (Oct 9, 2026)

Paste this into Claude Code from the repo root. Follow CLAUDE.md: Tesla Algorithm first (delete before you add; reuse existing tables/pages), all schema changes nullable/additive, `requireAuth()`/`requireAuthApi()` only, org scoping on every query, mandatory review before shipping. Ask Nathan before anything that changes what people are paid.

## Context
The Oct 2026 company survey found that spend, overhead, cash, partners, recruiting and ownership obligations live outside the CRM (texts with Becky, Gmail receipts, the "ARX Tracker" Google Sheet, QuickBooks). Goal: the CRM becomes the system of record so the owner email and Goals page answer "are we profitable, what does each channel cost per sale, who owes what, and are we on pace" without a spreadsheet.

Existing pieces to build on (do not duplicate):
- Admin → Settings → Financials: **Budgets** and **Capital** are "coming soon" stubs.
- Admin → Campaigns: has campaigns + lead sources with a *budget* field, not actual spend.
- Admin → Job Profit Tracker (`/admin/job-profit-tracker`): job-level contract, costs, comp, GP, owner draw.
- Admin → Goals & Forecast (`/admin/goals`): monthly scorecard + funnel + by-channel (5 of 6 Sept sales land in "Other" → attribution gap).
- Inside Sales queue, Email Blasts (internal only), Owner Morning Update (5:30am), QuickBooks integration (not connected; pushes CRM → QB only).
- Known Redundancy #11 (job cost computed five ways) — consolidate onto `job_cost_lines` before building P&L on top.

## 0. Hygiene (do first, no schema)
1. Deactivate Evan Waltz (currently Admin, Active) and Roda Temanil; reassign the 9 users whose manager is Evan. Review Admin role for Joey Signa and Levi Hall with Nathan.
2. Update CLAUDE.md "Ownership Team": Evan exited (Pay and Exit Agreement signed Sep 1, 2026, effective Aug 17); owners are Nathan, Steve, Andrew at 33.33%; Cam Hill is earning in (see module 6).
3. Company phone is blank in General Settings (prints on proposals).
4. Delete test/duplicate opportunities ("Test Test", "testing tester", "Grandma", "Fuzz doodle", Evan's own address, duplicate James Palmer / Dora Myers / Steven rows) — confirm list with Nathan first.
5. Fix duplicate "Payment posted" emails (26-0040 notified 6+ times). Close stale payroll periods (W27 still open; nothing after Aug 16).
6. Reset weekly goals to 700 doors / 18 sets / 11 sits / 2–3 sales.

## 1. Spend & overhead ledger (fill the Budgets stub)
Table `org_expenses` (nullable/additive): id, org_id, vendor, category enum (lead_gen, recruiting, software, insurance, dues, payroll_non_comm, office, other), campaign_id (nullable FK), amount, incurred_on, recurrence (none|monthly|annual), notes, receipt_url, created_by.
Seed with Nathan's confirmation: Enzo Dialer $235/mo (to stop — call center ended), Yelp Ads $16/day cap $480/mo (from Sep 29), Google Workspace (2 seats; Sep invoice $11.76 — confirm), BBB $524/yr billed ~$43.67/mo, Hearth $2,297/yr (Sep 15), Supabase ~$33.71/mo, Vercel ~$20–43/mo, Cursor $20, OpenAI $20, Claude $20, ROOFPRO $83.33, Indeed (Mar $109.86, May $448.64, Jun $5.81, Jul $188.00 + $505.84, Aug $55.99), Google Ads (May $646.33, Jun $83.98), solar mailer $381.01 (Oct 2), Queensgate/Gaines mailer (amount TBD), call-center rep pay (from payroll hours), GL insurance (IGC — premium TBD).
UI: list + monthly totals by category; "recurring this month" view.

## 2. Campaign ROI (extend Campaigns)
- Add `actual_spend` rollup from `org_expenses.campaign_id` (keep `budget`).
- Make lead source/campaign **required** on opportunity create; backfill where inferable.
- Per campaign: leads → sets → sits → sales → contract → gross profit (from job profit tracker); cost per lead / sit / sale; ROI.
- New campaigns: Yelp Ads, Call Center (Enzo + Roda), Neighbor blitz (one per install), Realtor partners, Insurance agents, Home inspectors, Referral program, Care Club.

## 3. Monthly P&L + cash
Page `/admin/pnl`: by month — signed revenue, collected revenue, job costs (single consolidated source), commissions, overhead (ledger), net. Inputs: cash on hand (manual weekly entry). Receivables: open balances by job (e.g., Cox $40,986 after $4k, Kaestner $15,407). Payables: QXO bill due the 20th = materials for jobs installed in the prior month (compute from install date + material costs; allow manual override with the actual invoice). 13-week cash forecast. Later: QuickBooks pull for overhead.

## 4. Partners
Table `referral_partners`: id, org_id, name, company, type enum (realtor, home_inspector, insurance_agent, property_manager, hoa, trade, past_customer, other), phone, email, last_touch_at, next_touch_at, owner_user_id, notes. Table `partner_touches` (partner_id, kind call|visit|email|gift, at, user_id, note). Leads/opportunities get nullable `referring_partner_id` and `referring_customer_id`.
UI: Partner hour list sorted by next_touch_at; one-tap log; partner leaderboard (referrals, jobs, revenue). Compliance note in UI: no cash referral fees to NC real estate licensees or insurance agents without counsel review.

## 5. Recruiting pipeline + rep ROI
Table `candidates`: id, org_id, name, phone, email, source (indeed, referral, other), role, stage (applied, screened, field_interview, hired, retained_30, left, rejected), stage dates, notes, hired_user_id. Recruiting spend comes from `org_expenses` category recruiting.
Rep ROI report: per user — total pay (commissions + hourly + bonuses from payroll periods; require hours logged for every hourly/base rep) vs gross profit of jobs they set/closed; doors, sets, sits, sales; days active.

## 6. Ownership & obligations
Table `owners` (user/name, percent, effective_from, effective_to). Seed Nathan/Steve/Andrew 33.33% from 2026-08-17; Evan 25% until 2026-08-17.
**Evan buyout tracker:** fixed $6,010.19 + 25% of final net cash on Schaap 26-0038, Mclaughlin 26-0037, Peduto 26-0039, Parker 26-0040 (auto from job profit once each is collected/closed); payable in two equal monthly payments starting the 1st of the month after the written calculation. Plus Evan's 9% commission list: jobs he set on/before Sep 24 that sign by Oct 24 (retail) / Nov 15 (insurance), due only when completed and paid.
**Cam earn-in tracker** (per Cam Hill Ownership Earn-In Agreement, effective Sep 14, 2026): months of active service; Qualifying Revenue = completed-job final contract amounts (incl. approved changes/supplements) for Cam's jobs + jobs sold by approved recruits assigned to him; progress to 18 months AND $2.5M; second stage $3M company-wide trailing-12 after initial vesting; Section 7 sale-credit calculator; quarterly statement PDF (Section 4 requires Nathan to provide it).

## 7. Customer success automation
Customer-facing sequences triggered by job status Complete: day 0 review link (track asked/received), day 1 certificate + warranty, day 30 referral ask, day 60 Care Club offer; storm check-in when the CRM storm layer flags the address. Weekly status text/email to every open insurance customer. Care Club: plan, price, Stripe checkout link, member list.

## 8. Owner scoreboard
Extend Goals + Owner Morning Update with: partner touches, reviews received, candidates in pipeline/hires, cash on hand, bills due in 10 days, Inside Sales overdue count, jobs with materials not ordered >7 days after signing (Mclaughlin and Schaap were 10 weeks).

## Acceptance
Each module: migration (nullable/additive), RLS + org scoping, admin-only where financial (`PAYROLL_ADMIN_ROLES` unchanged), tests for calculators (Evan buyout, Cam progress/Section 7, QXO payable), bug-bot sweep, `/code-review`, `/security-review`.
