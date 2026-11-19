/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'

import ScheduleFilterBar from '@/components/schedule/ScheduleFilterBar'
import { EMPTY_FILTERS } from '@/lib/schedule-filters'

const options = { crews: [{ value: 'c1', label: 'Green Team' }], techs: [], customers: [], developments: [] }
const trades = [
  { slug: 'lawn', label: 'Lawn care', color: '#0a0', active: true },
  { slug: 'old', label: 'Old trade', color: '#999', active: false },
]

describe('ScheduleFilterBar', () => {
  it('no filter: no banner, inactive trades hidden', () => {
    render(<ScheduleFilterBar value={EMPTY_FILTERS} onChange={() => undefined} options={options} trades={trades} total={10} shown={10} />)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Old trade' })).toBeNull()
  })

  it('a filter on: banner counts what is hidden; a selected inactive trade keeps its chip; a selected crew with no work here stays selectable', () => {
    render(<ScheduleFilterBar value={{ ...EMPTY_FILTERS, trades: ['old'], crew: 'gone' }} onChange={() => undefined} options={options} trades={trades} total={10} shown={4} />)
    expect(screen.getByRole('status').textContent).toContain('Filtered — 6 hidden')
    expect(screen.getByRole('button', { name: 'Old trade' }).getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByLabelText('Crews') as HTMLSelectElement).value).toBe('gone')
  })
})
