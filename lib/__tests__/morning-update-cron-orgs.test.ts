/** @jest-environment node */
/** The morning-update cron runs each eligible company at ITS 5:30am, never test/empty orgs, never outside the fence. */
import { NextRequest } from 'next/server'
import { createFakeDb } from '@/lib/test-helpers/fake-db'

let db: ReturnType<typeof createFakeDb>
// The real table has UNIQUE (org_id, blast_type, send_date) — the once-a-day claim. The fake db has no constraints,
// so the claim insert is given that one rule here.
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    ...(db.client as unknown as Record<string, unknown>),
    from: (t: string) => {
      const b = (db.client as unknown as { from: (t: string) => unknown }).from(t) as unknown as Record<string, unknown>
      if (t !== 'email_blast_sends') return b
      return {
        ...b,
        insert: async (row: Record<string, unknown>) => {
          const dup = (db.tables.email_blast_sends ?? []).some(
            (r) => r.org_id === row.org_id && r.blast_type === row.blast_type && r.send_date === row.send_date
          )
          if (dup) return { data: null, error: { code: '23505', message: 'duplicate' } }
          return ((db.client as unknown as { from: (t: string) => unknown }).from(t) as unknown as { insert: (r: unknown) => Promise<unknown> }).insert(row)
        },
      }
    },
  }),
}))
const sendMorning = jest.fn(async (_c: unknown, _p: { orgId: string }) => ({ sent: 1, skipped: false }))
const sendSetter = jest.fn(async (_c: unknown, _p: { orgId: string }) => ({ sent: 0, skipped: true, reason: 'no_recipients' }))
const ensureCheckups = jest.fn(async (_c: unknown, _o: string) => ({ created: 0 }))
const sendScheduledReports = jest.fn(async (_c: unknown, _o: string) => undefined)
jest.mock('@/lib/morning-update-email', () => ({ sendMorningUpdateEmail: (c: unknown, p: { orgId: string }) => sendMorning(c, p) }))
jest.mock('@/lib/setter-field-update-email', () => ({ sendSetterFieldUpdateEmail: (c: unknown, p: { orgId: string }) => sendSetter(c, p) }))
jest.mock('@/lib/checkups', () => ({ ensureCheckups: (c: unknown, o: string) => ensureCheckups(c, o) }))
jest.mock('@/lib/reporting/scheduled', () => ({ sendScheduledReports: (c: unknown, o: string) => sendScheduledReports(c, o) }))

import { GET } from '@/app/api/cron/morning-update/route'

const EAST = 'bbbbbbbb-0000-4000-8000-000000000001'
const WEST = 'bbbbbbbb-0000-4000-8000-000000000002'
const TEST_ORG = 'bbbbbbbb-0000-4000-8000-000000000003'
const ENV = { ...process.env }
const on = { notification_settings: { email_blasts: { morning_update: { enabled: true }, setter_field_update: { enabled: false } } } }

function run(isoUtc: string) {
  jest.setSystemTime(new Date(isoUtc))
  return GET(new NextRequest('https://crm.example/api/cron/morning-update', { headers: { authorization: 'Bearer s3cret' } }))
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
  process.env = { ...ENV, CRON_SECRET: 's3cret' }
  delete process.env.DEPLOYMENT_ORG_ID
  for (const f of [sendMorning, sendSetter, ensureCheckups, sendScheduledReports]) f.mockClear()
  db = createFakeDb({
    orgs: [
      { id: EAST, settings: on, timezone: 'America/New_York' },
      { id: WEST, settings: on, timezone: 'America/Los_Angeles' },
      { id: TEST_ORG, settings: on, timezone: 'America/New_York' },
    ],
    users: [
      { id: 'e1', org_id: EAST, active: true },
      { id: 'w1', org_id: WEST, active: true },
      { id: 't1', org_id: TEST_ORG, active: false },
    ],
  })
})
afterEach(() => jest.useRealTimers())
afterAll(() => { process.env = ENV })

const orgsSentTo = () => sendMorning.mock.calls.map((c) => c[1].orgId).sort()

test('5:30am Eastern (winter): only the Eastern company; Pacific is still asleep; test org never', async () => {
  const res = await run('2026-11-03T10:30:00Z')
  expect(res.status).toBe(200)
  expect(orgsSentTo()).toEqual([EAST])
  expect(ensureCheckups.mock.calls.map((c) => c[1])).toEqual([EAST])
  expect(db.tables.email_blast_sends).toEqual([expect.objectContaining({ org_id: EAST, send_date: '2026-11-03' })])
})

test('5:30am Pacific (13:30 UTC winter): the Pacific company sends; Eastern already claimed today → no second email', async () => {
  await run('2026-11-03T10:30:00Z')
  sendMorning.mockClear()
  await run('2026-11-03T13:30:00Z')
  expect(orgsSentTo()).toEqual([WEST])
  expect(db.tables.email_blast_sends.filter((r) => r.org_id === EAST)).toHaveLength(1)
  expect(db.tables.email_blast_sends.find((r) => r.org_id === WEST)).toEqual(expect.objectContaining({ send_date: '2026-11-03' }))
  expect((db.tables.email_blast_sends ?? []).some((r) => r.org_id === TEST_ORG)).toBe(false)
})

test('DEPLOYMENT_ORG_ID: a fenced copy runs only its own company', async () => {
  process.env.DEPLOYMENT_ORG_ID = WEST
  await run('2026-08-04T12:30:00Z') // 8:30 EDT and 5:30 PDT: both in window
  expect(orgsSentTo()).toEqual([WEST])
})
