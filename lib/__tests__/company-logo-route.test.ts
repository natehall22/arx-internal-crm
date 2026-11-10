/** @jest-environment node */
/** /api/company-logo: host-scoped logo for signed-out pages — bytes, never a redirect, never the org id. */
let fence: { kind: string; orgId?: string } = { kind: 'org', orgId: '9f0c1b2a-0000-4000-8000-000000000001' }
jest.mock('@/lib/company-host-server', () => ({ getRequestHostFence: async () => fence }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
jest.mock('@/lib/org-logo-serve', () => ({
  LOGO_CACHE: 'public, max-age=300',
  signedOrgLogoUrl: async (_a: unknown, orgId: string) => `https://proj.supabase.co/storage/v1/object/sign/files/org/${orgId}/logo.png?token=t`,
}))

import { GET } from '@/app/api/company-logo/route'

beforeEach(() => {
  fence = { kind: 'org', orgId: '9f0c1b2a-0000-4000-8000-000000000001' }
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } }))
})

test('serves the bytes with no redirect and no org id anywhere in the response', async () => {
  const res = await GET()
  expect(res.status).toBe(200)
  expect(res.headers.get('location')).toBeNull()
  expect(JSON.stringify(Object.fromEntries(res.headers.entries()))).not.toContain('9f0c1b2a')
  expect(res.headers.get('content-security-policy')).toContain('sandbox')
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]))
})

test('no company behind this address (legacy / apex / unknown) → 404', async () => {
  fence = { kind: 'open' }
  expect((await GET()).status).toBe(404)
  fence = { kind: 'closed' }
  expect((await GET()).status).toBe(404)
})

test('a non-image upstream is refused', async () => {
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }))
  expect((await GET()).status).toBe(404)
})

