# How roof faces are measured (Aurora, Solo, Google Solar, ARX)

## Related docs

| Doc | Purpose |
|-----|---------|
| [roof-measure-README.md](./roof-measure-README.md) | Quick start, commands, architecture |
| [roof-measure-in-house-capability-prompt.md](./roof-measure-in-house-capability-prompt.md) | Master — desire paths |
| [roof-measure-launch-prompt.md](./roof-measure-launch-prompt.md) | Legacy agent waves |
| [roof-measure-launch-checklist.md](./roof-measure-launch-checklist.md) | Human QA before prod |
| [roof-measure-accuracy-report.md](./roof-measure-accuracy-report.md) | Calibration & prelaunch gate |
| [roof-measure-qa-TEMPLATE.md](./roof-measure-qa-TEMPLATE.md) | Browser QA report template |
| [roof-measurement-providers.md](./roof-measurement-providers.md) | Aurora / Solo / Google vs ARX |


This doc is about **roof planes / faces** — not webhooks or imports. Each platform answers: *what is one face, how is its area/pitch/direction defined, and where do ridge/hip/valley lengths come from?*

---

## One roof face = one sloped plane

Across solar tools, a **roof face** is a single continuous sloped surface (one pitch, one facing direction). Complex roofs are many faces meeting at ridges, hips, and valleys.

| Concept | Meaning |
|--------|---------|
| **Footprint** | Horizontal projection of the face on the ground (plan view) |
| **Surface area** | Actual sloped area (footprint × pitch factor, or measured on the 3D plane) |
| **Pitch** | Steepness of the plane (degrees from horizontal, or rise/12) |
| **Azimuth** | Compass direction the plane **faces** (solar/panel convention: where the surface normal points horizontally) |
| **Drain direction** | Direction water runs **down** the slope — often ~180° from panel-facing azimuth on simple gable planes, but not always on complex shapes |

ARX must keep **panel-facing azimuth** (Solar/Aurora) separate from **drain azimuth** (`computeFacetDrainAzimuth`). **Facing** drives the UI label and interior ridge/hip/valley when Solar (or saved) azimuth is present; **drain** is used for eave/rake and as a fallback when facing is unknown.

---

## Aurora Solar — 3D model first, edges typed on the model

Docs: [3 ways to model a roof](https://help.aurorasolar.com/hc/en-us/articles/21016351139859-3-Ways-to-model-a-roof), [roof face characteristics](https://help.aurorasolar.com/hc/en-us/articles/360036998854-How-to-View-Roof-Face-Characteristics), [SmartRoof tips](https://help.aurorasolar.com/hc/en-us/articles/360034501014-SmartRoof-Best-Practices-and-Tips).

### How faces are created

1. **SmartRoof (manual or AI SmartRoof)**  
   - User draws the **roof perimeter** on satellite imagery (often with 90° snap).  
   - Aurora **infers internal faces** (ridges, hips, valleys) inside that outline — you do not draw every plane boundary by hand.  
   - **Edit Roof** mode: drag internal lines, set **pitch/slope per face**, **edge height**, add folds/dormers.  
   - Data: HD imagery + **LiDAR** when available (AI roof).

2. **Roof face (manual or AI Roof faces)**  
   - Each face is drawn/edited **as its own plane** — better for odd shapes or partial roofs.  
   - More control, more labor.

3. **Expert / EagleView-powered models**  
   - Human or EagleView-built **3D site model** dropped into the design; same face/edge semantics afterward.

### What Aurora stores per face

When you click a face in Design mode you see:

- **Azimuth** — direction the slope faces (same solar sense as Google: compass degrees).  
- **Pitch / slope** — angle of that plane (UI uses pitch and slope interchangeably).  
- **Area** — **surface area of that face** (sloped sq ft), not just footprint.  
- Module count / module area on that face.

`roof_summary` API returns the same idea per face: `area`, `azimuth`, `pitch` (degrees), plus rolled-up `edges_length` per **roof** (a group of faces within ~1 sq ft of each other).

### How Aurora gets ridge / hip / valley / eave / rake LF

Lengths are **not** inferred from a flat map polygon.

- Each line in the 3D model is an **edge with a type** (ridge, hip, valley, eave, rake).  
- SmartRoof / AI / Expert service **assign types automatically** when the 3D model is built.  
- Simple manual “roof face only” models require **manual edge typing** or summaries are wrong.  
- Totals can include **internal/barn edges**, not only the outer perimeter.

So Aurora’s LF numbers are a **property of the 3D edge graph**, not of 2D adjacency math.

---

## Solo (gosolo.io) — DSM → 3D roof → edges, pitch, azimuth inside the app

**Not** [solo.io](https://www.solo.io) (API gateway). Solo is [gosolo.io](https://gosolo.io) — Gemini, Solo Studio, SunPixel.

Public docs do not publish a `roof_summary`-style API. From product/marketing copy, the **measurement pipeline** is:

1. Load **digital surface model (DSM)** for the address.  
2. **Detect roof edges and surfaces** (AI roofline / obstruction detection).  
3. Build a **3D model** of the structure.  
4. **Label edges**, compute **pitch and azimuth** per surface, apply fire setbacks, run shade, place panels.

Same *class* of approach as Google’s solar roof pipeline (DSM → planar segments → per-plane pitch/azimuth), but tuned for **sales/proposal** (DNV-validated production, Treescape shading, etc.). Face geometry and edge lengths stay **inside Solo** unless you export reports manually — there is no documented LF export like Aurora’s `edges_length`.

For ARX: treat Solo as a **reference workflow** (DSM + classified edges + per-face pitch/azimuth), not a drop-in geometry source.

---

## Google Solar API — pre-built planes per segment (what ARX actually loads)

Docs: [Building insights](https://developers.google.com/maps/documentation/solar/building-insights), `RoofSegmentSizeAndSunshineStats`.

Google does **not** give ridge/hip/valley lengths. It gives **roof segments** = planar patches fitted to DSM:

| Field | Meaning |
|-------|---------|
| `pitchDegrees` | Angle from horizontal (0 = flat, 90 = wall) |
| `azimuthDegrees` | Direction the segment **faces** (0 = N, 90 = E, 180 = S). Flat roofs: azimuth forced to 0. |
| `planeHeightAtCenterMeters` | With center + pitch + azimuth, defines the **3D plane** |
| `stats.areaMeters2` | Sloped segment area |
| `stats.groundAreaMeters2` | Footprint on the ground |
| `boundingBox` / `center` | Rough plan location — ARX uses these for bboxes and mask labeling |

### How ARX uses Solar segments (`app/api/ai/detect-roof`, `lib/solar-roof-mask-facets.ts`)

- **Planes, not edges:** Solar supplies pitch/azimuth per segment; ARX builds **2D polygons** (bbox quads, mask contours, or vision-traced outlines).  
- **Suggestions only:** `suggested_pitch_degrees` / `suggested_azimuth_degrees` on facets; user still sets **manual pitch** before save.  
- **Footprint vs surface:** `flat_area_sqft` from drawn/mask polygon; `area_sqft` after user pitch via `pitchMultiplierFromRise` (same idea as sloped area, but footprint comes from drawing not Google’s plane area).  
- **No Solar edge LF:** `classifyRoofEdges()` runs on **drawn** facet polygons only.

Solar **azimuth** ≈ Aurora **azimuth** (panel-facing). It is **not** the same as ARX **drain** azimuth. Interior ridge/hip/valley use **facing** when `facing_azimuth_degrees` is set; drain is used for eave/rake and as the interior fallback.

---

## ARX in-house roof measure — draw footprints, confirm pitch, infer edges in 2D

| Step | What happens |
|------|----------------|
| Import | Google Solar mask/bbox/vision → facet **polygons** + pitch suggestions |
| User | Adjust vertices; assign **pitch** per facet (required before save) |
| Face label | UI **Facing** / `orientation` = 8-wind from Solar **panel-facing** when available; else `computeFacetDrainAzimuth` (footprint guess) |
| Areas | `flat_area_sqft` on polygon; `area_sqft` = footprint × pitch multiplier |
| Linear LF | `classifyRoofEdges()` — interior ridge/hip/valley from **facing** when set, else drain; eave/rake from **drain** |

### Important mismatch vs Aurora / Solo

| | Aurora / Solo (typical) | ARX today |
|--|-------------------------|-----------|
| Face definition | 3D tilted plane | 2D lat/lng polygon + user pitch |
| Pitch | Per-face on 3D model | User `rise/12` after draw |
| Azimuth | Plane **faces** (solar) | Solar suggests; saved `orientation` matches **facing** when azimuth is known, else drain 8-wind |
| Ridge/hip/valley | Typed on 3D edges | Inferred from 2D adjacency; interior uses **facing** when set, else drain |
| Area | Sloped face area from model | Footprint measured; slope applied via multiplier |

So ARX can match **Google/Aurora pitch and facing** on each facet, but **edge lengths** will only align with Aurora when footprints snap together the same way Aurora’s 3D faces meet — expect calibration gaps on complex hips.

---

## ARX implementation (spot-on pass)

| Feature | Module / location |
|---------|-------------------|
| Facing azimuth from Solar | `lib/roof-face-solar-alignment.ts`, facet fields in `page.tsx` |
| Interior edge LF uses facing when set | `classifyRoofEdges` + `facing_azimuth_degrees` on `FacetInput` |
| Drain azimuth | `computeFacetDrainAzimuth` — eave/rake + interior fallback; never labeled “Facing” in UI |
| Classify golden tests | `lib/__tests__/fixtures/roof-edge-golden.json`, `npm run roof-measure:classify` |
| Duplicate Solar segment warning | `updateMeasurements` validation |
| Aurora mapper (reference only) | `lib/aurora-roof-summary-mapper.ts` |

## Practical alignment (no webhooks)

1. **Treat each drawn facet as one Solar/Aurora plane** — one pitch, one panel-facing azimuth (from Solar suggestion or manual).  
2. **Facing shown in facet panel** — `orientation` + degrees from Solar when available.  
3. **Use panel-facing azimuth for interior edge classification** when `facing_azimuth_degrees` is set; drain azimuth for eave/rake and hand-drawn-only facets.  
4. **Do not expect** 2D `classifyRoofEdges` to equal Aurora `edges_length` without 3D edge typing.  
5. **Calibrate** with `npm run roof-measure:classify` and manual draws against `scripts/roof-measure-eval-fixtures.json`.

---

## Professional roofing reports (benchmark only — not ARX integrations)

Photogrammetry-style reports (historically from vendors such as EagleView or Roofr) typically include per-roof **facets** with pitch and **typed edge lengths**. That output shape is what ARX **replicates in-house** via draw + `classifyRoofEdges` — we do **not** use EagleView software in this tool.

Test fixtures may cite report LF from a real address (e.g. ~101 LF ridge) only to set **±15% calibration targets** in `scripts/roof-measure-classify-fixtures.json`. Admin webhook stubs for future vendors are out of scope for roof-measure launch.

---

## References

- Aurora: [Retrieve roof measurements](https://docs.aurorasolar.com/docs/retrieve-roof-measurements) (example `faces[]` + `edges_length`)  
- Google: [RoofSegmentSizeAndSunshineStats](https://developers.google.com/maps/documentation/solar/reference/rest/v1/buildingInsights/findClosest#RoofSegmentSizeAndSunshineStats)  
- Solo: [AI rooftop design workflow](https://gosolo.io/blog/ai-powered-rooftop-design-without-leaving-the-workflow/), [Solo Studio](https://gosolo.io/solo-studio/)  
- ARX code: `app/api/ai/detect-roof/route.ts`, `lib/solar-roof-mask-facets.ts`, `lib/roof-measure-edge-classification.ts`
