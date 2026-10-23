'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

import AppointmentsList from '@/components/appointments/AppointmentsList'
import CalendarView from '@/components/appointments/CalendarView'
import ScheduleView from '@/components/appointments/ScheduleView'
import Nav from '@/components/Nav'
import { PageHeader } from '@/components/ui/page-header'

/**
 * Appointments: the one home for inspections and closes. List and Calendar are two views of the same thing
 * (/appointments, /appointments?view=calendar); picking a new time (?reschedule=ID) happens here too.
 * Replaces the separate /appointments, /calendar and /schedule screens (those URLs redirect here).
 * Round-robin / Google / appointment-type setup stays in Settings → Appointment scheduling.
 */
function Hub() {
  const params = useSearchParams()
  const reschedule = params.get('reschedule')
  const view = params.get('view') === 'calendar' ? 'calendar' : 'list'
  const tab = (active: boolean) => `inline-flex min-h-tap items-center rounded-ui px-4 text-ui-sm font-semibold ${active ? 'bg-brand-700 text-white' : 'border border-surface-line bg-surface text-ink'}`

  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6">
        {reschedule ? (
          <ScheduleView />
        ) : (
          <>
            <PageHeader
              title="Appointments"
              subtitle="Inspections and closes: list or calendar"
              actions={<Link href="/admin/scheduling" className="inline-flex min-h-tap items-center text-ui-sm font-semibold text-brand-800 underline">Scheduling settings</Link>}
            />
            <nav aria-label="Appointments views" className="flex gap-2">
              <Link href="/appointments" className={tab(view === 'list')} aria-current={view === 'list' ? 'page' : undefined}>List</Link>
              <Link href="/appointments?view=calendar" className={tab(view === 'calendar')} aria-current={view === 'calendar' ? 'page' : undefined}>Calendar</Link>
            </nav>
            {view === 'calendar' ? <CalendarView /> : <AppointmentsList />}
          </>
        )}
      </main>
    </div>
  )
}

export default function AppointmentsPage() {
  return (
    <Suspense fallback={null}>
      <Hub />
    </Suspense>
  )
}
