# Roof measure QA — 2026-05-28 (MCP browser)

**Tester:** Agent (cursor-ide-browser)  
**Address:** 2402 Florida Ave, Charlotte, NC  
**Prelaunch:** PASS

## Session notes

- User logged in on `localhost:3000` — **Logout** visible, `/tools/roof-measure` loaded (not redirected to login).
- **Do not kill dev servers during QA** — multiple `next dev` instances on 3000/3001/3002 broke the MCP browser tab (blank page after restart).

## Checklist (MCP)

| Item | Pass | Notes |
|------|------|-------|
| Logged in / route loads | **PASS** | CRM shell + roof measure URL |
| Map + satellite | **PARTIAL** | UI stuck on “Loading Google Maps…”; Reload outline **disabled** |
| Solar load → sections | **BLOCKED** | 0 sections; maps never finished loading in MCP session |
| Facing / pitch / Looks good | **BLOCKED** | Depends on sections |
| Ridge / hip LF | **BLOCKED** | |
| Save → builder / caps | **BLOCKED** | Save button disabled (expected with 0 sections / no pitch) |
| Ridge / Valley buttons present | **PASS** | Controls visible in a11y tree |

## Verdict

**Not fully verified in browser** — auth and page shell work when logged in; **Google Maps did not finish loading** in the automated browser pass, so the operator path could not be completed.

## Next step for human

1. One `npm run dev` on port 3000 only.  
2. Refresh the tab where you logged in.  
3. Confirm map tiles appear (not endless “Loading Google Maps…”).  
4. Reload outline from satellite → set pitch on all sections → save.

If the map never loads, check `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` in `.env.local` and Maps JavaScript API in Google Cloud Console.
