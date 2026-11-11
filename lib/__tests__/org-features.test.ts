/** @jest-environment node */
import {
  DEFAULT_ORG_FEATURES,
  ORG_FEATURE_KEYS,
  coerceOrgFeatures,
  insuranceFieldsSetInPatch,
  loadOrgFeatures,
  parseOrgFeaturesPatch,
  reportDatasetHidden,
  resolveOrgFeatures,
} from '@/lib/org-features'
import { visibleNav, type NavContext } from '@/lib/nav-config'
import { visibleSettingsGroups } from '@/lib/settings-registry'
import { featuresFromEffectivePermissions } from '@/hooks/useOrgFeatures'
import { insideSalesFeatureTabs } from '@/lib/inside-sales-follow-up'

let storedFeatures: unknown = undefined
let readError: { message: string } | null = null
let reads = 0
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => (reads++, readError ? { data: null, error: readError } : { data: { features: storedFeatures }, error: null }),
      }
      return q
    },
  }),
}))

import { orgFeatureChecker, orgFeatureOffResponse } from '@/lib/org-features-server'

beforeEach(() => {
  storedFeatures = undefined
  readError = null
  reads = 0
})

describe('resolveOrgFeatures (pure)', () => {
  it('nothing stored → every feature on (the original company is unchanged with zero data changes)', () => {
    expect(resolveOrgFeatures(undefined)).toEqual(DEFAULT_ORG_FEATURES)
    expect(resolveOrgFeatures(null)).toEqual(DEFAULT_ORG_FEATURES)
    expect(resolveOrgFeatures({})).toEqual(DEFAULT_ORG_FEATURES)
    expect(resolveOrgFeatures({ pricing: { p: 1 }, brand: { shortName: 'X' } })).toEqual(DEFAULT_ORG_FEATURES)
    // Every original feature is ON; only modules the original company never had default OFF.
    expect(ORG_FEATURE_KEYS.filter((k) => !DEFAULT_ORG_FEATURES[k])).toEqual(['servicePlans', 'timeTracking', 'onlinePayments'])
  })
  it('a default-OFF feature (service plans) turns on only with an explicit true', () => {
    expect(resolveOrgFeatures({ features: { servicePlans: true } }).servicePlans).toBe(true)
    expect(resolveOrgFeatures({ features: { servicePlans: 'true' } }).servicePlans).toBe(false)
    expect(resolveOrgFeatures({ features: { servicePlans: false } }).servicePlans).toBe(false)
    expect(coerceOrgFeatures({ servicePlans: true }).servicePlans).toBe(true)
    expect(coerceOrgFeatures({}).servicePlans).toBe(false)
  })
  it('only an explicit false turns a feature off; junk values and unknown keys are ignored', () => {
    const f = resolveOrgFeatures({ features: { canvassing: false, insurance: 'false', roofMeasure: 0, incentives: null, bogus: false } })
    expect(f).toEqual({ ...DEFAULT_ORG_FEATURES, canvassing: false })
  })
  it('accepts the whole settings object or the features object itself', () => {
    expect(resolveOrgFeatures({ features: { squaresPricing: false } }).squaresPricing).toBe(false)
    expect(resolveOrgFeatures({ squaresPricing: false }).squaresPricing).toBe(false)
    expect(resolveOrgFeatures({ features: [false] })).toEqual(DEFAULT_ORG_FEATURES)
  })
  it('wire coercion: a missing or partial map fills in ON', () => {
    expect(coerceOrgFeatures(undefined)).toEqual(DEFAULT_ORG_FEATURES)
    expect(coerceOrgFeatures({ incentives: false })).toEqual({ ...DEFAULT_ORG_FEATURES, incentives: false })
    expect(featuresFromEffectivePermissions({ flags: { payWeek: true } })).toEqual(DEFAULT_ORG_FEATURES)
    expect(featuresFromEffectivePermissions({ flags: { features: { insurance: false } } }).insurance).toBe(false)
    expect(featuresFromEffectivePermissions(null)).toEqual(DEFAULT_ORG_FEATURES)
  })
})

describe('parseOrgFeaturesPatch', () => {
  it('takes known features with true/false only', () => {
    expect(parseOrgFeaturesPatch({ features: { canvassing: false, insurance: true } })).toEqual({ set: { canvassing: false, insurance: true } })
    expect(parseOrgFeaturesPatch({ features: { canvassing: 'off' } })).toHaveProperty('error')
    expect(parseOrgFeaturesPatch({ features: { brand: false } })).toEqual({ error: 'Unknown feature: brand' })
    expect(parseOrgFeaturesPatch({ features: {} })).toEqual({ error: 'Nothing to save' })
    expect(parseOrgFeaturesPatch(null)).toEqual({ error: 'Nothing to save' })
  })
})

describe('insuranceFieldsSetInPatch', () => {
  it('flags setting claim data or job_source insurance; clearing and retail are always allowed', () => {
    expect(insuranceFieldsSetInPatch({ job_source: 'insurance' })).toEqual(['job_source'])
    expect(insuranceFieldsSetInPatch({ claim_number: 'C-1', status: 'sold' })).toEqual(['claim_number'])
    expect(insuranceFieldsSetInPatch({ job_source: 'retail', insurance_stage: null })).toEqual([])
    expect(insuranceFieldsSetInPatch({ insurance_company: '' })).toEqual([])
    expect(insuranceFieldsSetInPatch({ status: 'complete' })).toEqual([])
  })
})

describe('loadOrgFeatures / orgFeatureOffResponse', () => {
  it('reads settings->features; a failed read fails open (every feature on)', async () => {
    const client = jest.requireMock('@/lib/supabase/service').createServiceClient()
    storedFeatures = { roofMeasure: false }
    expect((await loadOrgFeatures(client, 'org-1')).roofMeasure).toBe(false)
    readError = { message: 'boom' }
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(await loadOrgFeatures(client, 'org-1')).toEqual(DEFAULT_ORG_FEATURES)
    spy.mockRestore()
    expect(await loadOrgFeatures(client, null)).toEqual(DEFAULT_ORG_FEATURES)
  })
  it('API gate: 403 with code feature_off only when the feature is off', async () => {
    storedFeatures = { canvassing: false }
    const off = await orgFeatureOffResponse('org-1', 'canvassing')
    expect(off?.status).toBe(403)
    expect(await off?.json()).toMatchObject({ code: 'feature_off' })
    expect(await orgFeatureOffResponse('org-1', 'insurance')).toBeNull()
    storedFeatures = undefined
    expect(await orgFeatureOffResponse('org-1', 'canvassing')).toBeNull()
  })
})

describe('entry points hide when a feature is off', () => {
  const flags = { isOpsOnly: false, canSeeOpsDashboard: false, canSeeJobBoard: false, canSeeInsideSales: false, projectsBarred: false, salesDocBarred: false, customerRecords: false, reports: false, isPayrollAdmin: true, earnsPay: false, payWeek: true }
  const owner = (features?: NavContext['features']): NavContext => ({ permsReady: true, role: 'owner', fullAccess: true, permissionNames: new Set(), flags, features })
  const leaves = (c: NavContext) => visibleNav(c).sections.flatMap((s) => s.children.map((l) => l.href))

  it('nav: Canvass and Incentives disappear; nothing else changes', () => {
    const on = visibleNav(owner())
    expect(on.canvass).toBe(true)
    expect(leaves(owner())).toContain('/sisu')
    const off = owner({ canvassing: false, incentives: false })
    expect(visibleNav(off).canvass).toBe(false)
    expect(leaves(off)).toEqual(leaves(owner()).filter((h) => h !== '/sisu'))
    expect(visibleNav(owner({ insurance: false, roofMeasure: false, squaresPricing: false }))).toEqual(on)
  })
  it('settings hub: Work areas / Roof measure tool links hide (Incentives stays — it holds pay tools); Features is super admins only', () => {
    const all = { canCost: true, canPayroll: true, canSuperuser: true, canWorkAreas: true, canOwner: true, canSuperAdmin: true }
    const hrefs = (g: ReturnType<typeof visibleSettingsGroups>) => g.flatMap((x) => x.items.map((i) => i.href))
    const on = hrefs(visibleSettingsGroups(all))
    expect(on).toEqual(expect.arrayContaining(['/canvass?areas=1', '/tools/roof-measure', '/admin/sisu/incentives', '/admin#features']))
    const off = hrefs(visibleSettingsGroups({ ...all, features: { canvassing: false, roofMeasure: false, incentives: false } }))
    expect(off).toEqual(on.filter((h) => !['/canvass?areas=1', '/tools/roof-measure'].includes(h)))
    expect(hrefs(visibleSettingsGroups({ ...all, canSuperAdmin: false }))).not.toContain('/admin#features')
  })
})

describe('crons and reports', () => {
  it('orgFeatureChecker reads each org once, however many rows a cron walks', async () => {
    storedFeatures = { stormAlerts: false }
    const on = orgFeatureChecker('stormAlerts')
    expect(await Promise.all([on('org-1'), on('org-1'), on('org-1')])).toEqual([false, false, false])
    expect(reads).toBe(1)
    storedFeatures = undefined
    expect(await orgFeatureChecker('insurance')('org-2')).toBe(true)
  })
  it('report datasets of a switched-off feature are hidden; others never', () => {
    expect(reportDatasetHidden('canvass_doors', DEFAULT_ORG_FEATURES)).toBe(false)
    expect(reportDatasetHidden('canvass_doors', { ...DEFAULT_ORG_FEATURES, canvassing: false })).toBe(true)
    expect(reportDatasetHidden('instant_estimate_accuracy', { ...DEFAULT_ORG_FEATURES, roofMeasure: false })).toBe(true)
    expect(reportDatasetHidden('sales', { ...DEFAULT_ORG_FEATURES, canvassing: false, roofMeasure: false, insurance: false })).toBe(false)
  })
})

describe('inside sales tabs', () => {
  it('Insurance ON (the original company): the tab still says Insurance and Storm shows — unchanged', () => {
    expect(insideSalesFeatureTabs(DEFAULT_ORG_FEATURES)).toEqual({ handoffLabel: 'Insurance', showStorm: true })
  })
  it('Insurance OFF: the handoff tab stays (every handoff lives there), renamed Follow-ups; Storm hides with Storm alerts', () => {
    expect(insideSalesFeatureTabs({ ...DEFAULT_ORG_FEATURES, insurance: false })).toEqual({ handoffLabel: 'Follow-ups', showStorm: true })
    expect(insideSalesFeatureTabs({ ...DEFAULT_ORG_FEATURES, stormAlerts: false })).toEqual({ handoffLabel: 'Insurance', showStorm: false })
  })
})
