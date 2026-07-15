// Setter ramp program — tenure-week windowing and gate thresholds.
//
// Reuses the exact Sunday-alignment date math from program-444-utils.ts
// (week 1 begins the following Sunday after start_date, or the same day if
// start_date is already a Sunday; weeks run Sunday 00:00 -> Saturday 23:59:59
// in the payroll timezone, stored as an exclusive end boundary). Unlike 444,
// this ramp is open-ended — week 3+ repeats indefinitely rather than the
// program completing after two weeks.
import {
  WEEKDAY_INDEX,
  addDaysToDateParts,
  getTimeZoneParts,
  zonedDateTimeToUtcIso,
} from '@/lib/program-444-utils'

export const SETTER_RAMP_PAYROLL_TZ = 'America/New_York'

// ── Thresholds ────────────────────────────────────────────────────────────────
// Week 1 and week 2 targets are fixed program design, not org-configurable
// (unlike the week 3+ target/window, which orgs.setter_ramp_* lets ops tune).
export const SETTER_RAMP_WEEK1_DOOR_TARGET = 200
export const SETTER_RAMP_WEEK2_DOOR_TARGET = 400
export const SETTER_RAMP_WEEK2_APPOINTMENT_TARGET = 4

// Fallbacks used only if org settings are somehow missing — prefer the
// orgs.setter_ramp_week3_avg_target / setter_ramp_avg_window_weeks columns.
export const SETTER_RAMP_WEEK3_AVG_TARGET_DEFAULT = 10
export const SETTER_RAMP_AVG_WINDOW_WEEKS_DEFAULT = 4
export const SETTER_RAMP_WEEKLY_FLOOR_DEFAULT = 500
export const SETTER_RAMP_COMMISSION_RATE_DEFAULT = 3

export type RampWeekWindow = {
  weekNumber: number
  weekStartsAt: string
  weekEndsAt: string
}

/**
 * Sunday-aligned window for an arbitrary 1-indexed tenure week, generalizing
 * compute444WeekWindows (which only computed weeks 1-2) to an open-ended
 * sequence. weekNumber=1 matches 444's week1 exactly for the same start_date.
 */
export function computeSetterRampWeekWindow(
  startDate: Date,
  weekNumber: number,
  timezone: string = SETTER_RAMP_PAYROLL_TZ
): RampWeekWindow {
  if (Number.isNaN(startDate.getTime())) {
    throw new Error('Invalid start date')
  }
  if (!Number.isInteger(weekNumber) || weekNumber < 1) {
    throw new Error('weekNumber must be a positive integer')
  }

  const startParts = getTimeZoneParts(startDate, timezone)
  const startWeekdayIndex = WEEKDAY_INDEX[startParts.weekday]
  if (startWeekdayIndex === undefined) {
    throw new Error('Unable to compute start weekday')
  }

  const daysUntilSunday = startWeekdayIndex === 0 ? 0 : 7 - startWeekdayIndex
  const week1StartParts = addDaysToDateParts(startParts, daysUntilSunday)
  const thisWeekStartParts = addDaysToDateParts(week1StartParts, (weekNumber - 1) * 7)
  const nextWeekStartParts = addDaysToDateParts(week1StartParts, weekNumber * 7)

  return {
    weekNumber,
    weekStartsAt: zonedDateTimeToUtcIso(thisWeekStartParts, timezone, 0, 0, 0),
    weekEndsAt: zonedDateTimeToUtcIso(nextWeekStartParts, timezone, 0, 0, 0), // exclusive
  }
}

/**
 * Which tenure week (1-indexed) `asOf` falls into, relative to start_date.
 * Returns null if `asOf` is before the program's week 1 starts (not yet begun).
 */
export function tenureWeekNumberForDate(
  startDate: Date,
  asOf: Date,
  timezone: string = SETTER_RAMP_PAYROLL_TZ
): number | null {
  const week1 = computeSetterRampWeekWindow(startDate, 1, timezone)
  const week1Start = new Date(week1.weekStartsAt).getTime()
  const asOfMs = asOf.getTime()
  if (asOfMs < week1Start) return null

  const msPerWeek = 7 * 24 * 60 * 60 * 1000
  // Approximate via elapsed ms, then correct by walking window boundaries —
  // DST transitions can shift a week's exact duration by an hour, so a pure
  // division can be off by one near a transition.
  let candidate = Math.floor((asOfMs - week1Start) / msPerWeek) + 1
  if (candidate < 1) candidate = 1

  while (asOfMs >= new Date(computeSetterRampWeekWindow(startDate, candidate, timezone).weekEndsAt).getTime()) {
    candidate += 1
  }
  while (candidate > 1 && asOfMs < new Date(computeSetterRampWeekWindow(startDate, candidate, timezone).weekStartsAt).getTime()) {
    candidate -= 1
  }

  return candidate
}

export type RampGateInput = {
  weekNumber: number
  doorsKnocked: number
  appointmentsSet: number
  /** Trailing rolling average appointments/week, only meaningful for weekNumber >= 3. */
  rollingAvgAppointments: number | null
  week3AvgTarget: number
  week2DoorTarget?: number
  week2AppointmentTarget?: number
  week1DoorTarget?: number
}

/**
 * Pure gate evaluation — does this week's activity clear its tenure-week
 * threshold? Week 1/2 are single-week thresholds; week 3+ uses the rolling
 * average (null average = not enough history yet = gate not passed).
 */
export function evaluateRampGate(input: RampGateInput): boolean {
  const week1Target = input.week1DoorTarget ?? SETTER_RAMP_WEEK1_DOOR_TARGET
  const week2DoorTarget = input.week2DoorTarget ?? SETTER_RAMP_WEEK2_DOOR_TARGET
  const week2ApptTarget = input.week2AppointmentTarget ?? SETTER_RAMP_WEEK2_APPOINTMENT_TARGET

  if (input.weekNumber === 1) {
    return input.doorsKnocked >= week1Target
  }
  if (input.weekNumber === 2) {
    return input.doorsKnocked >= week2DoorTarget && input.appointmentsSet >= week2ApptTarget
  }
  // week 3+
  if (input.rollingAvgAppointments == null) return false
  return input.rollingAvgAppointments >= input.week3AvgTarget
}

/**
 * Trailing rolling average over the last `windowWeeks` weeks 3+ (including the
 * current one), per the org's setter_ramp_avg_window_weeks setting. Uses an
 * EXPANDING average until a full window of week-3+ history exists (e.g. with
 * a 4-week window, week 3 averages just itself, week 4 averages weeks 3-4,
 * ... week 6+ is a true trailing 4-week average) — a straight requirement for
 * a full window would make the gate unpassable for the first `windowWeeks`
 * weeks of every rep's week-3+ era, which is harsher than "10/week on
 * average" reads. Confirm this interpretation matches intent; the window
 * size and target are org-configurable via orgs.setter_ramp_avg_window_weeks
 * / setter_ramp_week3_avg_target either way.
 */
export function computeRollingAverageAppointments(
  weeklyAppointmentCounts: number[],
  windowWeeks: number = SETTER_RAMP_AVG_WINDOW_WEEKS_DEFAULT
): number | null {
  if (weeklyAppointmentCounts.length === 0) return null
  const window = weeklyAppointmentCounts.slice(-windowWeeks)
  const sum = window.reduce((acc, n) => acc + n, 0)
  return Math.round((sum / window.length) * 100) / 100
}
