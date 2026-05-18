/**
 * Convert "YYYY-MM-DDTHH:MM" (and optional seconds) local wall-clock time for an inspection
 * into a UTC ISO string for `scheduled_appointments.scheduled_for` and Google Calendar alignment.
 *
 * Logic is extracted from `app/api/canvass/lead/route.ts` — keep this identical to that path so
 * reschedule, iOS, and canvass scheduling store the same instant for a given local slot.
 */
export function inspectionLocalWallClockToUtcIso(
  localTimeStr: string,
  closerTimezone: string
): string {
  const [datePart, timePart] = localTimeStr.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute] = timePart.split(':').map(Number)

  // Determine timezone offset based on the TARGET date (for DST handling)
  // DST in US starts second Sunday of March, ends first Sunday of November
  // More accurate check: March 8+ through November 1- (approximate)
  const isDST =
    (month > 3 && month < 11) ||
    (month === 3 && day >= 8) ||
    (month === 11 && day < 7)

  let tzOffsetHours = 5 // Default to Eastern Standard Time
  if (
    closerTimezone === 'America/New_York' ||
    closerTimezone === 'America/Detroit' ||
    closerTimezone === 'US/Eastern'
  ) {
    tzOffsetHours = isDST ? 4 : 5
  } else if (closerTimezone === 'America/Chicago' || closerTimezone === 'US/Central') {
    tzOffsetHours = isDST ? 5 : 6
  } else if (closerTimezone === 'America/Denver' || closerTimezone === 'US/Mountain') {
    tzOffsetHours = isDST ? 6 : 7
  } else if (
    closerTimezone === 'America/Los_Angeles' ||
    closerTimezone === 'US/Pacific'
  ) {
    tzOffsetHours = isDST ? 7 : 8
  } else if (closerTimezone === 'America/Phoenix') {
    tzOffsetHours = 7 // Arizona doesn't observe DST
  }

  const utcDate = new Date(Date.UTC(year, month - 1, day, hour + tzOffsetHours, minute, 0))
  return utcDate.toISOString()
}
