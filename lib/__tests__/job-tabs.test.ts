import { pickDefaultJobTab, tabsNeedingAttention, JOB_TABS, type DefaultTabInput } from '@/lib/job-tabs'

const base: DefaultTabInput = {
  jobStatus: 'in_progress', materialsKey: 'received', trades: [{ status: 'scheduled', scheduled_date: '2026-10-28', install_days: 1 }],
  todayYmd: '2026-10-25', balanceOwedCents: 0, allowed: [...JOB_TABS], lastTab: null,
}

describe('which job tab opens first', () => {
  it('materials not sent -> Materials, before anything else', () => {
    expect(pickDefaultJobTab({ ...base, materialsKey: 'not_ordered' })).toBe('materials')
    expect(pickDefaultJobTab({ ...base, materialsKey: 'partial', trades: [{ status: 'scheduled', scheduled_date: '2026-10-01', install_days: 1 }] })).toBe('materials')
  })
  it('crew date passed and not done -> Crews (a 2-day crew is not late on its second day)', () => {
    expect(pickDefaultJobTab({ ...base, trades: [{ status: 'scheduled', scheduled_date: '2026-10-20', install_days: 1 }], lastTab: 'files' })).toBe('crews')
    expect(pickDefaultJobTab({ ...base, trades: [{ status: 'scheduled', scheduled_date: '2026-10-24', install_days: 2 }], lastTab: 'files' })).toBe('files')
  })
  it('finished with a balance owed -> Money (only if they may see money)', () => {
    const done = { ...base, jobStatus: 'complete', trades: [{ status: 'completed', scheduled_date: '2026-10-20', install_days: 1 }], balanceOwedCents: 250000 }
    expect(pickDefaultJobTab(done)).toBe('money')
    expect(pickDefaultJobTab({ ...done, allowed: ['crews', 'materials', 'notes', 'files'] })).toBe('crews')
  })
  it('otherwise the last tab, else Crews; an unknown or disallowed last tab is ignored', () => {
    expect(pickDefaultJobTab({ ...base, lastTab: 'notes' })).toBe('notes')
    expect(pickDefaultJobTab({ ...base, lastTab: 'money', allowed: ['crews', 'materials', 'notes', 'files'] })).toBe('crews')
    expect(pickDefaultJobTab({ ...base, lastTab: 'bogus' })).toBe('crews')
    expect(pickDefaultJobTab(base)).toBe('crews')
  })
  it('cancelled / on-hold jobs do not chase crews or materials', () => {
    const lateTrade = [{ status: 'scheduled', scheduled_date: '2026-10-01', install_days: 1 }]
    expect(pickDefaultJobTab({ ...base, jobStatus: 'cancelled', materialsKey: 'not_ordered', trades: lateTrade, lastTab: 'notes' })).toBe('notes')
    expect(pickDefaultJobTab({ ...base, jobStatus: 'on_hold', trades: lateTrade, lastTab: 'notes' })).toBe('notes')
  })
  it('flags the tabs that need you', () => {
    expect(tabsNeedingAttention({ jobStatus: 'in_progress', materialsKey: 'not_ordered', trades: [{ status: 'scheduled', scheduled_date: '2026-10-01', install_days: 1 }], todayYmd: '2026-10-25', balanceOwedCents: null })).toEqual(['materials', 'crews'])
  })
})
