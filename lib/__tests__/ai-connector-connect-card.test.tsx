/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react'

import ConnectAiCard, { CHATGPT_CONNECTORS_URL, CLAUDE_CONNECTORS_URL } from '@/components/ai-connector/ConnectAiCard'

let mockOn = true
jest.mock('@/lib/org-features-server', () => ({ isOrgFeatureOn: async () => mockOn }))
jest.mock('@/lib/org-brand', () => ({ getOrgBrand: async () => ({ name: 'Example Roofing' }) }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))

import { loadConnectCard } from '@/lib/ai-connector/connect-card'

describe('connect card flag', () => {
  // jsdom has no Request; requestOrigin only reads .url and .headers.get
  const req = { url: 'https://crm.example.com/api/settings', headers: new Headers({ host: 'crm.example.com' }) } as unknown as Request
  it('feature off → no card info', async () => {
    mockOn = false
    expect(await loadConnectCard(req, 'org1')).toBeNull()
  })
  it('feature on → the /mcp address and company name', async () => {
    mockOn = true
    expect(await loadConnectCard(req, 'org1')).toEqual({ address: 'https://crm.example.com/mcp', companyName: 'Example Roofing' })
  })
  it('no org → null', async () => {
    expect(await loadConnectCard(req, null)).toBeNull()
  })
})

describe('ConnectAiCard', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    window.open = jest.fn() as unknown as typeof window.open
  })
  afterEach(() => jest.useRealTimers())

  it('copies, shows Copied for 2s, and Open Claude copies + opens the connectors page', async () => {
    const writeText = jest.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })
    render(<ConnectAiCard address="https://crm.example.com/mcp" companyName="Example Roofing" />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy address' })) })
    expect(writeText).toHaveBeenCalledWith('https://crm.example.com/mcp')
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
    act(() => { jest.advanceTimersByTime(2100) })
    expect(screen.getByRole('button', { name: 'Copy address' })).toBeTruthy()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open Claude' })) })
    expect(window.open).toHaveBeenCalledWith(CLAUDE_CONNECTORS_URL, '_blank', 'noopener,noreferrer')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open ChatGPT' })) })
    expect(window.open).toHaveBeenCalledWith(CHATGPT_CONNECTORS_URL, '_blank', 'noopener,noreferrer')
    expect(writeText).toHaveBeenCalledTimes(3)
    expect(screen.getAllByText(/Example Roofing/).length).toBeGreaterThan(0)
  })

  it('Open Claude starts the copy BEFORE opening the new tab (a focused page is required for the clipboard)', async () => {
    const order: string[] = []
    Object.assign(navigator, { clipboard: { writeText: jest.fn(async () => { order.push('copy') }) } })
    window.open = jest.fn(() => { order.push('open'); return null }) as unknown as typeof window.open
    render(<ConnectAiCard address="https://crm.example.com/mcp" companyName="Example Roofing" />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open Claude' })) })
    expect(order).toEqual(['copy', 'open'])
  })

  it('no clipboard API → address is selected and a hint shows', async () => {
    Object.assign(navigator, { clipboard: undefined })
    document.execCommand = jest.fn(() => false)
    render(<ConnectAiCard address="https://crm.example.com/mcp" companyName="Example Roofing" />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy address' })) })
    expect(screen.getByRole('status').textContent).toMatch(/selected/)
    expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull()
  })
})
