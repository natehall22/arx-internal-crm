import { redirect } from 'next/navigation'

/** Folded into Appointments (calendar view). Keep this stub: calendar links in old emails and invites still land here. */
export default function CalendarRedirect() {
  redirect('/appointments?view=calendar')
}
