/** @jest-environment node */
/**
 * POST /api/contracts/create takes an opportunityId from the request. It must belong to the caller's
 * org before the route voids pending contracts, saves sale credit or inserts the new contract.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'

let authResult: unknown = null
jest.mock('@/lib/auth', () => ({
  requireAuthApi: jest.fn(async () => {
    if (!authResult) throw new Error('Unauthorized')
    return authResult
  }),
}))
jest.mock('@/lib/sales-doc-access', () => ({ resolveSalesDocAccessBarred: jest.fn(async () => false) }))
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: () => ({ sendMail: jest.fn() }) } }))
jest.mock('@/lib/crm-email-from', () => ({ getCrmEmailFrom: () => 'crm@example.test' }))

let db: ReturnType<typeof createFakeDb>
/** When set, an insert into order_form_contracts whose row has `roof_color` fails with this error (migration not applied). */
let colorInsertError: { code: string; message: string } | null = null
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    ...(db.client as any),
    from: (t: string) => {
      const b = (db.client as any).from(t)
      if (t !== 'order_form_contracts') return b
      return new Proxy(b, {
        get: (target, k: string) => {
          const v = target[k]
          if (k !== 'insert') return typeof v === 'function' ? v.bind(target) : v
          return (row: any) => {
            if (colorInsertError && row && 'roof_color' in row) {
              const p: any = new Proxy(function () {}, {
                get: (_t, key) => (key === 'then' ? (res: (x: unknown) => void) => res({ data: null, error: colorInsertError, count: null }) : () => p),
              })
              return p
            }
            return v.call(target, row)
          }
        },
      })
    },
  }),
}))

import { POST } from '@/app/api/contracts/create/route'

const admin = {
  authUser: { id: 'u-a', email: null },
  profile: { id: 'u-a', org_id: 'org-a', role: 'admin', is_super_admin: false },
}
const body = (opportunityId: string) => ({
  opportunityId,
  agreementType: 'contingency',
  customerName: 'Pat Homeowner',
  projectAddress: '1 Main St',
  repName: 'Rep',
  repSignature: 'data:image/png;base64,xx',
})
const post = (b: unknown) =>
  POST(
    new Request('https://crm.example/api/contracts/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(b),
    }) as never
  )

beforeEach(() => {
  colorInsertError = null
  authResult = admin
  db = createFakeDb({
    opportunities: [
      { id: 'opp-a', org_id: 'org-a' },
      { id: 'opp-b', org_id: 'org-b' },
    ],
    order_form_contracts: [
      { id: 'c-b', org_id: 'org-b', opportunity_id: 'opp-b', agreement_type: 'contingency', status: 'pending_customer' },
    ],
    activities: [],
  })
})

test('an opportunity from another org → 404 and nothing written', async () => {
  const res = await post(body('opp-b'))
  expect(res.status).toBe(404)
  expect(db.writes).toEqual([])
  expect(db.tables.order_form_contracts).toEqual([
    expect.objectContaining({ id: 'c-b', status: 'pending_customer' }),
  ])
})

test('an unknown opportunity → 404 and nothing written', async () => {
  const res = await post(body('opp-missing'))
  expect(res.status).toBe(404)
  expect(db.writes).toEqual([])
})

test('same-org opportunity still creates the contract', async () => {
  const res = await post(body('opp-a'))
  expect(res.status).toBe(200)
  const inserted = db.writes.find((w) => w.table === 'order_form_contracts' && w.op === 'insert')
  expect(inserted?.rows[0]).toMatchObject({ org_id: 'org-a', opportunity_id: 'opp-a' })
})

test('no session → 401', async () => {
  authResult = null
  const res = await post(body('opp-a'))
  expect(res.status).toBe(401)
})

describe('roof color on the installation agreement (2026-11-12)', () => {
  const install = (over: Record<string, unknown> = {}) => ({ ...body('opp-a'), agreementType: 'installation', projectCost: 15000, ...over })
  const written = () => db.writes.find((w) => w.table === 'order_form_contracts' && w.op === 'insert')

  test('an installation agreement with no color is refused and nothing is written', async () => {
    for (const roofColor of [undefined, '', '   ']) {
      const res = await post(install({ roofColor }))
      expect(res.status).toBe(400)
    }
    expect(written()).toBeUndefined()
  })

  test('the typed color is stored trimmed', async () => {
    const res = await post(install({ roofColor: '  IKO Dynasty — Granite Black ' }))
    expect(res.status).toBe(200)
    expect(written()?.rows[0]).toMatchObject({ roof_color: 'IKO Dynasty — Granite Black' })
  })

  test('repair and contingency agreements take no color (stored null even if sent)', async () => {
    expect((await post({ ...body('opp-a'), roofColor: 'Black' })).status).toBe(200)
    expect(written()?.rows[0]).not.toHaveProperty('roof_color')
    db.writes.length = 0
    expect((await post({ ...body('opp-a'), agreementType: 'repair', projectCost: 900, roofColor: 'Black' })).status).toBe(200)
    expect(written()?.rows[0]).not.toHaveProperty('roof_color')
  })

  test.each([
    ['42703', 'column "roof_color" of relation "order_form_contracts" does not exist'],
    ['PGRST204', "Could not find the 'roof_color' column of 'order_form_contracts' in the schema cache"],
  ])('a missing roof_color column (%s) retries without it and the contract is still created', async (code, message) => {
    colorInsertError = { code, message }
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await post(install({ roofColor: 'Black' }))
    expect(res.status).toBe(200)
    expect(warn).toHaveBeenCalled()
    expect(written()?.rows[0]).not.toHaveProperty('roof_color')
    expect(db.tables.order_form_contracts.some((r: any) => r.org_id === 'org-a' && r.agreement_type === 'installation')).toBe(true)
    warn.mockRestore()
  })

  test('an unrelated insert error is not retried', async () => {
    colorInsertError = { code: '42703', message: 'column "something_else" does not exist' }
    const err = jest.spyOn(console, 'error').mockImplementation(() => {})
    expect((await post(install({ roofColor: 'Black' }))).status).toBe(500)
    err.mockRestore()
  })
})
