# Roof measure math — external accuracy sources

How in-house order math was checked against industry practice (May 2026). EagleView / Hover / Aurora are **report benchmarks** for LF and area; this tool does not integrate their APIs.

## Field shingles

| Rule in code | External basis |
|--------------|----------------|
| **3 bundles / square** (100 sq ft roof) | Standard architectural asphalt (GAF Timberline, Owens Corning Duration class). ~33.3 sq ft coverage per bundle at typical 5.625" exposure. |
| **MIN waste 10%** | Simple gable industry default (Roofr, construction estimating guides); granular model may compute lower before clamp |
| **Waste 10–25%** band, complex hip+valley **15–20%** | Common contractor guidance (Reddit r/Roofing, manufacturer install guides): simple gable ~10%, hips/valleys **15–20%**. NRCA-style estimating treats cut-up roofs at the high end. |
| **Valleys → field waste** (highest per-course factor) | Valley cuts consume full field shingles along the run; hip cuts are partial courses; ridge trim is small vs valley. Matches “order extra for valleys” field practice. |
| **LF floors:** ≥60 hip LF → min 15%; ≥40 valley + ≥60 hip → min **17%** | Calibrates granular model to complex-layout band without facet-count buckets. Greenway granular ~15% before floor; **17%** after calibration. |

## Granular coefficients (course-based)

| Constant | Value | Rationale |
|----------|-------|-----------|
| `BASE_AREA_WASTE_RATE` | 7% of base sq | Starter/end cuts, rakes, minor offcuts on every roof |
| `WASTE_SHINGLES_PER_COURSE_VALLEY` | 0.45 | ~half tab per sloped course — valley consumes both sides |
| `WASTE_SHINGLES_PER_COURSE_HIP` | 0.24 | Angled hip cuts — less than valley per LF |
| `WASTE_SHINGLES_PER_COURSE_RIDGE_TRIM` | 0.10 | Top-course trim at ridge — field shingles, not caps |
| `EXPOSURE_FT` | 5.625" | GAF/OC architectural standard exposure |

## Hip / ridge cap (separate from field squares)

| Rule in code | External basis |
|--------------|----------------|
| **Cap “square” = 100 LF** of hip+ridge line | GAF Seal-A-Ridge sell sheet: **25 LF/bundle**, **4 bundles ≈ 100 LF** ridge/hip coverage (6-2/3" exposure). Not the same unit as a **field** roofing square (100 sq ft). |
| **Order qty:** LF ÷ 100 → cap sq; bundles = ceil(LF ÷ 25) | Warehouse often stocks caps by bundle; UI shows **sq first**, LF as measured. |
| **25 LF/bundle default** | GAF label; OC and others may be **20–31 LF/bundle** — override in pricebook when product differs. |

## What we do *not* double-count

- **Ridge trim in field waste** (~0.1 shingle/course along ridge LF) models field shingle waste at the ridge line, not cap shingles. Cap order is a separate line (cap sq / bundles).
- **Eaves / rakes** affect drip edge and starter, not the granular field-waste model today.

## Greenway sanity check (304 Greenway Dr)

| Item | Value | Cross-check |
|------|-------|-------------|
| Measured field | 28.13 sq | vs first PO **26 sq** → under-ordered |
| + 17% waste | 32.91 sq → **99 bundles** / **33 sq** rounded | explains ~21-bundle gap vs 26 sq order |
| Caps | 112 R + 109 H → **2.21 cap sq** → **10 bundles** @ 25 LF | matches field story of **“10 more bundles”** if caps were missed |

## UI / ops alignment

- **Roof measure tool:** Material order panel = field order + cap sq; waste breakdown sums match total when LF floor applies (scaled + labeled).
- **Proposal builder:** Auto cap line items use **square** qty = cap sq (LF/bundles in description).
- **Job sold scope:** Combined hip+ridge → cap sq subline (existing).

## References (public)

- GAF Seal-A-Ridge product / coverage documentation (25 LF per bundle, 4 bundles per 100 LF).
- Manufacturer architectural shingle specs (3 bundles per square).
- Contractor forums (e.g. Reddit r/Roofing): waste threads for hip/valley complexity in the **15–20%** range.
- EagleView / Hover / Aurora: use third-party **reports** to validate drawn LF and area against orders; not source of truth inside ARX math.
