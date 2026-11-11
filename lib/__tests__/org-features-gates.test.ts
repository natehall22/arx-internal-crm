/** @jest-environment node */
/**
 * Proof that each switched-off feature is refused where the reviewer listed it. Behaviour tests where a route/function
 * can run in isolation; a source check where the gate is a server-page/JSX guard that can't render under jest.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

import { DEFAULT_ORG_FEATURES } from '@/lib/org-features'
import { ReportAccessError, checkAccess, datasetOffered, type ReportContext } from '@/lib/reporting/run'
import { DATASETS } from '@/lib/reporting/catalog'

let storedFeatures: unknown = undefined
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => {
      const q: Record<string, unknown> = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { features: storedFeatures }, error: null }) }
      return q
    },
  }),
}))

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

beforeEach(() => {
  storedFeatures = undefined
})

describe('2. website estimate config reports disabled when Roof measuring is off', () => {
  const env = { ...process.env }
  afterEach(() => {
    process.env = { ...env }
  })
  it('env on + feature on → enabled; feature off → disabled; env off → disabled', async () => {
    process.env.PUBLIC_ROOF_ESTIMATE_ENABLED = 'true'
    process.env.PUBLIC_ESTIMATE_ORG_ID = 'org-1'
    const { GET } = await import('@/app/api/public/estimate/config/route')
    const { NextRequest } = await import('next/server')
    const call = async () => (await (await GET(new NextRequest('https://crm.example/api/public/estimate/config'))).json()) as { enabled: boolean }
    expect((await call()).enabled).toBe(true)
    storedFeatures = { roofMeasure: false }
    expect((await call()).enabled).toBe(false)
    storedFeatures = undefined
    process.env.PUBLIC_ROOF_ESTIMATE_ENABLED = 'false'
    expect((await call()).enabled).toBe(false)
  })
})

describe('5. reports: one rule for the list and every run (screen, CSV, schedule)', () => {
  const ctx = (features?: ReportContext['features']): ReportContext => ({ orgId: 'o', userId: 'u', scope: 'all', finance: true, canExport: true, scopedUserIds: null, features })
  const spec = { dataset: 'canvass_doors', mode: 'summary', metric: { kind: 'count' }, filters: [] } as never
  it('a dataset of a switched-off feature is refused with 403 (scheduled runs skip ReportAccessError)', () => {
    expect(() => checkAccess(ctx({ ...DEFAULT_ORG_FEATURES, canvassing: false }), DATASETS.canvass_doors, spec)).toThrow(ReportAccessError)
    try {
      checkAccess(ctx({ ...DEFAULT_ORG_FEATURES, canvassing: false }), DATASETS.canvass_doors, spec)
    } catch (e) {
      expect((e as ReportAccessError).status).toBe(403)
    }
  })
  it('switch on, or a context built without features (older callers): unchanged', () => {
    expect(() => checkAccess(ctx(DEFAULT_ORG_FEATURES), DATASETS.canvass_doors, spec)).not.toThrow()
    expect(() => checkAccess(ctx(undefined), DATASETS.canvass_doors, spec)).not.toThrow()
    expect(datasetOffered(ctx({ ...DEFAULT_ORG_FEATURES, roofMeasure: false }), 'instant_estimate_accuracy')).toBe(false)
    expect(datasetOffered(ctx({ ...DEFAULT_ORG_FEATURES, roofMeasure: false }), 'sales')).toBe(true)
  })
  it('the list (GET) uses the same datasetOffered rule', () => {
    expect(src('app/api/reports/run/route.ts')).toMatch(/\.filter\(\(d\) => datasetOffered\(ctx, d\.key\)\)/)
  })
})

describe('6. every roof/exterior measure API and page is gated', () => {
  const apis = [
    'app/api/measurements/route.ts',
    'app/api/measurements/[id]/route.ts',
    'app/api/measurements/solar-footprint/route.ts',
    'app/api/opportunities/[id]/measure/route.ts',
    'app/api/opportunities/[id]/measure/photos/route.ts',
    'app/api/opportunities/[id]/measure/lidar/route.ts',
    'app/api/ops/jobs/[id]/measure/route.ts',
    'app/api/ops/jobs/[id]/measure/photos/route.ts',
    'app/api/ops/jobs/[id]/measure/lidar/route.ts',
    'app/api/ai/extract-exterior-measure/route.ts',
    'app/api/ai/detect-roof/route.ts',
    'app/api/maps/usgs-lidar/route.ts',
  ]
  it.each(apis)('%s: every handler 403s when Roof measuring is off', (p) => {
    const s = src(p)
    const handlers = (s.match(/^export async function (GET|POST|PUT|PATCH|DELETE)\b/gm) ?? []).length
    expect(handlers).toBeGreaterThan(0)
    expect((s.match(/orgFeatureOffResponse\([^)]*'roofMeasure'\)/g) ?? []).length).toBe(handlers)
  })
  it.each(['app/opportunities/[id]/measure/page.tsx', 'app/opportunities/[id]/measure/print/page.tsx', 'app/ops/jobs/[id]/measure/page.tsx', 'app/ops/jobs/[id]/measure/print/page.tsx', 'app/tools/roof-measure/layout.tsx'])(
    '%s 404s when Roof measuring is off',
    (p) => expect(src(p)).toContain("requireOrgFeaturePage(profile.org_id, 'roofMeasure')")
  )
})

describe('1, 4, 7. UI guards', () => {
  it('1. the Settings → Features link on Measurement shows only to super admins (canEditBrand = isSuperAdmin)', () => {
    const s = src('app/admin/settings/page.tsx')
    expect(s).toMatch(/\{canEditBrand \? \(\s*<a href="\/admin#features"/)
    expect(src('app/api/admin/settings/route.ts')).toContain('canEditBrand: isSuperAdmin(profile)')
  })
  it('4. opportunities inside-sales view: Storm filter and Storm count card follow the Storm alerts switch', () => {
    const s = src('app/opportunities/page.tsx')
    expect(s).toContain('{featureTabs.showStorm && <option value="storm">')
    expect(s).toMatch(/\{featureTabs\.showStorm && \(\s*<div className="rounded-xl border border-sky-200/)
  })
  it('7. server pages hand the resolved switches to the client so nothing flashes', () => {
    // JobView reads the switches off the industry profile it already loads (same rule: resolveOrgFeatures).
    expect(src('app/ops/jobs/[id]/JobView.tsx')).toContain('orgFeatures={orgProfile.features}')
    expect(src('app/dashboard/page.tsx')).toContain('orgFeatures={await getOrgFeatures(profile.org_id)}')
    expect(src('app/opportunities/[id]/OpportunityView.tsx')).toContain('orgFeatures={await getOrgFeatures(profile.org_id)}')
    expect(src('components/contracts/ContractModal.tsx')).toContain('useOrgFeatures(orgFeatures)')
  })
})
