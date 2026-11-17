/** @jest-environment node */
import { readFileSync } from 'fs'
import path from 'path'

import { builtInContractsAvailable, resolveOrgProfile } from '@/lib/org-profile'

let profileSettings: unknown = null
jest.mock('@/lib/auth', () => ({ requireAuthApi: async () => ({ authUser: { id: 'u1' }, profile: { id: 'u1', org_id: 'o1', role: 'owner' } }) }))
jest.mock('@/lib/sales-doc-access', () => ({ resolveSalesDocAccessBarred: async () => false }))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profileSettings ? { features: {}, profile: profileSettings } : { features: {} }, error: null }) }) }) }),
  }),
}))

import { POST } from '@/app/api/contracts/create/route'

const read = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8')
const req = () => new Request('http://x/api/contracts/create', { method: 'POST', body: '{}' }) as never

describe('built-in roofing agreements', () => {
  it.each(['lawn_landscape', 'exterior_cleaning', 'home_builder'])('%s: the create route refuses and points to Signatures', async (id) => {
    profileSettings = { id }
    const res = await POST(req())
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Use Signatures to send your own agreement')
  })

  it('roofing (nothing stored or roofing stored) is not refused by the gate', async () => {
    for (const stored of [null, { id: 'roofing' }]) {
      profileSettings = stored
      const res = await POST(req())
      expect(res.status === 403 && (await res.json()).error === 'Use Signatures to send your own agreement').toBe(false)
    }
  })

  it('availability: roofing only; the entry points swap the button for a Signatures link', () => {
    expect(builtInContractsAvailable(resolveOrgProfile({}))).toBe(true)
    expect(builtInContractsAvailable(resolveOrgProfile({ profile: { id: 'lawn_landscape' } }))).toBe(false)
    for (const f of ['app/opportunities/[id]/OpportunityView.tsx', 'app/proposals/[id]/page.tsx']) {
      const src = read(f)
      expect(src).toContain('builtInContracts')
      expect(src).toContain('href="/signing"')
    }
    // Signing links already sent keep working: the sign route is not gated.
    expect(read('app/api/contracts/sign/route.ts')).not.toContain('builtInContractsAvailable')
  })
})
