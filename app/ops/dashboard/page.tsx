export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import {
  canAccessJobBoardFromPermissionNames,
  canAccessOpsDashboardFromPermissionNames,
} from '@/lib/permissions'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { CANCELLED_JOB_STATUS } from '@/lib/job-status'
import { loadNeedsYouForViewer, type DataHealthReport } from '@/lib/data-health'
import OpsDashboardView from '@/components/ops/OpsDashboardView'
import { isOwnerProfile } from '@/lib/super-admin'

export default async function OpsDashboardPage() {
  const { authUser, profile } = await requireAuth()
  const supabase = createClient()
  const admin = createServiceClient()
  const opsPermissions = await resolveEffectivePermissionNames(admin, authUser.id, profile)

  if (!canAccessOpsDashboardFromPermissionNames(opsPermissions)) {
    redirect('/dashboard')
  }

  const canJobBoard = canAccessJobBoardFromPermissionNames(opsPermissions)

  // Get today's date for filtering
  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]
  const weekFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  // Fetch all ops data in parallel
  const [
    { data: allJobs },
    { data: todaysJobs },
    { data: upcomingJobs },
    { data: crews },
    { data: materialsNeeded },
    { data: recentNotes },
  ] = await Promise.all([
    // All active jobs (not collected or cancelled)
    supabase
      .from('production_jobs')
      .select('id, status, job_type, priority')
      .eq('org_id', profile.org_id)
      .not('status', 'in', `(collected,${CANCELLED_JOB_STATUS})`),
    // Today's scheduled jobs
    supabase
      .from('production_jobs')
      .select(`
        id, job_number, status, job_type, address_text, scheduled_date, 
        scheduled_time_start, priority,
        assigned_crew:crews(id, name, color),
        assigned_sub:sub_contractors(id, company_name),
        customer:customers(name, phone)
      `)
      .eq('org_id', profile.org_id)
      .eq('scheduled_date', todayStr)
      .in('status', ['scheduled', 'in_progress'])
      .order('scheduled_time_start'),
    // Upcoming jobs (next 7 days)
    supabase
      .from('production_jobs')
      .select(`
        id, job_number, status, job_type, address_text, scheduled_date,
        assigned_crew:crews(id, name, color),
        assigned_sub:sub_contractors(id, company_name)
      `)
      .eq('org_id', profile.org_id)
      .gt('scheduled_date', todayStr)
      .lte('scheduled_date', weekFromNow)
      .in('status', ['scheduled'])
      .order('scheduled_date')
      .limit(10),
    // Active crews
    supabase
      .from('crews')
      .select('id, name, color, crew_type, daily_capacity')
      .eq('org_id', profile.org_id)
      .eq('active', true),
    // Jobs needing materials attention
    supabase
      .from('production_jobs')
      .select('id, job_number, address_text, materials_status, materials_eta')
      .eq('org_id', profile.org_id)
      .in('materials_status', ['not_ordered', 'ordered'])
      .in('status', ['sold', 'materials', 'scheduled'])
      .order('created_at')
      .limit(5),
    // Recent job notes
    // Messages in the deal threads (Production/Crew); the session client keeps RLS (message_visible_to) in force.
    supabase
      .from('activities')
      .select(`
        id, body, created_at,
        production_job:production_jobs!activities_production_job_id_fkey(id, job_number, address_text),
        user:users(full_name)
      `)
      .eq('org_id', profile.org_id)
      .in('audience', ['production', 'crew'])
      .eq('origin', 'human')
      .not('production_job_id', 'is', null)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(5)
      .then((r) => ({ ...r, data: (r.data ?? []).map((n: any) => ({ ...n, note: n.body })) })),
  ])

  // "Needs you" — the daily data-health check, shaped for who is looking by the one rule in lib/data-health.ts
  // (owners: everything; ops: operational rows only, no dollars; field roles: nothing).
  let needsYou: DataHealthReport | null = null
  let needsYouAudience: 'owner' | 'ops' = 'ops'
  try {
    const loaded = await loadNeedsYouForViewer(admin, profile.org_id, profile, canJobBoard)
    needsYou = loaded.report
    needsYouAudience = loaded.audience === 'owner' ? 'owner' : 'ops'
  } catch (error) {
    console.error('[ops dashboard] data health failed', error)
  }

  // Calculate pipeline stats
  const pipelineStats: Record<string, number> = {
    sold: allJobs?.filter(j => j.status === 'sold').length || 0,
    materials: allJobs?.filter(j => j.status === 'materials').length || 0,
    scheduled: allJobs?.filter(j => j.status === 'scheduled').length || 0,
    in_progress: allJobs?.filter(j => j.status === 'in_progress').length || 0,
    complete: allJobs?.filter(j => j.status === 'complete').length || 0,
  }

  const totalActive = Object.values(pipelineStats).reduce((a, b) => a + b, 0)
  const urgentJobs = allJobs?.filter(j => j.priority === 'urgent').length || 0
  // Paused jobs have no pipeline box and aren't in totalActive — call them out so they aren't forgotten.
  const onHoldJobs = allJobs?.filter(j => j.status === 'on_hold').length || 0

  // Transform data to handle Supabase array returns
  const transformJob = (job: any) => ({
    ...job,
    assigned_crew: Array.isArray(job.assigned_crew) ? job.assigned_crew[0] : job.assigned_crew,
    assigned_sub: Array.isArray(job.assigned_sub) ? job.assigned_sub[0] : job.assigned_sub,
    customer: Array.isArray(job.customer) ? job.customer[0] : job.customer,
  })

  const todaysJobsList = todaysJobs?.map(transformJob) || []
  const upcomingJobsList = upcomingJobs?.map(transformJob) || []

  return (
    <OpsDashboardView
      today={today}
      canJobBoard={canJobBoard}
      canFixPayPlans={isOwnerProfile(profile)}
      needsYou={needsYou}
      needsYouAudience={needsYouAudience}
      pipelineStats={pipelineStats}
      totalActive={totalActive}
      urgentJobs={urgentJobs}
      onHoldJobs={onHoldJobs}
      todaysJobsList={todaysJobsList}
      upcomingJobsList={upcomingJobsList}
      crews={crews}
      materialsNeeded={materialsNeeded}
      recentNotes={recentNotes}
    />
  )
}
