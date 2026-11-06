# Multi-company plan (9 slices)

Goal: a second company can run this CRM without code edits. Each slice ships on its own and changes
nothing ARX customers or reps see unless the slice says so. Gate on every slice: `npm run gates`
(hardcode ratchet first; the baseline only goes down).

1. **Brand from the org row — DONE (feat/org-brand-slice1).** `lib/org-brand.ts` is the one reader
   (`getOrgBrand` / pure `resolveOrgBrand`): `orgs.settings.brand.*` → `orgs` column (name, phone,
   email, address) → `DEFAULT_ORG_BRAND` (same file, today's exact strings, counted by the ratchet).
   Blank = missing. Inspection report footer/contact, report email header/footer, `/r/[token]`
   (title, CTA, footer) read it via `lib/inspection-report/brand-copy.ts`. Phone = the rep's
   `users.phone` (report creator; the sender on the email), else `brand.phone` (`contactPhone`).
   Sent reports keep their stored footer. Admin → Settings → General edits short name, website,
   service-area line (merged into `settings.brand`). Settings timezone fallback is `DEFAULT_TIMEZONE`.
2a. **Customer-facing identity onto OrgBrand — DONE (feat/org-brand-slice2a).** Contract / change-order PDF
   letterhead + footers, signing pages, agreement/CO emails (`lib/contracts/customer-emails.ts`), proposal PDF
   fallbacks, completion certificate, invoice address, payroll statement, job packet, crew page + invite + API
   messages, review SMS, website-estimate emails/errors/next step, report PDF wordmark + filename. Letterheads use
   `brandDocument` (legal name, one-line address, dashed phone; ARX's historical spellings kept only while the org
   holds the default value). Phones: company phone where it was already shown (byte-identity beats the rep rule);
   proposals/reports keep the rep phone. Golden tests: `lib/__tests__/org-brand-documents.test.ts` (PDF SHA-256s +
   copy recorded from origin/main 0cdbd142). `lib/company-address.ts` and dead `lib/pdf/InvoicePDF.tsx` deleted.
2b. **Per-company / per-industry contract & document templates** (designed separately). Clause wording that names
   the company inside a sentence (`lib/contracts/generatePdf.ts` terms, contingency + repair clauses, cancellation
   notice text; `CustomerSigningForm.tsx` terms; `ContractModal.tsx` attestation; report seed text in
   `lib/inspection-report/types.ts`; door-drop / appointment-card print kits; employee comp agreements) becomes
   each company's own template — never string interpolation into ARX's contract.
   **PRE-COMPANY-2 BLOCKER:** `DEFAULT_ORG_BRAND` holds ARX's identity, so any fallback on another company's copy
   shows ARX. In 2b: write ARX's brand fields (legalName, shortName, website, serviceArea, and its contract spellings
   via its v1 template) into ARX's org row/template, then make `DEFAULT_ORG_BRAND` neutral and delete the
   `brandDocument()` ARX-spelling special case. Also 2b/2c: the "Charlotte metro" out-of-area text
   (`app/api/public/estimate/preview/route.ts`) and neutral wording for unknown-token signing / crew pages.
3. **Internal UI copy**: "ARX CRM" is the PRODUCT name and stays (Nathan, 2026-11-05, Salesforce-style) — not per-company. Every existing "ARX CRM" literal moves onto ONE product constant (e.g. `PRODUCT_NAME` in one module) and the ratchet baseline shrinks; staff-facing chrome (login, Nav title, staff system emails, page `<title>`) shows it beside the company's own logo/name. Anything else that says "ARX" in staff UI and means the company → the org brand.
4. **Timezone step A — pure aliasing, no behavior change.** `lib/business-timezone.ts`
   `BUSINESS_TIMEZONE`; the 10 existing constants alias it; the 135 safe literal swaps. First run
   jest under `TZ=UTC` and `TZ=America/Los_Angeles`; golden tests (Mar + Nov DST) before touching
   the 4 hand-rolled DST functions (canvass/availability, canvass/team-availability,
   `lib/inspection-local-wall-clock.ts`, `lib/timezone.ts`). Leave the 25 SQL `AT TIME ZONE` alone.
5. **Timezone step B**: env `BUSINESS_TIMEZONE` per deployment (defaults to today's value).
6. **CI workflow**: jest + tsc on every PR.
7. **Rebuildable schema baseline** from a prod schema dump, so a new project can be created from
   the repo.
8. **Per-deployment env checklist**: `docs/new-deployment-env.md`.
   Must include **`DEPLOYMENT_ORG_ID`** = that company's `orgs.id`. Every company copy sets it: `resolveAuth`
   (`lib/auth.ts`) then refuses any signed-in user whose profile is in another org (401 / login redirect).
   Unset = no fence (how ARX prod runs until it is set). Routes still on hand-rolled cookie auth (Known
   Redundancy #3b, 42 files) and other raw `auth.getUser` paths (`appointments/[id]` via `resolveApiRequestAuthUser`, `inspections/status`,
   `inspections/schedule-close`, `whoami`, and browser-client pages that rely on RLS alone) are not fenced until they move onto `requireAuthApi`.
9. **Idempotent seed-new-company script**: org row, settings.brand, roles, defaults; safe to re-run.
10. **Company web address + login**: each company gets its own address (company.<product-domain>) with its logo on
    the login page; iPhone app asks for a company code once and remembers it; shared-database later = email login
    with a company picker only for people in two companies. Product domain TBD (Nathan).

## Open after slice 2a
- `getCrmEmailFrom` (From header "ARX Roofing <info@…>") still hardcoded; per-org From needs the org passed to every sender.
- Static ARX logo files (`public/brand/arx-shield.png`) on the completion certificate, payroll PDF and appointment
  cards, and `arx-report-logo.png` in the report builder — move to the org logo (`orgLogoHref`) with a golden update.
- "ARX CRM" on the customer-facing completion-certificate footer → slice 3 product constant (Nathan to decide wording).
- Hardcoded certificate signer name; public-estimate service-area geofence.
- A new org with no `settings.brand` shows ARX's defaults. Slice 9 must seed `settings.brand`.
