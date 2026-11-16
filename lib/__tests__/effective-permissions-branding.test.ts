/** @jest-environment node */
/** /api/me/effective-permissions `org` branding: the caller's own org only, for every role (name + logo are not money). */
import { createFakeDb } from '@/lib/test-helpers/fake-db'

let authResult: unknown = null
jest.mock('@/lib/auth', () => ({
  requireAuthApi: jest.fn(async () => {
    if (!authResult) throw new Error('Unauthorized')
    return authResult
  }),
}))
jest.mock('@/lib/effective-permissions', () => ({
  resolveEffectivePermissionNames: jest.fn(async () => ({ fullAccess: false, permissionNames: new Set<string>() })),
}))
jest.mock('@/lib/org-profile', () => ({
  ...jest.requireActual('@/lib/org-profile'),
  loadOrgProfile: jest.fn(async () => jest.requireActual('@/lib/org-profile').defaultOrgProfile()),
}))
jest.mock('@/lib/org-brand', () => ({
  getDocumentBrand: jest.fn(async (_c: unknown, orgId: string) => ({ name: orgId === 'org-a' ? 'Summit Lawn' : 'Other Co', legalName: 'x', shortName: 'x' })),
}))
let db: ReturnType<typeof createFakeDb>
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

import { GET } from '@/app/api/me/effective-permissions/route'
import { navBrandingFromEffectivePermissions } from '@/hooks/useOrgFeatures'

const as = (role: string, org: string) => ({ authUser: { id: 'u1', email: null }, profile: { id: 'u1', org_id: org, role, custom_role_id: null } })

beforeEach(() => {
  db = createFakeDb({
    orgs: [
      { id: 'org-a', logo_url: 'org/org-a/logo.png?v=1', settings_logo: null, settings_logo_dark: null },
      { id: 'org-b', logo_url: 'org/org-b/logo.png?v=1', settings_logo: null, settings_logo_dark: null },
    ],
  })
})

test('returns the caller\'s own org branding, never another org\'s', async () => {
  authResult = as('owner', 'org-a')
  const body = await (await GET()).json()
  expect(body.org.name).toBe('Summit Lawn')
  expect(body.org.logoHref).toContain('/api/org-logo/org-a')
  expect(JSON.stringify(body.org)).not.toContain('org-b')
})

test('a field role still gets branding', async () => {
  authResult = as('setter', 'org-b')
  const body = await (await GET()).json()
  expect(body.org.name).toBe('Other Co')
  expect(body.org.logoHref).toContain('/api/org-logo/org-b')
})

test('client parse: missing org is blank, no fallback brand', () => {
  expect(navBrandingFromEffectivePermissions({})).toEqual({ name: '', logoHref: null, logoDarkHref: null })
})
