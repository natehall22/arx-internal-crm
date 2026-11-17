import { boardColumnForStatus, boardColumnStatuses } from '@/lib/job-status'

describe('board columns without a materials-ordering step', () => {
  it('roofing keeps all five columns; no-materials companies skip Material Ordering', () => {
    expect(boardColumnStatuses(true)).toEqual(['sold', 'materials', 'scheduled', 'in_progress', 'complete'])
    expect(boardColumnStatuses(false)).toEqual(['sold', 'scheduled', 'in_progress', 'complete'])
  })
  it('a job already in materials waits in Sold when the step is off; unknown statuses have no column', () => {
    expect(boardColumnForStatus('materials', true)).toBe('materials')
    expect(boardColumnForStatus('materials', false)).toBe('sold')
    expect(boardColumnForStatus('on_hold', false)).toBeNull()
    expect(boardColumnForStatus('collected', true)).toBeNull()
  })
})
