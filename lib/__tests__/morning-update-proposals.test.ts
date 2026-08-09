import { buildMorningUpdateHtml } from '../morning-update-email'
import {
  countUniqueGeneratedProposalOpportunities,
  type MorningUpdateMetrics,
} from '../morning-update-metrics'

function mondayMetrics(): MorningUpdateMetrics {
  return {
    sentDateLabel: 'Monday, August 10, 2026',
    activityPeriodKind: 'weekend',
    activityPeriodLabel: 'Sat Aug 8 – Sun Aug 9',
    doorsKnockedPeriod: 0,
    doorsKnockedMonthToDate: 0,
    inspectionsScheduledPeriod: 0,
    inspectionsScheduledMonthToDate: 0,
    salesPeriod: 0,
    salesMonthToDate: 0,
    revenueLastMonth: 0,
    revenueMonthToDate: 0,
    revenueYearToDate: 0,
    insuranceInspectionsLastMonth: 0,
    insuranceInspectionsMonthToDate: 0,
    lastWeekVsGoals: {
      rangeLabel: 'Sun Aug 2 – Sat Aug 8',
      monthGoalLabel: 'August 2026',
      proposalsShown: 4,
      proposalsShownMonthToDate: 7,
      doors: { actual: 0, goal: null, shareOfMonthPct: null },
      sets: { actual: 0, goal: null, shareOfMonthPct: null },
      sales: { actual: 0, goal: null, shareOfMonthPct: null },
      revenue: { actual: 0, goal: null, shareOfMonthPct: null },
    },
  }
}

describe('Monday morning proposal reporting', () => {
  it('deduplicates proposals by opportunity and keeps unlinked proposals distinct', () => {
    expect(
      countUniqueGeneratedProposalOpportunities([
        { id: 'p1', opportunity_id: 'o1' },
        { id: 'p2', opportunity_id: 'o1' },
        { id: 'p3', opportunity_id: null },
        { id: 'p4', opportunity_id: null },
      ])
    ).toBe(3)
  })

  it('renders last-week and month-to-date counts in the Monday section', () => {
    const html = buildMorningUpdateHtml(mondayMetrics())
    expect(html).toContain('Proposals shown</td>')
    expect(html).toContain('>4</td>')
    expect(html).toContain('Proposals shown month to date</td>')
    expect(html).toContain('>7</td>')
  })

  it('keeps the email usable when proposal counts are unavailable', () => {
    const metrics = mondayMetrics()
    metrics.lastWeekVsGoals!.proposalsShown = null
    metrics.lastWeekVsGoals!.proposalsShownMonthToDate = null
    expect(buildMorningUpdateHtml(metrics)).toContain('Unavailable')
  })

  it('does not render the weekly proposal section outside Monday', () => {
    const metrics = mondayMetrics()
    metrics.lastWeekVsGoals = null
    expect(buildMorningUpdateHtml(metrics)).not.toContain('Proposals shown</td>')
  })
})
