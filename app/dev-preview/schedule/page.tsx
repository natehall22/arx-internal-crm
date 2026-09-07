'use client'

/**
 * TEMPORARY dev-only visual harness for the install schedule board.
 *
 * Renders the REAL `InstallScheduleClient` against fixture data so the board can
 * be looked at without an authenticated session. Hard-gated to development, and
 * meant to be deleted once the visual pass is done — do not commit this.
 */
import InstallScheduleClient from '@/app/ops/schedule/InstallScheduleClient'

const IS_DEV = process.env.NODE_ENV === 'development'

function iso(offsetDays: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const SUBS = [
  { id: 'sub-1', company_name: 'Ramirez Roofing Crew', services: ['roofing'], scheduling_email: 'ramirez.crew@gmail.com', phone: '704-555-0142' },
  { id: 'sub-2', company_name: 'Blue Ridge Exteriors', services: ['roofing', 'siding'], scheduling_email: null, phone: '704-555-0188' },
  { id: 'sub-3', company_name: 'Carolina Peak Contractors', services: ['roofing'], scheduling_email: 'dispatch@carolinapeak.com', phone: '980-555-0110' },
]

const SCHEDULED = [
  { id: 'j1', job_number: '26-0044', customer_name: 'Caitlin Kaestner', address_text: '639 Spring St SW, Concord NC 28025', scheduled_date: iso(1), install_days: 1, assigned_sub_id: 'sub-1', status: 'scheduled', job_type: 'roofing', total_squares: 29.56 },
  { id: 'j2', job_number: '26-0051', customer_name: 'Marcus Webb', address_text: '2300 Heritage Ct, Kannapolis NC 28083', scheduled_date: iso(2), install_days: 2, assigned_sub_id: 'sub-1', status: 'scheduled', job_type: 'roofing', total_squares: 47 },
  { id: 'j3', job_number: '26-0048', customer_name: 'Priya Raman', address_text: '1101 Mount Olivet Rd, Kannapolis NC 28083', scheduled_date: iso(3), install_days: 1, assigned_sub_id: 'sub-3', status: 'scheduled', job_type: 'roofing', total_squares: 22.45 },
  { id: 'j4', job_number: '26-0039', customer_name: 'Dale Whitfield', address_text: '88 Cabarrus Ave W, Concord NC 28025', scheduled_date: iso(5), install_days: 1, assigned_sub_id: 'sub-2', status: 'in_progress', job_type: 'roofing', total_squares: 31.2 },
  { id: 'j5', job_number: '26-0055', customer_name: 'Sandra Ellison-Vandermeer', address_text: '4471 Poplar Tent Rd, Concord NC 28027', scheduled_date: iso(8), install_days: 2, assigned_sub_id: 'sub-3', status: 'scheduled', job_type: 'roofing', total_squares: 38.9 },
]

const UNSCHEDULED = [
  { id: 'u1', job_number: '26-0057', customer_name: 'Tom Alvarez', address_text: '512 Ridgeview Dr, Concord NC 28025', status: 'materials', job_type: 'roofing', total_squares: 26.1, sold_at: iso(-21) },
  { id: 'u2', job_number: '26-0058', customer_name: 'Jenna Kowalczyk', address_text: '77 Union St N, Concord NC 28025', status: 'sold', job_type: 'roofing', total_squares: 33.4, sold_at: iso(-14) },
  { id: 'u3', job_number: '26-0059', customer_name: 'Ray Bell', address_text: '9004 Poplar Tent Rd, Concord NC 28027', status: 'sold', job_type: 'roofing', total_squares: null, sold_at: iso(-6) },
  { id: 'u4', job_number: '26-0060', customer_name: 'Auggie Fernandes', address_text: '215 Winecoff School Rd, Kannapolis NC 28081', status: 'materials', job_type: 'roofing', total_squares: 41.8, sold_at: iso(-3) },
]

if (IS_DEV && typeof window !== 'undefined' && !(window as unknown as { __arxPatched?: boolean }).__arxPatched) {
  ;(window as unknown as { __arxPatched?: boolean }).__arxPatched = true
  const realFetch = window.fetch.bind(window)
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (url.includes('/api/ops/install-schedule/assign')) {
      const body = JSON.parse(String(init?.body ?? '{}'))
      const sub = SUBS.find((s) => s.id === body.subId)
      return new Response(
        JSON.stringify({
          job: { id: body.jobId, scheduled_date: body.scheduledDate, install_days: body.installDays ?? 1, assigned_sub_id: body.subId, status: 'scheduled' },
          calendar: 'synced',
          subNotified: Boolean(sub?.scheduling_email),
          subHasSchedulingEmail: Boolean(sub?.scheduling_email),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }
    if (url.includes('/api/ops/install-schedule/unassign')) {
      return new Response(JSON.stringify({ job: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.includes('/api/ops/install-schedule')) {
      return new Response(JSON.stringify({ subs: SUBS, scheduled: SCHEDULED, unscheduled: UNSCHEDULED }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return realFetch(input as RequestInfo, init)
  }) as typeof window.fetch
}

export default function DevSchedulePreview() {
  if (!IS_DEV) return null
  return <InstallScheduleClient />
}
