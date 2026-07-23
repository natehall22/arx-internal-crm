import {
  filterStormReportsForAlerts,
  haversineDistanceMiles,
  hasFutureNonCancelledCloseAppointment,
  hasOpenInProgressAppointmentGate,
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
} from '@/lib/storm-opportunity-alerts'
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
    expect(july22?.report.magnitude).toBe(0.5)
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

  it('allows lost opportunities without installation agreement and no appointment gate', () => {
    const candidate = baseCandidate({ status: 'lost' })
    expect(isLostStormCandidate(candidate)).toBe(true)
    expect(
      isStormOpportunityEligible(
        candidate,
        { lat: candidate.lat!, lng: candidate.lng! },
        DEFAULT_WEATHER_FOOTPRINT,
        []
      )
    ).toBe(true)
  })

  it('rejects lost opportunities that already signed installation agreement', () => {
    const candidate = baseCandidate({
      status: 'lost',
      installation_agreement_signed_at: '2026-06-01T12:00:00.000Z',
    })
    expect(isLostStormCandidate(candidate)).toBe(false)
  })

  it('requires recent or future inspection/close appointments for open/in_progress', () => {
    const candidate = baseCandidate({ status: 'in_progress' })
    const coords = { lat: candidate.lat!, lng: candidate.lng! }

    expect(isStormOpportunityEligible(candidate, coords, DEFAULT_WEATHER_FOOTPRINT, [])).toBe(false)
    expect(
      isStormOpportunityEligible(candidate, coords, DEFAULT_WEATHER_FOOTPRINT, [
        {
          appointment_type: 'inspection',
          status: 'scheduled',
          scheduled_for: '2026-07-10T14:00:00.000Z',
        },
      ])
    ).toBe(true)
    expect(hasOpenInProgressAppointmentGate([])).toBe(false)
    expect(
      hasOpenInProgressAppointmentGate([
        {
          appointment_type: 'close',
          status: 'scheduled',
          scheduled_for: '2026-07-25T14:00:00.000Z',
        },
      ])
    ).toBe(true)
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

describe('storm alert constants', () => {
  it('documents locked thresholds', () => {
    expect(STORM_ALERT_RADIUS_MILES).toBe(0.5)
    expect(STORM_ALERT_HAIL_MIN_INCHES).toBe(0.25)
    expect(STORM_ALERT_WIND_MIN_MPH).toBe(58)
  })
})
