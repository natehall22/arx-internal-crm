import { applyTableFilters, type TableFilter } from '@/components/ui/data-table'

type Row = { status: string; owner: string | null }
const filters: TableFilter<Row>[] = [
  { key: 'status', label: 'Status', options: [], accessor: (r) => r.status },
  { key: 'owner', label: 'Owner', options: [], accessor: (r) => r.owner },
]
const rows: Row[] = [
  { status: 'open', owner: 'a' },
  { status: 'open', owner: null },
  { status: 'won', owner: 'a' },
]

describe('applyTableFilters', () => {
  it('no chosen filter returns every row', () => {
    expect(applyTableFilters(rows, filters, {})).toHaveLength(3)
    expect(applyTableFilters(rows, filters, { status: '' })).toHaveLength(3)
  })
  it('every chosen filter must match', () => {
    expect(applyTableFilters(rows, filters, { status: 'open', owner: 'a' })).toEqual([rows[0]])
  })
  it('a missing value never matches a chosen option', () => {
    expect(applyTableFilters(rows, filters, { owner: 'a' })).toHaveLength(2)
  })
  it('filters without an accessor (server lists) are ignored client-side', () => {
    expect(applyTableFilters(rows, [{ key: 'status', label: 'S', options: [] }], { status: 'won' })).toHaveLength(3)
  })
})
