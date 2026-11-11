# Move from Jobber

Settings → **Move from Jobber** (`/admin/import/jobber`, owners only). Three steps on one screen:
**1 Add files → 2 Check → 3 Bring it over**, then **Contracts & files** and **Undo this import**.
Code: `lib/jobber-import/*` (pure: `columns.ts`, `values.ts`, `schedule.ts`, `plan.ts`, `files-match.ts`; server: `db.ts`),
routes `app/api/admin/import/jobber/**`, screen `components/jobber-import/MoveFromJobber.tsx`.
Migration `supabase/migrations/202611120040_jobber_import.sql` (NOT applied; DB test `supabase/tests/run-jobber-import.sh`).

## What the owner downloads from Jobber

| Export | Where in Jobber | Notes |
|---|---|---|
| Clients & properties | Clients → More Actions → Export Clients → CSV | Emailed. Over ~1,500 clients come as **several files** — add them all ([Export client information](https://help.getjobber.com/en/articles/export-client-information/)). One row per client **property**; `J-ID` = `<client id>_<property id>`. Includes tags, property addresses, contact info and custom fields. |
| Recurring jobs | Insights → Reports → Recurring jobs → Export to CSV → all columns | Columns ([Recurring jobs report](https://help.getjobber.com/es/articles/recurring-jobs-report/)): Job #, Job title, Client name/email/phone, service + billing address, Billing type, Automatic invoicing, Visits assigned to, Line items, Total ($), Completed visits, Number of invoices, Schedule start/end date, custom fields. **No frequency column.** |
| Visits | Insights → Reports → Visits → Export to CSV | Job #, Date, Visit title, client, service address, Visit completed, Assigned to, Line items, One-off job ($), Visit based ($), Job type ([Visits report](https://help.getjobber.com/en/articles/visits-report/)). Used to work out how often a recurring job runs. |
| Invoices | Insights → Reports → Invoices → Export to CSV | Invoice #, Client name/email, addresses, Subject, Created/Issued/Due date, Marked paid date, Job #s, Status, Line items "(qty, $total)", Total ($), Tip ($), Balance ($), Tax (%), Deposit ($), Discount ($), Tax amount ($) ([Invoices report](https://help.getjobber.com/en/articles/invoices-report/)). |
| Quotes | Insights → Reports → Quotes → Export to CSV | Quote #, client, service address, Salesperson, Title, Status, Line items, Subtotal/Total/Discount, deposits, Job #s, Drafted/Sent/Approved/Converted/Archived date ([Quotes report](https://help.getjobber.com/es/articles/quotes-report/)). |
| One-off jobs | Insights → Reports → One-off jobs → Export to CSV | Created date, Client name, Title, Schedule start date, Closed date, Job #, Total revenue ($), Line items, Invoice #s, Quote # … ([One-off jobs report](https://help.getjobber.com/es/articles/one-off-jobs-report/)). |
| Products & services | Settings (gear) → Products & Services → Export to CSV | Name, Description, Unit Price, Taxable, Category, Active (+ Unit cost, Bookable, Duration mins … on some plans) ([Products & services import/export](https://help.getjobber.com/hc/en-us/articles/115009735848)). |

Exact **client-export** header names (`J-ID`, `Display Name`, `Main Phone #s`, `E-mails`, `Billing Street 1`,
`Service Zip code`, `Text Message Enabled Phone #`, custom fields as `CFS[Label]` / `CFT[Label]`, dates as the account
prints them — a real US export read `18/03/2025`) come from a real export quoted in an open-source importer
(`Brendan-S20/pal-primer`, tests/jobber-import.test.ts) and match Jobber's own import template
([Import clients](https://help.getjobber.com/es/articles/import-clients/)). Report header names are Jobber's documented
column names; the exact CSV header text was **not verified against a real report export** — matching is tolerant
(case/spacing/`#`/`($)` ignored, several spellings per field) and every header we don't know is listed on the mapping
screen with a choice, never dropped silently.

## Payments — verified: none come over

Jobber's Invoices report has **no payments column** — only Balance ($) and Marked paid date
([Invoices report](https://help.getjobber.com/en/articles/invoices-report/)). A separate Transaction list report exists
(Insights → Financial reports → Transaction list, successful payments only, "Receive Excel copy"; columns not documented —
[Invoice and payment reports](https://help.getjobber.com/es/articles/invoice-and-payment-reports/)). We do **not** read it:
it can't be tied to invoices reliably and we never make up payments. Invoices come in with Jobber's **status and balance**;
what was already paid is `job_invoices.paid_outside_cents` (total − balance), written on the invoice's internal note, and
counted by every balance reader (`invoicePaidCents` in lib/invoice-lines.ts, `record_customer_invoice_payment`, the void
guard). Cards on file do not transfer either (customers re-enter them with Stripe, Phase 3).

## Files (contracts, photos) — one client at a time

Jobber has no bulk file export: open the client → **Files and media** tab → Select All → download; "you can't select or
download files across multiple clients in a single action" ([Files and media library](https://help.getjobber.com/es/articles/files-and-media-library/)).
Name each file `Client Name - Contract.pdf` and drop them all on **Contracts & files**: `matchFileNames` matches each name to
a customer (exact name, "Smith, Jane" ↔ "Jane Smith", or close — marked **Check**); the owner confirms per file, then the
normal customer-document upload (`lib/customer-document-upload.ts`) files them on the customer (category guessed from the
name: contract / invoice / warranty / permit / insurance / document). They are recorded on the import so Undo removes them
(soft delete). **Later:** a browser-assisted helper that walks Jobber's client pages and downloads each client's files may be
added; not built.

## What each export becomes

| Jobber | Here | Rules |
|---|---|---|
| Client (all rows with the same J-ID client part) | `customers` (+ `import_source='jobber'`, `import_source_id` = Jobber client id) | Name = Display Name / company / first+last; first valid email and phone; billing address → `address_text`. Matched to an existing customer by THE identity rule (`matchExistingCustomer` = `findExistingCustomer`: email, phone, exact name+address) → **linked**: only blank details filled. |
| Each service address row | `properties` (`source 'import'`, id = full J-ID) | Same-address rule is SQL `property_address_key` (asked for the whole list at once, `property_address_keys`). A client with no service address gets one from the billing address. |
| `CFx[Label]` columns, Tags, Lead source, extra phones/emails, Archived, unknown columns, "Keep as a note" | Custom fields (text) on the customer / property | Matched to your fields by name; new ones made via `saveDefinitionChange`; values checked by `cleanFieldValue`; ≤ 50 per record type. |
| Recurring job | `service_plans`, **paused, no resume date ("needs review")**, or **ended** if it ended in Jobber | Schedule: from the Visits report (gaps per month → seasons, usual weekday), else words in the title ("bi-weekly"), else weekly all year — each says so. Price = sum of the job's per-visit line items; fixed-price jobs get no price. Tax off. Trade = the service type picked on Check. No visits are made until someone taps Resume. |
| Invoice | `job_invoices` without a job (kind `service`), Jobber's number (`J-<n>` if yours already has it), Jobber's status/totals/tax snapshot, `paid_outside_cents` | Bad debt → void ("Bad debt in Jobber"). Lines = Jobber's "(qty, $total)" items + one line for discount / tip / rounding so they add up; unreadable line items → one line. |
| Product / service | `pricebook_items` (add-on, unit each, category = Jobber category) | Same name already in your price book → yours kept. |
| Quote, one-off job | Kept on the import as **history**: Customer page → "From Jobber" (open quotes marked) | No deal, job or proposal is made (roofing-shaped objects; Tesla step 1). |
| Client in a report but not in the clients file | A customer made from the report row (listed) | |

## Re-running, resuming, undo

- **Idempotent:** every row keeps Jobber's id (`import_source_id`, unique per company). A second import plans **update**
  for rows a previous import made — and updates only if the row still holds exactly what that import wrote (nobody changed
  it here); otherwise it is kept and listed. A linked customer of yours keeps its own details on re-runs.
- **Batches:** `import_run_claim` hands out ≤ 40 items in dependency order (fields → price book → customers → properties →
  plans → invoices → history), `SKIP LOCKED`, a stuck item is reclaimed after 10 minutes. The screen loops; closing the tab
  and coming back continues ("Continue"). Two tabs can't write the same item.
- **Undo this import** (newest import only): newest kind first; a row the import made is removed only if every value it wrote
  is still there AND no other row points at it (any foreign key, read from the catalog); a row it filled in is put back only
  if unchanged. Everything else is kept and listed ("Changed here since the import", "Used by something added since").
- One open import per company (draft / importing / undoing).

## Review fixes (2026-11-12)
- A re-run that changes nothing records no target for its items, so undoing the second import never deletes the first
  import's rows (test: import → re-run → undo second → first intact, `lib/__tests__/jobber-import-db.test.ts`).
- An invoice renamed `J-<n>` keeps that number on every re-run (found by Jobber id; the number is never written back).
- Recurring jobs, quotes, one-off jobs and invoices are kept once across overlapping exports (listed); a client split
  across Jobber's ~1,500-row files is one customer; a J-ID with no property part (`12_`) gets numbered properties.
- Files are decoded as UTF-8, or Windows-1252 when Excel re-saved them; Excel damage (`8.50555E+09` phones — dropped —
  and ZIPs that lost a leading zero) is listed on Check.
- Check runs one file per request (date evidence, then each file read and stored, then the plan) with "N of M" progress.
- Customer documents: only PDF, photos (JPG/PNG/GIF/WebP/HEIC), Word and CSV are accepted (server + picker); downloads are
  signed links with `Content-Disposition: attachment`.
- Signed out → 401, not an owner → 403; every action is in the cross-company break-in suite.

## Not built / open

- The Jobber history card is on the customer page without deals (`/c/[customerId]`), not yet on the deal Overview.
- Visits history (past visit rows) is used only to infer schedules; past visits are not created as work orders.
- Fixed-price / monthly recurring jobs need their price and billing set by hand (listed on "Plans to check").
- Report header spellings are from Jobber's docs, not a real report export — first real Precision export: check the mapping
  screen and add any new spelling to `JOBBER_FIELDS` (lib/jobber-import/columns.ts).
- Running it for a client "on their behalf": log in as an owner of that company (owners only by design).
