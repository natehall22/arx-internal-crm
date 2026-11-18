/** Google behind the provider contract: each method is the existing lib/google-calendar.ts function, untouched. */
import {
  createCalendarEvent,
  deleteCalendarEvent,
  getAvailableSlots,
  getFreeBusy,
  getFreeBusyForCalendars,
  isSlotAvailable,
  listCalendarEventsInRange,
  updateCalendarEvent,
} from '@/lib/google-calendar'
import type { CalendarClient } from '@/lib/calendar/provider'

export function googleClient(accessToken: string): CalendarClient {
  return {
    provider: 'google',
    accessToken,
    getFreeBusy: (min, max) => getFreeBusy(accessToken, min, max),
    getFreeBusyForCalendars: (min, max, ids) => getFreeBusyForCalendars(accessToken, min, max, ids),
    isSlotAvailable: (start, end, buffer) => isSlotAvailable(accessToken, start, end, buffer),
    getAvailableSlots: (date, duration, buffer, from, to) => getAvailableSlots(accessToken, date, duration, buffer, from, to),
    createEvent: (event, calendarId, sendUpdates) => createCalendarEvent(accessToken, event, calendarId, sendUpdates),
    updateEvent: (id, event, calendarId, sendUpdates) => updateCalendarEvent(accessToken, id, event, calendarId, sendUpdates),
    deleteEvent: (id, calendarId, sendUpdates) => deleteCalendarEvent(accessToken, id, calendarId, sendUpdates),
    listEventsInRange: (calendarId, min, max) => listCalendarEventsInRange(accessToken, calendarId, min, max),
  }
}
