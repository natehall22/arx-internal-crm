# Roof measure QA report — 2026-05-27

**Date:** 2026-05-27  
**Tester:** Agent L5 (Head Coder orchestration)  
**Build / branch:** `0605815` (2 commits ahead of `origin/main`)  
**Prelaunch:** `npm run roof-measure:prelaunch` → **PASS**  
**Build:** `npm run build` → **PASS**

## Checklist results

| Item | Pass | Notes |
|------|------|-------|
| Map loads | **BLOCKED** | Redirected to `/login`; session required |
| Solar load facets | **BLOCKED** | Not reached |
| Facing shown | **BLOCKED** | Not reached |
| Pitch on all sections | **BLOCKED** | Not reached |
| Ridge LF > 0 (gable) | **BLOCKED** | Not reached |
| Hip LF (complex) | **BLOCKED** | Not reached |
| Manual ridge override | **BLOCKED** | Not reached |
| Save → builder | **BLOCKED** | Not reached |
| Cap line items | **BLOCKED** | Not reached |

## Automated coverage (substitute for blocked browser rows)

| Check | Result |
|-------|--------|
| `roof-measure:prelaunch` (tsc + 103 tests + classify) | PASS |
| Golden classify (3 cases) | PASS |
| Florida Ave report-benchmark ridge 101 LF ±15% | PASS (100 LF, 1.0% error) |
| Roundtrip fixture (`roof-measure-roundtrip.test.ts`) | PASS |
| L2 ridge/valley columns → proposal builder | Fixed + tested |

## Blockers

- **Auth:** `http://localhost:3000/tools/roof-measure` requires signed-in CRM session. Browser MCP cannot complete checklist without operator login (or test credentials in env).

## Sign-off recommendation

- [ ] Ready for production
- [x] Ready with documented limitations
- [ ] Not ready

**Recommendation:** Ship automated gates + committed code after **one** logged-in browser pass on Florida Ave or Kison Court and **ops sign-off** on a hip-heavy job (P-00093-class).
