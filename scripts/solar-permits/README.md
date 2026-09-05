# Solar permit source audit

Local, isolated audit tooling for the orphaned-solar campaign. **No Supabase ingest, no canvass overlay wiring, no Accela HTML scraping.**

Run:

```bash
npm run solar-permits:audit
# optional ~9.3MB CAMA CSV download + parse:
npx tsx scripts/solar-permits/audit.ts --with-cama

# full Cabarrus + Mecklenburg + Rowan extract + unique-property dedupe (no CRM ingest):
npm run solar-permits:extract
# year-by-year coverage, Meck PV classification, AHJ + external-source tables:
npm run solar-permits:coverage
# fold Cabarrus Historical 2016–2018 into a NEW expanded extract (does not overwrite 7,312 files):
npm run solar-permits:expand
# or one county:
npx tsx scripts/solar-permits/extract.ts --county cabarrus
```

Outputs land in `scripts/solar-permits/data/` (gitignored).

PRA letter templates and send list: [`docs/solar-permit-records-request.md`](../docs/solar-permit-records-request.md).

---

## County source matrix (primary deliverable)

Verified 2026-08-27. Honest field availability — not every bulk source has every column.

| County | Years | Bulk source | Solar searchable | Address | PIN | Contractor | Records request needed |
|--------|-------|-------------|------------------|---------|-----|------------|------------------------|
| Cabarrus | 2007–2015 ArcGIS; Historical 2016–2018; Accela 2019+ | ArcGIS yearly + Historical Permits; Accela portal after 2018 | Yes | Yes | Yes | Partial | **Yes for 2019+** |
| Mecklenburg | 1997–2023 BuildingPermits; 2024–present Accela SolarPV | meckgis BuildingPermits + EPIC Accela | Yes | Yes | Yes | No | Partial |
| Rowan | 2014–2026 (Electrical Solar PV) | ArcGIS Building_Permits MapServer/6 | Yes | Yes | Yes | Partial | Partial |
| Union | Unknown | None (Evolve portal only) | Unknown | Unknown | Unknown | Unknown | Yes |
| Gaston | Unknown | None (EnerGov GIS token-gated; Gastonia separate) | Unknown | Unknown | Unknown | Unknown | Yes |
| Iredell | Unknown | None (EnerGov CSS; Mooresville separate) | Unknown | Unknown | Unknown | Unknown | Yes |
| Lincoln | Unknown | None (eTRAKiT search only; GIS has no permit layers) | Unknown | Unknown | Unknown | Unknown | Yes |

**How to read this:** Unknown means there is no queryable bulk API. Mecklenburg contractor **No** means bulk layers have owner names, not installer legal names.

**Partial notes:**

- **Cabarrus contractor Partial** — ArcGIS 2011–2015 has `AppName`/`Applicant`; CAMA has no installer column. Phase 1 (address + PIN + installer) does **not** need a records request.
- **Mecklenburg records request Partial** — address, PIN, and issue dates are on public FeatureServers. PRA is still required for **installer legal names**. Do not treat the AGOL inspector layer as history.
- **Rowan contractor Partial** — ~28% of Electrical Solar PV rows have `sCompanyName_Parc` (often installer, sometimes parcel owner). PRA optional to backfill.
- **Rowan PIN** — map-lot format (`016 077`), not Cabarrus PIN14.

Live probe rewrites `data/matrix.csv` and `data/matrix.md` on each audit run.

---

## Extraction (Cabarrus / Mecklenburg / Rowan only)

`npm run solar-permits:extract` pulls every matching ArcGIS row (not 25/year samples), then collapses building + electrical + zoning to **one unique property**.

- Key: county + PIN (preferred) or normalized address. Missing lat/lng is kept.
- Earliest `issuedOn`; installer copied from any row that has one.
- Rowan: Solar + Solar PV workclass. Solar Water (thermal) is excluded.
- Mecklenburg `%SOLAR%` includes `Skylight/Solar Panel` work-type boilerplate, not only PV arrays — the unique count is the honest bulk set, not a PV-only filter.
- Writes gitignored files under `data/`: `permits-*.json`, `unique-properties.json`, `unique-properties.csv`, `extract-summary.md`.

**Still out of scope:** CRM ingest, `solar_installs` migrations, canvass overlay, Accela HTML scraping.

Coverage gap analysis (2026-08-27): `npm run solar-permits:coverage` writes gitignored CSVs (`coverage-by-year.csv`, `jurisdiction-coverage.csv`, `external-sources.csv`, `mecklenburg-pv-classification.csv`). Narrative: `data/coverage-gap-report.md` and `data/market-size-estimate.md`.

**Headline:** Original extract **7,312** unique PINs (untouched). Expanded permit file **7,474**. Address census `npm run solar-permits:census` → **6,809 canvass-ready** streets (`data/census-canvass.csv`) metro-wide, plus slices `census-canvass-cabarrus.csv`, `census-canvass-east.csv`, and `census-canvass-south.csv`. Installer remains overlay.

---

## Goal

Before we bulk-ingest `solar_installs`, prove which jurisdictions expose machine-readable solar/PV permit history back to ~2011 and what fields we get (address, PIN, contractor, dates).

---

## Cabarrus (implemented)

### ArcGIS MapServer (2011–2015 primary)

- Base: `https://location.cabarruscounty.us/arcgisservices/rest/services/opendata/MapServer`
- Query: `UPPER(DetailedDescription) LIKE '%SOLAR%'`
- Layers: 2015=33 (`AppName`), 2014=61 … 2011=103 (`Applicant` instead of `AppName`)
- Paginate with `resultOffset`; `maxRecordCount` 1000
- **Always** use `outFields=*` or year-appropriate fields — requesting `AppName` on 2014 returns **0 features**

### CAMA Real Property Permit CSV

- SharePoint open-data export (~64k rows, ~1986–2025)
- ~344 solar-ish rows on `PermitNotes` / `WorkType` / `PermitType` (no contractor)
- Permit numbers join ArcGIS after stripping `BU` prefix (e.g. `BU2015-01047` → `2015-01047`)

---

## Mecklenburg (dated bulk — no installer names)

- Legacy: `https://meckgis.mecklenburgcountync.gov/server/rest/services/BuildingPermits/FeatureServer/0` (~482k; `permitdesc` LIKE `%SOLAR%`; `issuedate`, `projadd`, `parcelnum`, `ownname`)
- Accela/EPIC: `https://services.arcgis.com/BWD3gDuaqc7SQmy7/arcgis/rest/services/EPIC_Accela/FeatureServer/1` (`permit_subtype = 'SolarPV'`; `permit_issued_date`, `full_address`, `tax_parcel_id`). meckgis AccelaAllPermits is count-only (feature queries 400).
- Inspector AGOL `ResidentialBuildingPermit` is a current-workload layer (no dates; opaque `contractor_id`) — do not use as history
- City `Clean_Energy_Solar_Systems` is NCSEA-mapped PV points, not AHJ permits
- PRA still needed for **contractor legal names**, not for finding solar homes or dating them

---

## Rowan (bulk — partial contractor)

- Layer: `https://gis.rowancountync.gov/arcgis/rest/services/Public/Building_Permits/MapServer/6`
- Workclass values: Solar, Solar PV, Solar Water
- Sample filter: Electrical + Solar PV (`sName_Workclass = 'Solar PV' AND UPPER(PermitType) LIKE '%ELECTRICAL%'`)
- Address from `sAddress1` + `sPreDirection` + `sAddress2` + `sStreetT`
- PIN = `sPacelNum` (Rowan map-lot, e.g. `"016 077"`, not Cabarrus PIN14)
- Installer = `sCompanyName_Parc` when filled (~28% of Electrical Solar PV)
- EnerGov CSS still login-gated; GIS is the bulk path

---

## Union / Gaston / Iredell / Lincoln (PRA for permits; streets already in census)

No permit GIS/CSV. Duke NM unique-join already put canvass streets in `census-canvass.csv` for these counties. PRA is how you get **contractor names** and the homes Duke did not uniquely match. See `sources.ts` for portal URLs, city splits, and blockers. Do not scrape.

---

## Module layout

```
scripts/solar-permits/
  audit.ts              coverage CLI
  extract.ts            full pull + unique-property dedupe CLI
  expand.ts             Cabarrus 2016–2018 into a new expanded extract
  census.ts             address-first finished file (permits + Duke NM unique tax join)
  installer-frequency.ts  name-variant grouping (no defunct research)
  coverage.ts           year coverage + Meck PV class + AHJ/external CSVs
  classify-pv.ts        CONFIRMED / LIKELY / AMBIGUOUS / NON_PV
  coverage-data.ts      AHJ matrix + external source registry
  dedupe.ts             PIN/address collapse (no lat/lng drop)
  schema.ts             PermitRecord + coverage + unique-property types
  sources.ts            jurisdiction registry (7 counties)
  arcgis.ts             paginated ArcGIS helper (User-Agent: ARX-permit-audit/0.1)
  collectors/
    cabarrus.ts
    mecklenburg.ts
    rowan.ts
  data/                 gitignored local downloads + JSON/CSV artifacts
```

---

## Completeness / blockers

- **No `solar_installs` / `solar_installers` migration yet** — do not apply a migration until ingest is real.
- **No ingest, no migrations** — keep all work isolated under `scripts/solar-permits/`.
- **City splits** — Monroe, Waxhaw, Mooresville, Kings Mountain, and pre-2022 Gastonia are separate from county extracts. Kannapolis **city limits** (even in Rowan) are Cabarrus Accela (Crystal “Building Permits Rowan County” is that slice); Rowan GIS has Kannapolis **ETJ** only.
- **G.S. 132-10** — if a county offers a bulk extract under a “no commercial use” agreement, stop and send to counsel before signing.
- **CAMA lacks contractor** — orphaned-solar installer status still depends on ArcGIS-era contractor fields or later PRA enrichment.
- **Permit-era owner ≠ current owner** — `ownerNamePermitEra` stays on the staging row. `owner_is_original` on `solar_installs` is a later join to current tax/parcel records.

---

## Target CRM tables (not created)

Canvass overlay expects `solar_installs` + `solar_installers` but tables are **not migrated**. Do not wire overlay until rows exist.

---

## Next steps (after unique-property counts)

1. **Finished local product:** `npm run solar-permits:census` → `data/census-canvass.csv` (metro), `data/census-canvass-cabarrus.csv` (Cabarrus only), `data/census-canvass-east.csv`, `data/census-canvass-south.csv`. Requires `onemap-metro-owners.csv`. Address-first; installer overlay.
2. File Cabarrus Accela 2019–present records request (`data/cabarrus-records-request.md`) — do not scrape — this is for **contractor names**, not the only path to homes
3. PRA Union / Gaston / Iredell / Lincoln (+ Monroe, Waxhaw, Mooresville, pre-2022 Gastonia) only if NCUC/NCSEA path is refused
4. Installer-defunct scrub against `data/installer-frequency.csv` (186 names) only after Cabarrus 2019+ is in hand or explicitly deferred
5. Migration + ingest only after QA
