/** @jest-environment node */
/**
 * Move signed documents routes: signed out → 401, signed in but not an owner → 403, before any database read.
 * (Cross-company isolation is in cross-company-breakin.test.ts; the steps themselves in signed-import-db.test.ts.)
 */
const requireAuthApi = jest.fn()
jest.mock('@/lib/auth', () => ({ requireAuthApi: (...a: unknown[]) => requireAuthApi(...a) }))
const serviceClient = jest.fn(() => {
  throw new Error('the database must not be touched before the owner check')
})
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => serviceClient() }))

import * as listRoute from '@/app/api/admin/import/signed-docs/route'
import * as runRoute from '@/app/api/admin/import/signed-docs/[runId]/route'
import * as heldRoute from '@/app/api/admin/import/signed-docs/held/route'

const ctx = { params: { runId: '11111111-1111-1111-1111-111111111111' } }
const post = () => new Request('http://x/api', { method: 'POST', body: JSON.stringify({ action: 'customers' }) })
const get = () => new Request('http://x/api')
const calls: Array<[string, () => Promise<Response>]> = [
  ['GET list', () => listRoute.GET()],
  ['POST open', () => listRoute.POST()],
  ['GET run', () => runRoute.GET(get(), ctx)],
  ['POST run', () => runRoute.POST(post(), ctx)],
  ['GET held', () => heldRoute.GET()],
  ['POST held', () => heldRoute.POST(post())],
]

describe.each(calls)('%s', (_n, call) => {
  beforeEach(() => serviceClient.mockClear())
  it('is 401 when signed out', async () => {
    requireAuthApi.mockRejectedValue(new Error('no session'))
    expect((await call()).status).toBe(401)
    expect(serviceClient).not.toHaveBeenCalled()
  })
  it('is 403 for anyone who is not an owner', async () => {
    requireAuthApi.mockResolvedValue({ profile: { id: 'u1', org_id: 'o1', role: 'admin', is_super_admin: false } })
    expect((await call()).status).toBe(403)
    expect(serviceClient).not.toHaveBeenCalled()
  })
})
