import { formatInTimeZone } from 'date-fns-tz'
import type { RecentStormReport } from '@/lib/roofradar-open-data'
import {
  isOnUnresolvedInsideSalesQueueStage,
  REP_WORKING_HANDOFF_PIPELINE_PREFIX,
  STORM_PIPELINE_PREFIX,
} from '@/lib/inside-sales-follow-up'
import type { WeatherBbox } from '@/lib/weather-footprint'
import {
  matchPointToSwathGeometry,
  STORM_SWATH_HAIL_MIN_INCHES,
} from '@/lib/storm-swath-match'

/**
 * Match radius for IEM point reports.
 *
 * 3mi, not the original 0.5mi: LSR spotter reports are sparse — a county-wide
 * severe storm on 2026-08-11 produced exactly ONE report — and a wind-damage
 * report marks a storm line passing through, not a pinpoint event. At 0.5mi that
 * storm matched zero customers while the nearest sat 2.74mi from the report.
 *
 * Swath polygons are the precise signal; this radius is the fallback for when no
 * MRMS swath has been ingested for the event.
 */
export const STORM_ALERT_RADIUS_MILES = 3
export const STORM_ALERT_HAIL_MIN_INCHES = 0.25
export const STORM_ALERT_WIND_MIN_MPH = 58
/** IEM fetch window — filtered down to {@link STORM_ALERT_LOOKBACK_ET_DAYS} ET calendar days. */
export const STORM_IEM_FETCH_WINDOW_DAYS = 3
export const STORM_ALERT_LOOKBACK_ET_DAYS = 2
export const STORM_ALERT_EMAIL_MAX_ROWS = 50
export const STORM_ALERT_TIMEZONE = 'America/New_York'

export type StormAlertLayer = 'hail' | 'wind'

/** Where the impact estimate came from: an IEM point report or an MRMS swath polygon. */
export type StormMatchSource = 'report' | 'swath'

export type StormOpportunityCandidate = {
  id: string
  org_id: string
  lead_id: string | null
  status: string | null
  lat: number | null
  lng: number | null
  pipeline_stage: string | null
  assigned_user_id: string | null
  installation_agreement_signed_at: string | null
  address_text: string | null
  homeowner_name: string | null
  phone: string | null
}

export type StormMatchResult = {
  opportunity: StormOpportunityCandidate
  layer: StormAlertLayer
  eventDate: string
  /** 0 when the address sits inside a swath polygon. */
  distanceMiles: number
  /** inches for hail, mph for wind gusts, 0 for wind-damage reports with no measured gust */
  magnitude: number
  damage: boolean
  source: StormMatchSource
  /** Null for swath matches — the footprint is an area, not a point. */
  stormLat: number | null
  stormLng: number | null
  insideSwath: boolean
}

export type StormAlertDigestRow = {
  customerName: string
  address: string
  layer: StormAlertLayer
  eventDate: string
  magnitudeLabel: string
  /** Pre-rendered by {@link formatStormProximityLabel} — swaths have no meaningful distance. */
  proximityLabel: string
  source: StormMatchSource
  routed: boolean
  opportunityId: string
}

export function stormOpportunityAlertsEnabled(): boolean {
  return process.env.STORM_OPPORTUNITY_ALERTS_ENABLED === 'true'
}

export function stormAlertEmailTo(): string {
  return (process.env.STORM_ALERT_EMAIL_TO || 'info@arxroofing.com').trim()
}

const EARTH_RADIUS_MILES = 3958.7613

export function haversineDistanceMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function isCoordinateInBbox(lat: number, lng: number, bbox: WeatherBbox): boolean {
  return lat >= bbox.s && lat <= bbox.n && lng >= bbox.w && lng <= bbox.e
}

export function resolveOpportunityCoordinates(
  opportunity: Pick<StormOpportunityCandidate, 'lat' | 'lng'>,
  lead?: { lat?: number | null; lng?: number | null } | null
): { lat: number; lng: number } | null {
  const lat = Number(opportunity.lat ?? lead?.lat)
  const lng = Number(opportunity.lng ?? lead?.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

/** Last N ET calendar days including today. */
export function recentEtCalendarDayKeys(now = new Date(), days = STORM_ALERT_LOOKBACK_ET_DAYS): Set<string> {
  const keys = new Set<string>()
  for (let i = 0; i < days; i += 1) {
    const d = new Date(now.getTime() - i * 86400000)
    keys.add(formatInTimeZone(d, STORM_ALERT_TIMEZONE, 'yyyy-MM-dd'))
  }
  return keys
}

export function isStormReportWithinEtLookback(reportDate: Date, now = new Date()): boolean {
  const dayKey = formatInTimeZone(reportDate, STORM_ALERT_TIMEZONE, 'yyyy-MM-dd')
  return recentEtCalendarDayKeys(now, STORM_ALERT_LOOKBACK_ET_DAYS).has(dayKey)
}

export function filterStormReportsForAlerts(
  reports: RecentStormReport[],
  layer: StormAlertLayer,
  now = new Date()
): RecentStormReport[] {
  return reports.filter((report) => {
    if (!isStormReportWithinEtLookback(report.date, now)) return false
    if (layer === 'hail') return report.magnitude >= STORM_ALERT_HAIL_MIN_INCHES
    return report.damage || report.magnitude >= STORM_ALERT_WIND_MIN_MPH
  })
}

export function formatStormMagnitudeLabel(
  layer: StormAlertLayer,
  event: { magnitude: number; damage: boolean }
): string {
  if (layer === 'hail') {
    return `est. ${event.magnitude.toFixed(2)} in hail`
  }
  if (event.damage) return 'est. wind damage reported'
  return `est. ${Math.round(event.magnitude)} mph wind gust`
}

/** An MRMS swath row narrowed to what matching needs. */
export type StormSwathCandidate = {
  event_date: string
  layer: StormAlertLayer
  magnitude: number
  geometry: unknown
}

/**
 * Swaths are stored for the full 2-year overlay window, but an alert must only
 * fire for a storm that just happened — otherwise enabling the feature would
 * route every historical event at once. Same ET recency window as point reports.
 */
export function filterStormSwathsForAlerts(
  swaths: StormSwathCandidate[],
  now = new Date()
): StormSwathCandidate[] {
  const recentDays = recentEtCalendarDayKeys(now, STORM_ALERT_LOOKBACK_ET_DAYS)
  return swaths.filter((swath) => {
    if (!recentDays.has(swath.event_date)) return false
    if (swath.layer === 'hail') return swath.magnitude >= STORM_SWATH_HAIL_MIN_INCHES
    return swath.magnitude >= STORM_ALERT_WIND_MIN_MPH
  })
}

export function stormEventDateEt(report: RecentStormReport): string {
  return formatInTimeZone(report.date, STORM_ALERT_TIMEZONE, 'yyyy-MM-dd')
}

export function formatStormEventDateLabel(eventDate: string): string {
  const d = new Date(`${eventDate}T12:00:00`)
  if (!Number.isFinite(d.getTime())) return eventDate
  return d.toLocaleDateString('en-US', {
    timeZone: STORM_ALERT_TIMEZONE,
    month: 'short',
    day: 'numeric',
  })
}

export function isEligibleStormOpportunityStatus(status: string | null | undefined): boolean {
  const normalized = String(status || '').trim().toLowerCase()
  return normalized === 'open' || normalized === 'in_progress' || normalized === 'lost'
}

export function isLostStormCandidate(
  opportunity: Pick<StormOpportunityCandidate, 'status' | 'installation_agreement_signed_at'>
): boolean {
  return (
    String(opportunity.status || '').trim().toLowerCase() === 'lost' &&
    !opportunity.installation_agreement_signed_at
  )
}

/**
 * Any inspection/close appointment we ever put on the calendar and did not cancel.
 *
 * Deliberately unbounded in time: if we stood on a roof at this address, a new
 * storm over it is a callable event regardless of how long ago that was or how
 * the inspection turned out. (This replaced a 14-day recency gate that hid ~277
 * of 303 previously-inspected opportunities from the alert.)
 */
export function hasQualifyingInspectionHistory(
  appointments: Array<{ appointment_type: string; status: string; scheduled_for: string }>
): boolean {
  return appointments.some((appt) => {
    if (appt.status === 'cancelled') return false
    const type = String(appt.appointment_type || '').trim().toLowerCase()
    if (type !== 'inspection' && type !== 'close') return false
    return Number.isFinite(new Date(appt.scheduled_for).getTime())
  })
}

export function hasFutureNonCancelledCloseAppointment(
  appointments: Array<{ appointment_type: string; status: string; scheduled_for: string }>,
  now = new Date()
): boolean {
  const nowMs = now.getTime()
  return appointments.some((appt) => {
    if (appt.status === 'cancelled') return false
    if (String(appt.appointment_type || '').trim().toLowerCase() !== 'close') return false
    const scheduledMs = new Date(appt.scheduled_for).getTime()
    return Number.isFinite(scheduledMs) && scheduledMs > nowMs
  })
}

export function shouldSkipStormAlertEntirely(
  opportunity: Pick<StormOpportunityCandidate, 'pipeline_stage'>,
  appointments: Array<{ appointment_type: string; status: string; scheduled_for: string }>,
  now = new Date()
): boolean {
  if (!hasFutureNonCancelledCloseAppointment(appointments, now)) return false
  return !isOnUnresolvedInsideSalesQueueStage(opportunity.pipeline_stage)
}

const RESOLVED_STORM_PIPELINE_STAGES = new Set([
  `${STORM_PIPELINE_PREFIX}_rescheduled`,
  `${STORM_PIPELINE_PREFIX}_unresponsive`,
  `${STORM_PIPELINE_PREFIX}_lost`,
])

export function isRepWorkingStormGrace(stage: string | null | undefined): boolean {
  const pipelineStage = String(stage || '').trim().toLowerCase()
  return (
    pipelineStage === REP_WORKING_HANDOFF_PIPELINE_PREFIX ||
    pipelineStage.startsWith(`${REP_WORKING_HANDOFF_PIPELINE_PREFIX}_`)
  )
}

export function isOnUnresolvedStormPipelineStage(stage: string | null | undefined): boolean {
  const pipelineStage = String(stage || '').trim().toLowerCase()
  if (!pipelineStage) return false
  if (
    pipelineStage !== STORM_PIPELINE_PREFIX &&
    !pipelineStage.startsWith(`${STORM_PIPELINE_PREFIX}_`)
  ) {
    return false
  }
  return !RESOLVED_STORM_PIPELINE_STAGES.has(pipelineStage)
}

/**
 * Do not change pipeline / reopen lost when:
 * - closer close is still on the calendar
 * - rep-working grace applies
 * - already on another unresolved IS queue kind (note+notify only — do not steal)
 * Storm stages themselves are handled separately (mark routed, no re-update).
 */
export function shouldSkipStormRouting(
  pipelineStage: string | null | undefined,
  appointments: Array<{ appointment_type: string; status: string; scheduled_for: string }>,
  now = new Date()
): boolean {
  if (isRepWorkingStormGrace(pipelineStage)) return true
  if (hasFutureNonCancelledCloseAppointment(appointments, now)) return true
  if (
    isOnUnresolvedInsideSalesQueueStage(pipelineStage) &&
    !isOnUnresolvedStormPipelineStage(pipelineStage)
  ) {
    return true
  }
  return false
}

export function isStormOpportunityEligible(
  opportunity: StormOpportunityCandidate,
  coords: { lat: number; lng: number },
  bbox: WeatherBbox,
  appointments: Array<{ appointment_type: string; status: string; scheduled_for: string }>
): boolean {
  if (!isEligibleStormOpportunityStatus(opportunity.status)) return false
  if (!isCoordinateInBbox(coords.lat, coords.lng, bbox)) return false

  const status = String(opportunity.status || '').trim().toLowerCase()
  if (status === 'lost' && !isLostStormCandidate(opportunity)) return false

  return hasQualifyingInspectionHistory(appointments)
}

export function matchStormReportsToOpportunity(
  opportunity: StormOpportunityCandidate,
  coords: { lat: number; lng: number },
  hailReports: RecentStormReport[],
  windReports: RecentStormReport[],
  swaths: StormSwathCandidate[] = []
): StormMatchResult[] {
  const bestByLayerDate = new Map<string, StormMatchResult>()

  /**
   * One alert per layer per event date. A swath hit beats a point report for the
   * same day because the footprint is address-specific rather than "something was
   * reported half a mile away"; between two of the same source, nearest wins.
   */
  const consider = (next: StormMatchResult) => {
    const key = `${next.layer}:${next.eventDate}`
    const existing = bestByLayerDate.get(key)
    if (!existing) {
      bestByLayerDate.set(key, next)
      return
    }
    const upgradesSource = next.source === 'swath' && existing.source === 'report'
    const sameSourceCloser =
      next.source === existing.source && next.distanceMiles < existing.distanceMiles
    if (upgradesSource || sameSourceCloser) {
      bestByLayerDate.set(key, next)
    }
  }

  const considerReport = (report: RecentStormReport, layer: StormAlertLayer) => {
    const distanceMiles = haversineDistanceMiles(coords.lat, coords.lng, report.lat, report.lng)
    if (distanceMiles > STORM_ALERT_RADIUS_MILES) return

    consider({
      opportunity,
      layer,
      eventDate: stormEventDateEt(report),
      distanceMiles,
      magnitude: report.magnitude,
      damage: report.damage,
      source: 'report',
      stormLat: report.lat,
      stormLng: report.lng,
      insideSwath: false,
    })
  }

  for (const report of hailReports) considerReport(report, 'hail')
  for (const report of windReports) considerReport(report, 'wind')

  for (const swath of swaths) {
    const hit = matchPointToSwathGeometry(coords.lat, coords.lng, swath.geometry)
    if (!hit) continue

    consider({
      opportunity,
      layer: swath.layer,
      eventDate: swath.event_date,
      distanceMiles: hit.distanceMiles,
      magnitude: swath.magnitude,
      damage: false,
      source: 'swath',
      stormLat: null,
      stormLng: null,
      insideSwath: hit.inside,
    })
  }

  return Array.from(bestByLayerDate.values())
}

/** Claims-safe proximity phrasing — an area footprint is never described as a distance. */
export function formatStormProximityLabel(match: StormMatchResult): string {
  if (match.source === 'swath') {
    return match.insideSwath
      ? 'this address falls inside the est. storm footprint'
      : `this address is est. ${match.distanceMiles.toFixed(2)} mi from the est. storm footprint`
  }
  return `recorded est. ${match.distanceMiles.toFixed(2)} mi from this address`
}

export function buildStormActivityNote(match: StormMatchResult): string {
  const dateLabel = formatStormEventDateLabel(match.eventDate)
  const mag = formatStormMagnitudeLabel(match.layer, match)
  return `Recent storm activity (${mag}) on ${dateLabel} — ${formatStormProximityLabel(match)}. Property may have been impacted — free inspection available (est.).`
}

export function buildStormNotificationBody(match: StormMatchResult, customerName: string): string {
  const dateLabel = formatStormEventDateLabel(match.eventDate)
  const mag = formatStormMagnitudeLabel(match.layer, match)
  return [
    `Customer: ${customerName}`,
    match.opportunity.address_text ? `Address: ${match.opportunity.address_text}` : null,
    match.opportunity.phone ? `Phone: ${match.opportunity.phone}` : null,
    `Storm ${match.source === 'swath' ? 'footprint' : 'report'} (${mag}) on ${dateLabel} — ${formatStormProximityLabel(match)}`,
    'Offer a free inspection — impact is est. only.',
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildStormNotificationTitle(customerName: string): string {
  return `Storm follow-up (est.): ${customerName}`
}

export function stormPipelineStageForRouting(): string {
  return STORM_PIPELINE_PREFIX
}

export function buildStormAlertDigestHtml(rows: StormAlertDigestRow[]): string {
  const limited = rows.slice(0, STORM_ALERT_EMAIL_MAX_ROWS)
  const tableRows = limited
    .map(
      (row) =>
        `<tr>
          <td style="padding:8px 10px;border-bottom:1px solid #E5E7EB;color:#111827;">${escapeHtml(row.customerName)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #E5E7EB;color:#374151;">${escapeHtml(row.address || '—')}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #E5E7EB;color:#374151;">${escapeHtml(row.layer)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #E5E7EB;color:#374151;">${escapeHtml(row.magnitudeLabel)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #E5E7EB;color:#374151;">${escapeHtml(formatStormEventDateLabel(row.eventDate))}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #E5E7EB;color:#374151;">${escapeHtml(row.proximityLabel)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #E5E7EB;color:#374151;">${row.routed ? 'Routed to IS' : 'Noted only'}</td>
        </tr>`
    )
    .join('')

  const overflow =
    rows.length > STORM_ALERT_EMAIL_MAX_ROWS
      ? `<p style="color:#6B7280;font-size:13px;">Showing first ${STORM_ALERT_EMAIL_MAX_ROWS} of ${rows.length} new alerts.</p>`
      : ''

  return `
    <div style="font-family:Arial,sans-serif;max-width:960px;margin:0 auto;padding:20px;">
      <h2 style="color:#111827;margin-bottom:8px;">Storm opportunity alerts (est.)</h2>
      <p style="color:#374151;margin-bottom:16px;">
        New storm-near-opportunity matches from the latest cron run. All magnitudes and impact language are estimates only.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="background:#F3F4F6;text-align:left;">
            <th style="padding:8px 10px;color:#374151;">Customer</th>
            <th style="padding:8px 10px;color:#374151;">Address</th>
            <th style="padding:8px 10px;color:#374151;">Layer</th>
            <th style="padding:8px 10px;color:#374151;">Report</th>
            <th style="padding:8px 10px;color:#374151;">Date (ET)</th>
            <th style="padding:8px 10px;color:#374151;">Proximity (est.)</th>
            <th style="padding:8px 10px;color:#374151;">Action</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
      ${overflow}
      <p style="color:#6B7280;font-size:12px;margin-top:16px;">Automated ARX CRM storm alert digest.</p>
    </div>
  `
}

export function buildStormAlertDigestText(rows: StormAlertDigestRow[]): string {
  const limited = rows.slice(0, STORM_ALERT_EMAIL_MAX_ROWS)
  const lines = limited.map(
    (row) =>
      `${row.customerName} | ${row.address || '—'} | ${row.layer} (${row.source}) | ${row.magnitudeLabel} | ${formatStormEventDateLabel(row.eventDate)} | ${row.proximityLabel} | ${row.routed ? 'Routed' : 'Noted'}`
  )
  if (rows.length > STORM_ALERT_EMAIL_MAX_ROWS) {
    lines.push(`…and ${rows.length - STORM_ALERT_EMAIL_MAX_ROWS} more`)
  }
  return ['Storm opportunity alerts (est.)', '', ...lines].join('\n')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
