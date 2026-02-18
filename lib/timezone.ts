/**
 * Timezone utilities for consistent date/time display across the app.
 * Default timezone is America/New_York (Eastern Time).
 */

export const DEFAULT_TIMEZONE = 'America/New_York'

/**
 * Format a date string or Date object to display time in the specified timezone.
 * @param dateInput - ISO date string or Date object (typically UTC from database)
 * @param timezone - IANA timezone string (defaults to America/New_York)
 * @returns Formatted time string (e.g., "9:00 AM")
 */
export function formatTimeInTimezone(
  dateInput: string | Date,
  timezone: string = DEFAULT_TIMEZONE
): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput
  
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  })
}

/**
 * Format a date string or Date object to display date in the specified timezone.
 * Returns "Today", "Tomorrow", or formatted date.
 * @param dateInput - ISO date string or Date object (typically UTC from database)
 * @param timezone - IANA timezone string (defaults to America/New_York)
 * @returns Formatted date string
 */
export function formatDateInTimezone(
  dateInput: string | Date,
  timezone: string = DEFAULT_TIMEZONE
): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput
  
  // Get today and tomorrow in the target timezone
  const now = new Date()
  const todayStr = now.toLocaleDateString('en-US', { timeZone: timezone })
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const tomorrowStr = tomorrow.toLocaleDateString('en-US', { timeZone: timezone })
  
  const dateStr = date.toLocaleDateString('en-US', { timeZone: timezone })
  
  if (dateStr === todayStr) return 'Today'
  if (dateStr === tomorrowStr) return 'Tomorrow'
  
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: timezone,
  })
}

/**
 * Format a date string or Date object to display full date and time.
 * @param dateInput - ISO date string or Date object
 * @param timezone - IANA timezone string (defaults to America/New_York)
 * @returns Formatted date and time string (e.g., "Thu, Feb 19 at 9:00 AM")
 */
export function formatDateTimeInTimezone(
  dateInput: string | Date,
  timezone: string = DEFAULT_TIMEZONE
): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput
  
  const dateFormatted = date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: timezone,
  })
  
  const timeFormatted = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  })
  
  return `${dateFormatted} at ${timeFormatted}`
}

/**
 * Get the current date/time in a specific timezone as a formatted string.
 * @param timezone - IANA timezone string (defaults to America/New_York)
 * @returns Current time in the timezone
 */
export function getCurrentTimeInTimezone(timezone: string = DEFAULT_TIMEZONE): Date {
  // This returns a Date object, but operations should use timezone-aware formatting
  return new Date()
}

/**
 * Parse a local time string (e.g., "2026-02-17T09:00") and convert to UTC ISO string.
 * Assumes the input is in the specified timezone.
 * @param localTimeStr - Local time string in format "YYYY-MM-DDTHH:MM"
 * @param timezone - IANA timezone string the input is in (defaults to America/New_York)
 * @returns UTC ISO string for database storage
 */
export function localTimeToUTC(
  localTimeStr: string,
  timezone: string = DEFAULT_TIMEZONE
): string {
  // Parse the local time components
  const [datePart, timePart] = localTimeStr.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute] = (timePart || '00:00').split(':').map(Number)
  
  // Create a date string that includes the timezone
  // Format: "Feb 17, 2026 09:00:00" then parse with timezone
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`
  
  // Use Intl to get the offset for this timezone at this date
  const tempDate = new Date(dateStr + 'Z') // Treat as UTC temporarily
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  
  // Get timezone offset by comparing UTC to local
  // This is a simplified approach - for production, consider using a library like date-fns-tz
  const parts = formatter.formatToParts(tempDate)
  const getPart = (type: string) => parts.find(p => p.type === type)?.value || '0'
  
  // For Eastern Time, offset is typically -5 (EST) or -4 (EDT)
  // We'll use a simple calculation based on typical offsets
  const now = new Date()
  const jan = new Date(now.getFullYear(), 0, 1)
  const jul = new Date(now.getFullYear(), 6, 1)
  const stdOffset = Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset())
  
  // Check if we're in DST for the target date
  const targetDate = new Date(year, month - 1, day)
  const isDST = targetDate.getTimezoneOffset() < stdOffset
  
  // Eastern Time offsets
  const offsetHours = timezone === 'America/New_York' ? (isDST ? 4 : 5) : 5
  
  // Create UTC date by adding the offset
  const utcDate = new Date(Date.UTC(year, month - 1, day, hour + offsetHours, minute, 0))
  
  return utcDate.toISOString()
}

/**
 * Format time for display with AM/PM, handling both 12 and 24 hour formats.
 * @param hour - Hour (0-23)
 * @param minute - Minute (0-59)
 * @returns Formatted time string (e.g., "9:00 AM")
 */
export function formatHourMinute(hour: number, minute: number): string {
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  const displayMinute = String(minute).padStart(2, '0')
  return `${displayHour}:${displayMinute} ${ampm}`
}
