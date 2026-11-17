/** @jest-environment node */
let pages: Array<Array<Record<string, unknown>>> = []
const ranges: Array<[number, number]> = []
jest.mock('@/lib/supabase/org-db', () => ({
  orgDb: () => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'is', 'eq', 'in', 'gte', 'lte', 'order']) q[m] = () => q
    q.range = async (a: number, b: number) => { ranges.push([a, b]); return { data: pages[ranges.length - 1] ?? [], error: null } }
    return { from: () => q }
  },
}))

import { loadWorkSecondsByStop } from '@/lib/time-tracking-db'

const row = (n: number) => ({ id: `e${n}`, work_order_id: 'w1', kind: 'work', started_at: '2026-11-10T13:00:00Z', ended_at: '2026-11-10T14:00:00Z' })
const opts = { fromIso: 'a', toIso: 'b', workOrderIds: ['w1'] }
beforeEach(() => { ranges.length = 0 })

describe('loadWorkSecondsByStop', () => {
  it('reads every page, never stopping at the first thousand', async () => {
    pages = [Array.from({ length: 1000 }, (_, i) => row(i)), [row(1000), row(1001)]]
    const out = await loadWorkSecondsByStop({} as never, 'o1', opts)
    expect(out!.get('w1')).toBe(1002 * 3600)
    expect(ranges).toEqual([[0, 999], [1000, 1999]])
  })
  it('errors loudly past the page cap instead of truncating', async () => {
    pages = Array.from({ length: 30 }, () => Array.from({ length: 1000 }, (_, i) => row(i)))
    await expect(loadWorkSecondsByStop({} as never, 'o1', opts)).rejects.toThrow(/Too many/)
  })
})
