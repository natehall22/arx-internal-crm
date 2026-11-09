/** @jest-environment node */
/**
 * Customer File → Files tab "Add files": POST /api/customers/[id]/files/register + /finalize.
 *  - Private `files` bucket, path org/<org>/customers/<customer>/<fileId>_<name>; the row stores the PATH, never a URL.
 *  - Same people as the page (customers:view/edit; reps only on their own customers), minus field roles / sales-doc-barred.
 *  - Finalize trusts storage, not the browser: the object must exist under this customer's folder for that fileId.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { classifyFilesPath, fieldRoleMayReadFilesPath, filesObjectHref } from '@/lib/files/files-object'
import { loadCustomerFiles, loadCustomerFilesForViewer } from '@/lib/customer-file/customer-files-access'
import type { ThreadViewer } from '@/lib/threads/visibility'
import {
  CUSTOMER_FILE_MAX_BYTES,
  customerFileStoragePath,
  customerFileTag,
  isCustomerFilePathFor,
} from '@/lib/customer-file/customer-files'

const ORG = '9089d4ad-f46c-405b-9798-6751d45a7051'
const OTHER_ORG = '11111111-2222-3333-4444-555555555555'
const CUST = 'c0000000-0000-4000-8000-000000000001'
const CUST_OTHER_ORG = 'c0000000-0000-4000-8000-000000000002'
const CUST_NOT_MINE = 'c0000000-0000-4000-8000-000000000003'

let authResult: unknown = null
jest.mock('@/lib/auth', () => ({
  requireAuthApi: jest.fn(async () => {
    if (!authResult) throw new Error('Unauthorized')
    return authResult
  }),
}))

// Only the permission resolver is stubbed; the real lib/sales-doc-access (field-role + sales-doc rules) runs.
jest.mock('@/lib/effective-permissions', () => ({
  resolveEffectivePermissionNames: jest.fn(async (_a: unknown, _id: string, p: { role: string }) => {
    if (p.role === 'admin') return { fullAccess: true, permissionNames: new Set<string>() }
    if (p.role === 'no_customers') return { fullAccess: false, permissionNames: new Set<string>(['leads:view']) }
    // The Inside Sales preset by grant (no inside-sales role name): barred from sales docs.
    if (p.role === 'grant_inside_sales') return { fullAccess: false, permissionNames: new Set<string>(['customers:view', 'opportunities:view', 'leads:claim_inbound']) }
    return { fullAccess: false, permissionNames: new Set<string>(['customers:view']) }
  }),
}))

let db: ReturnType<typeof createFakeDb>
let storageObjects: Array<{ folder: string; name: string; size: number; mimetype: string }>
const signedFor: string[] = []
const removed: string[] = []
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (t: string) => (db.client as any).from(t),
    storage: {
      from: (bucket: string) => ({
        createSignedUploadUrl: async (path: string) => {
          signedFor.push(`${bucket}:${path}`)
          return { data: { token: 'tok', path, signedUrl: 'x' }, error: null }
        },
        list: async (folder: string, opts: { search?: string }) => ({
          data: storageObjects
            .filter((o) => o.folder === folder && (!opts?.search || o.name.startsWith(opts.search)))
            .map((o) => ({ name: o.name, metadata: { size: o.size, mimetype: o.mimetype } })),
          error: null,
        }),
        remove: async (paths: string[]) => {
          removed.push(...paths.map((p) => `${bucket}:${p}`))
          return { data: [], error: null }
        },
      }),
    },
  }),
}))

import { POST as register } from '@/app/api/customers/[id]/files/register/route'
import { POST as finalize } from '@/app/api/customers/[id]/files/finalize/route'

const as = (id: string, role: string, extra: Record<string, unknown> = {}) => {
  authResult = { authUser: { id, email: null }, profile: { id, org_id: ORG, role, custom_role_id: null, ...extra } }
}
const req = (body: unknown) => new Request('http://x/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const ctx = (id: string) => ({ params: { id } })

beforeEach(() => {
  signedFor.length = 0
  removed.length = 0
  storageObjects = []
  db = createFakeDb({
    customers: [
      { id: CUST, org_id: ORG },
      { id: CUST_OTHER_ORG, org_id: OTHER_ORG },
      { id: CUST_NOT_MINE, org_id: ORG },
    ],
    projects: [{ id: 'p1', org_id: ORG, customer_id: CUST, owner_user_id: 'u-closer' }],
    custom_roles: [{ id: 'cr-canvass', name: 'Door Canvasser', display_name: null }],
    permission_denials: [],
    files: [],
  })
})

describe('pure helpers', () => {
  it('builds a private org path that field roles cannot read and staff link through the read route', () => {
    const path = customerFileStoragePath({ orgId: ORG, customerId: CUST, fileId: 'f1', fileName: 'Roof photo #1 (front).jpg' })
    expect(path).toBe(`org/${ORG}/customers/${CUST}/f1_Roof_photo_1_front_.jpg`)
    const c = classifyFilesPath(path)
    expect(c).toMatchObject({ kind: 'org', orgId: ORG, area: 'customers' })
    expect(fieldRoleMayReadFilesPath(c)).toBe(false)
    expect(filesObjectHref(path)).toBe(`/api/files/object?path=${encodeURIComponent(path)}`)
  })

  it('accepts only the exact folder + fileId prefix', () => {
    const a = { orgId: ORG, customerId: CUST, fileId: 'f1' }
    expect(isCustomerFilePathFor(`org/${ORG}/customers/${CUST}/f1_x.pdf`, a)).toBe(true)
    expect(isCustomerFilePathFor(`org/${ORG}/customers/${CUST}/f2_x.pdf`, a)).toBe(false)
    expect(isCustomerFilePathFor(`org/${ORG}/customers/${CUST}/f1_`, a)).toBe(false)
    expect(isCustomerFilePathFor(`org/${ORG}/customers/${CUST}/f1_a/b.pdf`, a)).toBe(false)
    expect(isCustomerFilePathFor(`org/${OTHER_ORG}/customers/${CUST}/f1_x.pdf`, a)).toBe(false)
  })

  it('tags images as photos and everything else as documents (files.tag enum)', () => {
    expect(customerFileTag('image/heic', 'a.heic')).toBe('photo')
    expect(customerFileTag('application/octet-stream', 'IMG_1.HEIC')).toBe('photo')
    expect(customerFileTag('application/pdf', 'permit.pdf')).toBe('document')
  })
})

describe('POST /api/customers/[id]/files/register', () => {
  it('401 without a session', async () => {
    authResult = null
    expect((await register(req({ fileName: 'a.pdf', size: 10 }), ctx(CUST))).status).toBe(401)
  })

  it('signs a one-time upload into the private files bucket under the org/customer folder', async () => {
    as('u-admin', 'admin')
    const res = await register(req({ fileName: 'permit.pdf', size: 1000 }), ctx(CUST))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.bucket).toBe('files')
    expect(body.signedUploadToken).toBe('tok')
    expect(body.storagePath).toBe(`org/${ORG}/customers/${CUST}/${body.fileId}_permit.pdf`)
    expect(signedFor).toEqual([`files:${body.storagePath}`])
  })

  it.each([
    ['another org', 'admin', CUST_OTHER_ORG],
    ['no customer permission', 'no_customers', CUST],
    ['a closer on a customer they have no project for', 'closer', CUST_NOT_MINE],
    ['a malformed id', 'admin', 'not-a-uuid'],
  ])('404 for %s (never confirms the customer exists)', async (_n, role, id) => {
    as(role === 'closer' ? 'u-closer' : 'u-x', role)
    expect((await register(req({ fileName: 'a.pdf', size: 10 }), ctx(id))).status).toBe(404)
    expect(signedFor).toEqual([])
  })

  it('lets a closer add files to their own customer', async () => {
    as('u-closer', 'closer')
    expect((await register(req({ fileName: 'a.pdf', size: 10 }), ctx(CUST))).status).toBe(200)
  })

  it.each([
    ['setter', {}],
    ['canvasser', {}],
    ['inside_sales', {}],
    ['call_center', {}],
    ['office_staff', { custom_role_id: 'cr-canvass' }],
    ['grant_inside_sales', {}],
  ])('404 for field / sales-doc-barred role %s, decided before the customer is looked up', async (role, extra) => {
    as('u-field', role, extra)
    const tracked = jest.spyOn(db.client, 'from')
    expect((await register(req({ fileName: 'a.pdf', size: 10 }), ctx(CUST))).status).toBe(404)
    expect(tracked.mock.calls.map((c) => c[0])).not.toContain('customers')
    expect(signedFor).toEqual([])
  })

  it('rejects empty, missing-name and oversized files before signing', async () => {
    as('u-admin', 'admin')
    expect((await register(req({ fileName: '', size: 10 }), ctx(CUST))).status).toBe(400)
    expect((await register(req({ fileName: 'a.pdf', size: 0 }), ctx(CUST))).status).toBe(400)
    expect((await register(req({ fileName: 'a.pdf', size: CUSTOMER_FILE_MAX_BYTES + 1 }), ctx(CUST))).status).toBe(413)
    expect(signedFor).toEqual([])
  })
})

describe('POST /api/customers/[id]/files/finalize', () => {
  const FID = 'f0000000-0000-4000-8000-0000000000aa'
  const folder = `org/${ORG}/customers/${CUST}`

  it('writes a files row with the storage PATH, size/type from storage, linked to the customer', async () => {
    as('u-admin', 'admin')
    storageObjects.push({ folder, name: `${FID}_permit.pdf`, size: 1234, mimetype: 'application/pdf' })
    const res = await finalize(req({ fileId: FID, fileName: 'Permit (signed).pdf' }), ctx(CUST))
    expect(res.status).toBe(200)
    const row = db.tables.files[0]
    expect(row).toMatchObject({
      id: FID,
      org_id: ORG,
      customer_id: CUST,
      user_id: 'u-admin',
      storage_path: `${folder}/${FID}_permit.pdf`,
      file_name: 'Permit (signed).pdf',
      mime_type: 'application/pdf',
      tag: 'document',
    })
    expect(String(row.storage_path)).not.toMatch(/^https?:|\/object\/public\//)
  })

  it('400 when the upload never arrived (no row written)', async () => {
    as('u-admin', 'admin')
    expect((await finalize(req({ fileId: FID, fileName: 'a.pdf' }), ctx(CUST))).status).toBe(400)
    expect(db.tables.files).toEqual([])
  })

  it('does not adopt an object under another customer folder', async () => {
    as('u-admin', 'admin')
    storageObjects.push({ folder: `org/${ORG}/customers/${CUST_NOT_MINE}`, name: `${FID}_a.pdf`, size: 10, mimetype: 'application/pdf' })
    expect((await finalize(req({ fileId: FID }), ctx(CUST))).status).toBe(400)
    expect(db.tables.files).toEqual([])
  })

  it('removes an over-limit object instead of saving it', async () => {
    as('u-admin', 'admin')
    storageObjects.push({ folder, name: `${FID}_big.mov`, size: CUSTOMER_FILE_MAX_BYTES + 1, mimetype: 'video/quicktime' })
    expect((await finalize(req({ fileId: FID }), ctx(CUST))).status).toBe(413)
    expect(removed).toEqual([`files:${folder}/${FID}_big.mov`])
    expect(db.tables.files).toEqual([])
  })

  it('applies the same access rule as register', async () => {
    storageObjects.push({ folder, name: `${FID}_a.pdf`, size: 10, mimetype: 'application/pdf' })
    as('u-field', 'setter')
    expect((await finalize(req({ fileId: FID }), ctx(CUST))).status).toBe(404)
    as('u-x', 'admin')
    expect((await finalize(req({ fileId: FID }), ctx(CUST_OTHER_ORG))).status).toBe(404)
    expect(db.tables.files).toEqual([])
  })

  it('refuses (and removes) an object storage reports no size for', async () => {
    as('u-admin', 'admin')
    storageObjects.push({ folder, name: `${FID}_a.pdf`, size: undefined as unknown as number, mimetype: 'application/pdf' })
    expect((await finalize(req({ fileId: FID }), ctx(CUST))).status).toBe(400)
    expect(removed).toEqual([`files:${folder}/${FID}_a.pdf`])
    expect(db.tables.files).toEqual([])
  })

  it('a repeated finalize for the same fileId returns the row instead of a second one', async () => {
    as('u-admin', 'admin')
    storageObjects.push({ folder, name: `${FID}_a.pdf`, size: 10, mimetype: 'application/pdf' })
    expect((await finalize(req({ fileId: FID }), ctx(CUST))).status).toBe(200)
    expect(db.tables.files).toHaveLength(1)
  })

  it('a duplicate-key insert never removes the stored object, even when the existing row cannot be read back', async () => {
    as('u-admin', 'admin')
    storageObjects.push({ folder, name: `${FID}_a.pdf`, size: 10, mimetype: 'application/pdf' })
    // The row exists in another customer (so the read-back, scoped to this customer, finds nothing).
    db.tables.files.push({ id: FID, org_id: ORG, customer_id: CUST_NOT_MINE, storage_path: 'x' })
    const realFrom = (db.client as any).from
    jest.spyOn(db.client as any, 'from').mockImplementation((t: unknown) => {
      const b = realFrom(t)
      if (t !== 'files') return b
      const origInsert = b.insert
      b.insert = (p: unknown) => {
        origInsert(p)
        b.single = async () => ({ data: null, error: { code: '23505', message: 'duplicate key' } })
        return b
      }
      return b
    })
    const res = await finalize(req({ fileId: FID }), ctx(CUST))
    expect(res.status).toBe(409)
    expect(removed).toEqual([])
  })

  it('an unexpected error after the object is found removes it (every 500 means "upload again")', async () => {
    as('u-admin', 'admin')
    storageObjects.push({ folder, name: `${FID}_a.pdf`, size: 10, mimetype: 'application/pdf' })
    const realFrom = (db.client as any).from
    jest.spyOn(db.client as any, 'from').mockImplementation((t: unknown) => {
      if (t === 'files') throw new Error('boom')
      return realFrom(t)
    })
    const res = await finalize(req({ fileId: FID }), ctx(CUST))
    expect(res.status).toBe(500)
    expect(removed).toEqual([`files:${folder}/${FID}_a.pdf`])
  })

  it('400 on a non-uuid fileId', async () => {
    as('u-admin', 'admin')
    expect((await finalize(req({ fileId: '../x' }), ctx(CUST))).status).toBe(400)
  })
})

const viewerBase: ThreadViewer = { userId: 'u', orgId: ORG, ownerLike: false, jobBoard: false, jobEdit: false, jobFinancials: false, managerLike: false, closerLike: false, setterLike: false, pricingBarred: false }
const closerA: ThreadViewer = { ...viewerBase, userId: 'u-closer', closerLike: true }

describe('loadCustomerFiles (the one list both customer pages read)', () => {
  it('returns the customer\'s own files plus files on the given deals, newest first, org-scoped', async () => {
    const D1 = 'd0000000-0000-4000-8000-000000000001'
    const D2 = 'd0000000-0000-4000-8000-000000000002'
    db.tables.files.push(
      { id: 'a', org_id: ORG, customer_id: CUST, file_name: 'a.pdf', tag: 'document', storage_path: 'p/a', created_at: '2026-11-01' },
      { id: 'b', org_id: ORG, customer_id: null, opportunity_id: D1, file_name: 'b.pdf', tag: 'contract', storage_path: 'p/b', created_at: '2026-11-03' },
      { id: 'c', org_id: ORG, customer_id: null, opportunity_id: D2, file_name: 'c.pdf', tag: 'contract', storage_path: 'p/c', created_at: '2026-11-04' },
      { id: 'd', org_id: OTHER_ORG, customer_id: CUST, file_name: 'd.pdf', tag: 'document', storage_path: 'p/d', created_at: '2026-11-05' },
    )
    const rows = await loadCustomerFiles(db.client as any, { orgId: ORG, customerId: CUST, opportunityIds: [D1, 'not-a-uuid'] })
    expect(rows.map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('a closer on deal A does not see the contract on deal B of the same customer (customer_id alone is not enough)', async () => {
    const DEAL_A = 'd0000000-0000-4000-8000-00000000000a' // closer's own deal
    const DEAL_B = 'd0000000-0000-4000-8000-00000000000b' // another closer's deal, same customer
    ;(db.tables.opportunities ??= []).push(
      { id: DEAL_A, org_id: ORG, customer_id: CUST, lead_id: 'a1000000-0000-4000-8000-00000000000a', owner_user_id: 'u-closer' },
      { id: DEAL_B, org_id: ORG, customer_id: CUST, lead_id: 'a1000000-0000-4000-8000-00000000000b', owner_user_id: 'u-other' },
    )
    db.tables.projects.push({ id: 'b1000000-0000-4000-8000-00000000000a', org_id: ORG, opportunity_id: DEAL_A, customer_id: CUST })
    db.tables.files.push(
      { id: 'cust-level', org_id: ORG, customer_id: CUST, opportunity_id: null, project_id: null, lead_id: null, job_id: null, file_name: 'w9.pdf', tag: 'document', storage_path: 'p/1', created_at: '2026-11-01' },
      { id: 'contract-A', org_id: ORG, customer_id: CUST, opportunity_id: DEAL_A, file_name: 'a.pdf', tag: 'contract', storage_path: 'p/2', created_at: '2026-11-02' },
      { id: 'contract-B', org_id: ORG, customer_id: CUST, opportunity_id: DEAL_B, project_id: null, file_name: 'b.pdf', tag: 'contract', storage_path: 'p/3', created_at: '2026-11-03' },
      { id: 'project-A', org_id: ORG, customer_id: null, project_id: 'b1000000-0000-4000-8000-00000000000a', file_name: 'pa.pdf', tag: 'document', storage_path: 'p/4', created_at: '2026-11-04' },
      { id: 'lead-B', org_id: ORG, customer_id: CUST, lead_id: 'a1000000-0000-4000-8000-00000000000b', file_name: 'lb.jpg', tag: 'photo', storage_path: 'p/5', created_at: '2026-11-05' },
      { id: 'lead-A', org_id: ORG, customer_id: null, lead_id: 'a1000000-0000-4000-8000-00000000000a', file_name: 'la.jpg', tag: 'photo', storage_path: 'p/6', created_at: '2026-11-06' },
    )
    // The Customer File passes only the deals this closer can open (ctx.deals = [DEAL_A]).
    const rows = await loadCustomerFilesForViewer(db.client as any, closerA, CUST, { openableDealIds: [DEAL_A] })
    expect(rows.map((r) => r.id)).toEqual(['lead-A', 'project-A', 'contract-A', 'cust-level'])
    expect(rows.map((r) => r.id)).not.toContain('contract-B')
    expect(rows.map((r) => r.id)).not.toContain('lead-B')
    // The account page shape (no deal ids) only gets the customer-level file.
    expect((await loadCustomerFiles(db.client as any, { orgId: ORG, customerId: CUST })).map((r) => r.id)).toEqual(['cust-level'])
  })

  describe('account page scope (loadCustomerFilesForViewer with no deal list): closer A vs closer B on one customer', () => {
    const DEAL_A = 'd0000000-0000-4000-8000-0000000000a1'
    const DEAL_B = 'd0000000-0000-4000-8000-0000000000b1'
    const LEAD_A = 'a1000000-0000-4000-8000-0000000000a1'
    const LEAD_B = 'a1000000-0000-4000-8000-0000000000b1' // closer B's lead, ALSO carrying customer_id (set at contract sign)
    const LEAD_LOOSE = 'a1000000-0000-4000-8000-0000000000c1' // customer's lead with no deal at all
    const PROJ_A = 'b1000000-0000-4000-8000-0000000000a1'
    beforeEach(() => {
      ;(db.tables.opportunities ??= []).push(
        { id: DEAL_A, org_id: ORG, customer_id: CUST, lead_id: LEAD_A, owner_user_id: 'u-closer', setter_user_id: null },
        { id: DEAL_B, org_id: ORG, customer_id: CUST, lead_id: LEAD_B, owner_user_id: 'u-closer-b', setter_user_id: null },
      )
      ;(db.tables.leads ??= []).push(
        { id: LEAD_A, org_id: ORG, customer_id: CUST },
        { id: LEAD_B, org_id: ORG, customer_id: CUST },
        { id: LEAD_LOOSE, org_id: ORG, customer_id: CUST },
      )
      db.tables.projects.push({ id: PROJ_A, org_id: ORG, customer_id: CUST, opportunity_id: DEAL_A, owner_user_id: 'u-closer', lead_id: LEAD_A })
      db.tables.files.push(
        { id: 'lead-B-photo', org_id: ORG, customer_id: null, lead_id: LEAD_B, file_name: 'b.jpg', tag: 'photo', storage_path: 'p/b', created_at: '2026-11-05' },
        { id: 'lead-A-photo', org_id: ORG, customer_id: null, lead_id: LEAD_A, file_name: 'a.jpg', tag: 'photo', storage_path: 'p/a', created_at: '2026-11-04' },
        { id: 'loose-lead', org_id: ORG, customer_id: null, lead_id: LEAD_LOOSE, file_name: 'l.jpg', tag: 'photo', storage_path: 'p/l', created_at: '2026-11-03' },
      )
    })

    it('closer A gets their own lead\'s file, never closer B\'s lead file or the deal-less lead', async () => {
      const rows = await loadCustomerFilesForViewer(db.client as any, closerA, CUST, { extraProjectIds: [PROJ_A] })
      expect(rows.map((r) => r.id)).toEqual(['lead-A-photo'])
    })

    it('an owner (opens every deal) gets all three', async () => {
      const rows = await loadCustomerFilesForViewer(db.client as any, { ...viewerBase, ownerLike: true }, CUST)
      expect(rows.map((r) => r.id).sort()).toEqual(['lead-A-photo', 'lead-B-photo', 'loose-lead'])
    })

    it('the account page and the Customer File give a closer the same list', async () => {
      const account = await loadCustomerFilesForViewer(db.client as any, closerA, CUST, { extraProjectIds: [PROJ_A] })
      const file = await loadCustomerFilesForViewer(db.client as any, closerA, CUST, { openableDealIds: [DEAL_A] })
      expect(file.map((r) => r.id)).toEqual(account.map((r) => r.id))
    })
  })
})
