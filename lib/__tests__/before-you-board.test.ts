/** @jest-environment node */
import { beforeYouFor, beforeYouText, shortYmd, type CrewRow } from '@/lib/before-you'
import { buildBoard, filterLots, groupByBuilderAndDevelopment, type BoardCrew, type BoardProperty } from '@/lib/development-board'
import type { OrgTrade } from '@/lib/org-trades'

const trades: OrgTrade[] = [
  { slug: 'grading', label: 'Grading', sort: 10, active: true, matchKeywords: null },
  { slug: 'sod', label: 'Sod', sort: 20, active: true, matchKeywords: null },
  { slug: 'landscaping', label: 'Landscaping', sort: 30, active: true, matchKeywords: null },
]
const day = (at: string) => at.slice(0, 10)
const wo = (o: Partial<CrewRow>): CrewRow => ({ id: 'x', job_id: 'j', property_id: 'p1', trade: 'grading', status: 'pending', scheduled_date: null, completed_at: null, ...o })

describe('before you', () => {
  const me = { id: 'me', trade: 'landscaping', property_id: 'p1' }
  it('lists earlier trades on the same property, in the company order, done with a day or not done', () => {
    const lines = beforeYouFor(
      me,
      [wo({ id: 'a', trade: 'sod', scheduled_date: '2026-11-20' }), wo({ id: 'b', trade: 'grading', status: 'completed', completed_at: '2026-11-12T15:00:00Z' }), wo({ id: 'me', trade: 'landscaping' })],
      new Set(),
      trades,
      day
    )
    expect(lines.map(beforeYouText)).toEqual(['Grading — done Nov 12', 'Sod — not done yet · Nov 20'])
  })
  it('never lists later trades, itself, cancelled rows or another property', () => {
    const lines = beforeYouFor(
      { id: 'me', trade: 'grading', property_id: 'p1' },
      [wo({ id: 'a', trade: 'sod' }), wo({ id: 'c', trade: 'landscaping' })],
      new Set(),
      trades,
      day
    )
    expect(lines).toEqual([])
    expect(beforeYouFor(me, [wo({ id: 'o', property_id: 'p2' }), wo({ id: 'k', status: 'cancelled' })], new Set(), trades, day)).toEqual([])
  })
  it('a stage dependency adds a later trade the company order would not (only the crew the stage names)', () => {
    const lines = beforeYouFor(
      { id: 'me', trade: 'grading', property_id: 'p1' },
      [wo({ id: 'a', trade: 'sod', status: 'completed', completed_at: '2026-11-01T10:00:00Z' }), wo({ id: 'b', trade: 'sod', status: 'pending' })],
      new Set(['a']),
      trades,
      day
    )
    expect(lines).toEqual([{ trade: 'sod', label: 'Sod', done: true, date: '2026-11-01' }])
  })
  it('two earlier rows of one trade fold into one line, not done until all are', () => {
    const lines = beforeYouFor(me, [wo({ id: 'a', trade: 'sod', status: 'completed', completed_at: '2026-11-01T10:00:00Z' }), wo({ id: 'b', trade: 'sod', scheduled_date: '2026-11-09' })], new Set(), trades, day)
    expect(lines).toEqual([{ trade: 'sod', label: 'Sod', done: false, date: '2026-11-09' }])
  })
  it('no property, no lines; text carries no money or contact', () => {
    expect(beforeYouFor({ id: 'me', trade: 'sod', property_id: null }, [wo({})], new Set(), trades, day)).toEqual([])
    expect(shortYmd('2026-03-05')).toBe('Mar 5')
  })
})

describe('development board', () => {
  const props: BoardProperty[] = [
    { id: 'p1', customer_id: 'c1', community: 'Oak Ridge', lot: '2', address_text: 'Lot 2, Oak Ridge' },
    { id: 'p2', customer_id: 'c1', community: 'Oak Ridge', lot: '10', address_text: 'Lot 10, Oak Ridge' },
    { id: 'p3', customer_id: 'c2', community: 'oak ridge', lot: '1', address_text: 'Lot 1, Oak Ridge' },
  ]
  const crews: BoardCrew[] = [
    { id: 'a', job_id: 'j1', property_id: 'p1', trade: 'grading', status: 'completed', scheduled_date: '2026-11-01', completed_at: '2026-11-02T12:00:00Z' },
    { id: 'b', job_id: 'j1', property_id: 'p1', trade: 'sod', status: 'scheduled', scheduled_date: '2026-11-20', completed_at: null },
    { id: 'c', job_id: 'j2', property_id: 'p2', trade: 'grading', status: 'pending', scheduled_date: null, completed_at: null },
    { id: 'd', job_id: 'jx', property_id: 'p2', trade: 'sod', status: 'pending', scheduled_date: null, completed_at: null },
    { id: 'e', job_id: 'j3', property_id: 'p3', trade: 'grading', status: 'completed', scheduled_date: null, completed_at: '2026-11-03T12:00:00Z' },
  ]
  const board = buildBoard(props, crews, new Set(['j1', 'j2', 'j3']), new Map([['c1', 'Acme Homes'], ['c2', 'Beta Builders']]), trades, day)
  const lot = (id: string) => board.find((l) => l.propertyId === id)!
  it('cells: done with day, scheduled date, not scheduled, none (also for a cancelled job)', () => {
    expect(lot('p1').cells.grading).toEqual({ state: 'done', date: '2026-11-02', jobId: 'j1' })
    expect(lot('p1').cells.sod).toEqual({ state: 'scheduled', date: '2026-11-20', jobId: 'j1' })
    expect(lot('p1').cells.landscaping.state).toBe('none')
    expect(lot('p2').cells.grading.state).toBe('not_scheduled')
    expect(lot('p2').cells.sod.state).toBe('none')
  })
  it('needs next = first unfinished trade in the company order; all done = none; sorted lot 2 before 10', () => {
    expect(lot('p1').nextTrade).toBe('sod')
    expect(lot('p2').nextTrade).toBe('grading')
    expect(lot('p3').nextTrade).toBeNull()
    expect(board.filter((l) => l.customerId === 'c1').map((l) => l.lot)).toEqual(['2', '10'])
  })
  it('filters by trade and needs-next (builder and development are database filters)', () => {
    const f = { trade: '', needsNext: '' }
    expect(filterLots(board, { ...f, trade: 'sod' }).map((l) => l.propertyId)).toEqual(['p1'])
    expect(filterLots(board, { ...f, needsNext: 'grading' }).map((l) => l.propertyId)).toEqual(['p2'])
    expect(filterLots(board, f)).toHaveLength(3)
  })
  it('groups by builder then development with per-trade progress', () => {
    const g = groupByBuilderAndDevelopment(board, trades)
    expect(g).toHaveLength(2)
    const acme = g.find((x) => x.customerId === 'c1')!
    expect(acme.lots).toHaveLength(2)
    expect(acme.progress).toEqual([
      { slug: 'grading', label: 'Grading', done: 1, total: 2 },
      { slug: 'sod', label: 'Sod', done: 0, total: 1 },
    ])
  })
})
