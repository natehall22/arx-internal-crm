export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'

import Nav from '@/components/Nav'
import { requireAuth } from '@/lib/auth'
import { resolveOpsAccess } from '@/lib/ops-access'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import ProductionCalendarClient, { type ProductionCalendarCrew, type ProductionCalendarJob } from '../calendar/ProductionCalendarClient'
import InstallScheduleClient from './InstallScheduleClient'

function transformCalendarJobs(rows: unknown[]): ProductionCalendarJob[] {
  return (rows || []).map((job: any) => ({
    ...job,
    assigned_crew: Array.isArray(job.assigned_crew) ? job.assigned_crew[0] : job.assigned_crew,
    assigned_sub: Array.isArray(job.assigned_sub) ? job.assigned_sub[0] : job.assigned_sub,
    customer: Array.isArray(job.customer) ? job.customer[0] : job.customer,
  }))
}

/**
 * Jobs → Schedule: the one home for install scheduling. "Board" is the sub-contractor dispatch board (view + assignment on
 * one screen, 2 clicks to put a sold job on a sub's day); "Calendar" is the production calendar of scheduled jobs.
 * Replaces the separate /ops/schedule and /ops/calendar screens (/ops/calendar redirects here).
 */
export default async function JobsSchedulePage({ searchParams }: { searchParams?: { view?: string } }) {
  const { authUser, profile } = await requireAuth()
  const admin = createServiceClient()
  const { canJobBoard } = await resolveOpsAccess(admin, authUser.id, profile)
  if (!canJobBoard) redirect('/dashboard')

  const calendar = searchParams?.view === 'calendar'
  let calendarJobs: ProductionCalendarJob[] = []
  let crews: ProductionCalendarCrew[] = []
  if (calendar) {
    const supabase = createClient()
    const [jobsRes, crewsRes] = await Promise.all([
      supabase
        .from('production_jobs')
        .select(`
          id, job_number, status, job_type, address_text,
          scheduled_date, scheduled_time_start, estimated_duration_hours, priority,
          assigned_crew:crews(id, name, color),
          assigned_sub:sub_contractors(id, company_name),
          customer:customers(name)
        `)
        .eq('org_id', profile.org_id)
        .not('scheduled_date', 'is', null)
        .in('status', ['scheduled', 'in_progress'])
        .order('scheduled_date'),
      supabase.from('crews').select('id, name, color, daily_capacity').eq('org_id', profile.org_id).eq('active', true).order('name'),
    ])
    calendarJobs = transformCalendarJobs((jobsRes.data ?? []) as unknown[])
    crews = (crewsRes.data ?? []) as ProductionCalendarCrew[]
  }

  const tab = (active: boolean) => `inline-flex min-h-tap items-center rounded-ui px-4 text-ui-sm font-semibold ${active ? 'bg-brand-700 text-white' : 'border border-surface-line bg-surface text-ink'}`
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <nav aria-label="Schedule views" className="mx-auto flex max-w-[1800px] gap-2 px-4 pt-4">
        <Link href="/ops/schedule" className={tab(!calendar)} aria-current={!calendar ? 'page' : undefined}>Board</Link>
        <Link href="/ops/schedule?view=calendar" className={tab(calendar)} aria-current={calendar ? 'page' : undefined}>Calendar</Link>
      </nav>
      {calendar ? <ProductionCalendarClient jobs={calendarJobs} crews={crews} canJobBoard={canJobBoard} embedded /> : <InstallScheduleClient embedded />}
    </div>
  )
}
