import { readFileSync } from 'fs'
import { join } from 'path'

import { TODAY_TILE_KEYS, INDUSTRY_PROFILES } from '@/lib/industry-profiles'
import { clientOrgProfile, resolveOrgProfile } from '@/lib/org-profile'
import { MANUAL_LEAD_SOURCES, manualLeadSourcesFor } from '@/lib/lead-sources'
import { REPORT_TEMPLATES } from '@/lib/reporting/templates'

const roof = resolveOrgProfile({})
const lawn = resolveOrgProfile({ profile: { id: 'lawn_landscape', version: 6 } })
const cleaning = resolveOrgProfile({ profile: { id: 'exterior_cleaning', version: 4 } })
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('roofing is unchanged by the simple-quote / start / tiles work', () => {
  it('roofing asks for no Today tiles, no Reports overview, hides no lead source', () => {
    expect(roof.today.ownerTiles).toBeUndefined()
    expect(roof.reportsOverview).toBeNull()
    expect(roof.hiddenLeadSources).toEqual([])
    expect(manualLeadSourcesFor(roof.hiddenLeadSources)).toEqual([...MANUAL_LEAD_SOURCES])
    expect(roof.features.squaresPricing).toBe(true)
  })
  it('an org with nothing stored resolves exactly like roofing', () => {
    expect(clientOrgProfile(resolveOrgProfile({})).hiddenLeadSources).toEqual([])
  })
  it('today page keeps the roofing tiles verbatim behind the profile branch', () => {
    const src = read('app/today/page.tsx')
    for (const label of ['Sits this week', 'Sales this week', 'Inspections set', 'Appointments', 'Doors this week']) expect(src).toContain(`'${label}'`)
  })
  it('reports page keeps the roofing KPI row and cards in today’s order', () => {
    const src = read('app/reports/page.tsx')
    expect(src).toContain("const ROOFING_KPIS = ['sales', 'inspections-set', 'sits', 'doors', 'new-leads']")
    expect(src).toContain("const ROOFING_TILES = ['revenue-by-month', 'sales-by-closer', 'sold-rate-by-closer', 'doors-by-rep', 'appointments-by-type', 'leads-by-source', 'sales-by-month']")
  })
  it('the quote builder gates every change on the simple flag (squares pricing off)', () => {
    const src = read('app/proposals/builder/page.tsx')
    expect(src).toContain('const simple = !squaresOn')
    expect(src).toContain("setStep(simple ? 5 : squaresOn ? 2 : 3)")
  })
})

describe('service profiles', () => {
  it('lawn and cleaning ask for the service tiles; every key is one the Today page fills', () => {
    for (const p of [lawn, cleaning]) {
      expect(p.today.ownerTiles).toEqual(['visits-left-today', 'unpaid-invoices', 'billed-week'])
      for (const k of p.today.ownerTiles ?? []) expect(TODAY_TILE_KEYS).toContain(k)
    }
  })
  it('reports overview: billed and collected as two numbers; every card is a real starter report the profile offers', () => {
    for (const p of [lawn, cleaning]) {
      expect(p.reportsOverview?.kpis.slice(0, 2)).toEqual(['billed', 'collected'])
      const keys = new Set(REPORT_TEMPLATES.map((t) => t.key))
      for (const tile of p.reportsOverview?.tiles ?? []) {
        expect([tile, keys.has(tile)]).toEqual([tile, true])
        expect([tile, (p.starterReports ?? []).includes(tile)]).toEqual([tile, true])
      }
    }
    const src = read('app/reports/page.tsx')
    for (const k of lawn.reportsOverview?.kpis ?? []) expect([k, src.includes(`key: '${k}'`)]).toEqual([k, true])
  })
  it('the billed / collected cards read the revenue dataset, which only people with financials can run', () => {
    const src = read('app/reports/page.tsx')
    expect(src).toMatch(/key: 'billed'[^\n]*money: true[^\n]*dataset: 'revenue'/)
    expect(src).toMatch(/key: 'collected'[^\n]*money: true[^\n]*dataset: 'revenue'/)
  })
  it('lawn hides door to door and call center; cleaning keeps door knocking', () => {
    expect(manualLeadSourcesFor(lawn.hiddenLeadSources).map((s) => s.value)).toEqual(['ad_campaign', 'call_in', 'referral', 'web', 'yelp', 'other'])
    expect(manualLeadSourcesFor(cleaning.hiddenLeadSources).map((s) => s.value)).toContain('door_to_door')
    expect(manualLeadSourcesFor(cleaning.hiddenLeadSources).map((s) => s.value)).not.toContain('call_center')
  })
  it('hidden sources are real manual sources', () => {
    const all = new Set<string>(MANUAL_LEAD_SOURCES.map((s) => s.value))
    for (const p of Object.values(INDUSTRY_PROFILES)) for (const h of p.hiddenLeadSources ?? []) expect([h, all.has(h)]).toEqual([h, true])
  })
})
