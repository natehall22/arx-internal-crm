import { fetchFounderWeekTally, founderWeekStart } from '@/lib/founder-week-tally'

const calls: string[][] = []
jest.mock('@/lib/morning-update-metrics', () => ({
  countDoors: jest.fn(async (_s: unknown, _o: string, a: string, b: string) => {
    calls.push(['doors', a, b])
    return 412
  }),
  countGeneratedProposalOpportunitiesInPeriod: jest.fn(async () => 6),
  fetchSignedContractsInPeriod: jest.fn(async () => [{ id: 'c1' }, { id: 'c2' }]),
  summarizeSignedContracts: jest.fn(() => ({ salesCount: 2, revenue: 28500.499 })),
}))
jest.mock('@/lib/inspection-set-metrics', () => ({ countOrgInspectionSetsInPeriod: jest.fn(async () => 14) }))

describe('founderWeekStart (Mon 00:00 Eastern)', () => {
  it('a weekday maps to that week’s Monday midnight Eastern (EDT = UTC-4)', () => {
    expect(founderWeekStart(new Date('2026-10-14T15:00:00Z')).toISOString()).toBe('2026-10-12T04:00:00.000Z')
  })

  it('Sunday belongs to the week that began the Monday before', () => {
    // Sun Oct 18, 10pm Eastern = Mon 02:00 UTC — still Sunday in Eastern.
    expect(founderWeekStart(new Date('2026-10-19T02:00:00Z')).toISOString()).toBe('2026-10-12T04:00:00.000Z')
  })

  it('Monday 00:30 Eastern starts the new week', () => {
    expect(founderWeekStart(new Date('2026-10-19T04:30:00Z')).toISOString()).toBe('2026-10-19T04:00:00.000Z')
  })

  it('crosses the November DST change (week of Nov 2 starts at EST = UTC-5)', () => {
    expect(founderWeekStart(new Date('2026-11-04T17:00:00Z')).toISOString()).toBe('2026-11-02T05:00:00.000Z')
    // Sun Nov 1 (DST ends that morning) belongs to the week of Mon Oct 26, which began in EDT.
    expect(founderWeekStart(new Date('2026-11-01T18:00:00Z')).toISOString()).toBe('2026-10-26T04:00:00.000Z')
  })
})

describe('fetchFounderWeekTally', () => {
  it('counts Monday 00:00 Eastern → now with the morning-email helpers', async () => {
    const now = new Date('2026-10-14T18:30:00Z')
    const t = await fetchFounderWeekTally({} as never, 'org-1', now)
    expect(calls[0]).toEqual(['doors', '2026-10-12T04:00:00.000Z', '2026-10-14T18:30:00.000Z'])
    expect(t).toEqual({
      weekStart: '2026-10-12',
      through: '2026-10-14T18:30:00.000Z',
      doors: 412,
      sets: 14,
      proposalsShown: 6,
      sales: 2,
      revenue: 28500.5,
    })
  })
})
