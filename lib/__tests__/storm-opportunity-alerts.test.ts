import {
  filterStormReportsForAlerts,
  haversineDistanceMiles,
  hasFutureNonCancelledCloseAppointment,
  hasQualifyingInspectionHistory,
  filterStormSwathsForAlerts,
  isLostStormCandidate,
  isRepWorkingStormGrace,
  isStormOpportunityEligible,
  isStormReportWithinEtLookback,
  matchStormReportsToOpportunity,
  shouldSkipStormAlertEntirely,
  shouldSkipStormRouting,
  STORM_ALERT_HAIL_MIN_INCHES,
  STORM_ALERT_RADIUS_MILES,
  STORM_ALERT_WIND_MIN_MPH,
  type StormOpportunityCandidate,
  type StormSwathCandidate,
} from '@/lib/storm-opportunity-alerts'
import {
  matchPointToSwathGeometry,
  STORM_SWATH_BUFFER_MILES,
  STORM_SWATH_HAIL_MIN_INCHES,
} from '@/lib/storm-swath-match'
import {
  DIDNT_SIT_PIPELINE_PREFIX,
  isOnUnresolvedInsideSalesQueueStage,
  REP_WORKING_HANDOFF_PIPELINE_PREFIX,
} from '@/lib/inside-sales-follow-up'
import { DEFAULT_WEATHER_FOOTPRINT } from '@/lib/weather-footprint'
import type { RecentStormReport } from '@/lib/roofradar-open-data'

const baseCandidate = (overrides: Partial<StormOpportunityCandidate> = {}): StormOpportunityCandidate => ({
  id: 'opp-1',
  org_id: 'org-1',
  lead_id: 'lead-1',
  status: 'open',
  lat: 35.25,
  lng: -80.65,
  pipeline_stage: null,
  assigned_user_id: null,
  installation_agreement_signed_at: null,
  address_text: '123 Main St',
  homeowner_name: 'Jane Doe',
  phone: '704-555-0100',
  ...overrides,
})

describe('storm opportunity alert filters', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-07-22T16:00:00.000Z'))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('filters hail reports to lookback and minimum size', () => {
    const reports: RecentStormReport[] = [
      { lat: 35.2, lng: -80.7, magnitude: 0.1, date: new Date('2026-07-22T18:00:00.000Z'), damage: false },
      { lat: 35.2, lng: -80.7, magnitude: 0.5, date: new Date('2026-07-22T18:00:00.000Z'), damage: false },
      { lat: 35.2, lng: -80.7, magnitude: 1.0, date: new Date('2026-07-19T18:00:00.000Z'), damage: false },
    ]

    const filtered = filterStormReportsForAlerts(reports, 'hail')
    expect(filtered).toHaveLength(1)
    expect(filtered[0].magnitude).toBe(0.5)
  })

  it('filters wind reports to damage or 58+ mph within ET lookback', () => {
    const reports: RecentStormReport[] = [
      { lat: 35.2, lng: -80.7, magnitude: 40, date: new Date('2026-07-22T18:00:00.000Z'), damage: false },
      { lat: 35.2, lng: -80.7, magnitude: 60, date: new Date('2026-07-22T18:00:00.000Z'), damage: false },
      { lat: 35.2, lng: -80.7, magnitude: 0, date: new Date('2026-07-22T18:00:00.000Z'), damage: true },
    ]

    const filtered = filterStormReportsForAlerts(reports, 'wind')
    expect(filtered.map((r) => r.damage ? 'damage' : r.magnitude)).toEqual([60, 'damage'])
  })

  it('respects the 2-day ET calendar lookback', () => {
    expect(isStormReportWithinEtLookback(new Date('2026-07-22T20:00:00.000Z'))).toBe(true)
    expect(isStormReportWithinEtLookback(new Date('2026-07-21T20:00:00.000Z'))).toBe(true)
    expect(isStormReportWithinEtLookback(new Date('2026-07-20T20:00:00.000Z'))).toBe(false)
  })

  it('matches opportunities within 0.5 miles of a report', () => {
    const candidate = baseCandidate({ lat: 35.25, lng: -80.65 })
    const near: RecentStormReport = {
      lat: 35.2505,
      lng: -80.6505,
      magnitude: STORM_ALERT_HAIL_MIN_INCHES,
      date: new Date('2026-07-22T18:00:00.000Z'),
      damage: false,
    }
    const far: RecentStormReport = {
      ...near,
      lat: 35.3,
      lng: -80.7,
    }

    const nearDist = haversineDistanceMiles(candidate.lat!, candidate.lng!, near.lat, near.lng)
    expect(nearDist).toBeLessThanOrEqual(STORM_ALERT_RADIUS_MILES)

    const matches = matchStormReportsToOpportunity(candidate, { lat: candidate.lat!, lng: candidate.lng! }, [near], [])
    expect(matches).toHaveLength(1)
    expect(matchStormReportsToOpportunity(candidate, { lat: candidate.lat!, lng: candidate.lng! }, [far], [])).toHaveLength(0)
  })

  it('keeps only the nearest report per layer and event date', () => {
    const candidate = baseCandidate({ lat: 35.25, lng: -80.65 })
    const coords = { lat: candidate.lat!, lng: candidate.lng! }
    const eventDate = new Date('2026-07-22T18:00:00.000Z')

    const nearer: RecentStormReport = {
      lat: 35.2502,
      lng: -80.6502,
      magnitude: 0.5,
      date: eventDate,
      damage: false,
    }
    const farther: RecentStormReport = {
      lat: 35.2508,
      lng: -80.6508,
      magnitude: 1.0,
      date: eventDate,
      damage: false,
    }
    const otherDay: RecentStormReport = {
      ...nearer,
      date: new Date('2026-07-21T18:00:00.000Z'),
    }

    const matches = matchStormReportsToOpportunity(candidate, coords, [farther, nearer, otherDay], [])
    expect(matches).toHaveLength(2)
    const july22 = matches.find((match) => match.eventDate === '2026-07-22')
    expect(july22?.magnitude).toBe(0.5)
    expect(july22?.source).toBe('report')
    expect(july22?.distanceMiles).toBeLessThan(
      haversineDistanceMiles(coords.lat, coords.lng, farther.lat, farther.lng)
    )
  })
})

describe('storm opportunity eligibility', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-07-22T16:00:00.000Z'))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('allows lost opportunities we inspected, at any age, when no agreement was signed', () => {
    const candidate = baseCandidate({ status: 'lost' })
    const coords = { lat: candidate.lat!, lng: candidate.lng! }
    expect(isLostStormCandidate(candidate)).toBe(true)

    const oldInspection = [
      {
        appointment_type: 'inspection',
        status: 'completed',
        scheduled_for: '2024-03-02T14:00:00.000Z',
      },
    ]
    expect(
      isStormOpportunityEligible(candidate, coords, DEFAULT_WEATHER_FOOTPRINT, oldInspection)
    ).toBe(true)

    // Inspection history is now required for lost too — a lead we never actually
    // inspected is not "a customer we had an inspection with".
    expect(isStormOpportunityEligible(candidate, coords, DEFAULT_WEATHER_FOOTPRINT, [])).toBe(false)
  })

  it('rejects lost opportunities that already signed installation agreement', () => {
    const candidate = baseCandidate({
      status: 'lost',
      installation_agreement_signed_at: '2026-06-01T12:00:00.000Z',
    })
    expect(isLostStormCandidate(candidate)).toBe(false)
  })

  it('requires some inspection/close history but imposes no recency limit', () => {
    const candidate = baseCandidate({ status: 'in_progress' })
    const coords = { lat: candidate.lat!, lng: candidate.lng! }

    expect(isStormOpportunityEligible(candidate, coords, DEFAULT_WEATHER_FOOTPRINT, [])).toBe(false)

    // Two years stale — previously blocked by the 14-day gate, now eligible.
    expect(
      isStormOpportunityEligible(candidate, coords, DEFAULT_WEATHER_FOOTPRINT, [
        {
          appointment_type: 'inspection',
          status: 'scheduled',
          scheduled_for: '2024-07-10T14:00:00.000Z',
        },
      ])
    ).toBe(true)

    expect(hasQualifyingInspectionHistory([])).toBe(false)
    expect(
      hasQualifyingInspectionHistory([
        { appointment_type: 'close', status: 'scheduled', scheduled_for: '2023-01-25T14:00:00.000Z' },
      ])
    ).toBe(true)
    // Cancelled appointments never count — we never actually stood on the roof.
    expect(
      hasQualifyingInspectionHistory([
        { appointment_type: 'inspection', status: 'cancelled', scheduled_for: '2026-07-10T14:00:00.000Z' },
      ])
    ).toBe(false)
    // Non-inspection appointment types do not qualify.
    expect(
      hasQualifyingInspectionHistory([
        { appointment_type: 'adjuster', status: 'scheduled', scheduled_for: '2026-07-10T14:00:00.000Z' },
      ])
    ).toBe(false)
  })

  it('skips entirely when closer mid-deal unless already on inside sales queue', () => {
    const futureClose = [
      {
        appointment_type: 'close',
        status: 'scheduled',
        scheduled_for: '2026-07-25T14:00:00.000Z',
      },
    ]

    expect(
      shouldSkipStormAlertEntirely({ pipeline_stage: null }, futureClose)
    ).toBe(true)
    expect(
      shouldSkipStormAlertEntirely({ pipeline_stage: DIDNT_SIT_PIPELINE_PREFIX }, futureClose)
    ).toBe(false)
    expect(
      shouldSkipStormAlertEntirely({ pipeline_stage: `${DIDNT_SIT_PIPELINE_PREFIX}_lost` }, futureClose)
    ).toBe(true)
    expect(isOnUnresolvedInsideSalesQueueStage(`${DIDNT_SIT_PIPELINE_PREFIX}_lost`)).toBe(false)
    expect(isOnUnresolvedInsideSalesQueueStage(DIDNT_SIT_PIPELINE_PREFIX)).toBe(true)
    expect(shouldSkipStormRouting(null, futureClose)).toBe(true)
    expect(hasFutureNonCancelledCloseAppointment(futureClose)).toBe(true)
  })

  it('skips storm routing for rep_working grace stage', () => {
    expect(isRepWorkingStormGrace(REP_WORKING_HANDOFF_PIPELINE_PREFIX)).toBe(true)
    expect(isRepWorkingStormGrace(`${REP_WORKING_HANDOFF_PIPELINE_PREFIX}_delay`)).toBe(true)
    expect(shouldSkipStormRouting(REP_WORKING_HANDOFF_PIPELINE_PREFIX, [])).toBe(true)
    expect(shouldSkipStormRouting(`${REP_WORKING_HANDOFF_PIPELINE_PREFIX}_delay`, [])).toBe(true)
    expect(shouldSkipStormRouting(null, [])).toBe(false)
  })

  it('skips routing when already on another unresolved IS queue kind (note only)', () => {
    expect(shouldSkipStormRouting(DIDNT_SIT_PIPELINE_PREFIX, [])).toBe(true)
    expect(shouldSkipStormRouting(null, [])).toBe(false)
  })
})

describe('storm swath matching', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-07-22T16:00:00.000Z'))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  // ~0.1deg lat box (~6.9mi tall) centred near the Concord footprint.
  const box = {
    type: 'Polygon',
    coordinates: [
      [
        [-80.7, 35.2],
        [-80.6, 35.2],
        [-80.6, 35.3],
        [-80.7, 35.3],
        [-80.7, 35.2],
      ],
    ],
  }

  it('reports zero distance for a point inside the polygon', () => {
    const hit = matchPointToSwathGeometry(35.25, -80.65, box)
    expect(hit).toEqual({ distanceMiles: 0, inside: true })
  })

  it('accepts a point just outside within the 1-mile buffer', () => {
    // ~0.007deg lat north of the top edge ≈ 0.48mi.
    const hit = matchPointToSwathGeometry(35.307, -80.65, box)
    expect(hit?.inside).toBe(false)
    expect(hit!.distanceMiles).toBeGreaterThan(0)
    expect(hit!.distanceMiles).toBeLessThan(STORM_SWATH_BUFFER_MILES)
  })

  it('rejects a point beyond the buffer', () => {
    // ~0.05deg lat north of the edge ≈ 3.5mi.
    expect(matchPointToSwathGeometry(35.35, -80.65, box)).toBeNull()
  })

  it('treats a point inside a hole as outside the polygon', () => {
    const donut = {
      type: 'Polygon',
      coordinates: [
        box.coordinates[0],
        [
          [-80.66, 35.24],
          [-80.64, 35.24],
          [-80.64, 35.26],
          [-80.66, 35.26],
          [-80.66, 35.24],
        ],
      ],
    }
    const hit = matchPointToSwathGeometry(35.25, -80.65, donut)
    // Inside the hole: not "inside" the swath, but the hole rim is within 1mi.
    expect(hit?.inside).toBe(false)
  })

  it('ignores non-polygon geometry', () => {
    expect(matchPointToSwathGeometry(35.25, -80.65, { type: 'Point', coordinates: [-80.65, 35.25] })).toBeNull()
    expect(matchPointToSwathGeometry(35.25, -80.65, null)).toBeNull()
  })

  it('filters swaths to the ET lookback and the damaging-hail threshold', () => {
    const swaths: StormSwathCandidate[] = [
      { event_date: '2026-07-22', layer: 'hail', magnitude: 1.0, geometry: box },
      { event_date: '2026-07-22', layer: 'hail', magnitude: 0.5, geometry: box },
      { event_date: '2026-07-19', layer: 'hail', magnitude: 1.5, geometry: box },
    ]
    const filtered = filterStormSwathsForAlerts(swaths)
    expect(filtered).toHaveLength(1)
    expect(filtered[0].magnitude).toBe(1.0)
    expect(STORM_SWATH_HAIL_MIN_INCHES).toBe(0.75)
  })

  it('prefers a swath hit over a point report for the same layer and day', () => {
    const candidate = baseCandidate({ lat: 35.25, lng: -80.65 })
    const coords = { lat: 35.25, lng: -80.65 }
    const report: RecentStormReport = {
      lat: 35.2505,
      lng: -80.6505,
      magnitude: 0.5,
      date: new Date('2026-07-22T18:00:00.000Z'),
      damage: false,
    }
    const swath: StormSwathCandidate = {
      event_date: '2026-07-22',
      layer: 'hail',
      magnitude: 1.25,
      geometry: box,
    }

    const matches = matchStormReportsToOpportunity(candidate, coords, [report], [], [swath])
    expect(matches).toHaveLength(1)
    expect(matches[0].source).toBe('swath')
    expect(matches[0].magnitude).toBe(1.25)
    expect(matches[0].insideSwath).toBe(true)
    expect(matches[0].stormLat).toBeNull()
  })

  it('keeps a point report when no swath covers the address', () => {
    const candidate = baseCandidate({ lat: 35.25, lng: -80.65 })
    const coords = { lat: 35.25, lng: -80.65 }
    const report: RecentStormReport = {
      lat: 35.2505,
      lng: -80.6505,
      magnitude: 0.5,
      date: new Date('2026-07-22T18:00:00.000Z'),
      damage: false,
    }
    const distantSwath: StormSwathCandidate = {
      event_date: '2026-07-22',
      layer: 'hail',
      magnitude: 1.25,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-80.9, 35.5],
            [-80.8, 35.5],
            [-80.8, 35.6],
            [-80.9, 35.6],
            [-80.9, 35.5],
          ],
        ],
      },
    }

    const matches = matchStormReportsToOpportunity(candidate, coords, [report], [], [distantSwath])
    expect(matches).toHaveLength(1)
    expect(matches[0].source).toBe('report')
  })
})

describe('2026-08-11 east Cabarrus storm (regression)', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-08-12T10:00:00.000Z'))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  // The only LSR the storm produced: wind damage, 4 NNW Midland, 21:50Z.
  const midlandDamageReport: RecentStormReport = {
    lat: 35.28,
    lng: -80.54,
    magnitude: 0,
    date: new Date('2026-08-11T21:50:00.000Z'),
    damage: true,
  }

  it('passes the wind filter as a damage report with no measured gust', () => {
    expect(filterStormReportsForAlerts([midlandDamageReport], 'wind')).toHaveLength(1)
  })

  it('reaches 2988 Parks Lafferty Rd at 2.74mi, which the old 0.5mi radius missed', () => {
    const palmer = baseCandidate({ status: 'lost', lat: 35.3181001, lng: -80.5262467 })
    const coords = { lat: palmer.lat!, lng: palmer.lng! }

    const distance = haversineDistanceMiles(coords.lat, coords.lng, midlandDamageReport.lat, midlandDamageReport.lng)
    expect(distance).toBeGreaterThan(0.5)
    expect(distance).toBeLessThan(STORM_ALERT_RADIUS_MILES)

    const matches = matchStormReportsToOpportunity(palmer, coords, [], [midlandDamageReport])
    expect(matches).toHaveLength(1)
    expect(matches[0].layer).toBe('wind')
    expect(matches[0].damage).toBe(true)
    expect(matches[0].source).toBe('report')
  })
})

describe('storm alert constants', () => {
  it('documents locked thresholds', () => {
    expect(STORM_ALERT_RADIUS_MILES).toBe(3)
    expect(STORM_ALERT_HAIL_MIN_INCHES).toBe(0.25)
    expect(STORM_ALERT_WIND_MIN_MPH).toBe(58)
    expect(STORM_SWATH_BUFFER_MILES).toBe(1)
  })
})
