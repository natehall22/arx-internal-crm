/** @jest-environment node */
/**
 * Customer File → Files tab "Add files": POST /api/customers/[id]/files/register + /finalize.
 *  - Private `files` bucket, path org/<org>/customers/<customer>/<fileId>_<name>; the row stores the PATH, never a URL.
 *  - Same people as the page (customers:view/edit; reps only on their own customers), minus field roles / sales-doc-barred.
 *  - Finalize trusts storage, not the browser: the object must exist under this customer's folder for that fileId.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { classifyFilesPath, fieldRoleMayReadFilesPath, filesObjectHref } from '@/lib/files/files-object'
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

jest.mock('@/lib/effective-permissions', () => ({
  resolveEffectivePermissionNames: jest.fn(async (_a: unknown, _id: string, p: { role: string }) => {
    if (p.role === 'admin') return { fullAccess: true, permissionNames: new Set<string>() }
    if (p.role === 'no_customers') return { fullAccess: false, permissionNames: new Set<string>(['leads:view']) }
    return { fullAccess: false, permissionNames: new Set<string>(['customers:view']) }
  }),
}))
jest.mock('@/lib/sales-doc-access', () => {
  const { isFieldRoleLike } = jest.requireActual('@/lib/permissions')
  return {
    resolveFieldOrSalesDocBarred: jest.fn(async (admin: any, p: { role: string; custom_role_id?: string | null }) => {
      let customRoleName: string | null = null
      if (p.custom_role_id) {
        const { data } = await admin.from('custom_roles').select('name, display_name').eq('id', p.custom_role_id).maybeSingle()
        customRoleName = data?.name ?? null
      }
      return isFieldRoleLike({ role: p.role, customRoleName }) || p.role === 'sales_doc_barred'
    }),
  }
})

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
    ['office_staff', { custom_role_id: 'cr-canvass' }],
    ['sales_doc_barred', {}],
  ])('403 for field role %s', async (role, extra) => {
    as('u-field', role, extra)
    expect((await register(req({ fileName: 'a.pdf', size: 10 }), ctx(CUST))).status).toBe(403)
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
    expect((await finalize(req({ fileId: FID }), ctx(CUST))).status).toBe(403)
    as('u-x', 'admin')
    expect((await finalize(req({ fileId: FID }), ctx(CUST_OTHER_ORG))).status).toBe(404)
    expect(db.tables.files).toEqual([])
  })

  it('400 on a non-uuid fileId', async () => {
    as('u-admin', 'admin')
    expect((await finalize(req({ fileId: '../x' }), ctx(CUST))).status).toBe(400)
  })
})
