/** @jest-environment node */
/** promote-insurance-follow-ups runs one pass per eligible company, each query scoped to that company. */
import { NextRequest } from 'next/server'
import { createFakeDb } from '@/lib/test-helpers/fake-db'

let db: ReturnType<typeof createFakeDb>
const scoped: Array<{ table: string; org: unknown }> = []
let failFor: string | null = null
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    ...(db.client as unknown as Record<string, unknown>),
    from: (t: string) => {
      const b = (db.client as unknown as { from: (t: string) => unknown }).from(t) as unknown as Record<string, (...a: unknown[]) => unknown>
      if (t !== 'opportunities') return b
      const eq = b.eq
      b.eq = (c: unknown, v: unknown) => {
        if (c === 'org_id') {
          scoped.push({ table: t, org: v })
          if (v === failFor) throw new Error('db blip')
        }
        return eq(c, v)
      }
      return b
    },
  }),
}))

import { GET } from '@/app/api/cron/promote-insurance-follow-ups/route'

const A = 'cccccccc-0000-4000-8000-000000000001'
const B = 'cccccccc-0000-4000-8000-000000000002'
const TEST_ORG = 'cccccccc-0000-4000-8000-000000000003'
const ENV = { ...process.env }
const run = () => GET(new NextRequest('https://crm.example/api/cron/promote-insurance-follow-ups', { headers: { authorization: 'Bearer s3cret' } }))

beforeEach(() => {
  process.env = { ...ENV, CRON_SECRET: 's3cret' }
  delete process.env.DEPLOYMENT_ORG_ID
  scoped.length = 0
  failFor = null
  db = createFakeDb({
    orgs: [{ id: A, settings: {} }, { id: B, settings: {} }, { id: TEST_ORG, settings: {} }],
    users: [{ id: 'a', org_id: A, active: true }, { id: 'b', org_id: B, active: true }, { id: 't', org_id: TEST_ORG, active: false }],
    opportunities: [
      { id: 'oa', org_id: A, status: 'open', inspection_outcome: null },
      { id: 'ot', org_id: TEST_ORG, status: 'open', inspection_outcome: null },
    ],
  })
})
afterAll(() => { process.env = ENV })

test('one candidate fetch per eligible company; the test org is never read', async () => {
  const res = await run()
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual(expect.objectContaining({ orgs: 2, failedOrgs: [] }))
  expect(scoped.map((s) => s.org).sort()).toEqual([A, B].sort())
})

test("one company's failure doesn't stop the others and fails the run loudly", async () => {
  failFor = A
  const res = await run()
  expect(res.status).toBe(500)
  expect((await res.json()).failedOrgs).toEqual([A])
  expect(scoped.map((s) => s.org)).toContain(B)
})
