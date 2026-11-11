/** @jest-environment jsdom */
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

import OrgProfileCard from '@/components/admin/OrgProfileCard'
import { OrgProfileProvider } from '@/components/OrgProfileProvider'
import { resetOrgFeaturesCacheForTests, useOrgFeatures, useOrgProfile } from '@/hooks/useOrgFeatures'
import { INDUSTRY_PROFILE_IDS, INDUSTRY_PROFILES } from '@/lib/industry-profiles'
import { clientOrgProfile, resolveOrgProfile } from '@/lib/org-profile'
import { planProfileSwitch } from '@/lib/org-profile-server'
import { DEFAULT_ORG_TRADES } from '@/lib/org-trades'

jest.mock('@/components/ui/toast', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))

const lawn = resolveOrgProfile({ profile: { id: 'lawn_landscape', version: 1 } })

describe('first paint uses the server-resolved profile (no menu flash)', () => {
  beforeEach(() => {
    resetOrgFeaturesCacheForTests()
    global.fetch = jest.fn(() => new Promise(() => {})) as never // the refresh never answers: we only check first paint
  })
  it('useOrgProfile / useOrgFeatures start from the layout provider', () => {
    const wrapper = ({ children }: { children: ReactNode }) => <OrgProfileProvider initial={{ profile: clientOrgProfile(lawn), features: lawn.features }}>{children}</OrgProfileProvider>
    expect(renderHook(() => useOrgProfile(), { wrapper }).result.current.terms.jobBoard).toBe('Work board')
    expect(renderHook(() => useOrgFeatures(), { wrapper }).result.current.canvassing).toBe(false)
  })
  it('signed out / no provider: roofing, every feature on (as before)', () => {
    expect(renderHook(() => useOrgProfile()).result.current.terms.jobBoard).toBe('Job Board')
    expect(renderHook(() => useOrgFeatures()).result.current.canvassing).toBe(true)
  })
})

describe('OrgProfileCard', () => {
  const profiles = INDUSTRY_PROFILE_IDS.map((id) => ({ id, label: INDUSTRY_PROFILES[id].label, description: INDUSTRY_PROFILES[id].description }))
  const plan = (to: 'lawn_landscape' | 'home_builder') => planProfileSwitch({ features: {} }, [...DEFAULT_ORG_TRADES], to)

  it('a slow, older preview never replaces the newer one, and Apply posts the shown plan’s profile', async () => {
    const pending: Record<string, (v: unknown) => void> = {}
    const posts: unknown[] = []
    global.fetch = jest.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)))
        return Promise.resolve({ ok: false, json: async () => ({ error: 'stop' }) })
      }
      const to = new URL(url, 'http://x').searchParams.get('to')!
      return new Promise((resolve) => {
        pending[to] = () => resolve({ ok: true, json: async () => ({ plan: plan(to as 'lawn_landscape') }) })
      })
    }) as never
    render(<OrgProfileCard current={{ ...profiles[0] }} profiles={profiles} />)
    const select = screen.getByLabelText('Switch to')
    fireEvent.change(select, { target: { value: 'lawn_landscape' } })
    fireEvent.change(select, { target: { value: 'home_builder' } })
    await act(async () => pending.home_builder(null))
    await waitFor(() => screen.getByText('What changes with Home builder'))
    await act(async () => pending.lawn_landscape(null)) // the stale answer arrives last
    expect(screen.queryByText('What changes with Lawn & landscape')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Home builder' }))
    await waitFor(() => expect(posts).toEqual([{ profile: 'home_builder', resetFeatures: false }]))
  })

  it('an unknown stored profile is called out and the current option is not marked current', () => {
    render(<OrgProfileCard current={{ ...profiles[0], unknownStoredId: 'pool_service' }} profiles={profiles} />)
    expect(screen.getByRole('status').textContent).toContain('pool_service')
    expect(screen.queryByText(/\(current\)/)).toBeNull()
  })
})
