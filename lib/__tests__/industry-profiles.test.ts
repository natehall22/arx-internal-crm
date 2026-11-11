/** @jest-environment node */
import { readFileSync } from 'fs'
import path from 'path'

import {
  BASE_TERMS,
  INDUSTRY_PROFILE_IDS,
  INDUSTRY_PROFILES,
  PROFILE_ONLY_UNITS,
  TERM_KEYS,
  TERM_LABELS,
} from '@/lib/industry-profiles'
import { DEFAULT_ORG_FEATURES, ORG_FEATURE_KEYS, resolveOrgFeatures } from '@/lib/org-features'
import { applyTodayProfile, clientOrgProfile, coerceClientOrgProfile, defaultOrgProfile, resolveOrgProfile, t } from '@/lib/org-profile'
import { planProfileSwitch, profileTradeSeeds } from '@/lib/org-profile-server'
import { NAV_SECTIONS, visibleNav, type NavContext } from '@/lib/nav-config'
import { visibleSettingsGroups } from '@/lib/settings-registry'
import { buildStages, nextAction, type StageInput } from '@/lib/customer-file/stage'
import { TAB_LABELS, tabLabelsFor } from '@/lib/customer-file/access'
import { REPORT_TEMPLATES } from '@/lib/reporting/templates'
import { DEFAULT_ORG_TRADES, cleanTradeLabel, slugForNewTrade, type OrgTrade } from '@/lib/org-trades'
import { planOrgTradesAddOnly } from '@/lib/org-trades-admin'
import { mergeSettingsAt } from '@/lib/org-settings'
import { profileFromEffectivePermissions } from '@/hooks/useOrgFeatures'
import { parseCompanySeedInput } from '@/lib/company-seed'

const read = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8')
const lawnSettings = { profile: { id: 'lawn_landscape', version: 3 } }

const flags = { isOpsOnly: false, canSeeOpsDashboard: true, canSeeJobBoard: true, canSeeInsideSales: true, projectsBarred: false, salesDocBarred: false, customerRecords: true, reports: true, isPayrollAdmin: true, earnsPay: true, payWeek: true }
const owner = (extra: Partial<NavContext> = {}): NavContext => ({ permsReady: true, role: 'owner', fullAccess: true, permissionNames: new Set(), flags, ...extra })

describe('roofing profile = the app as it was (the original company is unchanged)', () => {
  const roof = defaultOrgProfile()

  it('nothing stored → roofing, every feature on, today’s words', () => {
    expect(roof.id).toBe('roofing')
    expect(roof.storedVersion).toBeNull()
    expect(roof.features).toEqual(DEFAULT_ORG_FEATURES)
    expect(roof.terms).toEqual(BASE_TERMS)
    expect(BASE_TERMS).toEqual({ job: 'Job', jobs: 'Jobs', jobBoard: 'Job Board', productionBoard: 'Production Board', inspection: 'Inspection', proposal: 'Proposal', install: 'Install', installed: 'Installed', subs: 'Subcontractors' })
    // An explicit roofing profile is the same thing.
    expect(resolveOrgProfile({ profile: { id: 'roofing', version: 1 } }).terms).toEqual(BASE_TERMS)
  })

  it('feature rule unchanged for settings with no profile: only an explicit false turns a feature off', () => {
    expect(resolveOrgFeatures({})).toEqual(DEFAULT_ORG_FEATURES)
    expect(resolveOrgFeatures({ features: { canvassing: false } }).canvassing).toBe(false)
    expect(resolveOrgFeatures({ canvassing: false }).canvassing).toBe(false)
    expect(resolveOrgFeatures({ features: { canvassing: 'false', insurance: null } })).toEqual(DEFAULT_ORG_FEATURES)
    expect(resolveOrgFeatures({ some_other_setting: 1 })).toEqual(DEFAULT_ORG_FEATURES)
  })

  it('nav: same sections, order and labels with the roofing profile as with none', () => {
    const none = visibleNav(owner())
    const withRoofing = visibleNav(owner({ profile: clientOrgProfile(roof) }))
    expect(withRoofing).toEqual(none)
    expect(none.sections.map((s) => s.label)).toEqual(['Today', 'Pipeline', 'Jobs', 'Customers', 'Money', 'Insights'])
    expect(none.sections.find((s) => s.id === 'jobs')!.children[0]).toEqual({ href: '/ops', label: 'Job Board' })
  })

  it('customer file steps, "Next" button and tab names: today’s exact words', () => {
    const input: StageInput = { inspectionSet: true, hasProposal: false, signed: false, job: null }
    expect(buildStages(input, roof.terms).map((s) => s.label)).toEqual(['Lead', 'Inspection', 'Proposal', 'Signed', 'Scheduled', 'Installed', 'Paid', 'Payroll'])
    expect(buildStages(input, roof.terms)).toEqual(buildStages(input))
    const words = ['lead', 'inspection', 'proposal', 'signed', 'scheduled', 'installed', 'paid', 'payroll'].map((key) =>
      nextAction([{ key, label: key, tab: 'sales', state: 'current' }], false, roof.terms)?.label
    )
    expect(words).toEqual(['Set the inspection', 'Do the inspection', 'Build the proposal', 'Get it signed', 'Schedule the install', 'Mark installed', 'Collect payment', 'Send to payroll'])
    expect(tabLabelsFor(roof.terms)).toEqual(TAB_LABELS)
  })

  it('Today cards and Settings list unchanged', () => {
    const queues = [{ id: 'b', title: 'Jobs to schedule' }, { id: 'a', title: 'Proposals waiting for a signature' }]
    expect(applyTodayProfile(queues, roof.today)).toEqual(queues)
    const args = { canCost: true, canPayroll: true, canSuperuser: true, canWorkAreas: true, canOwner: true, canSuperAdmin: true }
    expect(visibleSettingsGroups({ ...args, terms: roof.terms })).toEqual(visibleSettingsGroups(args))
  })

  it('price book lists are the add-on form’s old lists, in order; all reports offered', () => {
    expect(roof.pricebook.adderCategories).toEqual(['Ventilation', 'Gutters', 'Skylights', 'Chimney', 'Decking', 'Flashing', 'Other'])
    expect(roof.pricebook.units).toEqual([
      { value: 'each', label: 'Each' },
      { value: 'lf', label: 'Linear Foot' },
      { value: 'square', label: 'Square (roof)' },
      { value: 'per_sqft', label: 'Per sq ft (manual quantity)' },
      { value: 'sqft', label: 'Sq ft (from roof — auto)' },
      { value: 'job', label: 'Per Job' },
    ])
    expect(roof.starterReports).toBeNull()
    expect(profileTradeSeeds('roofing').map((x) => x.label)).toEqual(DEFAULT_ORG_TRADES.map((x) => x.label))
  })

  it('board heading default and the client fallback are today’s words', () => {
    expect(t(null, 'productionBoard')).toBe('Production Board')
    expect(profileFromEffectivePermissions(null)).toEqual(clientOrgProfile(roof))
    expect(read('app/ops/OpsClient.tsx')).toContain('{terms.productionBoard}')
  })
})

describe('lawn & landscape profile (Precision Maintenance)', () => {
  const lawn = resolveOrgProfile(lawnSettings)

  it('roof / door-knocking / insurance / incentive features default off; service plans + time clock + hourly billing + customer messages on', () => {
    expect(lawn.id).toBe('lawn_landscape')
    expect(lawn.storedVersion).toBe(3)
    for (const k of ORG_FEATURE_KEYS) expect([k, lawn.features[k]]).toEqual([k, k === 'servicePlans' || k === 'timeTracking' || k === 'hourlyBilling' || k === 'customerMessages' || k === 'customerPortal' || k === 'quoteApproval'])
  })

  it('words, menu order and hidden pages', () => {
    expect(t(lawn, 'proposal')).toBe('Quote')
    expect(t(lawn, 'inspection')).toBe('Estimate visit')
    // Crews are a job's per-trade crews; subcontractors keep their own word (no clash).
    expect(t(lawn, 'subs')).toBe('Subcontractors')
    const nav = visibleNav(owner({ features: lawn.features, profile: clientOrgProfile(lawn) }))
    expect(nav.sections.map((s) => s.id)).toEqual(['today', 'jobs', 'customers', 'pipeline', 'money', 'insights'])
    expect(nav.sections.find((s) => s.id === 'jobs')!.label).toBe('Work')
    const hrefs = nav.sections.flatMap((s) => s.children.map((c) => c.href))
    for (const gone of ['/inside-sales', '/ops/checkups', '/projects', '/sisu']) expect(hrefs).not.toContain(gone)
    expect(nav.canvass).toBe(false)
    expect(nav.sections.find((s) => s.id === 'jobs')!.children[0]).toEqual({ href: '/ops', label: 'Work board' })
  })

  it('customer file speaks lawn', () => {
    const steps = buildStages({ inspectionSet: false, hasProposal: false, signed: false, job: null }, lawn.terms)
    expect(steps.map((s) => s.label)).toEqual(['Lead', 'Estimate visit', 'Quote', 'Signed', 'Scheduled', 'Done', 'Paid', 'Payroll'])
    expect(nextAction(steps, false, lawn.terms)?.label).toBe('Do the estimate visit')
    expect(tabLabelsFor(lawn.terms).job).toBe('Project')
  })

  it('Today: quotes first, renamed; planned cards (not built) are never shown', () => {
    const queues = [
      { id: 'today-appointments', title: "Today's appointments" },
      { id: 'awaiting-payment', title: 'Finished, waiting on payment' },
      { id: 'unsigned-proposals', title: 'Proposals waiting for a signature' },
      { id: 'mystery', title: 'Something new' },
    ]
    expect(applyTodayProfile(queues, lawn.today).map((q) => q.title)).toEqual([
      'Quotes awaiting approval',
      'Finished, not paid yet',
      "Today's estimate visits",
      'Something new',
    ])
    expect(lawn.today.planned).toEqual([])
    expect(lawn.today.order).toContain('unpaid-invoices')
    // Service-plan visit cards (built) lead the lawn Today.
    expect(lawn.today.order.slice(0, 2)).toEqual(['todays-visits', 'skipped-visits'])
  })

  it('price book: per visit / month / sq ft / hour / each; starter reports only', () => {
    expect(lawn.pricebook.units.map((u) => u.value)).toEqual(['visit', 'month', 'per_sqft', 'hour', 'each', 'job'])
    expect(lawn.starterReports).not.toContain('doors-by-rep')
    expect(lawn.starterReports).toContain('ar-aging')
  })

  it('trades: lawn care, landscaping, tractor / land work, clean-up, soft wash / pressure washing', () => {
    expect(profileTradeSeeds('lawn_landscape').map((x) => x.label)).toEqual(['Lawn care', 'Landscaping', 'Tractor / land work', 'Clean-up', 'Soft wash / pressure washing'])
  })
})

describe('company settings override the profile', () => {
  it('a saved switch wins in both directions', () => {
    expect(resolveOrgFeatures({ ...lawnSettings, features: { canvassing: true } }).canvassing).toBe(true)
    expect(resolveOrgFeatures({ ...lawnSettings, features: { canvassing: true } }).insurance).toBe(false)
    expect(resolveOrgFeatures({ profile: { id: 'roofing' }, features: { insurance: false } }).insurance).toBe(false)
    expect(resolveOrgProfile({ ...lawnSettings, features: { stormAlerts: true } }).features.stormAlerts).toBe(true)
  })

  it('an unknown or malformed stored profile falls back to roofing', () => {
    expect(resolveOrgProfile({ profile: { id: 'spaceships' } }).id).toBe('roofing')
    expect(resolveOrgProfile({ profile: 'lawn_landscape' }).id).toBe('roofing')
    expect(resolveOrgFeatures({ profile: { id: 'spaceships' } })).toEqual(DEFAULT_ORG_FEATURES)
  })

  it('the client payload can’t inject words: only the id is trusted, the rest comes from this build', () => {
    const c = coerceClientOrgProfile({ id: 'lawn_landscape', terms: { job: '<script>' }, nav: { order: [], hidden: ['/today'] } })
    expect(c.terms.job).toBe('Project')
    expect(c.nav.hidden).not.toContain('/today')
    expect(coerceClientOrgProfile({ id: 'nope' }).id).toBe('roofing')
  })

  it('only the profile writer can set settings.profile (top-level saves refuse it; generic save strips it)', async () => {
    const { mergeOrgSettings } = jest.requireActual('@/lib/org-settings') as typeof import('@/lib/org-settings')
    const rpc = jest.fn()
    const res = await mergeOrgSettings({ rpc } as never, 'org-1', { profile: { id: 'lawn_landscape' } })
    expect(res.error).toMatch(/path \[profile\]/)
    expect(rpc).not.toHaveBeenCalled()
    expect(mergeSettingsAt({ a: 1 }, ['profile'], { id: 'lawn_landscape', version: 1 })).toEqual({ a: 1, profile: { id: 'lawn_landscape', version: 1 } })
    expect(read('app/api/admin/settings/route.ts')).toMatch(/profile: _profile, \.\.\.rest/)
  })
})

describe('switching profile', () => {
  const trade = (slug: string, label: string, sort: number, active = true): OrgTrade => ({ slug, label, sort, active, matchKeywords: null })

  it('roofing → lawn: says what changes; trades are add-only (standard ones kept, never turned off)', () => {
    const plan = planProfileSwitch({ features: {} }, [...DEFAULT_ORG_TRADES], 'lawn_landscape')
    expect(plan.from.id).toBe('roofing')
    // Roofing: every switch on except the default-off modules (service plans, time clock); lawn: the reverse.
    expect(plan.features.map((f) => [f.key, f.now, f.after])).toEqual(ORG_FEATURE_KEYS.filter((k) => k !== 'onlinePayments' && k !== 'aiConnector' && k !== 'projectTools' && k !== 'quickbooks' && k !== 'aiConnectorWrites').map((k) => (k === 'servicePlans' || k === 'timeTracking' || k === 'hourlyBilling' || k === 'customerMessages' || k === 'customerPortal' || k === 'quoteApproval' ? [k, false, true] : [k, true, false])))
    expect(plan.trades).toEqual({
      add: ['Lawn care', 'Landscaping', 'Tractor / land work', 'Clean-up', 'Soft wash / pressure washing'],
      turnOn: [],
      keep: ['Roofing', 'Gutters', 'Siding', 'Windows', 'Other'],
    })
    expect(plan.words.find((w) => w.key === 'proposal')).toEqual({ key: 'proposal', now: 'Proposal', after: 'Quote' })
    expect(plan.noChange).toBe(false)
  })

  it('own switches are kept (and shown) unless the owner asks for the profile’s', () => {
    const settings = { features: { canvassing: true } }
    const keep = planProfileSwitch(settings, [], 'lawn_landscape')
    expect(keep.features.find((f) => f.key === 'canvassing')).toEqual({ key: 'canvassing', label: expect.any(String), now: true, after: true, keptByOwnSwitch: true })
    const reset = planProfileSwitch(settings, [], 'lawn_landscape', { resetFeatures: true })
    expect(reset.features.find((f) => f.key === 'canvassing')).toMatchObject({ now: true, after: false, keptByOwnSwitch: false })
  })

  it('switching back to roofing turns trades back on and restores the words', () => {
    const lawnTrades = [trade('roofing', 'Roofing', 10, false), trade('lawn_care', 'Lawn care', 60)]
    const plan = planProfileSwitch({ ...lawnSettings, features: {} }, lawnTrades, 'roofing')
    expect(plan.trades?.turnOn).toEqual(['Roofing'])
    expect(plan.trades?.add).toEqual(['Gutters', 'Siding', 'Windows', 'Other'])
    expect(plan.trades?.keep).toEqual(['Lawn care'])
    expect(plan.words.find((w) => w.key === 'job')).toEqual({ key: 'job', now: 'Project', after: 'Job' })
  })

  it('same profile, same version, nothing to add → no change; trades table missing → trades left alone', () => {
    const lawnTrades = profileTradeSeeds('lawn_landscape').map((s, i) => trade(`t${i}`, s.label, (i + 1) * 10))
    expect(planProfileSwitch(lawnSettings, lawnTrades, 'lawn_landscape').noChange).toBe(true)
    expect(planProfileSwitch(lawnSettings, null, 'lawn_landscape').trades).toBeNull()
    // an older stored version is re-applied (records the new version)
    expect(planProfileSwitch({ profile: { id: 'lawn_landscape', version: 0 } }, lawnTrades, 'lawn_landscape').noChange).toBe(false)
  })

  it('planOrgTradesAddOnly: an org with no rows gets the standard list first; nothing is ever deactivated or renamed', () => {
    const plan = planOrgTradesAddOnly([], profileTradeSeeds('lawn_landscape'))
    expect(plan.insert.slice(0, 5).map((t) => t.slug)).toEqual(DEFAULT_ORG_TRADES.map((t) => t.slug))
    expect(plan.insert.slice(5).map((t) => [t.slug, t.sort])).toEqual([
      ['lawn_care', 60],
      ['landscaping', 70],
      ['tractor_land_work', 80],
      ['clean_up', 90],
      ['soft_wash_pressure_washing', 100],
    ])
    const again = planOrgTradesAddOnly([trade('landscaping', 'LANDSCAPING', 10, false), trade('roofing', 'Roofing', 20)], profileTradeSeeds('lawn_landscape'))
    expect(again.update).toEqual([{ slug: 'landscaping', set: { active: true } }])
    expect(again.deactivate).toEqual([])
    expect(again.insert.map((t) => t.slug)).not.toContain('landscaping')
  })
})

describe('definitions stay wired to real things (parity)', () => {
  const todaySrc = read('lib/today.ts')
  const knownQueueIds = new Set(Array.from(todaySrc.matchAll(/(?:id: |Queue\()'([a-z-]+)'/g)).map((m) => m[1]))

  it.each(INDUSTRY_PROFILE_IDS)('%s', (id) => {
    const p = INDUSTRY_PROFILES[id]
    // Today: titles are real lib/today.ts titles; order/hidden are real queue ids; planned ids are not built yet.
    for (const text of Object.keys(p.today.texts)) expect([text, todaySrc.includes(text)]).toEqual([text, true])
    // "Crews" means a job's trade crews: no profile may call subcontractors that.
    expect(resolveOrgProfile({ profile: { id } }).terms.subs.toLowerCase()).not.toBe('crews')
    // Service-type units are only roof-measured ones (the builder prices them from squares).
    for (const u of p.pricebook.serviceTypeUnits) expect(['square', 'sqft', 'lf']).toContain(u.value)
    for (const q of [...p.today.order, ...p.today.hidden]) expect([q, knownQueueIds.has(q)]).toEqual([q, true])
    for (const q of p.today.planned) expect([q.id, knownQueueIds.has(q.id)]).toEqual([q.id, false])
    // Nav: hidden pages exist; order lists every section once.
    const hrefs = new Set(NAV_SECTIONS.flatMap((s) => s.children.map((c) => c.href)))
    for (const h of p.nav.hidden) expect([h, hrefs.has(h)]).toEqual([h, true])
    expect([...p.nav.order].sort()).toEqual(NAV_SECTIONS.map((s) => s.id).sort())
    // Reports: every starter key is a template.
    for (const k of p.starterReports ?? []) expect([k, REPORT_TEMPLATES.some((r) => r.key === k)]).toEqual([k, true])
    // Units: in the prod enum (2026-11-10) or added by migration 202611100090.
    const enumValues = ['square', 'each', 'lf', 'sheet', 'job', 'percent', 'per_sqft', 'sqft', ...PROFILE_ONLY_UNITS]
    for (const u of p.pricebook.units) expect([u.value, enumValues.includes(u.value)]).toEqual([u.value, true])
    expect(p.pricebook.units.some((u) => u.value === 'each')).toBe(true) // the add-on form's default
    expect(p.pricebook.adderCategories).toContain('Other') // the add-on form's default category
    // Trades: valid labels with usable slugs and keyword patterns.
    for (const tr of p.trades ?? []) {
      expect(cleanTradeLabel(tr.label)).toBe(tr.label)
      expect(slugForNewTrade(tr.label, [])).toBeTruthy()
      for (const k of tr.matchKeywords ?? []) expect(() => new RegExp(k, 'i')).not.toThrow()
    }
    // Words: complete map after merge.
    expect(Object.keys(resolveOrgProfile({ profile: { id } }).terms).sort()).toEqual([...TERM_KEYS].sort())
  })

  it('the migration adds exactly the profile-only units', () => {
    const sql = read('supabase/migrations/202611100090_pricebook_units_service.sql')
    for (const u of PROFILE_ONLY_UNITS) expect(sql).toContain(`ALTER TYPE unit ADD VALUE IF NOT EXISTS '${u}'`)
    expect(Object.keys(TERM_LABELS).sort()).toEqual([...TERM_KEYS].sort())
  })
})

describe('seed', () => {
  const base = { org: { name: 'X', phone: '1', email: 'a@b.co', address: 'y' }, owner: { email: 'o@b.co', fullName: 'O' } }
  it('accepts a profile id, refuses an unknown one, leaves it null when missing', () => {
    const ok = parseCompanySeedInput({ ...base, profile: 'lawn_landscape' })
    expect(ok.ok && ok.input.profile).toBe('lawn_landscape')
    const none = parseCompanySeedInput(base)
    expect(none.ok && none.input.profile).toBeNull()
    const bad = parseCompanySeedInput({ ...base, profile: 'lawn' })
    expect(bad.ok ? '' : bad.errors.join()).toContain('profile must be one of')
  })
})

describe('review fixes', () => {
  it('unknown stored profile: runs on roofing defaults, flagged, and switching is allowed (never "no change")', () => {
    const odd = resolveOrgProfile({ profile: { id: 'pool_service', version: 1 } })
    expect(odd.id).toBe('roofing')
    expect(odd.unknownStoredId).toBe('pool_service')
    expect(odd.storedVersion).toBeNull()
    const plan = planProfileSwitch({ profile: { id: 'pool_service', version: 1 }, features: {} }, [...DEFAULT_ORG_TRADES], 'roofing')
    expect(plan.noChange).toBe(false)
    expect(plan.from.unknownStoredId).toBe('pool_service')
    expect(plan.other.join()).toContain('Replaces the unknown profile "pool_service"')
    expect(resolveOrgProfile({ profile: 'lawn_landscape' }).unknownStoredId).toBe('"lawn_landscape"')
    expect(resolveOrgProfile({}).unknownStoredId).toBeNull()
    expect(resolveOrgProfile(lawnSettings).unknownStoredId).toBeNull()
  })

  it('Today rows and empty texts follow the profile; roofing rows are untouched', () => {
    const q = {
      id: 'jobs-to-schedule',
      title: 'Jobs to schedule',
      count: 1,
      empty: 'Every sold job has an install date.',
      items: [{ id: 'j', title: 'Job 26-0012', detail: '1 Main St · install 2026-11-12', href: '/ops/jobs/j', ref: 'Job 26-0012', note: 'install Nov 12' }],
    }
    const roof = defaultOrgProfile()
    expect(applyTodayProfile([q], roof.today, roof.terms)[0]).toBe(q)
    const lawn = resolveOrgProfile(lawnSettings)
    const out = applyTodayProfile([q], lawn.today, lawn.terms)[0]
    expect(out.title).toBe('Projects to schedule')
    expect(out.empty).toBe('Every approved project has a date.')
    expect(out.items[0]).toMatchObject({ title: 'Project 26-0012', ref: 'Project 26-0012', detail: '1 Main St · work 2026-11-12', note: 'work Nov 12', href: '/ops/jobs/j' })
    // "Jobless" text and addresses that merely contain the words are not rewritten
    const other = applyTodayProfile([{ ...q, items: [{ ...q.items[0], title: 'Jobson Rd', detail: '9 Install Way' }] }], lawn.today, lawn.terms)[0]
    expect(other.items[0].title).toBe('Jobson Rd')
    expect(other.items[0].detail).toBe('9 Install Way')
  })

  it('a service unit the database lacks gets a clear message; other errors pass through', () => {
    const { serviceUnitNotReadyMessage } = jest.requireActual('@/lib/industry-profiles') as typeof import('@/lib/industry-profiles')
    expect(serviceUnitNotReadyMessage({ code: '22P02', message: 'invalid input value for enum unit: "visit"' }, 'visit')).toContain('migration 202611100090')
    expect(serviceUnitNotReadyMessage({ code: '22P02' }, 'each')).toBeNull()
    expect(serviceUnitNotReadyMessage({ code: '23505', message: 'duplicate' }, 'visit')).toBeNull()
    expect(serviceUnitNotReadyMessage(null, 'visit')).toBeNull()
    expect(read('app/api/admin/proposals/route.ts').match(/serviceUnitNotReadyMessage\(/g)).toHaveLength(2)
  })

  it('Settings → Pricing units come from the profile; roofing = the old three, same words and order', () => {
    expect(defaultOrgProfile().pricebook.serviceTypeUnits).toEqual([
      { value: 'square', label: 'Per Square', desc: '100 sq ft' },
      { value: 'sqft', label: 'Per Sq Ft', desc: 'square foot' },
      { value: 'lf', label: 'Per Linear Ft', desc: 'linear foot' },
    ])
    const page = read('app/admin/pricing/page.tsx')
    expect(page).toContain('useOrgProfile().pricebook.serviceTypeUnits')
    expect(page).not.toContain("{ value: 'square', label: 'Per Square'")
  })

  it('proposal builder: visit / month / hour ask for a quantity and read "per visit"', () => {
    const b = read('app/proposals/builder/page.tsx')
    const needs = b.slice(b.indexOf('const needsQuantityInput'), b.indexOf('const needsQuantityInput') + 800)
    for (const u of ["'visit'", "'month'", "'hour'"]) expect(needs).toContain(u)
    expect(b).not.toMatch(/per \{getUnitLabel\(/)
  })

  it('board, job page and subs page use the profile words (roofing keeps today’s text)', () => {
    expect(read('app/ops/OpsClient.tsx')).toContain('Track each {terms.job.toLowerCase()} from sold through payment')
    // server pages hand the resolved profile down, so the words are right on first paint
    expect(read('app/ops/page.tsx')).toContain('orgProfile={clientOrgProfile(await loadOrgProfile(admin, profile.org_id))}')
    expect(read('app/ops/jobs/[id]/JobView.tsx')).toContain('orgProfile={clientOrgProfile(orgProfile)}')
    expect(read('app/layout.tsx')).not.toMatch(/loadOrgProfile|getAuthContext/) // the root layout stays static-friendly
    expect(read('app/ops/jobs/[id]/JobDetailClient.tsx')).toContain('← Back to {orgTerms.productionBoard}')
    expect(read('app/admin/subs/page.tsx')).toContain("subsTerm === BASE_TERMS.subs ? 'Sub-Contractors' : subsTerm")
    expect(BASE_TERMS.job.toLowerCase()).toBe('job')
  })
})
