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
2. **Contracts / PDFs / customer copy onto OrgBrand**, with golden-text diff tests per document
   (byte-identical for ARX). Legal text for company #2 is their own template, not string
   interpolation into ARX's contract. Adds `legalName`; phones follow `contactPhone` (rep, else company).
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
9. **Idempotent seed-new-company script**: org row, settings.brand, roles, defaults; safe to re-run.

## Open after slice 1
- `getCrmEmailFrom` (From header) is unchanged and still hardcoded; per-org From needs the org passed
  through every mail sender.
- PDF engine wordmark fallback "ARX" and guide copy ("ARX included") in `lib/inspection-report/pdf.ts`.
- `lib/company-address.ts` callers (invoice, certificate, payroll PDF) not yet on `brand.address`.
- A new org with no `settings.brand` shows ARX's defaults. Slice 9 must seed `settings.brand`.
