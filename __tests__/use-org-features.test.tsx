import { renderHook, waitFor } from '@testing-library/react'

import { fetchEffectivePermissions, resetOrgFeaturesCacheForTests, useOrgFeatures } from '@/hooks/useOrgFeatures'
import { DEFAULT_ORG_FEATURES } from '@/lib/org-features'

const respond = (ok: boolean, features?: unknown) => {
  ;(global as { fetch?: unknown }).fetch = jest.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => (features ? { flags: { features } } : {}) }))
}

describe('useOrgFeatures first render (7. no flash)', () => {
  beforeEach(() => resetOrgFeaturesCacheForTests())

  it('uses the server-resolved map on the very first render, then the fetched one', async () => {
    const off = { ...DEFAULT_ORG_FEATURES, insurance: false }
    respond(true, off)
    const { result } = renderHook(() => useOrgFeatures(off))
    expect(result.current.insurance).toBe(false)
    await waitFor(() => expect(result.current).toEqual(off))
  })
  it('a component mounted after the tab already loaded the switches starts with them (no ON-then-OFF flash)', async () => {
    const off = { ...DEFAULT_ORG_FEATURES, stormAlerts: false }
    respond(true, off)
    await fetchEffectivePermissions()
    const { result } = renderHook(() => useOrgFeatures())
    expect(result.current.stormAlerts).toBe(false)
  })
  it('nothing known yet and no server map: every feature on (the original company never loses anything)', async () => {
    respond(false)
    const { result } = renderHook(() => useOrgFeatures())
    expect(result.current).toEqual(DEFAULT_ORG_FEATURES)
    await waitFor(() => expect((global as unknown as { fetch: jest.Mock }).fetch).toHaveBeenCalled())
    expect(result.current).toEqual(DEFAULT_ORG_FEATURES)
  })
})
