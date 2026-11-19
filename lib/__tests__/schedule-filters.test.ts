import { EMPTY_FILTERS, filterOptions, filterWork, filtersToViewState, tradeColor, viewStateToFilters, type WorkFilterable } from '@/lib/schedule-filters'

const row = (o: Partial<WorkFilterable> & { text: string; crewName?: string; techName?: string }): WorkFilterable & { crewName?: string; techName?: string } => ({ trade: null, crewId: null, techId: null, customerId: null, customerName: null, ...o })
const rows = [
  row({ trade: 'lawn', type: 'visit', crewId: 's1', crewName: 'Crew One', techId: 'u1', techName: 'Ana', customerId: 'c1', customerName: 'Pat', community: 'Oak Hills', text: 'Weekly mowing Pat 1 Oak St' }),
  row({ trade: 'grading', type: 'job', crewId: 's2', crewName: 'Crew Two', customerId: 'c2', customerName: 'Builder Co', text: 'Grading 26-0101 Builder Co' }),
  row({ type: 'appointment', techId: 'u2', techName: 'Bo', customerName: 'Lee', text: 'Inspection Lee' }),
]

describe('filterWork', () => {
  it('no filter keeps everything', () => expect(filterWork(rows, EMPTY_FILTERS)).toHaveLength(3))
  it('trades are multi-select; a row with no trade never matches a chosen trade', () => {
    expect(filterWork(rows, { ...EMPTY_FILTERS, trades: ['lawn', 'grading'] })).toHaveLength(2)
    expect(filterWork(rows, { ...EMPTY_FILTERS, trades: ['grading'] }).map((r) => r.customerName)).toEqual(['Builder Co'])
  })
  it('type chips, crew (several ids), tech, customer, development and text all narrow together', () => {
    expect(filterWork(rows, { ...EMPTY_FILTERS, types: ['appointment'] })).toHaveLength(1)
    expect(filterWork(rows, { ...EMPTY_FILTERS, crew: 's1,s2' })).toHaveLength(2)
    expect(filterWork(rows, { ...EMPTY_FILTERS, tech: 'u2' }).map((r) => r.customerName)).toEqual(['Lee'])
    expect(filterWork(rows, { ...EMPTY_FILTERS, customer: 'Lee' })).toHaveLength(1)
    expect(filterWork(rows, { ...EMPTY_FILTERS, development: 'Oak Hills' })).toHaveLength(1)
    expect(filterWork(rows, { ...EMPTY_FILTERS, q: ' BUILDER ' })).toHaveLength(1)
    expect(filterWork(rows, { ...EMPTY_FILTERS, q: 'pat', trades: ['grading'] })).toHaveLength(0)
  })
})

describe('options, colors and saved state', () => {
  it('builds sorted options from the rows (a development shows only when rows have one)', () => {
    const o = filterOptions(rows)
    expect(o.crews.map((c) => c.label)).toEqual(['Crew One', 'Crew Two'])
    expect(o.techs.map((c) => c.label)).toEqual(['Ana', 'Bo'])
    expect(o.developments).toEqual([{ value: 'Oak Hills', label: 'Oak Hills' }])
    expect(filterOptions([rows[1]]).developments).toEqual([])
  })
  it('a trade keeps one color by the company order; unknown trades are gray', () => {
    const trades = [{ slug: 'lawn' }, { slug: 'grading' }]
    expect(tradeColor('lawn', trades)).not.toBe(tradeColor('grading', trades))
    expect(tradeColor('x', trades)).toBe(tradeColor(null, trades))
  })
  it('round-trips through the table_views state (lists comma-joined)', () => {
    const f = { ...EMPTY_FILTERS, q: 'oak', trades: ['lawn', 'grading'], types: ['visit' as const], crew: 's1,s2', development: 'Oak Hills' }
    const state = filtersToViewState(f)
    expect(state.filters.trades).toBe('lawn,grading')
    expect(viewStateToFilters(state)).toEqual(f)
    expect(viewStateToFilters(null)).toEqual(EMPTY_FILTERS)
    expect(viewStateToFilters({ filters: { types: 'visit,bogus' } }).types).toEqual(['visit'])
  })
})
