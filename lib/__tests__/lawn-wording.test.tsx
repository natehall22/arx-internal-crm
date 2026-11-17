/** @jest-environment jsdom */
import { readFileSync } from 'fs'
import path from 'path'
import { render, waitFor } from '@testing-library/react'

import AppointmentCardsClient from '@/app/admin/print-kit/appointment-cards/AppointmentCardsClient'
import BonusApprovalClient from '@/app/admin/bonuses/BonusApprovalClient'
import { resetOrgFeaturesCacheForTests } from '@/hooks/useOrgFeatures'
import { bonusIntro, bonusLinkLabel } from '@/lib/bonus-programs'
import TimeClockSettingsCard from '@/components/time/TimeClockSettingsCard'
import { DEFAULT_TIME_TRACKING_SETTINGS } from '@/lib/time-tracking'
import { composeWeek } from '@/lib/payroll-pay-week'
import { resolveHourlyRate } from '@/lib/payroll-hourly-rate'
import { computeHourlyEarnings } from '@/lib/weekly-payroll/hourly-earnings'
import { getCompPlanPayabilityWarnings, hasBlockingCompPlanWarning } from '@/lib/comp-plan-payability'
import { DEFAULT_INSPECTION_OUTCOMES } from '@/lib/inspection-outcomes'
import { creditLaneWords } from '@/lib/sale-credit-words'
import { dispositionLabel, inspectionsSetLabel, profileOutcomeRows, resolveOrgProfile, sitsLabel } from '@/lib/org-profile'
import { doorDropAvailable, printKitBrand } from '@/lib/print-kit'
import { SETTINGS_GROUPS, visibleSettingsGroups } from '@/lib/settings-registry'

jest.mock('@/components/Nav', () => ({ __esModule: true, default: () => <nav /> }))

const read = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8')
const roof = resolveOrgProfile({})
const lawn = resolveOrgProfile({ profile: { id: 'lawn_landscape', version: 7 } })
const cleaning = resolveOrgProfile({ profile: { id: 'exterior_cleaning', version: 4 } })

/** Words a lawn company must never read where the screen is gated for it. */
const ROOFING_ONLY = /\b444\b|sisu|setter|roof|canvass|\bARX\b|squares?\b|ventilation|skylight|dealer fee|lender|round-robin|door-drop|door drop|closers?\b/i

const settingsFor = (p: typeof lawn) =>
  visibleSettingsGroups({
    features: p.features,
    terms: p.terms,
    profileId: p.id,
    hiddenHrefs: [...p.nav.hidden, ...p.settingsHidden],
    text: p.settingsText,
    canCost: true,
    canPayroll: true,
    canSuperuser: true,
    canWorkAreas: true,
    canOwner: true,
    canSuperAdmin: true,
  })

describe('lawn company never reads roofing / ARX wording where gated', () => {
  it('Money → Bonuses intro and the payroll link', () => {
    expect(bonusIntro(lawn.features)).toBe('Review and approve every bonus line before payroll locks.')
    expect(bonusLinkLabel(lawn.features)).toBe('Bonuses')
    expect(bonusIntro(lawn.features) + bonusLinkLabel(lawn.features)).not.toMatch(ROOFING_ONLY)
  })

  it('the Bonuses screen renders without 444 / Sisu / setter ramp for lawn', () => {
    resetOrgFeaturesCacheForTests()
    global.fetch = jest.fn(() => new Promise(() => {})) as never
    const { container } = render(<BonusApprovalClient isFullAdmin features={lawn.features} />)
    expect(container.textContent).toContain('Review and approve every bonus line before payroll locks.')
    expect(container.textContent).not.toMatch(ROOFING_ONLY)
  })

  it('Settings: every entry a lawn owner sees (title + description) is free of roofing wording', () => {
    const seen = settingsFor(lawn).flatMap((g) => [g.title, ...g.items.flatMap((i) => [i.title, i.description])])
    expect(seen.filter((t) => ROOFING_ONLY.test(t))).toEqual([])
    const hrefs = settingsFor(lawn).flatMap((g) => g.items.map((i) => i.href))
    for (const h of ['/admin/print-kit', '/admin/door-drop', '/admin/financing-programs', '/admin/sisu/incentives', '/admin/inspection-feedback']) expect(hrefs).not.toContain(h)
  })


  it('Print Kit: another company’s cards carry its own name and logo, never ARX', () => {
    for (const p of [lawn, cleaning]) {
      const brand = printKitBrand(p, { name: 'Precision Maintenance', logoHref: '/api/org-logo/o1?v=1' })
      const { container } = render(<AppointmentCardsClient brand={brand} />)
      expect(container.textContent).toContain('Precision Maintenance')
      expect(container.textContent).not.toMatch(/\bARX\b|roof|Alex Nunez|704-437/i)
      const srcs = Array.from(container.querySelectorAll('img')).map((i) => i.getAttribute('src'))
      expect(srcs.every((s) => s === '/api/org-logo/o1?v=1')).toBe(true)
    }
    expect(doorDropAvailable(lawn)).toBe(false)
    expect(doorDropAvailable(cleaning)).toBe(false)
  })
})

describe('lawn: leads, dashboard, sale credit, comp plans, time clock', () => {
  it('estimate-visit outcomes: no roof wording, no Insurance follow-up offered; ids unchanged', () => {
    const rows = profileOutcomeRows(lawn, null, DEFAULT_INSPECTION_OUTCOMES)
    expect(rows.map((r) => r.id)).toEqual(DEFAULT_INSPECTION_OUTCOMES.map((r) => r.id))
    const active = rows.filter((r) => r.active)
    expect(active.find((r) => r.id === 'insurance_follow_up')).toBeUndefined()
    expect(active.map((r) => `${r.label} ${r.description}`).filter((t) => /roof|insurance|claim/i.test(t))).toEqual([])
    // A company's own saved list always wins, untouched.
    const own = [{ ...DEFAULT_INSPECTION_OUTCOMES[0], label: 'Mine' }]
    expect(profileOutcomeRows(lawn, own, DEFAULT_INSPECTION_OUTCOMES)).toEqual(own)
  })

  it('dispositions and the leads screen: canvass fields only with door knocking; Salesperson, not Setter/Closer', () => {
    expect(dispositionLabel(lawn, 'bad_roof', 'Bad roof (no contact)')).not.toMatch(/roof/i)
    const src = read('app/leads/[id]/LeadView.tsx')
    expect(src).toContain('orgProfile.features.canvassing')
    expect(src).toContain("orgProfile.features.canvassing ? 'Closer' : 'Salesperson'")
    expect(src).toContain("t(orgProfile, 'inspection')")
  })

  it('Opportunities: Project Type filter is roofing-only (API flag), insurance/knockback filters follow the switches', () => {
    expect(read('app/api/opportunities/route.ts')).toContain("orgProfile.id === 'roofing'")
    const page = read('app/opportunities/page.tsx')
    expect(page).toContain('showProjectType &&')
    expect(page).toContain('orgFeaturesNow.canvassing &&')
  })

  it('Dashboard: no doors tiles, setter stats or goal bars without canvassing; first paint from the server; own words for sits', () => {
    expect(inspectionsSetLabel(lawn)).not.toMatch(/inspection/i)
    expect(sitsLabel(lawn)).not.toBe('Sits')
    const src = read('app/dashboard/DashboardClient.tsx')
    expect((src.match(/\{orgFeatures\.canvassing && \(/g) ?? []).length).toBeGreaterThanOrEqual(3)
    expect(src).toContain('orgFeatures.canvassing && showSetterStack')
    expect(src).toContain('useOrgProfile(serverOrgProfile)')
    expect(read('app/dashboard/page.tsx')).toContain('orgProfile={clientOrgProfile(')
  })

  it('sale credit: one Salesperson lane without canvassing, Setter + Closer with it', () => {
    expect(creditLaneWords(false)).toMatchObject({ showSetter: false, closer: 'Salesperson' })
    expect(creditLaneWords(true)).toMatchObject({ showSetter: true, closer: 'Closer', pickCloser: 'Pick the closer' })
  })

  it('comp plans: hourly form is a plain note, no weekly minimum, rate required; lanes and units follow the switches', () => {
    const src = read('app/admin/comp-plans/page.tsx')
    expect(src).toContain('Pays clock hours × this rate (overtime per your time settings). No commission on sales.')
    expect(src).toContain("planForm.plan_type !== 'hourly' && (")
    expect(src).toContain('Enter the hourly rate.')
    expect(src).toContain('{setterLane && <option value="setter">Setter production</option>}')
    expect(src).toContain('orgFeatures.squaresPricing')
    expect(getCompPlanPayabilityWarnings({ plan_type: 'hourly', hourly_rate: '23' })).toEqual([])
    expect(hasBlockingCompPlanWarning(getCompPlanPayabilityWarnings({ plan_type: 'hourly', hourly_rate: '' }))).toBe(true)
  })

  it('time clock: no Setters line without canvassing', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ settings: DEFAULT_TIME_TRACKING_SETTINGS, roles: ['sales_rep'] }) })) as never
    const { container } = render(<TimeClockSettingsCard canvassing={false} />)
    await waitFor(() => expect(container.textContent).toContain('Crew members always can.'))
    expect(container.textContent).not.toMatch(/setter/i)
  })

  it('setter ramp and the legacy inspection-commission card are gated', () => {
    expect(read('app/admin/sisu/setter-ramp/page.tsx')).toContain('!features.incentives && !features.canvassing')
    expect(read('app/admin/payroll/LegacyPayrollPage.tsx')).toContain('<InspectionCommissionRateCard canvassing={features.canvassing} />')
  })
})

describe('roofing / ARX copy is unchanged', () => {
  it('bonuses intro and link keep today’s words', () => {
    expect(bonusIntro(roof.features)).toBe('Review and approve every bonus line before payroll locks: Sisu 444, setter ramp and manual bonuses.')
    expect(bonusLinkLabel(roof.features)).toBe('Bonuses (444, setter ramp, manual)')
  })

  it('Settings: roofing sees every entry with the registry’s own text, nothing hidden or reworded', () => {
    const all = SETTINGS_GROUPS.flatMap((g) => g.items)
    const seen = settingsFor(roof).flatMap((g) => g.items)
    for (const i of seen) expect(i.description).toBe(all.find((a) => a.href === i.href)?.description)
    const hrefs = seen.map((i) => i.href)
    for (const h of ['/admin/print-kit', '/admin/door-drop', '/admin/financing-programs', '/admin/sisu/incentives', '/admin/inspection-feedback', '/admin/pricing', '/admin/proposals', '/admin/teams']) expect(hrefs).toContain(h)
    expect(seen.find((i) => i.href === '/admin/pricing')?.description).toBe('Price per square, dump costs, overhead and pricebook items')
    expect(seen.find((i) => i.href === '/admin/proposals')?.description).toBe('Ventilation, gutters, skylights, price visibility, PDF templates')
    expect(roof.nav.hidden).toEqual([])
    expect(roof.settingsHidden).toEqual([])
    expect(roof.settingsText).toEqual({})
  })

  it('Print Kit: the ARX appointment card prints exactly as before', () => {
    const brand = printKitBrand(roof, { name: 'Anything', logoHref: '/x' })
    const { container } = render(<AppointmentCardsClient brand={brand} />)
    expect(container.textContent).toContain('ARX Roofing & Exteriors')
    expect(container.textContent).toContain('Free Inspection')
    expect(container.textContent).toContain('Roofing Specialist')
    expect(container.textContent).toContain('Alex Nunez')
    expect(Array.from(container.querySelectorAll('img')).every((i) => i.getAttribute('src') === '/brand/arx-shield.png')).toBe(true)
    expect(doorDropAvailable(roof)).toBe(true)
  })

  it('roofing: outcomes, labels and lanes are the built-ins', () => {
    expect(profileOutcomeRows(roof, null, DEFAULT_INSPECTION_OUTCOMES)).toEqual(DEFAULT_INSPECTION_OUTCOMES)
    expect(dispositionLabel(roof, 'bad_roof', 'Bad roof (no contact)')).toBe('Bad roof (no contact)')
    expect(inspectionsSetLabel(roof)).toBe('Inspections Set')
    expect(sitsLabel(roof)).toBe('Sits')
  })
})

describe('an hourly plan pays hours × rate in the pay week (the lawn crew path)', () => {
  it('plan hourly_rate → clock hours → earnings → the pay week line and total', () => {
    const plan = { plan_type: 'hourly', hourly_rate: 23 } as never
    const rate = resolveHourlyRate({ hourlyRateOverride: null, compPlan: plan })
    expect(rate).toBe(23)
    const earned = computeHourlyEarnings({ regularHours: 40, overtimeHours: 5, hourlyRate: rate! }).total
    expect(earned).toBe(40 * 23 + 5 * 23 * 1.5)
    const { people } = composeWeek({
      rows: [],
      jobs: new Map(),
      names: new Map([['u1', { name: 'Crew Lead', role: 'sales_rep' }]]) as never,
      hours: [{ user_id: 'u1', full_name: 'Crew Lead', role: 'sales_rep', plan_name: 'Hourly', plan_type: 'hourly', hourly_rate: 23, regular_hours: 40, overtime_hours: 5, hourly_earnings: earned, notes: null, has_entry: true }],
      units: new Map(),
      bonuses: [],
      adjustments: [],
    })
    expect(people[0].total).toBe(earned)
    expect(people[0].lines.map((l) => l.kind)).toEqual(['Hourly'])
    expect(people[0].hours).toEqual({ regular: 40, overtime: 5 })
  })
  it('a person override wins over the plan rate', () => {
    expect(resolveHourlyRate({ hourlyRateOverride: 30, compPlan: { plan_type: 'hourly', hourly_rate: 23 } as never })).toBe(30)
  })
})
