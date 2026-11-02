/** @jest-environment node */
/**
 * Phase 2 prep for making the `files` bucket private:
 *  - the org logo resolves only to `org/<orgId>/logo.<ext>` and is served by the public GET /api/org-logo/<orgId>;
 *  - writers store storage paths, never public URLs (admin logo, proposal cover image, contracts, change orders);
 *  - no app code builds a `files` public URL any more.
 */
import fs from 'fs'
import path from 'path'

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { filesObjectHref, filesPathFromStoredUrl, orgLogoHref, orgLogoPath, storedOrgLogo } from '@/lib/files/files-object'

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
jest.mock('@/lib/sales-doc-access', () => ({ resolveSalesDocAccessBarred: jest.fn(async () => false) }))

let db: ReturnType<typeof createFakeDb>
const signed: string[] = []
const uploaded: string[] = []
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (t: string) => (db.client as any).from(t),
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (p: string, ttl: number) => {
          signed.push(`${bucket}:${p}:${ttl}`)
          return { data: { signedUrl: `${SB}/storage/v1/object/sign/${bucket}/${p}?token=t` }, error: null }
        },
        upload: async (p: string) => {
          uploaded.push(`${bucket}:${p}`)
          return { error: null }
        },
        list: async () => ({ data: [], error: null }),
        remove: async () => ({ error: null }),
      }),
    },
  }),
}))

import { GET as getOrgLogo } from '@/app/api/org-logo/[orgId]/route'
import { POST as postLogo, DELETE as deleteLogo } from '@/app/api/admin/logo/route'
import { POST as postProposalImage } from '@/app/api/proposals/[id]/image/route'

const PUBLIC_LOGO = `${SB}/storage/v1/object/public/files/org/${ORG}/logo.png`

beforeEach(() => {
  signed.length = 0
  uploaded.length = 0
  authResult = null
  db = createFakeDb({
    orgs: [
      { id: ORG, logo_url: PUBLIC_LOGO, settings: { logo_url: PUBLIC_LOGO, timezone: 'America/New_York' } },
      { id: OTHER, logo_url: `org/${ORG}/contracts/secret.pdf`, settings: {} },
    ],
    proposals: [{ id: 'p1', org_id: ORG, cover_image_url: null }],
  })
})

describe('org logo resolution', () => {
  it('prefers the column, then settings', () => {
    expect(storedOrgLogo({ logo_url: 'a', settings: { logo_url: 'b' } })).toBe('a')
    expect(storedOrgLogo({ logo_url: null, settings: { logo_url: 'b' } })).toBe('b')
    expect(storedOrgLogo(null)).toBeNull()
  })

  it("accepts the org's own logo as a public URL or a stored path (with ?v=)", () => {
    expect(orgLogoPath(ORG, { logo_url: PUBLIC_LOGO })).toBe(`org/${ORG}/logo.png`)
    expect(orgLogoPath(ORG, { logo_url: `org/${ORG}/logo.webp?v=123` })).toBe(`org/${ORG}/logo.webp`)
  })

  it('refuses anything that is not that org’s logo object', () => {
    expect(orgLogoPath(OTHER, { logo_url: `org/${ORG}/logo.png` })).toBeNull()
    expect(orgLogoPath(ORG, { logo_url: `org/${ORG}/contracts/secret.pdf` })).toBeNull()
    expect(orgLogoPath(ORG, { logo_url: `org/${ORG}/sub/logo.png` })).toBeNull()
    expect(orgLogoPath(ORG, { logo_url: 'https://example.com/logo.png' })).toBeNull()
    expect(orgLogoPath(null, { logo_url: `org/${ORG}/logo.png` })).toBeNull()
  })

  it('links through the logo route with a version that changes with the stored value', () => {
    const a = orgLogoHref(ORG, { logo_url: `org/${ORG}/logo.png?v=1` })
    const b = orgLogoHref(ORG, { logo_url: `org/${ORG}/logo.png?v=2` })
    expect(a).toMatch(new RegExp(`^/api/org-logo/${ORG}\\?v=[0-9a-z]+$`))
    expect(a).not.toBe(b)
    expect(orgLogoHref(ORG, { logo_url: `org/${ORG}/logo.png?v=1` }, { appUrl: 'https://crm.example.com/' })).toBe(
      `https://crm.example.com${a}`
    )
    expect(orgLogoHref(ORG, { logo_url: null })).toBeNull()
  })
})

describe('GET /api/org-logo/[orgId]', () => {
  const call = (orgId: string) => getOrgLogo(new Request(`http://x/api/org-logo/${orgId}`), { params: { orgId } })

  it('needs no session and 302s to a signed logo URL with a public cache header', async () => {
    const res = await call(ORG)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain(`/object/sign/files/org/${ORG}/logo.png`)
    expect(res.headers.get('cache-control')).toMatch(/^public, max-age=300/)
    expect(signed).toEqual([`files:org/${ORG}/logo.png:3600`])
  })

  it('404s a bad id, an unknown org and a stored value that is not the logo, without signing', async () => {
    for (const id of ['not-a-uuid', '00000000-0000-0000-0000-000000000000', OTHER]) {
      expect((await call(id)).status).toBe(404)
    }
    expect(signed).toEqual([])
  })
})

describe('writers store paths, not public URLs', () => {
  const admin = () => {
    authResult = { authUser: { id: 'u1', email: null }, profile: { id: 'u1', org_id: ORG, role: 'admin', custom_role_id: null } }
  }
  const form = (field: string, file: File) => {
    const fd = new FormData()
    fd.append(field, file)
    return { formData: async () => fd } as any
  }

  it('admin logo upload stores the path in both places readers look and returns the route link', async () => {
    admin()
    const res = await postLogo(form('logo', new File([new Uint8Array([1])], 'my logo%.png', { type: 'image/png' })))
    expect(res.status).toBe(200)
    const body = await res.json()
    const org = db.tables.orgs.find((o) => o.id === ORG) as any
    expect(org.logo_url).toMatch(new RegExp(`^org/${ORG}/logo\\.png\\?v=\\d+$`))
    expect(org.settings.logo_url).toBe(org.logo_url)
    expect(org.settings.timezone).toBe('America/New_York')
    expect(body.logo_url).toBe(orgLogoHref(ORG, org))
    expect(uploaded).toEqual([`files:org/${ORG}/logo.png`])
  })

  it('admin logo delete clears both the column and settings; non-admins and anonymous are refused', async () => {
    authResult = null
    expect((await deleteLogo()).status).toBe(401)
    authResult = { authUser: { id: 'u2', email: null }, profile: { id: 'u2', org_id: ORG, role: 'closer' } }
    expect((await deleteLogo()).status).toBe(403)
    admin()
    expect((await deleteLogo()).status).toBe(200)
    const org = db.tables.orgs.find((o) => o.id === ORG) as any
    expect(org.logo_url).toBeNull()
    expect(org.settings.logo_url).toBeUndefined()
    expect(org.settings.timezone).toBe('America/New_York')
  })

  it('proposal cover upload stores a bare path the readers resolve', async () => {
    admin()
    const res = await postProposalImage(form('image', new File([new Uint8Array([1])], 'house.jpg', { type: 'image/jpeg' })), {
      params: { id: 'p1' },
    })
    expect(res.status).toBe(200)
    const stored = String((db.tables.proposals[0] as any).cover_image_url)
    expect(stored).toMatch(new RegExp(`^proposals/${ORG}/p1/property-\\d+\\.jpg$`))
    expect(filesPathFromStoredUrl(stored)).toBe(stored)
    expect(filesObjectHref(stored)).toBe(`/api/files/object?path=${encodeURIComponent(stored)}`)
  })
})

describe('no app code builds a files-bucket public URL', () => {
  const roots = ['app', 'lib', 'components'].map((d) => path.join(process.cwd(), d))
  const sources: string[] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p)
      } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) sources.push(p)
    }
  }
  roots.forEach(walk)

  it.each([
    ['/object/public/files/', /object\/public\/files\//],
    ["getPublicUrl on the files bucket", /from\(\s*['"]files['"]\s*\)\s*\.getPublicUrl/],
    ['inline createSignedUrl on the files bucket (use signFilesObject)', /from\(\s*['"]files['"]\s*\)\s*\.createSignedUrl/],
  ])('%s', (_label, re) => {
    const hits = sources.filter((f) => re.test(fs.readFileSync(f, 'utf8')))
    expect(hits.map((f) => path.relative(process.cwd(), f))).toEqual([])
  })
})


describe('filesObjectHrefOrExternal', () => {
  const { filesObjectHrefOrExternal } = require('../files/files-object')
  it('routes files objects, passes other hosts, refuses unsafe bare paths', () => {
    expect(filesObjectHrefOrExternal('proposals/org1/p1/cover.jpg')).toMatch(/^\/api\/files\/object\?path=/)
    expect(filesObjectHrefOrExternal('https://maps.googleapis.com/maps/api/staticmap?x=1')).toBe('https://maps.googleapis.com/maps/api/staticmap?x=1')
    expect(filesObjectHrefOrExternal('org/a/%2e%2e/b.png')).toBeNull()
    expect(filesObjectHrefOrExternal('')).toBeNull()
    expect(filesObjectHrefOrExternal(null)).toBeNull()
  })
})
