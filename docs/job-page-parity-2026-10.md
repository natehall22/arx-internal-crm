# Job page redesign - parity table

Baseline: today's job page (`/ops/jobs/[id]` = Customer File "Job" tab, `JobView` -> `JobDetailClient`) and today's Projects page
(`/projects/[id]`). Nothing is removed until its new home is live. "Kept" = untouched top section.

## A. Top of the page (KEPT exactly)
| Today | New home |
|---|---|
| Job #, status pill, Unpaid / Partially paid / Paid in full pill, job-type pill | Kept |
| Customer name (h1), address -> Google Maps link | Kept |
| Exterior Measure button | Kept |
| Cancelled banner + "Undo cancellation" | Kept |
| Job progress stepper (vertical on phone, horizontal on desktop) | Kept |
| Workflow buttons: Mark Job Complete, Schedule crew, Start job, Mark collected, Resume | Kept (the "Materials ordered" workflow button is REMOVED: it is replaced by the per-supplier "Send order" / "I sent it myself" on the Materials tab) |
| More actions: Pause job, Cancel job (reason dialog), Delete job | Kept |
| Mobile summary: Crews n/m scheduled, Materials status | Kept - Materials now reads the ONE rollup (below) |
| Settled-externally card, Ready-to-pay banner, Payroll-sent banner | Kept (banners above the tabs) |

## B. Everything below the top
| # | Today (control / field / action) | New home |
|---|---|---|
| 1 | Customer card: name, phone (tap to call, Copy), email (mailto, Copy), "View customer" | **Customer row**: name, Call / Text / Email icon buttons (44px; tap = action, long-press = copy), "View customer" -> Customer File. "No customer linked" + Link customer button stays in the same row |
| 2 | Job documents banner: Crew run sheet - Open / Edit / Email | **Crews tab** (run sheet row) |
| 3 | Job documents banner: Supplier order sheet - View / Download | **Materials tab** (View PDF / Download on each supplier card) |
| 4 | Job documents banner: roof report link | **Files tab** (document row) |
| 5 | Job documents banner: "Materials ordered" / Undo | **Materials tab**: per-supplier "Send order" / "I sent it myself" / "Mark received"; job-level state is derived (rollup). Undo = "Undo" on a supplier card |
| 6 | Job-costs callout ("Job costs live on Materials...") and "+ Job cost" shortcut | **Money tab** "+ Job cost" |
| 7 | Certificate-of-completion callout (phone) + tools in Photos & files | **Crews tab** "Finish up" (certificate PDF / email) |
| 8 | Mobile tab bar Overview / Details / Materials / Financials / Photos & files / Notes | **Sticky tab bar** Crews - Materials - Money - Notes - Files |
| 9 | Overview tab: Schedule & Crews card (one row per trade, date, length, sub, assign, photos, Done) | **Crews tab** (same data, compact rows; the second "Schedule & Crews" block is deleted) |
| 10 | Overview: Final photos card (per-trade 4 photos) | **Crews tab** row: photos x/4 + "Add photos" |
| 11 | Overview: Insurance card | **Money tab** (insurance claim info) |
| 12 | Overview: Permit (applied / approved / not needed) | **Crews tab** (permit row) |
| 13 | Overview: Related - installation/repair agreement PDF, "Sold by", "Sale date" | **Files tab** (agreement row) + summary line in the Customer row |
| 14 | Details: Operations snapshot (scope of work, product, permits, install date, project review, "View project") | **Materials tab** "What was sold" (scope, product); permits -> Crews; install date -> Crews; project review -> Crews "Finish up"; "View project" is removed with Projects (redirect) |
| 15 | Details: Roofing brief (shingle/ridge/flashing detail) | **Materials tab** "What was sold" |
| 16 | Details: Sold scope card + "Job packet" button | **Materials tab** "What was sold" |
| 17 | Materials: Materials order list (editable qty, ops note) | **Materials tab** (Edit on the supplier card) |
| 18 | Materials: Supplier orders card (preview, send, cancel, "I sent it myself") | **Materials tab** cards: Draft / Sent / Received + timestamps, primary "Send order to <supplier>" |
| 19 | Materials: Job materials card (ordered date, ETA, notes, job-cost ledger: Add / Edit job cost, receipts, lender fee) | **Money tab** (cost ledger) + ETA / notes on the Materials tab |
| 20 | Photos & files: workspace card (photo grid, documents, cost attachments, certificate tools, roof report) | **Files tab** (photo grid incl. crew photos; documents as compact rows: icon, name, date, Open, ... menu) |
| 21 | Financials card (contract, comp, costs, profit, margin, Edit source) | **Money tab** (profit / commission only with reports:financials) |
| 22 | Payroll attribution editor | **Money tab** (same gate: billing roles or edit-attribution) |
| 23 | Payments card (record payment, list, edit, remaining) | **Money tab** (money:record) |
| 24 | Invoices card | **Money tab** (money:record) |
| 25 | Work orders card | **Crews tab** (work orders row) |
| 26 | Change orders section | **Money tab** |
| 27 | Internal notes (standalone page) / thread (Customer File) | **Notes tab** = the job thread (audiences, pinned, search, mentions), composer pinned at the bottom |
| 28 | Job source editor (Financials area) | **Money tab** (with Edit source) |
| 29 | Cancel dialog, Complete / Collect modals | Kept |

## C. Project-only actions (Projects UI is removed; nothing lost)
| Projects page action | New home |
|---|---|
| Send to Ops (create the job; sale amount default) - before a job exists | **Customer File Sales tab** (deal with a signed agreement and no job), same roles |
| Request / submit project review (ProjectReviewButton) | **Crews tab "Finish up"** (job exists) / Sales tab (no job) |
| Create Estimate | **Sales tab** |
| Delete project (owners) | **Sales tab** (only when no job exists), owners |
| Link customer | **Customer row** (job) / Sales tab (no job) |
| Edit job-site address (ops, regional manager, owners) | **Crews tab** "Install address" row |
| Upload files to the project | **Files tab** upload |
| Project financial snapshot | **Money tab** |
| Agreement section (view / send / rep-sign links) | **Files tab** agreement row + Sales tab (create/send) |
| Change orders | **Money tab** |
| Estimates list | **Sales tab** |
| What was sold | **Materials tab** |
| Job notes / Activities | **Notes tab** thread |
| Operations snapshot, measurements (squares, vents, windows...) | **Materials tab** "What was sold" |
| Review request card | **Crews tab "Finish up"** |
| /projects list | `/projects` redirects to the Job Board; `/projects/[id]` redirects to the job (Job tab) or the deal (Sales tab) |
| Dashboard "Projects" tile, nav "Projects" | Removed (tile points to the Job Board) |

The `projects` table and its writers stay. "Merge projects into production_jobs" goes on the Known Redundancy list.

## D. As built (differences from the plan above)
- Switch is per person: `users.ui_prefs.jobPageV2`, OFF for everyone. Owners get a "Try the new job page" link at the bottom of the job page; `POST /api/admin/job-page-v2 {userId, enabled}` (owner-only) sets it for one person.
- Crews tab: run-sheet row (Open / Edit / Email to this job's subs only), crews, final photos (offline queue), Finish up (button opens the certificate tools in Files), permit, work orders.
- Materials tab: one status (supplier orders first, stored status as fallback), supplier cards (Draft/Sent/Received, Mark received, I sent it myself), order list edit, then "What was sold" (snapshot, brief, sold scope, job packet).
- Money tab: balance owed + "+ Job cost", payments, invoices, Financials (reports:financials only), payroll attribution, ledger + ETA/notes (JobMaterialsCard), cost attachments, change orders, insurance.
- Files tab: photo grid (offline queue) + documents (compact), "Related" (agreement, sold by, sale date).
- Notes: phone = tab, desktop = permanent side panel (Customer File thread when embedded, job notes otherwise).
- Project-only actions (Send to Ops, estimates, delete project, edit address, review request) are NOT moved yet: /projects stays until item 3, which builds their homes before anything is removed.
- The "Materials ordered" button is gone from the new page only; the old page is unchanged.
