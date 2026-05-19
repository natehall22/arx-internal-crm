export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  canAccessJobBoardFromPermissionNames,
  canAccessOpsDashboardFromPermissionNames,
} from '@/lib/permissions'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'

type JobStatus = 'sold' | 'materials' | 'scheduled' | 'in_progress' | 'complete' | 'collected'

const statusConfig: Record<JobStatus, { label: string; color: string; bgColor: string }> = {
  sold: { label: 'Sold', color: 'text-blue-700', bgColor: 'bg-blue-100' },
  materials: { label: 'Materials', color: 'text-amber-700', bgColor: 'bg-amber-100' },
  scheduled: { label: 'Scheduled', color: 'text-purple-700', bgColor: 'bg-purple-100' },
  in_progress: { label: 'In Progress', color: 'text-indigo-700', bgColor: 'bg-indigo-100' },
  complete: { label: 'Complete', color: 'text-green-700', bgColor: 'bg-green-100' },
  collected: { label: 'Collected', color: 'text-gray-700', bgColor: 'bg-gray-100' },
}

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
    // All active jobs (not collected)
    supabase
      .from('production_jobs')
      .select('id, status, job_type, priority')
      .eq('org_id', profile.org_id)
      .neq('status', 'collected'),
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
    supabase
      .from('production_job_notes')
      .select(`
        id, note, created_at, note_type,
        production_job:production_jobs(id, job_number, address_text),
        user:users(full_name)
      `)
      .eq('org_id', profile.org_id)
      .order('created_at', { ascending: false })
      .limit(5),
  ])

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
    <div className="min-h-screen bg-gray-50">
      <Nav />
      
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Operations Dashboard</h1>
            <p className="text-gray-500 text-sm sm:text-base">
              Today&apos;s installs, materials, crews, and job movement ·{' '}
              {today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="flex gap-3">
            {canJobBoard && (
              <Link
                href="/ops"
                className="px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 font-medium"
              >
                Job Board
              </Link>
            )}
            <Link
              href="/ops/calendar"
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
            >
              Calendar
            </Link>
          </div>
        </div>

        {/* Pipeline Overview */}
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Job Pipeline</h2>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-gray-500">{totalActive} active jobs</span>
              {urgentJobs > 0 && (
                <span className="text-red-600 font-medium">🔴 {urgentJobs} urgent</span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-5 gap-4">
            {(['sold', 'materials', 'scheduled', 'in_progress', 'complete'] as JobStatus[]).map((status) => {
              const inner = (
                <>
                  <div className={`text-3xl font-bold ${statusConfig[status].color}`}>
                    {pipelineStats[status]}
                  </div>
                  <div className={`text-sm font-medium ${statusConfig[status].color}`}>
                    {statusConfig[status].label}
                  </div>
                </>
              )
              const boxClass = `p-4 rounded-lg ${statusConfig[status].bgColor}`
              return canJobBoard ? (
                <Link
                  key={status}
                  href={`/ops?status=${status}`}
                  className={`${boxClass} hover:opacity-80 transition-opacity`}
                >
                  {inner}
                </Link>
              ) : (
                <div key={status} className={boxClass}>
                  {inner}
                </div>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Today's Jobs */}
          <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Today&apos;s Schedule</h2>
              <span className="text-sm text-gray-500">{todaysJobsList.length} jobs</span>
            </div>
            {todaysJobsList.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>No jobs scheduled for today</p>
              </div>
            ) : (
              <div className="space-y-3">
                {todaysJobsList.map((job: any) => {
                  const card = (
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-gray-900">#{job.job_number}</span>
                          {job.priority === 'urgent' && <span>🔴</span>}
                          {job.priority === 'high' && <span>🟠</span>}
                          <span className={`px-2 py-0.5 text-xs font-medium rounded ${statusConfig[job.status as JobStatus]?.bgColor} ${statusConfig[job.status as JobStatus]?.color}`}>
                            {statusConfig[job.status as JobStatus]?.label}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 truncate">{job.address_text}</p>
                        {job.customer?.name && (
                          <p className="text-xs text-gray-500 mt-1">{job.customer.name}</p>
                        )}
                      </div>
                      <div className="text-right">
                        {job.scheduled_time_start && (
                          <p className="text-sm font-medium text-gray-900">{job.scheduled_time_start}</p>
                        )}
                        {job.assigned_crew && (
                          <div className="flex items-center gap-1 mt-1">
                            <div 
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: job.assigned_crew.color }}
                            />
                            <span className="text-xs text-gray-600">{job.assigned_crew.name}</span>
                          </div>
                        )}
                        {job.assigned_sub && (
                          <span className="text-xs text-gray-600">{job.assigned_sub.company_name}</span>
                        )}
                      </div>
                    </div>
                  )
                  return canJobBoard ? (
                    <Link
                      key={job.id}
                      href={`/ops/jobs/${job.id}`}
                      className="block p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      {card}
                    </Link>
                  ) : (
                    <div key={job.id} className="block p-4 bg-gray-50 rounded-lg">
                      {card}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Right Column */}
          <div className="space-y-6">
            {/* Crew Status */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Crews</h2>
                <Link href="/admin/crews" className="text-sm text-indigo-600 hover:text-indigo-700">
                  Manage
                </Link>
              </div>
              {!crews || crews.length === 0 ? (
                <p className="text-gray-500 text-sm">No crews set up yet</p>
              ) : (
                <div className="space-y-2">
                  {crews.map((crew: any) => (
                    <div key={crew.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50">
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-4 h-4 rounded-full"
                          style={{ backgroundColor: crew.color }}
                        />
                        <span className="text-sm font-medium text-gray-900">{crew.name}</span>
                      </div>
                      <span className="text-xs text-gray-500 capitalize">{crew.crew_type}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Materials Attention */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Materials Needed</h2>
                <span className="text-sm text-gray-500">{materialsNeeded?.length || 0}</span>
              </div>
              {!materialsNeeded || materialsNeeded.length === 0 ? (
                <p className="text-gray-500 text-sm">All materials on track</p>
              ) : (
                <div className="space-y-2">
                  {materialsNeeded.map((job: any) => {
                    const row = (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-gray-900">#{job.job_number}</span>
                          <span className={`text-xs font-medium ${
                            job.materials_status === 'not_ordered' ? 'text-red-600' : 'text-amber-600'
                          }`}>
                            {job.materials_status === 'not_ordered' ? 'Not Ordered' : 'Ordered'}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 truncate">{job.address_text}</p>
                      </>
                    )
                    return canJobBoard ? (
                      <Link
                        key={job.id}
                        href={`/ops/jobs/${job.id}`}
                        className="block p-2 rounded-lg hover:bg-gray-50"
                      >
                        {row}
                      </Link>
                    ) : (
                      <div key={job.id} className="block p-2 rounded-lg">
                        {row}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          {/* Upcoming Jobs */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Upcoming This Week</h2>
              <Link href="/ops/calendar" className="text-sm text-indigo-600 hover:text-indigo-700">
                View Calendar
              </Link>
            </div>
            {upcomingJobsList.length === 0 ? (
              <p className="text-gray-500 text-sm">No upcoming jobs scheduled</p>
            ) : (
              <div className="space-y-2">
                {upcomingJobsList.map((job: any) => {
                  const row = (
                    <>
                      <div className="flex items-center gap-3">
                        <div className="text-center min-w-[50px]">
                          <p className="text-xs text-gray-500">
                            {new Date(job.scheduled_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' })}
                          </p>
                          <p className="text-lg font-bold text-gray-900">
                            {new Date(job.scheduled_date + 'T12:00:00').getDate()}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">#{job.job_number}</p>
                          <p className="text-xs text-gray-500 truncate max-w-[200px]">{job.address_text}</p>
                        </div>
                      </div>
                      {job.assigned_crew && (
                        <div className="flex items-center gap-1">
                          <div 
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: job.assigned_crew.color }}
                          />
                          <span className="text-xs text-gray-600">{job.assigned_crew.name}</span>
                        </div>
                      )}
                    </>
                  )
                  return canJobBoard ? (
                    <Link
                      key={job.id}
                      href={`/ops/jobs/${job.id}`}
                      className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50"
                    >
                      {row}
                    </Link>
                  ) : (
                    <div key={job.id} className="flex items-center justify-between p-3 rounded-lg">
                      {row}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Recent Activity */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Updates</h2>
            {!recentNotes || recentNotes.length === 0 ? (
              <p className="text-gray-500 text-sm">No recent updates</p>
            ) : (
              <div className="space-y-3">
                {recentNotes.map((note: any) => {
                  const job = Array.isArray(note.production_job) ? note.production_job[0] : note.production_job
                  const user = Array.isArray(note.user) ? note.user[0] : note.user
                  return (
                    <div key={note.id} className="p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center justify-between mb-1">
                        {canJobBoard ? (
                          <Link 
                            href={`/ops/jobs/${job?.id}`}
                            className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                          >
                            #{job?.job_number}
                          </Link>
                        ) : (
                          <span className="text-sm font-medium text-gray-900">
                            #{job?.job_number}
                          </span>
                        )}
                        <span className="text-xs text-gray-400">
                          {new Date(note.created_at).toLocaleDateString('en-US', { 
                            month: 'short', 
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                            timeZone: 'America/New_York'
                          })}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700 line-clamp-2">{note.note}</p>
                      {user?.full_name && (
                        <p className="text-xs text-gray-500 mt-1">— {user.full_name}</p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
