/** @jest-environment node */
/**
 * Money sweep 2026-11-13 #4: a QuickBooks start date before the payments whose events were skipped would post those jobs'
 * invoices (the sweep re-queues unheard invoices) without their payments. The start date is refused before the first safe day.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'

const ORG = 'org1'
const outbox = (id: string, status: string) => ({ id: `o-${id}`, org_id: ORG, provider: 'quickbooks', entity_table: 'job_payments', entity_id: id, status })
function seed(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  return createFakeDb({
    integration_outbox: [outbox('p1', 'skipped'), outbox('p2', 'skipped'), outbox('p3', 'pending'), { ...outbox('x1', 'skipped'), org_id: 'other' }],
    job_payments: [
      { id: 'p1', job_id: 'j1', paid_at: '2026-10-02' },
      { id: 'p2', job_id: 'j2', paid_at: '2026-11-04' },
      { id: 'p3', job_id: 'j3', paid_at: '2026-11-12' },
      { id: 'x1', job_id: 'jx', paid_at: '2026-11-20' },
    ],
    qb_links: [],
    ...extra,
  })
}

const fake = { db: seed() }
jest.mock('@/lib/online-payments/access', () => ({ requireOnlinePaymentsCaller: async () => ({ profile: { id: 'owner', org_id: ORG }, admin: fake.db.client }) }))
jest.mock('@/lib/org-features', () => ({ loadOrgFeatures: async () => ({ quickbooks: true }) }))
jest.mock('@/lib/quickbooks/connection', () => ({ loadConnection: async () => ({ status: 'connected' }) }))
const openQbClient = jest.fn(async () => ({ ok: false, reason: 'unreachable' }))
jest.mock('@/lib/quickbooks/session', () => ({ openQbClient: (...a: unknown[]) => (openQbClient as unknown as (...x: unknown[]) => unknown)(...a) }))
jest.mock('@/lib/quickbooks/mapping-screen', () => ({
  loadOrgForMapping: async () => ({ settings: { quickbooks: { startDate: null } }, timezone: 'UTC' }),
  loadMappingScreen: jest.fn(),
  checkAgainstLists: jest.fn(),
  backfillDone: () => true,
}))

import { earliestSafeStartDate } from '@/lib/quickbooks/sweep'
import { PUT } from '@/app/api/admin/quickbooks/mapping/route'

describe('earliestSafeStartDate', () => {
  it('the day after the newest skipped payment (this company only; pending rows do not count)', async () => {
    expect(await earliestSafeStartDate(seed().client, ORG)).toBe('2026-11-05')
  })
  it('a skipped payment QuickBooks already has (a match from the backfill) does not count', async () => {
    const db = seed({ qb_links: [{ org_id: ORG, crm_table: 'job_payments', crm_id: 'p2', qb_type: 'Payment' }] })
    expect(await earliestSafeStartDate(db.client, ORG)).toBe('2026-10-03')
  })
  it('nothing skipped: no limit', async () => {
    expect(await earliestSafeStartDate(createFakeDb({ integration_outbox: [], job_payments: [], qb_links: [] }).client, ORG)).toBeNull()
  })
})

describe('PUT /api/admin/quickbooks/mapping refuses a start date that strands payments', () => {
  const put = (startDate: string) => PUT(new Request('http://x/api/admin/quickbooks/mapping', { method: 'PUT', body: JSON.stringify({ startDate }) }))
  beforeEach(() => {
    fake.db = seed()
    openQbClient.mockClear()
  })
  it('before the floor: 409 with the earliest safe day, nothing checked or saved', async () => {
    const res = await put('2026-01-01')
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ earliest: '2026-11-05', field: 'startDate' })
    expect(openQbClient).not.toHaveBeenCalled()
  })
  it('on the floor: goes on to the normal checks', async () => {
    await put('2026-11-05')
    expect(openQbClient).toHaveBeenCalled()
  })
})
