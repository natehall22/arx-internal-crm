/**
 * Shared client-side helpers for booking the inside-sales insurance call when a rep
 * submits an "Insurance Follow Up" inspection outcome. Used by both feedback surfaces
 * (/appointments/feedback and the dashboard inspection-status modal) so their
 * validation and payload construction cannot drift.
 */
import {
  easternDatetimeLocalToUtcIso,
  getEasternTodayIso,
  getEasternWeekdayForDateIso,
} from '@/lib/eastern-datetime'
import { normalizeInspectionOutcomeId } from '@/lib/inspection-outcomes'

export function isRescheduledOutcomeId(id: string | null | undefined): boolean {
  return normalizeInspectionOutcomeId(id) === 'rescheduled'
}

export function isInsuranceFollowUpOutcomeId(id: string | null | undefined): boolean {
  return normalizeInspectionOutcomeId(id) === 'insurance_follow_up'
}

export function addDaysToEasternDateIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

/** Tomorrow in ET, skipping Sunday — default suggestion for the inside-sales insurance call. */
export function defaultInsuranceCallDate(): string {
  let next = addDaysToEasternDateIso(getEasternTodayIso(), 1)
  if (getEasternWeekdayForDateIso(next) === 0) {
    next = addDaysToEasternDateIso(next, 1)
  }
  return next
}

export type InsuranceHandoffFields = {
  claimFiled: string
  insuranceCarrier: string
  claimNumber: string
  /** Raw `datetime-local` value (Eastern wall time) */
  adjusterMeeting: string
  decisionMaker: string
  bestCallWindow: string
  contextLine: string
}

/**
 * Builds the `handoff_context` payload for /api/inspections/status from raw form state.
 * Keys mirror the server's sanitizeHandoffContext whitelist; undefined when nothing filled.
 */
export function buildInsuranceHandoffContext(
  fields: InsuranceHandoffFields
): Record<string, string> | undefined {
  const handoffContext: Record<string, string> = {}
  if (fields.claimFiled) handoffContext.claim_filed = fields.claimFiled
  if (fields.insuranceCarrier.trim()) handoffContext.insurance_carrier = fields.insuranceCarrier.trim()
  if (fields.claimNumber.trim()) handoffContext.claim_number = fields.claimNumber.trim()
  if (fields.adjusterMeeting) {
    const adjusterIso = easternDatetimeLocalToUtcIso(fields.adjusterMeeting)
    if (adjusterIso) handoffContext.adjuster_meeting_at = adjusterIso
  }
  if (fields.decisionMaker.trim()) handoffContext.decision_maker = fields.decisionMaker.trim()
  if (fields.bestCallWindow) handoffContext.best_call_window = fields.bestCallWindow
  if (fields.contextLine.trim()) handoffContext.context_line = fields.contextLine.trim()
  return Object.keys(handoffContext).length > 0 ? handoffContext : undefined
}
