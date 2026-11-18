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

import { buildJobStages } from '@/lib/portal/job-stages'
import { pickDefaultJobTab, tabsNeedingAttention } from '@/lib/job-tabs'

describe('materialsStep off is respected by the portal stages and the job page tabs', () => {
  it('portal: no "Materials ordered" stage without the step; the rest is unchanged', () => {
    const base = { status: 'sold', materialsKey: 'not_ordered' as const, hasScheduledTrade: false, paidInFull: false }
    expect(buildJobStages(base).map((s) => s.key)).toEqual(['sold', 'materials', 'scheduled', 'installed', 'complete'])
    const off = buildJobStages({ ...base, materialsStep: false })
    expect(off.map((s) => s.key)).toEqual(['sold', 'scheduled', 'installed', 'complete'])
    expect(off.find((s) => s.key === 'scheduled')?.state).toBe('current')
  })
  it('job page: Materials is neither the default tab nor a needs-you dot when off', () => {
    const i = { jobStatus: 'sold', materialsKey: 'not_ordered' as const, trades: [], todayYmd: '2026-11-17', balanceOwedCents: null, allowed: ['crews', 'materials'] as never }
    expect(pickDefaultJobTab(i)).toBe('materials')
    expect(pickDefaultJobTab({ ...i, materialsStep: false })).toBe('crews')
    expect(tabsNeedingAttention(i)).toContain('materials')
    expect(tabsNeedingAttention({ ...i, materialsStep: false })).not.toContain('materials')
  })
})
