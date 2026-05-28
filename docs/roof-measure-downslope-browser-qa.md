# Roof measure — downslope arrow browser QA (manual)

**Feature:** Phase P1/P2 downslope preview + draggable arrow (`docs/prompts/roof-measure-drain-direction-fix.md`)  
**Tool:** `/tools/roof-measure`  
**Automated browser attempt (2026-05-28):** **BLOCKED** — see [Browser automation](#browser-automation-2026-05-28).

---

## Prerequisites

| Item | Notes |
|------|--------|
| Auth | Valid ARX CRM login (local or prod). Unauthenticated requests redirect to `/login?next=/tools/roof-measure`. |
| Google Maps | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` in `.env.local` for local dev. |
| Complex roof | **304 Greenway Dr, Huntersville NC 28078** (9+ bbox sections, dormer-friendly). Alternate: any saved hip job with `section_type: dormer` on at least one facet. |
| Dev server | `npm run dev` → `http://localhost:3000` |

**Recommended entry URL (complex):**

```text
/tools/roof-measure?address=304%20Greenway%20Dr%2C%20Huntersville%20NC%2028078
```

Optional opportunity deep-link (if your CRM row exists):

```text
/tools/roof-measure?opportunity_id=<uuid>&address=304%20Greenway%20Dr
```

---

## Test 1 — Load complex property

1. Sign in at `/login` if prompted.
2. Open the Greenway URL above (or search **304 Greenway Dr** in the Property Address field and run **Load from satellite** / Solar detect).
3. Wait for map overlays (colored facet polygons). Confirm **≥7 sections** and map is not blank.
4. Apply Solar / pitch if the job is fresh (use **Looks good ✓** when geometry is acceptable).

**Pass:** Facets visible; sidebar lists sections with pitch and **Facing** (panel direction).

---

## Test 2 — Gray downslope arrow on section select

1. Click any **non-dormer** section polygon on the map (or its row in the sidebar).
2. On the map, confirm a **gray** arrow (`#9CA3AF`) from facet centroid toward the downslope tip (~7 m).
3. In the sidebar for that section, confirm:
   - **Facing:** … `(…° — panel direction, not drain)` — unchanged from Solar/load.
   - **Downslope (water runs this way):** compass + degrees + `from outline`.

**Pass:** Gray arrow appears on select; Facing row still present and unchanged; Downslope row is separate from Facing.

---

## Test 3 — Dormer: Adjust downslope → drag → LF update

1. Select a section classified as **Dormer** (set **Section type → Dormer** in sidebar if needed).
2. Confirm sidebar shows **Auto / Manual** and **Adjust downslope** (shown when `needsDrainReview` — dormer, low confidence, or hip/valley validation notes).
3. Click **Adjust downslope**. Arrow turns **blue** (`#60A5FA`); tip marker is draggable.
4. Drag arrow tip toward the **eave / low side** (not toward the Facing label). Use two-finger pan if the map steals drag.
5. Watch **Ridge / Hip / Valley LF** in the measurements sidebar (or report panel) — values should **update live** after drag end (15° snap).
6. Note **hips_lf** / **valleys_lf** before and after on a misclassified dormer peak if possible (expect hips up / valleys down when drain was wrong).

**Pass:** Blue draggable arrow; LF totals change after drag; sidebar **Downslope** shows `manual` and new degrees.

---

## Test 4 — Save → reload `?measurement_id=` → arrow persists

1. Complete pitch confirmation (**Looks good ✓**) if required.
2. **Save** measurement (lands in proposal builder with `measurement_id` in URL).
3. Copy `measurement_id` from builder URL or measurements list.
4. Open:

   ```text
   /tools/roof-measure?measurement_id=<id>
   ```

5. Wait for map settle (overlays redraw).
6. Select the same dormer section. Confirm:
   - **Downslope** still **manual** with saved degrees.
   - Blue arrow (if **Adjust downslope** active) or gray preview at saved bearing.

**Pass:** `drain_azimuth_degrees` + `drain_azimuth_source: manual` roundtrip in `raw_data.facets[]`; arrow direction matches pre-save.

---

## Test 5 — Facing unchanged

1. On the dormer section from Test 3–4, record **Facing** label and degrees before save.
2. After manual downslope drag and after reload, confirm **Facing** text and `facing_azimuth_degrees` are **unchanged** (only Downslope / drain fields changed).

**Pass:** Facing is display-only; drain edits do not rewrite Solar facing.

---

## Fail criteria (stop and file bug)

- Login loop or blank map after reload.
- No downslope arrow on selected facet with ≥3 vertices.
- Manual drain not persisted on `?measurement_id=` reload.
- Facing degrees change when only downslope is adjusted.
- Save blocked solely because downslope is manual (v1 should warn only, not block).

---

## Browser automation (2026-05-28)

| Step | Result |
|------|--------|
| `curl http://localhost:3000/tools/roof-measure` | **307** → login (server up) |
| Cursor IDE browser MCP → `http://localhost:3000/tools/roof-measure` | **BLOCKED** — redirected to `http://localhost:3000/login?next=%2Ftools%2Froof-measure`; Sign in form (email/password). No CRM credentials in agent environment. |

**Conclusion:** Full UI QA requires a **logged-in human** (or test user in `.env`). Machine checks for classification: `npm test -- --testPathPattern="roof-edge-golden|roof-measure-edge-classification"` and `npm run roof-measure:classify`.

---

## Related automated fixtures (P0-4)

Golden cases in `lib/__tests__/fixtures/roof-edge-golden.json`:

| Case ID | Intent |
|---------|--------|
| `dormer-head-ridge` | Short dormer peak → **ridge** LF, valleys 0 |
| `l-valley` | Long converging shared edge → **ridge** LF (auto drain), valleys 0 |
| `t-intersection` | Bar + stem T footprint → ridge LF 40, interior classified |

---

## Sign-off template

| Test | Tester | Date | Pass/Fail | Notes |
|------|--------|------|-----------|-------|
| 1 Load complex | | | | |
| 2 Gray arrow | | | | |
| 3 Dormer drag + LF | | | | |
| 4 Reload persistence | | | | |
| 5 Facing unchanged | | | | |
