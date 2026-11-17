import type { CalendarClient } from '@/lib/calendar/provider'

/** Plain-words name of a user's calendar for messages. Neutral when there is no client to ask. */
export function calendarLabel(client?: Pick<CalendarClient, 'provider'> | null): string {
  if (!client) return 'Calendar'
  return client.provider === 'microsoft' ? 'Outlook Calendar' : 'Google Calendar'
}
