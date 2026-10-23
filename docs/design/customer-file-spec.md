# Customer File: Spec and Recommendation

Prepared 2026-10-21 for ARX internal CRM (`/home/claude/natehall22/arx-internal-crm`).
Inputs: `audit-ux.md`, `research-complaints.md`, code reading, read-only aggregate SQL on Supabase `anzqkklwcgaoeunzpqjh` (counts only, no personal data), and about 20 web searches and fetches.
Nothing in the code or the database was changed.

Legend: **[V]** verified in code or DB. **[I]** inferred. **[W]** from the web (linked).

---

## 1. Recommendation

Build **one Customer File page, but not one record and not one long page.** Keep the data normalized, as it is today: customer, then property, then deal (opportunity → project → production job → work orders). The page is a view over that data. It has a compact sticky header, a deal switcher, **five fixed tabs** (Overview, Sales, Job, Money, Files) and **one shared notes timeline** in a right rail (desktop) or its own tab (mobile).

Each role **lands on its own default tab**:
- ops opens straight into the Job tab for the active deal, with no sales history in view;
- closers open the Sales tab;
- inside sales open the Sales tab with the follow-up panel;
- the owner opens Overview.

Every note has an **audience**: Sales, Team, Production or Crew. The audience is enforced in one server function and in RLS, not only in the UI, and each role gets a sensible default.

**Crews never log in.** They keep the existing per-trade token link, which shows only Crew notes, shared files and photo upload. Pricing never appears there.

Ship it behind a flag. Re-use the existing cards. Keep every old URL as a redirect into the right tab. Add an outbound webhook and a versioned read API, so the CRM never turns into a closed box the way Podio does.

**Answers to the owner's five concerns:**

| Concern | Answer |
|---|---|
| (a) Bad for ops? | No, as long as ops lands on a job-only tab scoped to one deal. That tab also replaces the second job page (`/projects/[id]`), so ops gains. |
| (b) Forever scroll | Tabs are lazy routes. The timeline is paginated, collapsed and filtered. Each tab has a hard budget for above-the-fold content (§5). |
| (c) Podio | Podio's problem is a generic item engine with API rate limits and integrations that need glue code. We keep real tables and add webhooks and an API (§3.6). |
| (d) Setters → crews | Only ops and the owner can write **Crew** notes. Setters cannot see or write Production or Crew notes (§4). |
| (e) Shared timeline | Yes. One timeline per customer, filterable to "this deal" and by audience or type, with pinned alerts on top. |

---

## 2. What users hate about record pages (ranked)

Ranked by how often the theme appears across products and sources, and by how much it matters to ARX. Quotes are under 15 words, at most one per source, and dated.

1. **The timeline becomes a haystack: too long, too noisy, can't find anything.**
   - HubSpot's own team said that on busy contacts the timeline was "nearly impossible to find the thing you're actually looking for" (Oct 2017). Their fix was filter tabs by type. [HubSpot release](https://community.hubspot.com/t5/Releases-and-Updates/Three-More-updates-for-a-Cleaner-Timeline/ba-p/418312)
   - Users asked to jump to the oldest entry because they "scroll through heaps of emails and activities" (Dec 2019). HubSpot marked it *Not Currently Planned* in Nov 2020. [HubSpot idea](https://community.hubspot.com/t5/HubSpot-Ideas/Reverse-timeline-Skip-to-bottom/m-p/308155)
   - Users asked for saved timeline filter views (Oct 2021). New users got overwhelmed by workflow noise. A beta only arrived in Dec 2025. [HubSpot idea](https://community.hubspot.com/t/saved-timeline-filtered-view/46046)
   - Users asked for search inside the activity timeline (Aug 2020). [HubSpot community](https://community.hubspot.com/t5/CRM/Search-activity-tabs/td-p/361900)
   - **ARX today [V]:** 2,149 of 4,133 activities are canvasser call logs and 1,775 are status changes. Only about 200 are human notes. Without collapsing, the system rows would bury the notes.

2. **The page gets slow as records grow, because everything loads at once.**
   - Leap's top con in 2026 is slow loads and slowdowns as records grow (see `research-complaints.md` #2). [Capterra](https://www.capterra.com/p/162690/Leap/reviews/)
   - Salesforce Ben's guidance is to split the page into tabs: "only the default tab loads initially." It also suggests at most 3 related lists per tab (Jan 2025). [Salesforce Ben](https://www.salesforceben.com/slow-salesforce-page-loading-speed-here-are-12-tips-to-speed-up-your-org/)
   - **ARX today [V]:** `JobDetailClient.tsx` hides mobile tabs with `hidden lg:block`. Every section still mounts and fetches on every load.

3. **The wrong people see the wrong things, and permissions are too coarse.**
   - A Jobber ambassador wanted technicians to text customers without seeing pricing. The texting permission was tied to the financials permission. Hiding financials broke the reports (about 1 year ago, roughly 2025). [Jobber community](https://community.getjobber.com/discussions/team-management/how-to-disconnect-financials-from-texting/4452)
   - A Podio reviewer wants roles at both the app level and the field level (Aug 2025). [Capterra Podio](https://www.capterra.com/p/128631/Podio/reviews/)
   - The opposite failure also happens. ServiceTitan techs couldn't see a customer's history "without having to book a job" (Sep 2022, older than 2 years). [ServiceTitan community](https://community.servicetitan.com/t5/Mobile/Technician-permissions/m-p/17518)
   - **Lesson:** hide by audience, not by stripping access to the whole record.

4. **Customer, property and job are split badly: either nothing rolls up or everything does.**
   - In JobNimbus, a Job's photos don't show on the Contact unless *Include Related* is on. That same toggle then pulls other records' items into the feed, enough that a help article explains it. [JobNimbus nav](https://support.jobnimbus.com/how-do-i-navigate-jobs), [JobNimbus related](https://support.jobnimbus.com/what-am-i-seeing-records-from-another-job-or-contact)
   - A ServiceTitan user's multi-location customer had all jobs in one mixed list, and they wanted them grouped by address (Jul 2022, older than 2 years). [ServiceTitan community](https://community.servicetitan.com/t5/ServiceTitan-Pro-Products/Customer-with-Multiple-locations/m-p/48773)
   - JobNimbus and Housecall Pro reviewers say one customer with many properties is hard to handle (mostly older; see `research-complaints.md` #8).

5. **Integrations need glue, and APIs are throttled (Podio).**
   - Reviewers say Podio isn't natively integrated with its sibling products (Jul 2025). They bridge apps with Zapier (Jan 2026) and find integration setup complex (Nov 2024). [Capterra Podio](https://www.capterra.com/p/128631/Podio/reviews/)
   - Podio's API allows **250 calls/hour** for heavy operations and **1,000/hour** for standard ones, per user per key. Past that it returns HTTP 420. [Podio developers](https://developers.podio.com/index/limits)
   - Podio's own limits page lists 100 fields per app, 250 items per relationship field and 20,000-row Excel import/export. It also says many fields slow an app (undated, ©2026). [Podio limitations](https://www.progress.com/podio/documentation/using-podio/tips-and-tricks/known-limitations)

6. **Too many clicks and too much scrolling to get to the part you need.**
   - AccuLynx users ask for job switching without scrolling (Nov 2025 – Apr 2026; see `research-complaints.md` #4). [Capterra p3](https://www.capterra.com/p/116187/Acculynx/reviews/?page=3)
   - HubSpot users say the narrow property column holds "the most important information for a CRM user." The wide activity feed crowds it out (Jun 2021, last +1 Mar 2024). [HubSpot idea](https://community.hubspot.com/t5/HubSpot-Ideas/Allow-User-to-Expand-Left-Sidebar/idi-p/448565)

**What people praise, and what we should copy:**

- **ServiceTitan pinned notes.**
  - Notes can attach at the job, customer or location level, and you pin the ones "you and others see" first.
  - Techs can add job notes by default. Customer and location notes need permission.
  - [ServiceTitan help](https://help.servicetitan.com/how-to/add-and-create-pinned-notes)
- **ServiceTitan customer vs location.**
  - The customer is who pays. The location is where work happens.
  - A location belongs to one customer, and jobs are booked from the location.
  - [ServiceTitan help](https://help.servicetitan.com/roofing/docs/customer-and-location-records-overview)
- **AccuLynx job communications.**
  - Messages are threaded, with @mentions, admin-defined tags you can filter by, pins, and convert-to-task.
  - Its stated aim is "the right people see the right message at the right time" (Nov 2024, updated Sep 2025).
  - [AccuLynx guide](https://acculynx.com/job-communications-guide)
- **AccuLynx Crew app.**
  - Subs are invited by text. You control what they see and for how long.
  - They get the address, instructions, photos and checklists (2019, updated Nov 2024). The article does not say whether pricing is hidden.
  - [AccuLynx](https://acculynx.com/?p=1136)
- **JobTread audience mentions.**
  - Typing @customers or @vendors brings those people into the thread through their portal. @role mentions notify internal users (May 2022).
  - [JobTread](https://jobtread.com/blog/targeted-messaging-and-file-sharing)

---

## 3. Proposed structure

### 3.1 What ARX's data actually looks like [V, aggregate SQL]

| Fact | Number | Implication |
|---|---|---|
| Leads | 18,328 (18,284 with no `customer_id`) | Most are canvass pins. They must **not** each become a Customer File. |
| Opportunities | 407 (only 44 have a customer). By status: won 44, in progress 137, open 119, lost 107 | `customers` rows are created only at sale today. A pre-sale file has nothing to key on. |
| Customers / projects / production jobs | 49 / 42 / 42 | Today the chain is strictly 1:1:1:1. No opportunity has more than one project, and no project has more than one job. |
| Customers with more than one opportunity, or more than one job | 1 / 0 | Repeat and multi-property customers are rare **today**. Rental pre-marking, landlords and partner referrals will change that. |
| Duplicate addresses | 493 among leads (re-knocks), 8 among opportunities | An address is a real entity. Today it is copied as `address_text` onto 5 tables. |
| Work orders | 15 (3 jobs have more than one). 11 have a `crew_link_token` | Trade-level crew links already exist. |
| Activities | 4,133. Per opportunity: median 6, p90 18, max 21 | The timeline is small today. It needs collapsing more than it needs heavy pagination. |
| Production job notes | 104, all `is_internal`, 0 shared with a sub, written by 2 admin users | Ops notes live in a **separate** table from sales notes. |
| Free-text note columns | `leads.canvass_notes` 7,223, `opportunities.inspection_notes` 158, `.notes` 95, `projects.notes` 42, `.ops_notes` 29, `production_jobs.internal_notes` 31, `leads.notes` 31, `special_instructions` 3 | Notes live in **at least 11 places**: 3 tables plus 8 columns. |
| Who writes notes (activities, type `note`) | admin 179, canvasser 19, setter 2 | Today the owners write almost all notes. Setter and canvasser notes are few, but they are attached to the lead and opportunity that ops later inherits. |
| Users by role | canvasser 11, admin 6, sales_rep 5, setter 2, setter_manager 1. Custom roles: `call_center_rep` 2, `setter_manager` 1 | No `operations`-role user exists today. Ops work is done by admins. Design ops for the near future (a hire), not for today's headcount. |
| RLS on `activities` and `production_job_notes` | SELECT allowed for any user in the org | **Note privacy is UI-only today.** 34 of the 39 files that read `activities` use a service/admin client, which bypasses RLS. |

### 3.2 Hierarchy

```
Customer (who pays / who we talk to)            customers           ← the File is keyed here
 ├─ Contacts (spouse, tenant, PM, realtor)      customer_contacts   (later, optional)
 ├─ Property A (where work happens)             properties  (NEW)
 │   ├─ Deal 1  2026 re-roof                    opportunity → project → production_job → work_orders(trades)
 │   └─ Deal 2  2036 re-roof / gutters          new opportunity on same property
 └─ Property B (landlord's 2nd house)
     └─ Deal 3
Prospect (lead, no opportunity yet)             leads               ← lightweight "Prospect File", same shell, no tabs but Sales
```

How each case is handled:
- **Repeat customer.** This is the same customer and property with a new deal. The deal switcher shows "2026 Roof (Paid) · 2036 Roof (Open)". The timeline defaults to the current deal and has an "All deals" chip.
- **Landlord with 5 houses.**
  - This is one customer with 5 properties. The header shows a property picker only when there is more than one property.
  - Billing and QuickBooks stay on the customer (`qb_customer_id` already lives there).
  - The tenant becomes a contact on the property, so the crew calls the tenant, not the landlord.
- **Re-roof 10 years later, new owner.**
  - The property already exists, so the system links it and shows "Prior work at this address: 2026 re-roof (ARX)" on the new customer's Overview.
  - Notes from the old customer's file stay **private** to that file.
- **When the customer row is created.** Move creation from contract signing to **lead → opportunity conversion** (an inspection is set). That gives about 400 files, not 18,000. Dedupe on the existing `phone_normalized` and `email_lower` columns. Raw canvass leads keep living in the canvass app and open as a slim Prospect File.

### 3.3 Page layout (one shell, five tabs, role-default tab)

**Tabs** are fixed and permission-gated. Each one is a route segment and is lazy-loaded.

| Tab | Contains (re-using existing cards) | Who sees it |
|---|---|---|
| **Overview** | Stage stepper, pinned alerts, next action, deals and properties summary, prior work at the address, referral partner | Everyone with file access |
| **Sales** | Appointments and outcome, inspection and measure (opens the measure tool as an overlay), proposal and contract (opens the builder as an overlay), follow-up and knockback panel | Setter (read-limited), closer, inside sales, managers, owner. Ops gets read-only. |
| **Job** | Job sheet: schedule, trades and crews (`JobTradesCard`), materials, permit, sold scope (`SoldScopeCard`), crew instructions, work orders, completion | Ops, owner, closer (read-only), sales manager (read) |
| **Money** | One ledger: contract amount, change orders, invoices, payments (`JobPaymentsCard`), costs, commissions on this deal | Owner, ops with `jobs:financials:view`, closer sees **own commission line only** |
| **Files** | One gallery from `files`, `documents`, `job_files` and photo tables, filterable by deal and tag, with a "shared with crew" badge | Everyone, scoped by tag. Contracts and pricing PDFs are hidden from setters. |

**Why not tab-per-stage?** That would mean 8 stages (Lead → Inspection → Proposal → Signed → Scheduled → Installed → Paid → Payroll) as 8 tabs. Most of them would be empty most of the time, and ops would have to click through 4 tabs to see one job. Instead the **stepper stays as a progress indicator** in the header, and clicking a step jumps to the tab that owns it.

**Default tab by role** (a remembered last tab per user overrides it):

| Role | Lands on | Timeline default filter |
|---|---|---|
| Setter / canvasser | Overview (only when opened from a notification; normal work stays in canvass) | This deal · Sales + Team · notes and outcomes |
| Closer / sales rep | Sales | This deal · Sales + Team + customer messages |
| Inside sales / call center | Sales → follow-up panel open | This deal · calls, texts and notes |
| Operations | **Job** (active deal, or the one with the nearest install date) | This deal · Production + Crew + Team + status changes. Sales notes are hidden behind a "Sales history" chip. |
| Manager | Sales (sales manager) or Job (production manager) | This deal · all audiences they can see |
| Owner / admin | Overview | All deals · all audiences, with system events collapsed |

### 3.4 Wireframes

**Desktop (≥1024px), ops user on the Job tab:**

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◀ Jobs Board   Hall, J.  ·  123 Main St, Kannapolis ⌖   ☎ Call  ✉ Text   Deal: [2026 Roof ▾]  │ sticky, 1 row
│ ●Lead ─ ●Insp ─ ●Proposal ─ ●Signed ─ ◉Scheduled ─ ○Installed ─ ○Paid ─ ○Payroll   [Schedule ▸]│ sticky stepper + next action
│ ⚠ Dog in back yard · Gate code 4411 · Call tenant, not owner                    (pinned, 3 max)│
├───────────────────────────────────────────────────────────────┬──────────────────────────────┤
│ Overview   Sales   [Job]   Money   Files                      │ TIMELINE           ⌕  ⚙      │
├───────────────────────────────────────────────────────────────┤ [This deal▾] Production·Crew │
│ JOB SHEET                                    Job #1042        │ ·Team ·Status   +Sales hist. │
│ ┌ Schedule ─────────┐ ┌ Crew / trades ────┐ ┌ Materials ────┐ │──────────────────────────────│
│ │ Tue Oct 27, 7am   │ │ Roof: Crew A  ✓   │ │ Ordered 10/20 │ │ ✎ Write a note…              │
│ │ 2 days            │ │ Gutters: Sub B ⏳ │ │ ETA 10/26     │ │  Audience: [Production ▾] @  │
│ └───────────────────┘ └───────────────────┘ └───────────────┘ │──────────────────────────────│
│ ┌ Sold scope (read-only) ─────────────────────────────────┐   │ 📌 HANDOFF (closer, 10/18)   │
│ │ 28 sq OC Duration Onyx · ice&water valleys · 2 pipe     │   │  Promised: haul-off same day │
│ └─────────────────────────────────────────────────────────┘   │ Today                        │
│ ┌ Crew instructions (CREW-VISIBLE) ───────── [Edit] ─────┐   │  Production · Ops, 8:02a     │
│ │ Park on street. Tarp the AC unit. Tenant: call first.  │   │  "Dumpster moved to Wed"     │
│ └─────────────────────────────────────────────────────────┘   │  ⟳ Status → Scheduled        │
│ ┌ Permit ─┐ ┌ Balance due (if allowed) ┐ ┌ Work orders (2) ┐  │ Oct 19                       │
│ │ Issued  │ │ $0 deposit rec'd         │ │ WO-15 Gutters ▸ │  │  Crew · Ops "Tarp AC"  👷    │
│ └─────────┘ └──────────────────────────┘ └─────────────────┘  │ ▸ 14 earlier items (Sep)     │
│                                     ↑ fits 1 laptop screen     │ ▸ Sales history (hidden: 9)  │
└───────────────────────────────────────────────────────────────┴──────────────────────────────┘
```

**Mobile (375px), closer in a driveway on the Sales tab:**

```
┌───────────────────────────────┐
│ ◀  Hall, J.          [⋯]      │  sticky
│ 123 Main St ⌖   ◉ Proposal    │
│ [☎ Call] [✉ Text] [Maps]      │
│ ⚠ Dog in yard · Gate 4411     │  pinned (collapses to 1 line)
├───────────────────────────────┤
│ ‹ Overview [Sales] Job Money ›│  swipeable segmented tabs
├───────────────────────────────┤
│ Appointment  Today 4:00p  ✓   │
│ ┌ Measure ───────────────────┐│
│ │ 28.4 sq · 6/12 · Open  ▸   ││  overlay, returns here
│ └────────────────────────────┘│
│ ┌ Proposal ──────────────────┐│
│ │ Draft · $18,900   Build ▸  ││
│ └────────────────────────────┘│
│ Outcome  [Log outcome ▸]      │
├───────────────────────────────┤
│ [Overview][Sales][Activity 3][+]│  bottom bar; Activity = timeline
└───────────────────────────────┘    [+] opens composer sheet

  Composer bottom sheet (canvass LeadModal pattern):
┌───────────────────────────────┐
│ New note                  ✕   │
│ Audience: (Sales) Team        │  chips; role defaults; Crew chip
│ ┌───────────────────────────┐ │  hidden for sales roles
│ │ Wife wants to see samples │ │
│ └───────────────────────────┘ │
│ @ mention   📎 photo   📌 pin │
│ [ Save ]                      │
└───────────────────────────────┘
```

**Per-role notes on layout:**
- **Setter:**
  - Setters rarely open the File, because the canvass app is their home and stays untouched.
  - When they do, from "your appointment sold", they see the header, stepper, appointment and outcome, plus their own and Team notes.
  - They see no proposal pricing, no Job tab and no Money tab (apply the existing `isBarredFromSalesDocAccess`).
- **Closer:**
  - Sales tab by default. The measure tool and the proposal builder open as full-screen overlays that return to the File, which fixes today's 6–7 jumps.
  - At signing, a **Handoff** form is required. It becomes the pinned Production note: promises, colors, access, pets, HOA and financing quirks.
  - Closers can open the Job tab read-only for their own deals. That closes the gap where closers today cannot open `/customers`.
- **Inside sales:**
  - Sales tab with the follow-up panel on top: next follow-up date, knockback reason, one-tap "Log call" / "Log text" with outcome.
  - Their queue stays a saved view on the list, not on the File.
- **Ops:**
  - The Job tab is the whole morning. Ops starts on the **Jobs Board or Today** list, not on the File.
  - Each row deep-links to `/c/{id}/d/{deal}/job`.
  - No sales history appears unless they tap "Sales history".
- **Owner:**
  - Overview: the stepper, exceptions (stalled, balance due, missing docs), all deals, and the whole timeline with system events collapsed.

### 3.5 Crews and subs

- **No logins for crews.** Keep and extend the existing per-trade token link (`app/crew/[token]`, `lib/crew-link.ts`; 11 of 15 work orders already have tokens). Today it shows the address, job number, trade and photo upload.
- **Add a "Work order" view** to that link with:
  - scope for **their trade only**;
  - schedule;
  - **Crew** notes and the crew-instructions card;
  - files flagged `share_with_sub` (the column already exists on `files`, `job_files` and `production_job_notes`);
  - photo upload and check-in/out.
- **Never on the crew link:** prices, sale amount, other trades' costs, sales notes, the customer's email, the proposal.
- **Links expire** after the work order is completed plus N days (the existing `expired` reason). They are re-sent by SMS from the Job tab.
- The existing RLS policy "Subs can view shared notes" (`get_sub_id_for_user`) shows that a sub-login path existed. Leave it alone. Do not build a sub portal.

### 3.6 Staying easy to integrate (the anti-Podio rules)

1. **Real tables, fixed schema.** No user-defined "apps" or "items". Custom fields stay in the existing `job_fields` / `contact_fields` settings, stored in jsonb on the owning row.
2. **Versioned read API:** `GET /api/v1/files/{customerId}` returns header, deals and properties. `GET /api/v1/files/{customerId}/timeline?deal=&audience=&cursor=` returns the timeline. It uses API keys per integration, and the same audience filter applies (an integration key gets a role).
3. **Outbound webhooks** through a small outbox table: `note.created`, `deal.stage_changed`, `job.scheduled`, `job.completed`, `payment.recorded`. They are signed, retried, and listed in Settings → Integrations. An inbound `app/api/webhooks/leads` already exists, so this mirrors it.
4. **Stable deep links** use IDs in the path and never in query strings (§8).
5. **No throttle we don't control.** It's our Postgres. Rate-limit by key at the edge for abuse only.

---

## 4. Notes and permissions design

### 4.1 Note audiences (keep it to four, plus customer messages)

| Audience | What it's for | Examples | Tone in UI |
|---|---|---|---|
| **Sales** | Selling context that production doesn't need and crews must never see | "Wife wants to think it over", "competitor quoted $16k", "offered $500 off" | gray |
| **Team** | General internal facts useful to anyone in the office | "Prefers text after 5pm", "Realtor is Heather" | default |
| **Production** | How to build the job | Handoff, material changes, permit, scheduling, punch list | blue |
| **Crew** | Instructions that leave the building and appear on the crew link | "Tarp the AC", "Park on street" | amber, with a 👷 "Crew will see this" banner on the composer |
| *Customer message* | Not a note. These are logged SMS and email to or from the homeowner (activity types `text` and `email`) | — | Shown to anyone who can see the deal's Sales or Job tab |

System rows (status changes, canvass call logs, automations) carry **no audience**. They are shown to anyone who can see the deal and **collapsed by default**: "12 door attempts, Jun 3 – Jul 9 ▸".

### 4.2 Role × note type (R = read, W = write, — = hidden)

| Role | Sales | Team | Production | Crew | Pin | Re-classify others' notes |
|---|---|---|---|---|---|---|
| Setter / canvasser | R/W own deals | R/W | — | — | — | — |
| Closer / sales rep | R/W own deals | R/W | R/W own deals (handoff) | R | own notes | — |
| Inside sales / call center | R/W | R/W | — | — | — | — |
| Setter / sales manager | R/W team | R/W | R | R | yes | Sales ↔ Team |
| Operations | R (behind "Sales history" chip) | R/W | R/W | R/W | yes | any → Production/Team; Crew requires ops |
| Owner / admin | R/W | R/W | R/W | R/W | yes | any |
| Crew (token link, no login) | — | — | — | R (own work order) | — | — |
| Integration API key | per assigned role | | | | | |

Defaults in the composer:
- setter → Sales;
- closer → Sales on the Sales tab and Production on the Job tab;
- inside sales → Sales;
- ops → Production;
- owner → follows the current tab (Sales / Production / Team on Overview).

**Crew is never a default.** It must be picked explicitly, shows the amber banner, and is offered only to ops and the owner. Closers and setters cannot write to crews at all. Their Production handoff is read by ops, who then write the crew instructions.

### 4.3 Pinned notes and alerts

- **Customer-level alerts** (max 3) appear in the header on every tab and every deal: dog, gate code, "call tenant", "do not text after 6pm", "litigious". They are pinned from any note, and their audience still applies. A Sales-audience pin never shows to ops.
- **Deal-level pin** (max 1 per audience): the Handoff note is auto-pinned for Production.
- Pins have an optional expiry ("until job complete"), so stale alerts drop off.

### 4.4 @mentions

- Mentions already exist in job notes (`JobDetailClient` @ dropdown, `renderNoteWithMentions`). Move them to the shared composer and store `mentioned_user_ids`.
- The mention dropdown **only lists users who can read the selected audience**. That prevents "@setter" on a Production note.
- A mention creates a notification with a deep link straight to the note (§8). Add role mentions later (@ops, @closer-on-this-deal), in the JobTread style.

### 4.5 Timeline filters

- **Scope:** This deal (default) · All deals · This property.
- **Type chips:** Notes · Calls & texts · Status · Files · Appointments. An "Audience" multi-select shows only the audiences the user can read.
- **Search box:** client-side over loaded items, then server `ilike` past the first page.
- **The remembered filter is per user** (the HubSpot lesson). It is stored on a nullable `users.ui_prefs` jsonb column, not in localStorage, so it follows the user to the phone.

### 4.6 Enforcement (important)

- Today any org user can SELECT every activity and job note (RLS policies are org-scoped only). 34 of the 39 code paths that read `activities` use a service client, so RLS does not apply to them.
- Therefore:
  1. Add **one** server function, `lib/customer-file/timeline.ts → getTimeline(viewer, fileId, filters)`, as the only read path for the File and the v1 API. It applies the audience matrix.
  2. Add RLS on the new `audience` column through a `note_audience_visible(audience)` SQL function, for any browser-client reads.
  3. Add Jest tests per role × audience. Nav/RBAC history (8 permission fixes on 2026-05-19) says this will regress without tests.
- Legacy rows have `audience IS NULL`. Treat them as **Team** (today's behavior) **except** rows on lead/opportunity written by setter/canvasser roles, which become **Sales**. That hides old canvass chatter from ops by default without deleting anything.

---

## 5. How it avoids forever scroll

1. **Tabs are routes** (`/c/[id]/d/[deal]/job`). Only the active tab's queries run. This fixes `hidden lg:block`, which mounts everything today.
2. **Above-the-fold budget:** header + stepper + alerts take at most 3 lines. Each tab shows at most **3 cards across, 2 rows** before any scroll on a 1366×768 laptop. Anything else lives in a collapsed card with a summary line ("Materials: Ordered, ETA 10/26 ▸").
3. **The timeline is a rail, not the page.** It scrolls inside its own panel. The first load is **25 items** with cursor pagination ("▸ 14 earlier items"). Older months are collapsed into month headers.
4. **System noise is collapsed.** Consecutive status changes and canvass call logs become one row. They are about 95% of today's activities.
5. **Default filters by role** mean ops never loads sales history unless asked.
6. **Deal scope by default.** A 10-year customer shows this deal's timeline, not a decade's.
7. **Sticky header and tabs.** You never scroll back up to switch context. A keyboard shortcut (`g j` / `g s`) and Cmd-K search jump between Files.
8. **Overlays for heavy tools.** The measure tool (5,272 lines) and the proposal builder open over the File and close back to it, instead of becoming more page.

---

## 6. Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Big rewrite of 7,113 lines** across the 5 record pages breaks working flows (JobDetailClient alone has 35 commits of churn) | Re-shell, don't rewrite: move existing cards into tabs. Feature flag per role. Ship **ops' Job tab first** (it replaces two pages), then closers, then inside sales. Keep the old pages reachable via `?legacy=1` for 30 days. |
| 2 | **Note leaks.** A Sales note shows on the crew link or to ops through a service-client path | Single `getTimeline` read path, audience RLS, a crew link that queries **only** `audience='crew'` with an explicit allow-list, and per-role tests. The amber composer banner covers human error. |
| 3 | **Misclassified notes** (a closer puts a crew instruction in Sales) | Handoff form at signing. Ops can re-classify, which is logged as a status row. Defaults are by tab. |
| 4 | **Ops overwhelmed by "one page"** | Ops lands on the Job tab scoped to one deal, with sales hidden. The morning starts from the Jobs Board or Today, not the File. |
| 5 | **Creating customers earlier** (at opportunity) makes duplicates | Match on `phone_normalized` / `email_lower` / normalized address before insert. Build a merge tool (an unmet need in `research-complaints.md` #9). Watch QuickBooks sync: only push to QuickBooks at signing, as today. |
| 6 | **Slowness as data grows** (the Leap pattern) | Lazy tabs, a paginated timeline, indexes on `(customer_id, created_at desc)` and `(opportunity_id, created_at desc)`. Budget: Job tab TTFB under 500 ms at p90. Add a `loading.tsx` skeleton per tab. |
| 7 | **Becoming Podio** (over-flexible, closed) | Fixed tabs and schema. API and webhooks from day one. No per-user layout builder beyond default tab and filter. |
| 8 | **RBAC churn** (4 visibility mechanisms today) | Tab gating uses permission names only (`jobs:view`, `jobs:financials:view`, `proposals:view`, `customers:view`). No role-slug checks in the new code. |
| 9 | **The 11 legacy note locations** confuse the timeline | Show the legacy text columns as one collapsed "Notes from the old pages" card per deal (read-only). Stop writing new values to them, then backfill into `activities` later as an optional cleanup. |
| 10 | **iOS app and existing API consumers** (`app/api/mobile`) break | Don't touch the existing API routes. The new `v1` endpoints are additive. |
| 11 | **Multi-property UI clutter** for the 99% single-property case | The property picker only renders when the count is greater than 1, and the deal switcher only when it is greater than 1. |

---

## 7. Minimal data-model changes (all additive and nullable)

```sql
-- 1. Property (address as a real entity)
create table properties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  customer_id uuid null references customers(id),       -- current owner/payer
  address_text text not null,
  address_normalized text null,                          -- lower/trim/abbr for matching
  lat double precision null, lng double precision null,
  is_rental boolean null,                                -- feeds canvass rental pre-marking
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index on properties (org_id, address_normalized);

alter table leads            add column property_id uuid null references properties(id);
alter table opportunities    add column property_id uuid null references properties(id);
alter table projects         add column property_id uuid null references properties(id);
alter table production_jobs  add column property_id uuid null references properties(id);
alter table work_orders      add column property_id uuid null references properties(id);

-- 2. Customer type (landlord / PM / builder)
alter table customers add column customer_type text null;   -- 'homeowner'|'landlord'|'property_manager'|'builder'

-- 3. Notes: extend the existing hub table rather than inventing a new one
alter table activities
  add column audience text null,                 -- 'sales'|'team'|'production'|'crew'; null = legacy rules (§4.6)
  add column production_job_id uuid null references production_jobs(id),
  add column work_order_id uuid null references work_orders(id),
  add column property_id uuid null references properties(id),
  add column pinned_at timestamptz null,
  add column pinned_by uuid null,
  add column pin_scope text null,                -- 'customer'|'deal'
  add column pin_expires_at timestamptz null,
  add column mentioned_user_ids uuid[] null,
  add column edited_at timestamptz null;
alter table production_job_notes add column audience text null;   -- until merged; share_with_sub → 'crew'

create index on activities (customer_id, created_at desc);
create index on activities (opportunity_id, created_at desc);
create index on activities (production_job_id, created_at desc);

-- 4. Read model: one union view (security_invoker) over activities, production_job_notes,
--    work_order_comments, appointments, files/documents (as "file added" rows)
create view customer_file_timeline with (security_invoker = true) as ...;

-- 5. Visibility helper used by RLS and mirrored in lib/customer-file/timeline.ts
create function note_audience_visible(p_audience text) returns boolean ...;

-- 6. Per-user defaults (default tab, timeline filters)
alter table users add column ui_prefs jsonb null;

-- 7. Integrations (phase 3)
create table webhook_subscriptions (id uuid pk, org_id uuid, url text, events text[], secret text, active bool, created_at timestamptz);
create table outbox_events (id bigserial pk, org_id uuid, event text, payload jsonb, created_at timestamptz, delivered_at timestamptz null, attempts int default 0);
```

Behavior changes, not schema changes:
- Create the `customers` row at lead → opportunity conversion.
- Backfill `customer_id` on the 363 opportunities that lack one.
- Backfill `properties` from normalized `address_text`.

These are data writes and should run as a reviewed migration with a dry-run count first.

Not needed now: a `customer_contacts` table (tenant, spouse, PM). Add it when the first landlord account appears.

---

## 8. Migration of old pages (redirects)

URL scheme (IDs in the path; `deal` = opportunity id):

```
/c/[customerId]                         → role-default tab of the most relevant deal
/c/[customerId]/d/[dealId]/[tab]        → overview | sales | job | money | files
/c/[customerId]/d/[dealId]/[tab]/n/[activityId]   → opens tab, scrolls/highlights the note
/c/lead/[leadId]                        → Prospect File (lead with no opportunity yet)
```

| Old route | Redirect to | Resolution |
|---|---|---|
| `/leads/[id]` | `/c/{lead.customer_id}/d/{opp}/sales`, else `/c/lead/{id}` | lead → opportunity by `opportunities.lead_id` (1:1 today) |
| `/opportunities/[id]` | `/c/{customer}/d/{id}/sales` (`/measure`, `/report` sub-routes → Sales tab overlay) | Uses `opportunities.customer_id`. If it is null, use `/c/lead/{lead_id}` until backfill. |
| `/customers/[id]` | `/c/{id}` | direct |
| `/projects/[id]` (and `/jobs/[id]`, which already redirects here) | `/c/{customer}/d/{project.opportunity_id}/job` | `projects.opportunity_id` is never null [V] |
| `/ops/jobs/[id]` and `/orders`, `/sheets`, `/measure`, `/run-sheet` | `/c/{customer}/d/{opp}/job` (orders and sheets as Job sub-panels; run-sheet stays a print route) | job → project → opportunity |
| `/proposals/[id]` | `/c/{customer}/d/{opp}/sales` with the proposal overlay open | proposal → opportunity |
| `/proposals/builder?opportunity_id=…` | Overlay launched from the Sales tab. Keep the route for deep links. | — |

Rules:
- Implement as **server-component redirects** that look up the IDs. The pattern already exists in `app/jobs/[id]/page.tsx`. `next.config.js` `redirects()` can't do DB lookups.
- Preserve any `#note`/`?tab` intent by mapping it into the path.
- **Login deep links:** `middleware.ts` sets `next` to the **pathname only**, so query strings are dropped at login. That is why tabs and notes go in the path. Verify that `/login` honors `next` for `/c/...`.
- **SMS and email templates** (closer briefing email, notifications, calendar invites with crew links) switch to the new URLs. Old links keep working through the redirects.
- **Log every redirect hit** (route, role). Delete the old page bodies after 30 days of the flag at 100%. Keep the redirect stubs for at least 12 months, because calendar invites and texts live a long time.
- Rollout order:
  1. Job tab for ops/owner, which replaces `/projects/[id]` and `/ops/jobs/[id]`.
  2. Sales tab for closers and inside sales.
  3. Overview, Money and Files.
  4. Prospect File.

---

### Confidence notes
- Counts in §3.1 come from read-only aggregate SQL on 2026-10-21. Role names come from `users.role`. Custom roles may change effective permissions.
- The code was read, not run. No build was done.
- Web sources were fetched 2026-10-21. Dates are those shown on each page. Items older than 2 years are marked in the text where relevant. Reddit was not searched (it was blocked in prior research).
