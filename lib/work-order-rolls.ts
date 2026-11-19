/**
 * "Not ready — roll" (pure, client-safe). One tap pushes any scheduled work (a service visit or a trade work order) to the
 * crew's next working day, with an optional reason. The writes live in lib/work-order-roll.ts (which calls the EXISTING move
 * writers); the counter and the move log in lib/work-order-moves-db.ts.
 *
 * Working days are Mon–Fri (the one definition, `isWorkday` in lib/job-schedule.ts). The company has no holiday list or
 * per-crew work week yet, so a holiday counts as a working day. Dates are bare 'YYYY-MM-DD' (org time zone) — date-only math,
 * so a daylight-saving change cannot shift a roll.
 */
import { addWorkdays, isWorkday, nextWorkdayOnOrAfter } from '@/lib/job-schedule'

export const ROLL_REASONS = ['site_not_ready', 'weather', 'builder_asked', 'other'] as const
export type RollReason = (typeof ROLL_REASONS)[number]

export const ROLL_REASON_LABELS: Record<RollReason, string> = {
  site_not_ready: 'Site not ready',
  weather: 'Weather',
  builder_asked: 'Builder asked',
  other: 'Other',
}

/** 'roll' = the one-tap button, 'shift' = the bulk rain move, 'move' = any other date change. */
export type MoveKind = 'roll' | 'shift' | 'move'

export function isRollReason(v: unknown): v is RollReason {
  return typeof v === 'string' && (ROLL_REASONS as readonly string[]).includes(v)
}

/** A request body's reason: absent / empty = none, a known key = that, anything else = an error. */
export function parseRollReason(v: unknown): RollReason | null | { error: string } {
  if (v === undefined || v === null || v === '') return null
  return isRollReason(v) ? v : { error: 'Pick one of the reasons' }
}

/**
 * The day a roll lands on: the next working day AFTER the later of the scheduled day and today (work still sitting on a day
 * that already passed rolls forward from today, never into the past).
 */
export function rollTargetDay(scheduled: string, today: string): string {
  const base = scheduled > today ? scheduled : today
  // A workday rolls to the next workday; a weekend day to the coming Monday.
  return isWorkday(base) ? addWorkdays(base, 1) : nextWorkdayOnOrAfter(base)
}

/** "Rolled 3×" for the job page / crew row; null when never rolled. */
export function rolledLabel(count: number | null | undefined): string | null {
  const n = Math.max(0, Math.floor(Number(count) || 0))
  return n > 0 ? `Rolled ${n}×` : null
}

export type MoveHistoryEntry = {
  id: string
  from: string | null
  to: string | null
  reason: RollReason | null
  kind: MoveKind
  by: string | null
  at: string
}
