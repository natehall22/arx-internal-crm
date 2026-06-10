type TimeZoneParts = {
  year: number
  month: number
  day: number
  weekday: string
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

function getTimeZoneParts(date: Date, timezone: string): TimeZoneParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const parts = formatter.formatToParts(date)
  const partMap = new Map(parts.map((part) => [part.type, part.value]))

  const weekday = partMap.get('weekday')
  const year = partMap.get('year')
  const month = partMap.get('month')
  const day = partMap.get('day')

  if (!weekday || !year || !month || !day) {
    throw new Error('Unable to compute timezone date parts')
  }

  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    weekday,
  }
}

function addDaysToDateParts(
  dateParts: Pick<TimeZoneParts, 'year' | 'month' | 'day'>,
  days: number
): Pick<TimeZoneParts, 'year' | 'month' | 'day'> {
  const date = new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day + days, 12, 0, 0))
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  }
}

function getOffsetMilliseconds(utcDate: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })

  const parts = formatter.formatToParts(utcDate)
  const partMap = new Map(parts.map((part) => [part.type, part.value]))
  const year = partMap.get('year')
  const month = partMap.get('month')
  const day = partMap.get('day')
  const hour = partMap.get('hour')
  const minute = partMap.get('minute')
  const second = partMap.get('second')

  if (!year || !month || !day || !hour || !minute || !second) {
    throw new Error('Unable to compute timezone offset')
  }

  const localAsUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  )

  return localAsUtc - utcDate.getTime()
}

function zonedDateTimeToUtcIso(
  dateParts: Pick<TimeZoneParts, 'year' | 'month' | 'day'>,
  timezone: string,
  hour: number,
  minute: number,
  second: number
): string {
  const localAsUtc = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, hour, minute, second)
  let utcTime = localAsUtc - getOffsetMilliseconds(new Date(localAsUtc), timezone)
  utcTime = localAsUtc - getOffsetMilliseconds(new Date(utcTime), timezone)
  return new Date(utcTime).toISOString()
}

// Given a start date (the FM's first day), compute the week1 and week2 windows.
// Week 1 begins the following Sunday (or same day if Sunday).
// Weeks are Sunday 00:00 ET -> Saturday 23:59:59 ET.
export function compute444WeekWindows(startDate: Date, timezone = 'America/New_York'): {
  week1StartsAt: string
  week1EndsAt: string
  week2StartsAt: string
  week2EndsAt: string
} {
  if (Number.isNaN(startDate.getTime())) {
    throw new Error('Invalid start date')
  }

  const startParts = getTimeZoneParts(startDate, timezone)
  const startWeekdayIndex = WEEKDAY_INDEX[startParts.weekday]

  if (startWeekdayIndex === undefined) {
    throw new Error('Unable to compute start weekday')
  }

  const daysUntilSunday = startWeekdayIndex === 0 ? 0 : 7 - startWeekdayIndex
  const week1StartParts = addDaysToDateParts(startParts, daysUntilSunday)
  const week2StartParts = addDaysToDateParts(week1StartParts, 7)
  const week3StartParts = addDaysToDateParts(week1StartParts, 14)

  // Use exclusive end boundaries (start of the next period) so that sub-second
  // timestamps at the end of Saturday are never silently dropped.
  // Comparisons in sync and accountability use ts < endsAt (not ts <= endsAt).
  return {
    week1StartsAt: zonedDateTimeToUtcIso(week1StartParts, timezone, 0, 0, 0),
    week1EndsAt: zonedDateTimeToUtcIso(week2StartParts, timezone, 0, 0, 0),
    week2StartsAt: zonedDateTimeToUtcIso(week2StartParts, timezone, 0, 0, 0),
    week2EndsAt: zonedDateTimeToUtcIso(week3StartParts, timezone, 0, 0, 0),
  }
}
