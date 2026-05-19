export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveOpsAccess } from '@/lib/ops-access'
import ProductionCalendarClient, {
  type ProductionCalendarJob,
  type ProductionCalendarCrew,
} from './ProductionCalendarClient'

function transformCalendarJobs(jobsResData: unknown[]): ProductionCalendarJob[] {
  return (jobsResData || []).map((job: any) => ({
    ...job,
    assigned_crew: Array.isArray(job.assigned_crew) ? job.assigned_crew[0] : job.assigned_crew,
    assigned_sub: Array.isArray(job.assigned_sub) ? job.assigned_sub[0] : job.assigned_sub,
    customer: Array.isArray(job.customer) ? job.customer[0] : job.customer,
  }))
}

export default async function ProductionCalendarPage() {
  const { authUser, profile } = await requireAuth()
  const admin = createServiceClient()
  const { canJobBoard } = await resolveOpsAccess(admin, authUser.id, profile)

  if (!canJobBoard) {
    redirect('/dashboard')
  }

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
    supabase
      .from('crews')
      .select('id, name, color, daily_capacity')
      .eq('org_id', profile.org_id)
      .eq('active', true)
      .order('name'),
  ])

  const jobs = transformCalendarJobs((jobsRes.data ?? []) as unknown[])
  const crews = (crewsRes.data ?? []) as ProductionCalendarCrew[]

  return (
    <ProductionCalendarClient jobs={jobs} crews={crews} canJobBoard={canJobBoard} />
  )
}
