/** @jest-environment node */
/**
 * The two `files`-bucket read routes:
 *  - GET /api/files/object — staff (same org; field roles kept off money/production paths) and subs (their jobs' shared files
 *    and packet). Not allowed → 404, never 403. Success → 302 to a signed URL, never cached across users.
 *  - GET /api/files/signed/[kind]/[token] — customers, by signing token, signed documents only, no expiry check.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'

const ORG = '9089d4ad-f46c-405b-9798-6751d45a7051'
const OTHER = '11111111-2222-3333-4444-555555555555'
const SB = 'https://anzqkklwcgaoeunzpqjh.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_URL = SB

let authResult: unknown = null
jest.mock('@/lib/auth', () => ({
  requireAuthApi: jest.fn(async () => {
    if (!authResult) throw new Error('Unauthorized')
    return authResult
  }),
}))
jest.mock('@/lib/sales-doc-access', () => ({
  resolveSalesDocAccessBarred: jest.fn(async (_a: unknown, _id: string, p: { role: string }) => p.role === 'inside_sales'),
}))

let db: ReturnType<typeof createFakeDb>
const signed: string[] = []
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (t: string) => (db.client as any).from(t),
    rpc: (name: string, args: Record<string, unknown>) => (db.client as any).rpc(name, args),
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, ttl: number) => {
          signed.push(`${bucket}:${path}:${ttl}`)
          return { data: { signedUrl: `${SB}/storage/v1/object/sign/${bucket}/${path}?token=t` }, error: null }
        },
      }),
    },
  }),
}))

import { GET as getObject } from '@/app/api/files/object/route'
import { GET as getSigned } from '@/app/api/files/signed/[kind]/[token]/route'

const CO_TOKEN = 'ab'.repeat(32)
const C_TOKEN = '0b5d2485-9aba-4c1e-8f00-1234567890ab'

beforeEach(() => {
  signed.length = 0
  db = createFakeDb(
    {
      job_change_orders: [
        { id: 'co-legacy', org_id: ORG, pdf_storage_path: 'change-orders/x/CO_1.pdf', status: 'completed', signing_token: null },
        { id: 'co-1', org_id: ORG, pdf_storage_path: `org/${ORG}/change-orders/p1/CO_2.pdf`, pdf_url: `${SB}/storage/v1/object/public/files/org/${ORG}/change-orders/p1/CO_2.pdf`, status: 'completed', signing_token: CO_TOKEN, token_expires_at: '2020-01-01T00:00:00Z' },
      ],
      order_form_contracts: [
        { id: 'c-1', status: 'completed', signing_token: C_TOKEN, pdf_storage_path: `org/${ORG}/contracts/c1.pdf`, pdf_url: `${SB}/storage/v1/object/public/files/org/${ORG}/contracts/c1.pdf` },
        { id: 'c-2', status: 'pending_customer', signing_token: '0b5d2485-9aba-4c1e-8f00-000000000000', pdf_storage_path: null, pdf_url: null },
        { id: 'c-v1', status: 'voided', customer_signed_at: '2026-09-01T00:00:00Z', signing_token: '0b5d2485-9aba-4c1e-8f00-00000000000a', pdf_storage_path: `org/${ORG}/contracts/v1.pdf`, pdf_url: null },
        { id: 'c-v2', status: 'voided', customer_signed_at: null, signing_token: '0b5d2485-9aba-4c1e-8f00-00000000000b', pdf_storage_path: `org/${ORG}/contracts/v2.pdf`, pdf_url: null },
      ],
      files: [
        { id: 'f-legacy', org_id: ORG, storage_path: 'c1d2/photo.jpg', job_id: null, project_id: null, share_with_sub: false, photo_tag: null },
        { id: 'f-shared', org_id: ORG, storage_path: `org/${ORG}/projects/p1/shared.pdf`, job_id: null, project_id: 'p1', share_with_sub: true, photo_tag: null },
        { id: 'f-private', org_id: ORG, storage_path: `org/${ORG}/projects/p1/private.pdf`, job_id: null, project_id: 'p1', share_with_sub: false, photo_tag: null },
      ],
      production_jobs: [
        { id: 'j1', org_id: ORG, project_id: 'p1', assigned_sub_id: 'sub-1', job_packet_pdf_path: `${ORG}/jobs/j1/job-packet-1.pdf` },
        { id: 'j2', org_id: ORG, project_id: 'p2', assigned_sub_id: 'sub-2', job_packet_pdf_path: `${ORG}/jobs/j2/job-packet-2.pdf` },
      ],
      work_order_photos: [{ id: 'w1', org_id: ORG, storage_path: 'files/work-orders/wo1/work_done_1_0.jpg' }],
      custom_roles: [{ id: 'cr-canvass', org_id: ORG, name: 'canvasser_custom', display_name: 'Door Canvasser' }],
    },
    { rpc: { get_sub_id_for_user: (args) => (args.user_uuid === 'u-sub' ? 'sub-1' : null) } }
  )
})

const as = (id: string, role: string, extra: Record<string, unknown> = {}) => {
  authResult = { authUser: { id, email: null }, profile: { id, org_id: ORG, role, custom_role_id: null, ...extra } }
}
const open = (path: string) => getObject(new Request(`https://crm.example/api/files/object?path=${encodeURIComponent(path)}`))

describe('GET /api/files/object', () => {
  it('401s without a session', async () => {
    authResult = null
    expect((await open(`org/${ORG}/contracts/c1.pdf`)).status).toBe(401)
  })

  it('redirects same-org staff to a 10-minute signed URL, private and uncached', async () => {
    as('u-admin', 'admin')
    const res = await open(`org/${ORG}/contracts/c1.pdf`)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain(`/object/sign/files/org/${ORG}/contracts/c1.pdf`)
    expect(res.headers.get('cache-control')).toBe('private, no-store, max-age=0')
    expect(signed).toEqual([`files:org/${ORG}/contracts/c1.pdf:600`])
  })

  it('accepts a stored public URL with ?t= as the path', async () => {
    as('u-admin', 'admin')
    const res = await open(`${SB}/storage/v1/object/public/files/proposals/${ORG}/p1/property-1.jpg?t=123`)
    expect(res.status).toBe(302)
    expect(signed).toEqual([`files:proposals/${ORG}/p1/property-1.jpg:600`])
  })

  it('404s another org, other buckets, unsafe and unknown paths', async () => {
    as('u-admin', 'admin')
    for (const p of [
      `org/${OTHER}/contracts/c.pdf`,
      `proposals/${OTHER}/p/x.jpg`,
      `${OTHER}/jobs/j9/job-packet-1.pdf`,
      `${SB}/storage/v1/object/public/contracts/org/${ORG}/contracts/c1.pdf`,
      'org/../x.pdf',
      'change-orders/unknown/CO.pdf',
      'nobody/else.jpg',
      'work-orders/wo9/x.jpg',
      '',
    ]) {
      expect({ p, status: (await open(p)).status }).toEqual({ p, status: 404 })
    }
    expect(signed).toEqual([])
  })

  it('allows legacy change orders, legacy uploads and work-order photos only through an org row', async () => {
    as('u-admin', 'admin')
    expect((await open('change-orders/x/CO_1.pdf')).status).toBe(302)
    expect((await open('c1d2/photo.jpg')).status).toBe(302)
    expect((await open('work-orders/wo1/work_done_1_0.jpg')).status).toBe(302)
    expect((await open(`${ORG}/jobs/j1/job-packet-1.pdf`)).status).toBe(302)
  })

  it('keeps field roles (slug, custom-role name, sales-doc barred) off contracts and change orders', async () => {
    for (const [role, extra] of [
      ['setter', {}],
      ['canvasser', {}],
      ['call_center', {}],
      ['rep', { custom_role_id: 'cr-canvass' }],
      ['inside_sales', {}],
    ] as const) {
      as('u-field', role, extra)
      expect((await open(`org/${ORG}/contracts/c1.pdf`)).status).toBe(404)
      expect((await open(`org/${ORG}/change-orders/p1/CO_2.pdf`)).status).toBe(404)
      expect((await open('change-orders/x/CO_1.pdf')).status).toBe(404)
      expect((await open(`${ORG}/jobs/j1/job-packet-1.pdf`)).status).toBe(404)
      expect((await open(`org/${ORG}/logo.png`)).status).toBe(302)
      expect((await open(`proposals/${ORG}/p1/property-1.jpg`)).status).toBe(302)
    }
  })

  it('lets subs read only their jobs’ shared files and packet', async () => {
    as('u-sub', 'sub')
    expect((await open(`org/${ORG}/projects/p1/shared.pdf`)).status).toBe(302)
    expect((await open(`${ORG}/jobs/j1/job-packet-1.pdf`)).status).toBe(302)
    expect((await open(`org/${ORG}/projects/p1/private.pdf`)).status).toBe(404)
    expect((await open(`${ORG}/jobs/j2/job-packet-2.pdf`)).status).toBe(404)
    expect((await open(`org/${ORG}/contracts/c1.pdf`)).status).toBe(404)
    expect((await open(`org/${ORG}/logo.png`)).status).toBe(404)
  })
})

describe('GET /api/files/signed/[kind]/[token]', () => {
  const get = (kind: string, token: string) =>
    getSigned(new Request(`https://crm.example/api/files/signed/${kind}/${token}`), { params: { kind, token } })

  it('redirects a signed contract and a signed change order (signing expiry does not apply)', async () => {
    const c = await get('contract', C_TOKEN)
    expect(c.status).toBe(302)
    expect(c.headers.get('cache-control')).toBe('private, no-store, max-age=0')
    const co = await get('change-order', CO_TOKEN)
    expect(co.status).toBe(302)
    expect(signed).toEqual([`files:org/${ORG}/contracts/c1.pdf:600`, `files:org/${ORG}/change-orders/p1/CO_2.pdf:600`])
  })

  it('404s unsigned documents, unknown tokens, malformed tokens and unknown kinds without signing', async () => {
    expect((await get('contract', '0b5d2485-9aba-4c1e-8f00-000000000000')).status).toBe(404)
    expect((await get('contract', '0b5d2485-9aba-4c1e-8f00-999999999999')).status).toBe(404)
    expect((await get('contract', 'not-a-token')).status).toBe(404)
    expect((await get('contract', '0b5d2485-9aba-4c1e-8f00-00000000000b')).status).toBe(404) // voided, never signed
    expect((await get('change-order', C_TOKEN)).status).toBe(404)
    expect((await get('invoice', C_TOKEN)).status).toBe(404)
    expect(signed).toEqual([])
  })

  it('still serves a contract the customer signed that was later superseded (voided, kept)', async () => {
    expect((await get('contract', '0b5d2485-9aba-4c1e-8f00-00000000000a')).status).toBe(302)
    expect(signed).toEqual([`files:org/${ORG}/contracts/v1.pdf:600`])
  })

  it('keeps the old contracts-bucket fallback URL working', async () => {
    const url = `${SB}/storage/v1/object/public/contracts/org/${ORG}/contracts/c1.pdf`
    db = createFakeDb({ order_form_contracts: [{ id: 'c-3', status: 'completed', signing_token: C_TOKEN, pdf_storage_path: `org/${ORG}/contracts/c1.pdf`, pdf_url: url }] })
    const res = await get('contract', C_TOKEN)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(url)
    expect(signed).toEqual([])
  })
})
