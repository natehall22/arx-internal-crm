/** @jest-environment node */
import { NextRequest } from 'next/server'

import { createFakeDb } from '@/lib/test-helpers/fake-db'

let profile: Record<string, unknown> | null = null
let rpcMissing = false
let db = createFakeDb({})

jest.mock('@/lib/auth', () => ({
  requireAuthApi: async () => {
    if (!profile) throw new Error('no session')
    return { authUser: { id: profile.id }, profile }
  },
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

import { GET, PUT } from '@/app/api/admin/job-catch-up/route'

const ORG = 'org-1'
function fresh() {
  db = createFakeDb(
    { orgs: [{ id: ORG, settings: { logo_url: 'org/org-1/logo.png', brand: { shortName: 'Harness' } } }] },
    {
      rpc: {
        merge_org_settings: (args, tables) => {
          if (rpcMissing) throw Object.assign(new Error('Could not find the function'), { code: 'PGRST202' })
          const org = tables.orgs.find((o) => o.id === args.p_org_id)!
          org.settings = { ...(org.settings as object), ...(args.p_set as object) }
        },
      },
    }
  )
}
const put = (body: unknown) => PUT(new NextRequest('http://x/api/admin/job-catch-up', { method: 'PUT', body: JSON.stringify(body) }))
const settings = () => db.tables.orgs[0].settings as Record<string, unknown>

beforeEach(() => {
  fresh()
  rpcMissing = false
  profile = { id: 'u1', org_id: ORG, role: 'admin', active: true }
})

describe('/api/admin/job-catch-up', () => {
  it('needs a session; field roles cannot read it', async () => {
    profile = null
    expect((await GET()).status).toBe(401)
    profile = { id: 'u2', org_id: ORG, role: 'setter', active: true }
    expect((await GET()).status).toBe(403)
  })

  it('defaults OFF / 7 days; leadership reads, only admins edit', async () => {
    expect(await (await GET()).json()).toEqual({ enabled: false, stuckDays: 7, canEdit: true })
    profile = { id: 'u3', org_id: ORG, role: 'operations', active: true }
    expect(await (await GET()).json()).toEqual({ enabled: false, stuckDays: 7, canEdit: false })
    expect((await put({ enabled: true })).status).toBe(403)
    expect(settings().job_catch_up_enabled).toBeUndefined()
  })

  it('admin turns it on and sets N; only those two keys change (per-key merge)', async () => {
    const res = await put({ enabled: true, stuckDays: 10 })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: true, stuckDays: 10, canEdit: true })
    expect(settings()).toEqual({ logo_url: 'org/org-1/logo.png', brand: { shortName: 'Harness' }, job_catch_up_enabled: true, job_catch_up_stuck_days: 10 })
  })

  it('rejects bad input without writing', async () => {
    for (const body of [{}, { enabled: 'yes' }, { stuckDays: 0 }, { stuckDays: 61 }, { stuckDays: 2.5 }, { brand: { shortName: 'X' } }]) {
      expect((await put(body)).status).toBe(400)
    }
    expect(settings()).toEqual({ logo_url: 'org/org-1/logo.png', brand: { shortName: 'Harness' } })
  })

  it('falls back to read-merge-write until the migration is applied', async () => {
    rpcMissing = true
    expect((await put({ enabled: true })).status).toBe(200)
    expect(settings()).toEqual({ logo_url: 'org/org-1/logo.png', brand: { shortName: 'Harness' }, job_catch_up_enabled: true })
  })
})
