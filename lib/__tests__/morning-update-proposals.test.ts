import { buildMorningUpdateHtml } from '../morning-update-email'
import {
  countUniqueGeneratedProposalOpportunities,
  type MorningUpdateMetrics,
} from '../morning-update-metrics'

function metrics(): MorningUpdateMetrics {
  return {
    sentDateLabel: 'Tuesday, August 11, 2026',
    activityPeriodKind: 'yesterday',
    activityPeriodLabel: 'Monday, August 10, 2026',
    doorsKnockedPeriod: 1,
    doorsKnockedWeekToDate: 2,
    doorsKnockedMonthToDate: 3,
    inspectionsScheduledPeriod: 4,
    inspectionsScheduledWeekToDate: 5,
    inspectionsScheduledMonthToDate: 6,
    proposalsShownPeriod: 7,
    proposalsShownWeekToDate: 8,
    proposalsShownMonthToDate: 9,
    salesPeriod: 10,
    salesWeekToDate: 11,
    salesMonthToDate: 12,
    revenuePeriod: 1300,
    revenueWeekToDate: 1400,
    revenueMonthToDate: 1500,
    revenueLastMonth: 0,
    revenueYearToDate: 0,
    insuranceInspectionsPeriod: 16,
    insuranceInspectionsWeekToDate: 17,
    insuranceInspectionsMonthToDate: 18,
    insuranceInspectionsLastMonth: 0,
    lastWeekVsGoals: null,
  }
}

describe('company feature switches in the morning email', () => {
  const withGoals = (): MorningUpdateMetrics => ({
    ...metrics(),
    lastWeekVsGoals: {
      monthGoalLabel: 'August', rangeLabel: 'Aug 2–8', proposalsShown: 1,
      doors: { actual: 1, goal: 2, shareOfMonthPct: 50 }, sets: { actual: 1, goal: 2, shareOfMonthPct: 50 },
      sales: { actual: 1, goal: 2, shareOfMonthPct: 50 }, revenue: { actual: 1, goal: 2, shareOfMonthPct: 50 },
    } as never,
  })
  it('every switch on / nothing stored: unchanged (doors + insurance rows in all three sections)', () => {
    for (const html of [buildMorningUpdateHtml(withGoals()), buildMorningUpdateHtml(withGoals(), { features: { canvassing: true, insurance: true, roofMeasure: true, incentives: true, stormAlerts: true, squaresPricing: true, servicePlans: false, timeTracking: false, hourlyBilling: false, onlinePayments: false } })]) {
      expect(html.match(/Doors knocked<\/td>/g)).toHaveLength(3)
      expect(html.match(/Inspections going through insurance<\/td>/g)).toHaveLength(3)
      expect(html).toContain('>Doors</td>')
      expect(html).toContain('Insurance inspections are counted')
    }
  })
  it('door knocking off drops every doors row; insurance off drops the insurance rows and footnote', () => {
    const html = buildMorningUpdateHtml(withGoals(), { features: { canvassing: false, insurance: false, roofMeasure: true, incentives: true, stormAlerts: true, squaresPricing: true, servicePlans: false, timeTracking: false, hourlyBilling: false, onlinePayments: false } })
    expect(html).not.toContain('Doors knocked')
    expect(html).not.toContain('>Doors</td>')
    expect(html).not.toContain('going through insurance')
    expect(html).not.toContain('Insurance inspections are counted')
    expect(html.match(/Proposals shown<\/td>/g)?.length).toBeGreaterThanOrEqual(3)
  })
})

describe('daily morning proposal reporting', () => {
  it('deduplicates generated proposals by opportunity and keeps unlinked proposals distinct', () => {
    expect(
      countUniqueGeneratedProposalOpportunities([
        { id: 'p1', opportunity_id: 'o1' },
        { id: 'p2', opportunity_id: 'o1' },
        { id: 'p3', opportunity_id: null },
        { id: 'p4', opportunity_id: null },
      ])
    ).toBe(3)
  })

  it('organizes every daily metric under yesterday, week-to-date, and month-to-date sections', () => {
    const html = buildMorningUpdateHtml(metrics())
    expect(html).toContain('>Yesterday</h2>')
    expect(html).toContain('>Week to date</h2>')
    expect(html).toContain('>Month to date</h2>')
    expect(html.match(/Proposals shown<\/td>/g)).toHaveLength(3)
    expect(html).toContain('>7</td>')
    expect(html).toContain('>8</td>')
    expect(html).toContain('>9</td>')
  })

  it('labels the first section Weekend for Monday while retaining all three sections', () => {
    const monday = metrics()
    monday.activityPeriodKind = 'weekend'
    monday.activityPeriodLabel = 'Sat Aug 8 – Sun Aug 9'
    expect(buildMorningUpdateHtml(monday)).toContain('>Weekend</h2>')
  })
})
