# Roof measure — sign-off before production

Use this **in the real tool** while logged into the CRM — not as a code checklist.

**Master context:** [roof-measure-in-house-capability-prompt.md](./roof-measure-in-house-capability-prompt.md) (desire paths)

---

## Before you open the browser (engineering)

- [x] `npm run roof-measure:prelaunch` (2026-05-27 — PASS)
- [x] `npm run build` (re-run after doc audit — must pass before prod)

---

## Desire path: “I can quote this job”

**Use a real address** (e.g. Florida Ave benchmark or any production job).

### On the map

- [ ] Search address → satellite loads  
- [ ] **Reload outline from satellite** (Google Solar) → section outlines (not empty boxes only)  
- [ ] Each section shows **Facing** when Solar had it  
- [ ] **Choose roof pitch** on **every** section — save stays blocked until done  
- [ ] **Looks good ✓** on auto-loaded sections before save  

### Numbers you’ll order from

- [ ] Simple 2-section gable: **ridge LF** ≈ shared top edge (not 0)  
- [ ] Complex roof: **hips LF** &gt; 0 when hip planes are drawn  
- [ ] **Ridge** draw button → ridge LF follows your line  
- [ ] **Valley** draw button → adds to valley LF  

### Save → proposal

- [ ] Save → lands in proposal builder with `measurement_id`  
- [ ] **Ridge cap** / **hip cap** lines when ridge/hip LF &gt; 0  
- [ ] **Waste %** higher on hip-heavy roof than simple gable (sidebar)  

### Nothing scary in the console

- [ ] No errors on the happy path above  
- [ ] Overlap warning if sections are way bigger than Solar footprint (~8%+)  

---

## Desire path: “I’d order material from these numbers”

- [ ] On a hip-heavy test roof: hip LF visible, waste % not naive, cap count &gt; 0  
- [ ] Ops name + date for one real hip job (P-00093-class) below  

---

## Prod notes (2026-05-27)

**Concord — 1361 Kison Ct NW, Concord NC 28027** ([full QA](./roof-measure-qa-2026-05-28-final.md#human-prod-verification--concord-2026-05-27)):

- Solar auto-loaded **3** sections on map (not blank); operator added **5** more → **8** at save.
- Save → proposal builder OK (~17.6 sq, ~17.5% waste, ridge/hip caps in LF summary).
- **Limit (P1):** Solar under-splits this roof — manual sections expected for full quote.
- Tool warned possible duplicate **sections 3 & 4** — delete overlap before final quote.

**Greenway — 304 Greenway Dr** ([full QA](./roof-measure-qa-2026-05-28-final.md#human-prod-verification--greenway-2026-05-27)):

- Solar auto-loaded **7** sections (case study count) — **not blank**.
- Geometry: **Satellite box (rough)** (`solar_bbox`); operator **drags vertices** to roof lines (no +N manual sections like Concord).
- **Pending:** Looks good all → save → confirm ~28.13 sq, ~17% waste, ridge/hip/valley LF vs case study; builder caps.

---

## Sign-off

| Role | Name | Date |
|------|------|------|
| Engineering | Nathan Hall | 2026-05-28 — **GO** (known limits: bbox quads, manual sections on under-split addresses, plane LF off) |
| Ops / production | | |
