/**
 * Section-level profile gating on the opportunity / lead pages and the nav: a lawn company's opportunity page must not
 * carry the roofing-only sections (roof report, roof measurements, close-visit debrief, Design, Setter lane), while the
 * roofing profile (ARX, the original company) keeps every one exactly as before.
 */
import { readFileSync } from 'fs'
import path from 'path'

import { INDUSTRY_PROFILES } from '@/lib/industry-profiles'
import { resolveOrgFeatures } from '@/lib/org-features'
import { clientOrgProfile, dealTypeLabel, defaultOrgProfile, newDealProjectType, pageHidden, profileOutcomeRows, resolveOrgProfile, roofSectionsAvailable, t } from '@/lib/org-profile'
import { visibleNav, type NavContext } from '@/lib/nav-config'
import { insertOpportunityRow } from '@/lib/new-deal'
import { DEFAULT_CLOSE_OUTCOMES } from '@/lib/close-outcomes'
import { creditLaneWords } from '@/lib/sale-credit-words'

const read = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8')
const lawnSettings = { profile: { id: 'lawn_landscape', version: 7 } }
const lawn = resolveOrgProfile(lawnSettings)
const roof = defaultOrgProfile()
const lawnFeatures = resolveOrgFeatures(lawnSettings)
const roofFeatures = resolveOrgFeatures({})

const ctx = (over: Partial<NavContext>): NavContext => ({
  permsReady: true,
  role: 'owner',
  fullAccess: true,
  permissionNames: new Set<string>(),
  flags: { isOpsOnly: false, canSeeOpsDashboard: true, canSeeJobBoard: true, canSeeInsideSales: true, projectsBarred: false, salesDocBarred: false, customerRecords: true, reports: true, isPayrollAdmin: true, earnsPay: false, payWeek: false },
  ...over,
})

describe('roof-only sections follow the profile', () => {
  it('roofing shows every roof section, whatever its switches say (ARX unchanged)', () => {
    expect(roofSectionsAvailable(roof, roofFeatures)).toEqual({ roofing: true, report: true, measurements: true })
    expect(roofSectionsAvailable(roof, { insurance: false, roofMeasure: false })).toEqual({ roofing: true, report: true, measurements: true })
    expect(roofSectionsAvailable(null, { insurance: false, roofMeasure: false }).roofing).toBe(true)
  })

  it('lawn hides roof report and roof measurements; its own switches can bring them back', () => {
    expect(lawnFeatures.insurance).toBe(false)
    expect(lawnFeatures.roofMeasure).toBe(false)
    expect(roofSectionsAvailable(lawn, lawnFeatures)).toEqual({ roofing: false, report: false, measurements: false })
    expect(roofSectionsAvailable(lawn, { insurance: true, roofMeasure: false }).report).toBe(true)
    expect(roofSectionsAvailable(lawn, { insurance: false, roofMeasure: true }).measurements).toBe(true)
  })

  it('lawn has what the lawn flow needs: yard measure, plans, quote approval', () => {
    expect(lawnFeatures.areaMeasure && lawnFeatures.servicePlans && lawnFeatures.quoteApproval).toBe(true)
    expect(roofFeatures.areaMeasure || roofFeatures.servicePlans || roofFeatures.quoteApproval).toBe(false)
  })

  it('words: roofing keeps Inspection / Proposal, lawn says estimate visit / quote; no setter lane without canvassing', () => {
    expect(t(roof, 'inspection')).toBe('Inspection')
    expect(t(roof, 'proposal')).toBe('Proposal')
    expect(t(lawn, 'inspection')).toBe('Estimate visit')
    expect(t(lawn, 'proposal')).toBe('Quote')
    expect(creditLaneWords(roofFeatures.canvassing)).toMatchObject({ showSetter: true, closer: 'Closer' })
    expect(creditLaneWords(lawnFeatures.canvassing)).toMatchObject({ showSetter: false, closer: 'Salesperson' })
  })
})

describe('Referral Partners follows the profile (v7 intent)', () => {
  it('lawn hides the page; roofing keeps it', () => {
    expect(INDUSTRY_PROFILES.lawn_landscape.nav.hidden).toContain('/referral-partners')
    expect(pageHidden(clientOrgProfile(lawn), '/referral-partners')).toBe(true)
    expect(pageHidden(clientOrgProfile(roof), '/referral-partners')).toBe(false)
    expect(pageHidden(null, '/referral-partners')).toBe(false)
  })

  const hrefs = (c: NavContext) => visibleNav(c).sections.flatMap((s) => (s.children.length ? s.children.map((x) => x.href) : [s.href]))
  it('nav: not under Pipeline for lawn, still there for roofing', () => {
    expect(hrefs(ctx({ features: lawnFeatures, profile: clientOrgProfile(lawn) }))).not.toContain('/referral-partners')
    expect(hrefs(ctx({ features: roofFeatures, profile: clientOrgProfile(roof) }))).toContain('/referral-partners')
    expect(hrefs(ctx({}))).toContain('/referral-partners')
  })

  it('the + Partner shortcut and the dashboard card use the same switch', () => {
    expect(read('components/Nav.tsx')).toContain("!pageHidden(orgProfile, '/referral-partners')")
    expect(read('app/dashboard/DashboardClient.tsx')).toContain("!pageHidden(orgProfile, '/referral-partners') && <MyPartnersCard />")
  })
})

describe('opportunity / lead page wiring (source guard: every roof-only section is behind its gate)', () => {
  const view = read('app/opportunities/[id]/OpportunityView.tsx')
  it('roof report, roof measurements, design, close status and debrief are gated', () => {
    expect(view).toMatch(/\{showRoofReport && \(\s*<div id="roof-report-section"/)
    expect(view).toMatch(/\{showRoofMeasurements \? \(/)
    expect(view).toMatch(/\{showDesign && \(/)
    expect(view).toMatch(/\{showCloseStatus && \(\s*<div id="close-section"/)
    expect(view).toContain('hideWhenEmpty={hideInspectionEmptyCard || !isRoofing}')
  })
  it('the roof gates come from the one helper and keep roofing unchanged', () => {
    expect(view).toContain('roofSectionsAvailable(orgProfile, orgFeatures)')
    expect(view).toContain('const showCloseStatus = isRoofing ||')
    expect(view).toContain('const showDesign = isRoofing ||')
  })
  it('lawn gets yard measure + plans where the roof measure was (not inside the Customer File, which shows them itself)', () => {
    expect(view).toContain('<OpportunityYardAndPlans')
    const comp = read('components/opportunities/OpportunityYardAndPlans.tsx')
    expect(comp).toContain('if (embedded) return null')
    expect(comp).toContain('CustomerRecords')
  })
  it('the roof report page 404s for a company without roofing / insurance (unless a report exists)', () => {
    expect(read('app/opportunities/[id]/report/page.tsx')).toContain('roofSectionsAvailable(')
  })
  it('lead page words follow the profile', () => {
    const lead = read('app/leads/[id]/LeadView.tsx')
    expect(lead).toContain("stepWord={t(orgProfile, 'inspection').toLowerCase()}")
    expect(lead).not.toContain('>Inspection outcome:<')
  })
})

describe('insurance wording and documents follow the profile', () => {
  const active = (rows: { id: string; active: boolean }[]) => rows.filter((r) => r.active).map((r) => r.id)
  it('close outcomes: lawn is not offered the insurance ones; roofing keeps all of them (list unchanged)', () => {
    const lawnRows = profileOutcomeRows(lawn, null, [...DEFAULT_CLOSE_OUTCOMES])
    expect(active(lawnRows)).not.toContain('waiting_on_insurance')
    expect(active(lawnRows)).not.toContain('insurance_follow_up')
    expect(profileOutcomeRows(roof, null, [...DEFAULT_CLOSE_OUTCOMES])).toEqual(DEFAULT_CLOSE_OUTCOMES)
  })
  it('change order PDF: default wording is the original text; only a passed document name changes it', () => {
    const src = read('lib/contracts/generateChangeOrderPdf.ts')
    expect(src).toContain("data.documentName || 'Installation Agreement'")
    const w = read('lib/contracts/change-order-wording.ts')
    expect(w).toContain("profile.id === 'roofing' ? ROOFING_CHANGE_ORDER_DOCUMENT")
  })
})

describe('Customer File Sales tab and deal type follow the profile', () => {
  it('new deals: roofing stays roofing, every other profile is other', () => {
    expect(newDealProjectType(roof)).toBe('roofing')
    expect(newDealProjectType(null)).toBe('roofing')
    expect(newDealProjectType(lawn)).toBe('other')
    for (const f of ['app/api/inspections/status/route.ts', 'app/api/leads/[id]/opportunity/route.ts', 'app/api/canvass/lead/route.ts']) {
      expect(read(f)).not.toContain("project_type: 'roofing'")
      expect(read(f)).toContain('insertOpportunityRow(')
    }
  })
  it('the Roofing pill is only shown to roofing, or when the deal has a real type', () => {
    expect(read('app/opportunities/[id]/OpportunityView.tsx')).toContain("(isRoofing || opportunity.project_type !== 'roofing')")
  })
  it('Sales tab: roofing keeps the opportunity page; others get the Overview-style cards', () => {
    const tab = read('components/customer-file/TabBody.tsx')
    expect(tab).toContain("id !== 'roofing'")
    expect(tab).toContain('<SalesTab')
    expect(tab).toContain('<OpportunityView params={{ id: dealId }} embedded />')
    const sales = read('components/customer-file/SalesTab.tsx')
    expect(sales).toContain('creditLaneWords(features.canvassing)')
    expect(sales).toContain('markOpportunityLost(')
    expect(sales.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')).not.toMatch(/Roof|Insurance|Canvass/)
  })
})

describe('deal project type vs the database enum', () => {
  const enumValues = (/export type ProjectType = ([^\n]+)/.exec(read('lib/types/database.ts'))![1].match(/'([a-z_]+)'/g) ?? []).map((v) => v.replace(/'/g, ''))
  it('everything newDealProjectType returns is a ProjectType; the migration adds the new value', () => {
    for (const p of [roof, lawn, resolveOrgProfile({ profile: { id: 'exterior_cleaning', version: 4 } }), resolveOrgProfile({ profile: { id: 'home_builder', version: 1 } })]) {
      expect(enumValues).toContain(newDealProjectType(p))
    }
    expect(read('supabase/migrations/202611300010_project_type_other.sql')).toContain("ADD VALUE IF NOT EXISTS 'other'")
    expect(read('supabase/data-fixes/2026-11-30_retype_non_roofing_deals.sql')).toContain('undo_retype_non_roofing_deals')
  })
  it('a database without the new value: the insert is retried once as roofing, never fails', async () => {
    const calls: string[] = []
    const client = {
      from: (table: string) => {
        if (table === 'orgs') return { select: () => ({ eq: () => ({ single: async () => ({ data: { profile: lawnSettings.profile, features: {}, entitlements: null }, error: null }), maybeSingle: async () => ({ data: { profile: lawnSettings.profile, features: {}, entitlements: null }, error: null }) }) }) }
        return {
          insert: (row: { project_type: string }) => ({
            select: () => ({
              single: async () => {
                calls.push(row.project_type)
                return row.project_type === 'other' ? { data: null, error: { code: '22P02', message: 'invalid input value for enum project_type: "other"' } } : { data: { id: 'o1' }, error: null }
              },
            }),
          }),
        }
      },
    }
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const res = await insertOpportunityRow(client as never, 'org-1', { org_id: 'org-1' })
    expect(res.error).toBeNull()
    expect(calls).toEqual(['other', 'roofing'])
  })
  it('non-roofing deals read as the company trade, roofing as stored', () => {
    expect(dealTypeLabel(lawn, 'roofing')).toBe('Lawn & landscape')
    expect(dealTypeLabel(lawn, 'other')).toBe('Lawn & landscape')
    expect(dealTypeLabel(lawn, 'siding')).toBe('siding')
    expect(dealTypeLabel(roof, 'roofing')).toBe('roofing')
  })
})
