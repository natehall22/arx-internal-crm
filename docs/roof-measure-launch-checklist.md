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

## Sign-off

| Role | Name | Date |
|------|------|------|
| Engineering | | |
| Ops / production | | |
