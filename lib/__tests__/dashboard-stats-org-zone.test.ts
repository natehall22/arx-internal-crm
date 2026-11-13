/** @jest-environment node */
/**
 * Codex audit 2026-11-13 #11: the dashboard's day / week boundaries are the COMPANY's (orgs.timezone), not a fixed zone.
 * team-stats, personal-stats and ops-metrics (and the dashboard's first paint) all read the same zone. A New York company is
 * unchanged. DST: both 2026 clock-change Sundays (Mar 8, Nov 1).
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'

const profile = { id: 'u-admin', org_id: 'org-a', role: 'admin', custom_role_id: null, team_id: null, region_id: null }
jest.mock('@/lib/auth', () => ({ requireAuthApi: jest.fn(async () => ({ authUser: { id: profile.id }, profile })) }))
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u-admin' } }, error: null }) } }),
}))
let db: ReturnType<typeof createFakeDb>
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
const ranges: Array<{ startIso: string; endIso: string }> = []
jest.mock('@/lib/reporting/period-metrics', () => ({
  fetchPeriodMetricRows: jest.fn(async (_c: unknown, a: { startIso: string; endIso: string }) => {
    ranges.push({ startIso: a.startIso, endIso: a.endIso })
    return { sales: [], sits: [] }
  }),
  summarizePeriodRows: () => ({ doors: 0, contacts: 0, inspectionsSet: 0, inspectionsReceived: 0, sits: 0, sales: 0, calendar: 0 }),
}))
jest.mock('@/lib/dashboard-member-scope', () => ({ resolveDashboardMemberScope: async () => ({ orgWide: true, memberIds: [] }) }))

import { GET as teamGET } from '@/app/api/dashboard/team-stats/route'
import { GET as personalGET } from '@/app/api/dashboard/personal-stats/route'

function seed(timezone: string | null) {
  db = createFakeDb({
    orgs: [{ id: 'org-a', timezone, settings: {} }],
    users: [{ id: 'u-admin', org_id: 'org-a', role: 'admin', team_id: null, region_id: null, full_name: 'A', show_in_reports: true, active: true }],
  })
}

const req = (path: string) => {
  const r = new Request(`https://crm.example${path}`, { headers: { authorization: 'Bearer t' } }) as Request & { nextUrl: URL; cookies: { get: () => undefined } }
  r.nextUrl = new URL(r.url)
  r.cookies = { get: () => undefined }
  return r as never
}

async function todayStart(get: typeof teamGET, path: string, zone: string | null, nowIso: string) {
  seed(zone)
  ranges.length = 0
  jest.useFakeTimers().setSystemTime(new Date(nowIso))
  try {
    const res = await get(req(path))
    expect(res.status).toBe(200)
  } finally {
    jest.useRealTimers()
  }
  return ranges[0]
}

describe.each([
  ['team-stats', teamGET, '/api/dashboard/team-stats?timeframe=today'],
  ['personal-stats', personalGET as typeof teamGET, '/api/dashboard/personal-stats?timeframe=today'],
])('%s uses the company zone', (_name, get, path) => {
  it('March (spring forward Sunday): today starts at local midnight', async () => {
    expect(await todayStart(get, path, 'America/New_York', '2026-03-08T12:00:00Z')).toEqual({ startIso: '2026-03-08T05:00:00.000Z', endIso: '2026-03-09T04:00:00.000Z' })
    expect(await todayStart(get, path, 'America/Chicago', '2026-03-08T12:00:00Z')).toEqual({ startIso: '2026-03-08T06:00:00.000Z', endIso: '2026-03-09T05:00:00.000Z' })
  })
  it('November (fall back Sunday): today starts at local midnight', async () => {
    expect(await todayStart(get, path, 'America/New_York', '2026-11-01T12:00:00Z')).toEqual({ startIso: '2026-11-01T04:00:00.000Z', endIso: '2026-11-02T05:00:00.000Z' })
    expect(await todayStart(get, path, 'America/Chicago', '2026-11-01T12:00:00Z')).toEqual({ startIso: '2026-11-01T05:00:00.000Z', endIso: '2026-11-02T06:00:00.000Z' })
  })
  it('no zone saved (or an invalid one) = the default, exactly as before', async () => {
    const ny = await todayStart(get, path, 'America/New_York', '2026-11-01T12:00:00Z')
    expect(await todayStart(get, path, null, '2026-11-01T12:00:00Z')).toEqual(ny)
    expect(await todayStart(get, path, 'Not/AZone', '2026-11-01T12:00:00Z')).toEqual(ny)
  })
  it('a custom range is read on the company clock', async () => {
    seed('America/Chicago')
    ranges.length = 0
    await get(req(`${path.split('?')[0]}?timeframe=custom&startDate=2026-11-01&endDate=2026-11-01`))
    expect(ranges[0].startIso).toBe('2026-11-01T05:00:00.000Z')
  })
})
