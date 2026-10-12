import { buildRunSheetCrews } from '@/lib/job-run-sheet'

const legacy = { label: 'Subcontractor', name: 'Legacy Sub', phone: '7045550100' }

const subs = new Map([
  ['sub-roof', { company_name: 'Gabriel', contact_name: null, phone: '7042224431' }],
  ['sub-solar', { company_name: '10 Star Solar', contact_name: 'Pat', phone: '980-251-3004' }],
])

describe('buildRunSheetCrews', () => {
  it('prints every crew on the job, each with its trade, date and length', () => {
    const crews = buildRunSheetCrews(
      [
        { trade: 'roofing', assigned_sub_id: 'sub-roof', scheduled_date: '2026-10-01', install_days: 2 },
        { trade: 'other', assigned_sub_id: 'sub-solar', scheduled_date: '2026-10-02', install_days: 0.5 },
      ],
      subs,
      legacy
    )
    expect(crews).toEqual([
      { label: 'Roofing · Thu, Oct 1 · 2 days', name: 'Gabriel', phone: '7042224431' },
      { label: 'Other · Fri, Oct 2 · ½ day', name: '10 Star Solar', phone: '980-251-3004' },
    ])
  })

  it('shows a trade nobody is booked on as unassigned rather than dropping it', () => {
    expect(
      buildRunSheetCrews(
        [{ trade: 'gutters', assigned_sub_id: null, scheduled_date: null, install_days: null }],
        subs,
        legacy
      )
    ).toEqual([{ label: 'Gutters · not scheduled', name: 'Unassigned', phone: null }])
  })

  it('falls back to the job-level crew when the job has no trades yet', () => {
    expect(buildRunSheetCrews([], subs, legacy)).toEqual([legacy])
  })
})
