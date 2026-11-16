/** @jest-environment node */
/** Optional logo for dark backgrounds: path, variant fallback, tenant isolation, main logo unchanged. */
import { orgLogoHref, orgLogoPath, storedOrgDarkLogo } from '@/lib/files/files-object'
import { signedOrgLogoUrl } from '@/lib/org-logo-serve'

const ORG = '9f0c1b2a-0000-4000-8000-000000000001'
const OTHER = '9f0c1b2a-0000-4000-8000-000000000002'
const MAIN = { logo_url: `org/${ORG}/logo.png?v=1`, settings: {} }
const BOTH = { logo_url: `org/${ORG}/logo.png?v=1`, settings: { logo_dark_url: `org/${ORG}/logo-dark.webp?v=2` } }

function fakeAdmin(org: unknown) {
  const signed: string[] = []
  const admin = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: org }) }) }) }),
    storage: { from: () => ({ createSignedUrl: async (p: string) => { signed.push(p); return { data: { signedUrl: `https://x/${p}` }, error: null } } }) },
  }
  return { admin: admin as never, signed }
}

describe('orgLogoPath', () => {
  test('main logo is unchanged and ignores the dark one', () => {
    expect(orgLogoPath(ORG, BOTH)).toBe(`org/${ORG}/logo.png`)
    expect(orgLogoPath(ORG, MAIN, { variant: 'main' })).toBe(`org/${ORG}/logo.png`)
  })
  test('dark variant returns logo-dark, else falls back to the main logo', () => {
    expect(orgLogoPath(ORG, BOTH, { variant: 'dark' })).toBe(`org/${ORG}/logo-dark.webp`)
    expect(orgLogoPath(ORG, MAIN, { variant: 'dark' })).toBe(`org/${ORG}/logo.png`)
  })
  test("another company's or malformed dark value is never returned", () => {
    const foreign = { ...MAIN, settings: { logo_dark_url: `org/${OTHER}/logo-dark.png?v=1` } }
    expect(orgLogoPath(ORG, foreign, { variant: 'dark' })).toBe(`org/${ORG}/logo.png`)
    expect(orgLogoPath(OTHER, BOTH, { variant: 'dark' })).toBeNull()
    for (const bad of [`org/${ORG}/contracts/secret.pdf`, `org/${ORG}/sub/logo-dark.png`, `org/${ORG}/logo-dark.png/x`, 'https://example.com/logo-dark.png']) {
      expect(orgLogoPath(ORG, { ...MAIN, settings: { logo_dark_url: bad } }, { variant: 'dark' })).toBe(`org/${ORG}/logo.png`)
    }
    // a dark path stored in the main column is not a main logo
    expect(orgLogoPath(ORG, { logo_url: `org/${ORG}/logo-dark.png` })).toBeNull()
  })
})

describe('orgLogoHref', () => {
  test('main href is byte-identical to before (no variant param)', () => {
    expect(orgLogoHref(ORG, MAIN)).toMatch(new RegExp(`^/api/org-logo/${ORG}\\?v=[0-9a-z]+$`))
    expect(orgLogoHref(ORG, BOTH)).toBe(orgLogoHref(ORG, MAIN))
  })
  test('dark href carries variant=dark and its own cache tag; no dark logo means the main link', () => {
    expect(orgLogoHref(ORG, BOTH, { variant: 'dark' })).toMatch(new RegExp(`^/api/org-logo/${ORG}\\?variant=dark&v=[0-9a-z]+$`))
    expect(orgLogoHref(ORG, MAIN, { variant: 'dark' })).toBe(orgLogoHref(ORG, MAIN))
    expect(orgLogoHref(ORG, {}, { variant: 'dark' })).toBeNull()
    expect(storedOrgDarkLogo(MAIN)).toBeNull()
  })
})

describe('signedOrgLogoUrl', () => {
  test('signs only the org own object, per variant', async () => {
    const a = fakeAdmin(BOTH)
    expect(await signedOrgLogoUrl(a.admin, ORG, 'dark')).toContain(`org/${ORG}/logo-dark.webp`)
    expect(await signedOrgLogoUrl(a.admin, ORG)).toContain(`org/${ORG}/logo.png`)
    expect(a.signed).toEqual([`org/${ORG}/logo-dark.webp`, `org/${ORG}/logo.png`])
  })
  test('falls back to main when there is no dark logo; signs nothing for another company', async () => {
    const a = fakeAdmin(MAIN)
    expect(await signedOrgLogoUrl(a.admin, ORG, 'dark')).toContain(`org/${ORG}/logo.png`)
    const b = fakeAdmin({ logo_url: `org/${OTHER}/logo.png`, settings: { logo_dark_url: `org/${OTHER}/logo-dark.png` } })
    expect(await signedOrgLogoUrl(b.admin, ORG, 'dark')).toBeNull()
    expect(b.signed).toEqual([])
  })
})
