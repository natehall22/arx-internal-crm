/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import AllWorkCalendar from '@/components/schedule/AllWorkCalendar'
import RollButton from '@/components/schedule/RollButton'
import { HARNESS_ALL_WORK } from '../../e2e/fixtures'

jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }))

const saved: Array<{ name: string; state: unknown }> = []
beforeEach(() => {
  saved.length = 0
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url)
    if (u.startsWith('/api/ops/all-work')) return { ok: true, json: async () => HARNESS_ALL_WORK } as Response
    if (u.startsWith('/api/table-views')) {
      if (init?.method === 'POST') {
        const b = JSON.parse(String(init.body))
        saved.push({ name: b.name, state: b.state })
        return { ok: true, json: async () => ({ view: { id: 'v1', name: b.name, state: b.state } }) } as Response
      }
      return { ok: true, json: async () => ({ views: [] }) } as Response
    }
    return { ok: false, json: async () => ({}) } as Response
  }) as never
})

describe('All work calendar', () => {
  it('month shows a count per section; a day lists its work by crew; a section chip narrows it; the last filter is remembered', async () => {
    jest.useFakeTimers()
    render(<AllWorkCalendar />)
    const day = await screen.findByLabelText('Tue, Nov 10: 3 items')
    fireEvent.click(screen.getByRole('button', { name: 'Grading' }))
    expect(screen.getByLabelText('Tue, Nov 10: 1 item')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Grading' })) // off again
    fireEvent.click(await screen.findByLabelText('Tue, Nov 10: 3 items'))
    expect(await screen.findByText('Rolled 2×')).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Green Team/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Blue Team/ })).toBeTruthy()
    expect(day).toBeTruthy()
    // "Last filter" is saved quietly into table_views a moment after the change.
    fireEvent.click(screen.getByRole('button', { name: 'Visits' }))
    await act(async () => {
      jest.advanceTimersByTime(900)
    })
    await waitFor(() => expect(saved.map((s) => s.name)).toContain('__last'))
    jest.useRealTimers()
  })
})

describe('RollButton', () => {
  it('opens the reason chips and sends the chosen reason (or none)', async () => {
    const onRoll = jest.fn(async () => ({ ok: true as const, to: '2026-11-11' }))
    render(<RollButton onRoll={onRoll} rolls={3} />)
    expect(screen.getByText('Rolled 3×')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Not ready — roll' }))
    fireEvent.click(screen.getByRole('button', { name: 'Weather' }))
    await waitFor(() => expect(onRoll).toHaveBeenCalledWith('weather'))
    await screen.findByText('Rolled to the next working day')
    fireEvent.click(screen.getByRole('button', { name: 'Not ready — roll' }))
    fireEvent.click(screen.getByRole('button', { name: 'Just roll' }))
    await waitFor(() => expect(onRoll).toHaveBeenLastCalledWith(null))
  })
  it('shows the server’s refusal and keeps the chips', async () => {
    render(<RollButton onRoll={async () => ({ ok: false, error: 'Only scheduled work can be rolled' })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Not ready — roll' }))
    fireEvent.click(screen.getByRole('button', { name: 'Other' }))
    expect(await screen.findByText('Only scheduled work can be rolled')).toBeTruthy()
  })
})
