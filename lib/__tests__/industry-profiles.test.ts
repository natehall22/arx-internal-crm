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
import { ALL_FEATURES_ON, ORG_FEATURE_KEYS, resolveOrgFeatures } from '@/lib/org-features'
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
const lawnSettings = { profile: { id: 'lawn_landscape', version: 1 } }

const flags = { isOpsOnly: false, canSeeOpsDashboard: true, canSeeJobBoard: true, canSeeInsideSales: true, projectsBarred: false, salesDocBarred: false, customerRecords: true, reports: true, isPayrollAdmin: true, earnsPay: true, payWeek: true }
const owner = (extra: Partial<NavContext> = {}): NavContext => ({ permsReady: true, role: 'owner', fullAccess: true, permissionNames: new Set(), flags, ...extra })

describe('roofing profile = the app as it was (the original company is unchanged)', () => {
  const roof = defaultOrgProfile()

  it('nothing stored → roofing, every feature on, today’s words', () => {
    expect(roof.id).toBe('roofing')
    expect(roof.storedVersion).toBeNull()
    expect(roof.features).toEqual(ALL_FEATURES_ON)
    expect(roof.terms).toEqual(BASE_TERMS)
    expect(BASE_TERMS).toEqual({ job: 'Job', jobs: 'Jobs', jobBoard: 'Job Board', productionBoard: 'Production Board', inspection: 'Inspection', proposal: 'Proposal', install: 'Install', installed: 'Installed', subs: 'Subcontractors' })
    // An explicit roofing profile is the same thing.
    expect(resolveOrgProfile({ profile: { id: 'roofing', version: 1 } }).terms).toEqual(BASE_TERMS)
  })

  it('feature rule unchanged for settings with no profile: only an explicit false turns a feature off', () => {
    expect(resolveOrgFeatures({})).toEqual(ALL_FEATURES_ON)
    expect(resolveOrgFeatures({ features: { canvassing: false } }).canvassing).toBe(false)
    expect(resolveOrgFeatures({ canvassing: false }).canvassing).toBe(false)
    expect(resolveOrgFeatures({ features: { canvassing: 'false', insurance: null } })).toEqual(ALL_FEATURES_ON)
    expect(resolveOrgFeatures({ some_other_setting: 1 })).toEqual(ALL_FEATURES_ON)
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
    expect(read('app/ops/OpsClient.tsx')).toContain('boardTitle = BASE_TERMS.productionBoard')
  })
})

describe('lawn & landscape profile (Precision Maintenance)', () => {
  const lawn = resolveOrgProfile(lawnSettings)

  it('roof / door-knocking / insurance / incentive features default off', () => {
    expect(lawn.id).toBe('lawn_landscape')
    expect(lawn.storedVersion).toBe(1)
    for (const k of ORG_FEATURE_KEYS) expect([k, lawn.features[k]]).toEqual([k, false])
  })

  it('words, menu order and hidden pages', () => {
    expect(t(lawn, 'proposal')).toBe('Quote')
    expect(t(lawn, 'inspection')).toBe('Estimate visit')
    expect(t(lawn, 'subs')).toBe('Crews')
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
    expect(lawn.today.planned.map((p) => p.id)).toEqual(['todays-visits', 'skipped-visits', 'unpaid-invoices'])
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
    expect(resolveOrgFeatures({ profile: { id: 'spaceships' } })).toEqual(ALL_FEATURES_ON)
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
    expect(plan.features.map((f) => [f.key, f.now, f.after])).toEqual(ORG_FEATURE_KEYS.map((k) => [k, true, false]))
    expect(plan.trades).toEqual({
      add: ['Lawn care', 'Landscaping', 'Tractor / land work', 'Clean-up', 'Soft wash / pressure washing'],
      turnOn: [],
      keep: ['Roofing', 'Gutters', 'Siding', 'Windows', 'Other'],
    })
    expect(plan.words.find((w) => w.key === 'proposal')).toEqual({ key: 'proposal', now: 'Proposal', after: 'Quote' })
    expect(plan.other.join('\n')).toContain("Today's visits and routes (needs service plans + visits (Phase 2))")
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
    for (const title of Object.keys(p.today.titles)) expect(todaySrc).toContain(JSON.stringify(title).slice(1, -1).replace(/\\"/g, '"'))
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
