'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { createClientBrowser } from '@/lib/supabase/client'
import ScheduleJobModal from '@/components/ops/ScheduleJobModal'

type JobStatus = 'sold' | 'materials' | 'scheduled' | 'in_progress' | 'complete' | 'collected'

interface Job {
  id: string
  project_id: string
  job_number: string
  status: JobStatus
  job_type: string
  address_text: string
  sale_amount: number | null
  sale_date: string | null
  scheduled_date: string | null
  materials_status: string
  permit_status: string
  priority: string
  assigned_crew?: { id: string; name: string; color: string } | null
  assigned_sub?: { id: string; company_name: string } | null
  customer?: { id: string; name: string; phone: string } | null
  salesperson?: { id: string; full_name: string } | null
  project?: { id: string; scope_of_work: string; product_summary: string } | null
}

interface Crew {
  id: string
  name: string
  crew_type: string
  color: string
  daily_capacity: number
}

interface SubContractor {
  id: string
  company_name: string
  services: string[]
}

const statusConfig: Record<JobStatus, { label: string; color: string; bgColor: string }> = {
  sold: { label: 'Sold', color: 'text-blue-700', bgColor: 'bg-blue-50 border-blue-200' },
  materials: { label: 'Materials', color: 'text-amber-700', bgColor: 'bg-amber-50 border-amber-200' },
  scheduled: { label: 'Scheduled', color: 'text-purple-700', bgColor: 'bg-purple-50 border-purple-200' },
  in_progress: { label: 'In Progress', color: 'text-indigo-700', bgColor: 'bg-indigo-50 border-indigo-200' },
  complete: { label: 'Complete', color: 'text-green-700', bgColor: 'bg-green-50 border-green-200' },
  collected: { label: 'Collected', color: 'text-gray-700', bgColor: 'bg-gray-50 border-gray-200' },
}

const priorityConfig: Record<string, { icon: string; color: string }> = {
  urgent: { icon: '🔴', color: 'text-red-600' },
  high: { icon: '🟠', color: 'text-orange-600' },
  normal: { icon: '', color: 'text-gray-600' },
}

const materialsConfig: Record<string, { label: string; color: string }> = {
  not_ordered: { label: 'Not Ordered', color: 'text-gray-500' },
  ordered: { label: 'Ordered', color: 'text-blue-600' },
  partial: { label: 'Partial', color: 'text-amber-600' },
  received: { label: 'Received', color: 'text-green-600' },
}

export default function OpsPage() {
  const router = useRouter()
  const [jobs, setJobs] = useState<Job[]>([])
  const [crews, setCrews] = useState<Crew[]>([])
  const [subs, setSubs] = useState<SubContractor[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board')
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [filterType, setFilterType] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const supabase = createClientBrowser()

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    console.log('Job Board: Loading data...')
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    console.log('Job Board: Session result:', { hasSession: !!session, error: sessionError })
    
    if (!session?.user) {
      console.log('Job Board: No session, redirecting to login')
      router.push('/login')
      return
    }
    const user = session.user
    console.log('Job Board: User found:', user.id)

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    console.log('Job Board: Profile result:', { profile, error: profileError })

    if (!profile) {
      console.log('Job Board: No profile found')
      return
    }

    // Check role access
    console.log('Job Board: Checking role access for:', profile.role)
    if (!['admin', 'regional_manager', 'operations', 'manager', 'owner'].includes(profile.role)) {
      console.log('Job Board: Role not allowed, redirecting to dashboard')
      router.push('/dashboard')
      return
    }

    // Load jobs, crews, and subs in parallel
    const [jobsRes, crewsRes, subsRes] = await Promise.all([
      supabase
        .from('production_jobs')
        .select(`
          *,
          assigned_crew:crews(id, name, color),
          assigned_sub:sub_contractors(id, company_name),
          customer:customers(id, name, phone),
          salesperson:users!production_jobs_salesperson_id_fkey(id, full_name),
          project:projects(id, scope_of_work, product_summary)
        `)
        .eq('org_id', profile.org_id)
        .neq('status', 'collected')
        .order('scheduled_date', { ascending: true, nullsFirst: false }),
      supabase
        .from('crews')
        .select('id, name, crew_type, color, daily_capacity')
        .eq('org_id', profile.org_id)
        .eq('active', true)
        .order('name'),
      supabase
        .from('sub_contractors')
        .select('id, company_name, services')
        .eq('org_id', profile.org_id)
        .eq('active', true)
        .order('company_name'),
    ])

    // Transform data to handle Supabase's array returns for joins
    const transformedJobs = (jobsRes.data || []).map((job: any) => ({
      ...job,
      assigned_crew: Array.isArray(job.assigned_crew) ? job.assigned_crew[0] : job.assigned_crew,
      assigned_sub: Array.isArray(job.assigned_sub) ? job.assigned_sub[0] : job.assigned_sub,
      customer: Array.isArray(job.customer) ? job.customer[0] : job.customer,
      salesperson: Array.isArray(job.salesperson) ? job.salesperson[0] : job.salesperson,
      project: Array.isArray(job.project) ? job.project[0] : job.project,
    }))
    setJobs(transformedJobs)
    setCrews(crewsRes.data || [])
    setSubs(subsRes.data || [])
    setLoading(false)
  }

  const getJobsByStatus = (status: JobStatus) => {
    return jobs.filter(job => {
      if (job.status !== status) return false
      if (filterType !== 'all' && job.job_type !== filterType) return false
      if (searchQuery) {
        const search = searchQuery.toLowerCase()
        return (
          job.job_number.toLowerCase().includes(search) ||
          job.address_text.toLowerCase().includes(search) ||
          job.customer?.name?.toLowerCase().includes(search)
        )
      }
      return true
    })
  }

  const openScheduleModal = (job: Job) => {
    setSelectedJob(job)
    setShowScheduleModal(true)
  }

  const handleScheduleSave = async () => {
    setShowScheduleModal(false)
    setSelectedJob(null)
    await loadData()
  }

  const updateJobStatus = async (jobId: string, newStatus: JobStatus) => {
    const updates: any = { status: newStatus }
    if (newStatus === 'in_progress') {
      updates.started_at = new Date().toISOString()
    } else if (newStatus === 'complete') {
      updates.completed_at = new Date().toISOString()
    }

    await supabase
      .from('production_jobs')
      .update(updates)
      .eq('id', jobId)

    await loadData()
  }

  // Calculate stats
  const stats = {
    sold: getJobsByStatus('sold').length,
    materials: getJobsByStatus('materials').length,
    scheduled: getJobsByStatus('scheduled').length,
    inProgress: getJobsByStatus('in_progress').length,
    complete: getJobsByStatus('complete').length,
    totalValue: jobs.reduce((sum, j) => sum + (j.sale_amount || 0), 0),
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Nav />
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      </div>
    )
  }

  const JobCard = ({ job }: { job: Job }) => {
    const priority = priorityConfig[job.priority] || priorityConfig.normal
    const materials = materialsConfig[job.materials_status] || materialsConfig.not_ordered

    return (
      <div 
        className="bg-white rounded-lg border shadow-sm p-4 hover:shadow-md transition cursor-pointer"
        onClick={() => router.push(`/ops/jobs/${job.id}`)}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            {priority.icon && <span>{priority.icon}</span>}
            <span className="text-xs font-mono text-gray-500">{job.job_number}</span>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            job.job_type === 'roofing' ? 'bg-blue-100 text-blue-700' :
            job.job_type === 'siding' ? 'bg-green-100 text-green-700' :
            job.job_type === 'windows' ? 'bg-purple-100 text-purple-700' :
            'bg-gray-100 text-gray-700'
          }`}>
            {job.job_type}
          </span>
        </div>

        {/* Customer & Address */}
        <div className="mb-3">
          {job.customer?.name && (
            <div className="font-medium text-gray-900 truncate">{job.customer.name}</div>
          )}
          <div className="text-sm text-gray-500 truncate">{job.address_text}</div>
        </div>

        {/* Info Row */}
        <div className="flex items-center gap-3 text-xs text-gray-500 mb-3">
          {job.sale_amount && (
            <span className="font-medium text-gray-700">
              ${job.sale_amount.toLocaleString()}
            </span>
          )}
          <span className={materials.color}>{materials.label}</span>
        </div>

        {/* Assignment */}
        {(job.assigned_crew || job.assigned_sub) && (
          <div className="flex items-center gap-2 mb-3">
            {job.assigned_crew && (
              <div 
                className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs"
                style={{ backgroundColor: `${job.assigned_crew.color}20`, color: job.assigned_crew.color }}
              >
                <div 
                  className="w-2 h-2 rounded-full" 
                  style={{ backgroundColor: job.assigned_crew.color }}
                />
                {job.assigned_crew.name}
              </div>
            )}
            {job.assigned_sub && (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs bg-orange-100 text-orange-700">
                <span>Sub:</span> {job.assigned_sub.company_name}
              </div>
            )}
          </div>
        )}

        {/* Schedule Date */}
        {job.scheduled_date && (
          <div className="text-xs text-indigo-600 font-medium">
            📅 {new Date(job.scheduled_date + 'T12:00:00').toLocaleDateString('en-US', { 
              weekday: 'short', 
              month: 'short', 
              day: 'numeric',
              timeZone: 'America/New_York'
            })}
          </div>
        )}

        {/* Quick Actions */}
        <div className="flex gap-2 mt-3 pt-3 border-t">
          <button
            onClick={(e) => { e.stopPropagation(); openScheduleModal(job); }}
            className="flex-1 text-xs py-1.5 px-2 bg-indigo-50 text-indigo-600 rounded hover:bg-indigo-100"
          >
            {job.scheduled_date ? 'Reschedule' : 'Schedule'}
          </button>
          {job.status === 'scheduled' && (
            <button
              onClick={(e) => { e.stopPropagation(); updateJobStatus(job.id, 'in_progress'); }}
              className="flex-1 text-xs py-1.5 px-2 bg-green-50 text-green-600 rounded hover:bg-green-100"
            >
              Start
            </button>
          )}
          {job.status === 'in_progress' && (
            <button
              onClick={(e) => { e.stopPropagation(); updateJobStatus(job.id, 'complete'); }}
              className="flex-1 text-xs py-1.5 px-2 bg-green-50 text-green-600 rounded hover:bg-green-100"
            >
              Complete
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <Nav />
      
      <div className="max-w-[1800px] mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Production Board</h1>
            <p className="text-gray-500 text-sm">Manage jobs from sold to collected</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/ops/calendar"
              className="px-4 py-2 border border-gray-300 bg-white rounded-lg hover:bg-gray-50 text-sm font-medium text-gray-700"
            >
              📅 Calendar View
            </Link>
            <Link
              href="/admin/crews"
              className="px-4 py-2 border border-gray-300 bg-white rounded-lg hover:bg-gray-50 text-sm font-medium text-gray-700"
            >
              👷 Manage Crews
            </Link>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
          <div className="bg-white rounded-lg border p-4">
            <div className="text-2xl font-bold text-blue-600">{stats.sold}</div>
            <div className="text-xs text-gray-500">Ready to Schedule</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-2xl font-bold text-amber-600">{stats.materials}</div>
            <div className="text-xs text-gray-500">Awaiting Materials</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-2xl font-bold text-purple-600">{stats.scheduled}</div>
            <div className="text-xs text-gray-500">Scheduled</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-2xl font-bold text-indigo-600">{stats.inProgress}</div>
            <div className="text-xs text-gray-500">In Progress</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-2xl font-bold text-green-600">{stats.complete}</div>
            <div className="text-xs text-gray-500">Ready to Collect</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-2xl font-bold text-gray-900">
              ${(stats.totalValue / 1000).toFixed(0)}k
            </div>
            <div className="text-xs text-gray-500">Pipeline Value</div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg border p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <input
                type="text"
                placeholder="Search by job #, address, or customer..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div className="flex gap-3">
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="all">All Types</option>
                <option value="roofing">Roofing</option>
                <option value="siding">Siding</option>
                <option value="windows">Windows</option>
                <option value="mixed">Mixed</option>
              </select>
              <div className="flex border border-gray-300 rounded-lg overflow-hidden">
                <button
                  onClick={() => setViewMode('board')}
                  className={`px-4 py-2 text-sm ${viewMode === 'board' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-700'}`}
                >
                  Board
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`px-4 py-2 text-sm ${viewMode === 'list' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-700'}`}
                >
                  List
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Board View */}
        {viewMode === 'board' && (
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {(['sold', 'materials', 'scheduled', 'in_progress', 'complete'] as JobStatus[]).map(status => {
              const config = statusConfig[status]
              const statusJobs = getJobsByStatus(status)
              
              return (
                <div key={status} className={`rounded-lg border ${config.bgColor}`}>
                  <div className={`p-3 border-b ${config.bgColor}`}>
                    <div className="flex items-center justify-between">
                      <h3 className={`font-semibold ${config.color}`}>{config.label}</h3>
                      <span className={`text-sm font-medium ${config.color}`}>{statusJobs.length}</span>
                    </div>
                  </div>
                  <div className="p-3 space-y-3 max-h-[calc(100vh-400px)] overflow-y-auto">
                    {statusJobs.length === 0 ? (
                      <div className="text-center py-8 text-gray-400 text-sm">
                        No jobs
                      </div>
                    ) : (
                      statusJobs.map(job => <JobCard key={job.id} job={job} />)
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* List View */}
        {viewMode === 'list' && (
          <div className="bg-white rounded-lg border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Job</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Materials</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Assigned</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Scheduled</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Value</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {jobs.filter(job => {
                  if (filterType !== 'all' && job.job_type !== filterType) return false
                  if (searchQuery) {
                    const search = searchQuery.toLowerCase()
                    return (
                      job.job_number.toLowerCase().includes(search) ||
                      job.address_text.toLowerCase().includes(search) ||
                      job.customer?.name?.toLowerCase().includes(search)
                    )
                  }
                  return true
                }).map(job => {
                  const config = statusConfig[job.status]
                  const materials = materialsConfig[job.materials_status] || materialsConfig.not_ordered
                  const priority = priorityConfig[job.priority] || priorityConfig.normal

                  return (
                    <tr key={job.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {priority.icon && <span>{priority.icon}</span>}
                          <div>
                            <div className="font-mono text-sm text-gray-900">{job.job_number}</div>
                            <div className="text-xs text-gray-500 truncate max-w-[200px]">{job.address_text}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-gray-900">{job.customer?.name || '-'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          job.job_type === 'roofing' ? 'bg-blue-100 text-blue-700' :
                          job.job_type === 'siding' ? 'bg-green-100 text-green-700' :
                          job.job_type === 'windows' ? 'bg-purple-100 text-purple-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {job.job_type}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-1 rounded-full ${config.bgColor} ${config.color}`}>
                          {config.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs ${materials.color}`}>{materials.label}</span>
                      </td>
                      <td className="px-4 py-3">
                        {job.assigned_crew ? (
                          <div 
                            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs"
                            style={{ backgroundColor: `${job.assigned_crew.color}20`, color: job.assigned_crew.color }}
                          >
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: job.assigned_crew.color }} />
                            {job.assigned_crew.name}
                          </div>
                        ) : job.assigned_sub ? (
                          <span className="text-xs text-orange-600">{job.assigned_sub.company_name}</span>
                        ) : (
                          <span className="text-xs text-gray-400">Unassigned</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {job.scheduled_date 
                          ? new Date(job.scheduled_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })
                          : <span className="text-gray-400">-</span>
                        }
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {job.sale_amount ? `$${job.sale_amount.toLocaleString()}` : '-'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => openScheduleModal(job)}
                            className="text-xs text-indigo-600 hover:text-indigo-800"
                          >
                            Schedule
                          </button>
                          <Link
                            href={`/ops/jobs/${job.id}`}
                            className="text-xs text-gray-600 hover:text-gray-800"
                          >
                            View
                          </Link>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Schedule Modal */}
      {showScheduleModal && selectedJob && (
        <ScheduleJobModal
          job={selectedJob}
          crews={crews}
          subs={subs}
          onClose={() => { setShowScheduleModal(false); setSelectedJob(null); }}
          onSave={handleScheduleSave}
        />
      )}
    </div>
  )
}
