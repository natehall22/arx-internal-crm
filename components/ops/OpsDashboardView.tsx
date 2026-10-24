import Link from 'next/link'

import Nav from '@/components/Nav'
import NeedsYouList from '@/components/ops/NeedsYouList'
import { JOB_STATUS_CONFIG, jobStatusConfig, type JobStatus } from '@/lib/job-status'
import type { DataHealthReport } from '@/lib/data-health'

/** Full words on the pipeline tiles; every other screen keeps JOB_STATUS_CONFIG's labels. */
const PIPELINE_TILE_LABEL: Partial<Record<JobStatus, string>> = { materials: 'Materials', in_progress: 'In progress' }

export type OpsDashboardViewProps = {
  today: Date
  canJobBoard: boolean
  canFixPayPlans: boolean
  needsYou: DataHealthReport | null
  needsYouAudience: 'owner' | 'ops'
  pipelineStats: Record<string, number>
  totalActive: number
  urgentJobs: number
  onHoldJobs: number
  todaysJobsList: any[]
  upcomingJobsList: any[]
  crews: any[] | null
  materialsNeeded: any[] | null
  recentNotes: any[] | null
}

/** The Operations Dashboard screen. Presentational only: the page loads the data, the phone check renders it with fixtures. */
export default function OpsDashboardView({
  today, canJobBoard, canFixPayPlans, needsYou, needsYouAudience, pipelineStats, totalActive, urgentJobs, onHoldJobs,
  todaysJobsList, upcomingJobsList, crews, materialsNeeded, recentNotes,
}: OpsDashboardViewProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">Operations Dashboard</h1>
            <p className="text-gray-500 text-sm sm:text-base">
              Today&apos;s installs, materials, crews, and job movement ·{' '}
              {today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>
          {/* Phone: one chip row that scrolls inside itself, so the page never scrolls sideways. */}
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:gap-3 sm:overflow-visible sm:px-0 sm:pb-0 [&>a]:shrink-0 [&>a]:whitespace-nowrap [&>a]:min-h-[44px] [&>a]:inline-flex [&>a]:items-center">
            {canJobBoard && (
              <Link
                href="/ops"
                className="px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 font-medium"
              >
                Job Board
              </Link>
            )}
            <Link
              href="/ops/schedule"
              className="px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 font-medium"
            >
              Install Schedule
            </Link>
            <Link
              href="/ops/reviews"
              className="px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 font-medium"
            >
              Reviews
            </Link>
            <Link
              href="/ops/schedule?view=calendar"
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
            >
              Calendar
            </Link>
          </div>
        </div>

        {needsYou && <NeedsYouList report={needsYou} canFixPayPlans={canFixPayPlans} audience={needsYouAudience} />}

        {/* Pipeline Overview */}
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <div className="flex flex-col gap-1 mb-4 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Job Pipeline</h2>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="text-gray-500">{totalActive} active jobs</span>
              {urgentJobs > 0 && (
                <span className="text-red-600 font-medium">🔴 {urgentJobs} urgent</span>
              )}
              {onHoldJobs > 0 && (
                <span className={`font-medium ${JOB_STATUS_CONFIG.on_hold.color}`}>⏸ {onHoldJobs} on hold</span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
            {(['sold', 'materials', 'scheduled', 'in_progress', 'complete'] as JobStatus[]).map((status) => {
              const inner = (
                <>
                  <div className={`text-3xl font-bold ${JOB_STATUS_CONFIG[status].color}`}>
                    {pipelineStats[status]}
                  </div>
                  <div className={`text-sm font-medium ${JOB_STATUS_CONFIG[status].color}`}>
                    {PIPELINE_TILE_LABEL[status] ?? JOB_STATUS_CONFIG[status].label}
                  </div>
                </>
              )
              const boxClass = `p-4 rounded-lg ${JOB_STATUS_CONFIG[status].pillClass}`
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
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-gray-900">#{job.job_number}</span>
                          {job.priority === 'urgent' && <span>🔴</span>}
                          {job.priority === 'high' && <span>🟠</span>}
                          <span className={`px-2 py-0.5 text-xs font-medium rounded ${jobStatusConfig(job.status).pillClass} ${jobStatusConfig(job.status).color}`}>
                            {jobStatusConfig(job.status).label}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 truncate">{job.address_text}</p>
                        {job.customer?.name && (
                          <p className="text-xs text-gray-500 mt-1">{job.customer.name}</p>
                        )}
                      </div>
                      <div className="max-w-[45%] shrink-0 text-right">
                        {job.scheduled_time_start && (
                          <p className="text-sm font-medium text-gray-900">{job.scheduled_time_start}</p>
                        )}
                        {job.assigned_crew && (
                          <div className="flex items-center gap-1 mt-1">
                            <div 
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: job.assigned_crew.color }}
                            />
                            <span className="truncate text-xs text-gray-600">{job.assigned_crew.name}</span>
                          </div>
                        )}
                        {job.assigned_sub && (
                          <span className="block truncate text-xs text-gray-600">{job.assigned_sub.company_name}</span>
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
                <Link href="/admin/crews" className="inline-flex min-h-[44px] items-center text-sm text-indigo-600 hover:text-indigo-700">
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
              <Link href="/ops/schedule?view=calendar" className="inline-flex min-h-[44px] items-center text-sm text-indigo-600 hover:text-indigo-700">
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
                          <span className="truncate text-xs text-gray-600">{job.assigned_crew.name}</span>
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
                            className="inline-flex min-h-[44px] items-center text-sm font-medium text-indigo-600 hover:text-indigo-700"
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
