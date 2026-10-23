import { redirect } from 'next/navigation'

/** Folded into Appointments: /schedule?reschedule=ID → /appointments?reschedule=ID. */
export default function ScheduleRedirect({ searchParams }: { searchParams?: { reschedule?: string } }) {
  const id = searchParams?.reschedule
  redirect(id && /^[0-9a-f-]{36}$/i.test(id) ? `/appointments?reschedule=${id}` : '/appointments')
}
