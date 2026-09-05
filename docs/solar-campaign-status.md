# Orphaned-solar campaign — build status

Overnight session 2026-08-27 → 08-28. **Nothing existing in the CRM was modified.**
All new surfaces are additive and behind a flag that is OFF in production.

Strategy page: https://claude.ai/code/artifact/c9130255-3b26-47bd-b358-cabd2aae4aeb

---

## TL;DR for the morning

- **6,643 solar properties** are now in the CRM (`solar_installs`), from Cabarrus,
  Mecklenburg and Rowan bulk county GIS. No records request was needed.
- **4,164-address mail list** is generated and tiered at
  `scripts/solar-permits/data/mail-list.csv`.
- **Canvass overlay is wired** behind `NEXT_PUBLIC_CANVASS_SOLAR`, which is set
  locally only. It is NOT set in Vercel — the layer cannot appear for reps until
  you set it there.
- **100 properties have a confirmed-gone installer**; 68 of those are documented
  well enough to name the company in outbound copy.
- Three things need your call before this goes further — see **Decisions needed**.

---

## What's in the database

| County | Properties | Geocoded | Owner name | Installer known |
|---|---:|---:|---:|---:|
| Mecklenburg | 5,372 | ~98% | ~4,800 | **0** |
| Rowan | 991 | 100% | 283 | ~28% |
| Cabarrus | 280 | 100% | 278 | most |
| **Total** | **6,643** | | | **543** |

`NON_PV` rows (831 — solar-thermal, solar-ready, solar farms) were deliberately
**not** ingested. They match a naive `%SOLAR%` search but are not rooftop arrays.

PV classification carried through from the extract: 3,251 CONFIRMED, 986 LIKELY,
2,406 AMBIGUOUS. **Only CONFIRMED and LIKELY reach the mail list.** AMBIGUOUS is a
research backlog, not a lead list — mailing it would mean telling people they have
solar when the permit only said "Skylight/Solar Panel."

### Installers found gone

| Company | Properties | Status | Confidence |
|---|---:|---|---|
| Power Home Solar / Pink Energy | 48 | Ch. 7, Oct 2022 | HIGH |
| Global Efficient Energy | 23 | FL registration revoked 2020 | MEDIUM |
| Titan Solar Power NC | 22 | Ch. 7, June 2024 | HIGH |
| ADT Solar | 8 | exited residential solar Jan 2024 | HIGH |
| NRG Home Solar | 1 | exited market | HIGH |

**102 properties total.** Note ADT and NRG still exist as companies — they just
stopped servicing. That's why the model has `service_orphaned` rather than only
`defunct`: the question that matters is whether the homeowner can get anyone to
answer, not whether the company is legally alive.

---

## The mail list

`npm run solar-permits:mail-list` → `data/mail-list.csv` (gitignored).

4,164 addresses after suppressing 17 that already exist in `leads`, `customers`,
`opportunities` or `production_jobs`. Suppression matching is deliberately loose —
over-suppressing costs one mailer, under-suppressing means cold-soliciting an
existing customer.

| Tier | Count | Meaning |
|---|---:|---|
| **A** | 48 | Installer confirmed gone **and** system 10+ yrs |
| **B** | 52 | Installer confirmed gone, newer system |
| **C** | 449 | System 10+ yrs, installer active or unknown |
| **D** | 3,615 | Confirmed PV, newer, installer fine |

**`orphan_claim_safe` is the column that matters for copy.** It is TRUE for only
68 rows — those where a specific company's death is documented at HIGH confidence.

- Rows where it's TRUE: you may name the installer and say they're out of business.
- Rows where it's FALSE: generic copy only — *"many solar systems in this area were
  installed by companies that are no longer in business"* — which is provably true
  and names nobody.

Global Efficient Energy's 23 properties are Tier A/B but NOT claim-safe, because
the evidence is a Florida registration revocation and a TV news story, not an NC
filing. NC's UDTPA has a "capacity to deceive" standard with no intent
requirement, so the distinction is worth respecting.

---

## What was built

| Path | What it is |
|---|---|
| `lib/solar-installers.ts` | Installer name normalization + status types |
| `lib/solar-installs.ts` | Dedupe + GeoJSON feature shaping (pure, tested) |
| `app/api/canvass/solar/route.ts` | Viewport GeoJSON endpoint |
| `app/(canvass-app)/canvass/lib/solar-overlay.ts` | Legend, colors, marker sizing |
| `app/(canvass-app)/canvass/lib/useCanvassOverlay.ts` | **Shared overlay hook (new)** |
| `scripts/solar-permits/ingest.ts` | Extract → CRM, idempotent, dry-run default |
| `scripts/solar-permits/geocode.ts` | Coordinates + owner names from county GIS |
| `scripts/solar-permits/mail-list.ts` | Tiered CSV export with suppression |

Tests: 1,177 passing across 119 suites. New: `solar-installers.test.ts` (23),
`solar-overlay-dedupe.test.ts` (17).

### About the shared hook

Weather and roof-age each hand-rolled the same ~190 lines of overlay plumbing
(hydration-safe toggle, viewport dedupe, abort + timeout, stale-response guards,
cleanup). Solar would have been the third copy, so that logic now lives in
`useCanvassOverlay`.

**Roof-age and weather were deliberately NOT migrated onto it.** They're live
field tooling and I wasn't going to refactor them unattended. The hook is a
faithful extraction of the roof-age implementation, so migrating them later is
mechanical. That's a reviewable follow-up, not tech debt I hid.

---

## Decisions needed

**1. Turn the layer on for reps?** `NEXT_PUBLIC_CANVASS_SOLAR=true` is in
`.env.local` only. Setting it in Vercel makes the layer visible to the field. I
did not touch Vercel.

**2. Mecklenburg installer names — 81% of the dataset is blind.** Mecklenburg's
bulk GIS carries owner names but no contractor. I checked their newer Accela layer
too: 73 fields, no contractor. Two ways to fix it:
   - **Shovels.ai** — contractor name confirmed as a field, explicit right to
     reuse and resell API output, $599/mo, 250-record free trial. The trial would
     settle coverage before you spend anything.
   - **A narrow records request** to Mecklenburg for contractor names only. Free,
     slower, and it's county correspondence you wanted to avoid.

   Fixing this is what turns Tier A/B from ~100 properties into a plausible ~500+.

**3. Iredell / Mooresville is the highest-value records request — and we're blind
there.** Re-checked directly (2026-08-28) rather than trusting the earlier audit,
because Rowan's "no bulk source" verdict had turned out to be wrong. Iredell's is
**correct**: their ArcGIS server does expose a `PermittingApp` folder with EnerGov
layers at `maps.iredellcountync.gov/server/rest/services/PermittingApp/`, but the
history layers hold **172 rows total** across all four — a spatial helper, not an
archive. Zero solar. There is no bulk path.

That matters more than it looks. **Power Home Solar / Pink Energy was headquartered
in Mooresville**, and a door-to-door company works its own backyard hardest. The
one county we cannot see is very likely the densest concentration of orphaned Pink
Energy systems in the region. Our 48 Pink Energy properties come from Cabarrus and
Rowan only.

Mooresville also runs its **own** building department (stood up 2023) separate from
the county, so full coverage there is two requests, not one.

**4. Cabarrus 2019–2026 has no bulk layer.** Accela-era permits aren't in GIS. A
draft records request is already written at `data/cabarrus-records-request.md`.

---

## Deliberately not done

- **Owner phone and email were NOT ingested**, though Mecklenburg's Accela layer
  publishes both. Having them in the CRM invites the exact channels that carry
  $500–$1,500-per-contact TCPA exposure. Mail-first is the strategy; the data model
  should make the safe path the easy one. Easy to revisit deliberately.
- **No canvass leads were created** from this data. It's reference data, not pins.
- **Nothing was sent to any county.**
- **AMBIGUOUS_SOLAR rows are ingested but never surfaced** by default.

---

## Corrections to earlier claims in this project

- I said Rowan's "ALL Permits layer" was fabricated. **It's real** — the layer is
  literally named `Rowan County ALL Permits`; my research agent probed the wrong
  map servers. It's now the source for all 991 Rowan properties.
- I said Stanford DeepSolar published 1.47M installs with coordinates. **Wrong** —
  panel-level detections were never publicly released, only census-tract aggregates.
- The worry that Mecklenburg only retains ~6 years online was **wrong**. Their
  bulk layer goes back to **1997**, well past the 15-year target.

---

## Bugs found and fixed overnight

- **PostgREST silently caps `.select()` at 1,000 rows.** The first geocode pass
  reported "100% matched" for Mecklenburg while actually processing 1,000 of
  5,372. Fixed with explicit pagination. Worth remembering — any script reading a
  large table in this codebase has this trap.
- **`isNonInstallerEntity` rejects `P0WER HOME SOLAR`** (digit-substituted typo in
  county records) as a person name, dropping a real Pink Energy property. Worked
  around in the ingest by checking the researched alias catalog first. The
  underlying heuristic in `installer-status.ts` is untouched so your existing
  reports still produce identical output — but it has the same blind spot.
