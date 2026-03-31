'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { createClientBrowser } from '@/lib/supabase/client'
import ScheduleJobModal from '@/components/ops/ScheduleJobModal'
import { handoffPreviewForJobBoard } from '@/lib/project-review'
import OperationsSnapshotCard, {
  hasOperationsSnapshotData,
} from '@/components/ops/OperationsSnapshotCard'

type JobStatus = 'sold' | 'materials' | 'scheduled' | 'in_progress' | 'complete' | 'collected'

interface Job {
  id: string
  project_id: string
  job_number: string
  status: JobStatus
  job_type: string
  address_text: string
  sale_amount: number | null
  labor_cost?: number | null
  material_cost?: number | null
  sale_date: string | null
  scheduled_date: string | null
  materials_status: string
  permit_status: string
  priority: string
  assigned_crew?: { id: string; name: string; color: string } | null
  assigned_sub?: { id: string; company_name: string } | null
  customer?: { id: string; name: string; phone: string } | null
  salesperson?: { id: string; full_name: string } | null
  project?: {
    id: string
    scope_of_work: string | null
    product_summary: string | null
    ops_notes?: string | null
    permits_status?: string | null
    install_date?: string | null
    project_review?: unknown
  } | null
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

interface OpsClientProps {
  initialJobs: Job[]
  initialCrews: Crew[]
  initialSubs: SubContractor[]
  orgId: string
  canViewProfitability: boolean
}

const statusConfig: Record<JobStatus, { label: string; color: string; bgColor: string }> = {
  sold: { label: 'Sold', color: 'text-blue-700', bgColor: 'bg-blue-50 border-blue-200' },
  materials: { label: 'Material Ordering', color: 'text-amber-700', bgColor: 'bg-amber-50 border-amber-200' },
  scheduled: { label: 'Scheduled', color: 'text-purple-700', bgColor: 'bg-purple-50 border-purple-200' },
  in_progress: { label: 'In Progress', color: 'text-indigo-700', bgColor: 'bg-indigo-50 border-indigo-200' },
  complete: { label: 'Completed', color: 'text-green-700', bgColor: 'bg-green-50 border-green-200' },
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
  partial: { label: 'Partially Delivered', color: 'text-amber-600' },
  received: { label: 'Fully Delivered', color: 'text-green-600' },
}

export default function OpsClient({ initialJobs, initialCrews, initialSubs, orgId, canViewProfitability }: OpsClientProps) {
  const router = useRouter()
  const [jobs, setJobs] = useState<Job[]>(initialJobs)
  const [crews] = useState<Crew[]>(initialCrews)
  const [subs] = useState<SubContractor[]>(initialSubs)
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board')
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [snapshotJob, setSnapshotJob] = useState<Job | null>(null)
  const [filterType, setFilterType] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [completedSearchQuery, setCompletedSearchQuery] = useState('')

  const supabase = createClientBrowser()

  const loadData = async () => {
    const response = await fetch('/api/ops/jobs')
    if (!response.ok) return
    const { jobs: jobsData } = await response.json()

    const transformedJobs = (jobsData || []).map((job: any) => {
      const rawProject = Array.isArray(job.project) ? job.project[0] : job.project
      const rawCustomer = Array.isArray(job.customer) ? job.customer[0] : job.customer
      
      // Try to get customer from: 1) direct customer link, 2) project's customer, 3) project's lead
      let customer = rawCustomer
      if (!customer && rawProject) {
        const projectCustomer = Array.isArray(rawProject.customers) ? rawProject.customers[0] : rawProject.customers
        const projectLead = Array.isArray(rawProject.leads) ? rawProject.leads[0] : rawProject.leads
        
        if (projectCustomer) {
          customer = projectCustomer
        } else if (projectLead) {
          customer = {
            id: projectLead.id,
            name: projectLead.homeowner_name,
            phone: projectLead.phone,
          }
        }
      }

      return {
        ...job,
        assigned_crew: Array.isArray(job.assigned_crew) ? job.assigned_crew[0] : job.assigned_crew,
        assigned_sub: Array.isArray(job.assigned_sub) ? job.assigned_sub[0] : job.assigned_sub,
        customer: customer,
        salesperson: Array.isArray(job.salesperson) ? job.salesperson[0] : job.salesperson,
        project: rawProject,
      }
    })
    setJobs(transformedJobs)
  }

  const getProfitability = (job: Job) => {
    const revenue = job.sale_amount ?? 0
    const hasLabor = typeof job.labor_cost === 'number'
    const hasMaterial = typeof job.material_cost === 'number'
    const hasCompleteCosts = hasLabor && hasMaterial
    const directCosts = (job.labor_cost ?? 0) + (job.material_cost ?? 0)
    const profit = revenue - directCosts
    const marginPercent = revenue > 0 ? (profit / revenue) * 100 : 0

    return {
      revenue,
      directCosts,
      profit,
      marginPercent,
      hasCompleteCosts,
    }
  }

  const activeJobs = jobs.filter((job) => job.status !== 'collected')
  const completedJobs = jobs.filter((job) => job.status === 'collected')

  const matchesSearch = (job: Job, query: string) => {
    if (!query) return true
    const search = query.toLowerCase()
    const handoff = handoffPreviewForJobBoard(job.project ?? null)
    return (
      job.job_number.toLowerCase().includes(search) ||
      job.address_text.toLowerCase().includes(search) ||
      job.customer?.name?.toLowerCase().includes(search) ||
      (handoff && handoff.toLowerCase().includes(search))
    )
  }

  const matchesActiveFilters = (job: Job) => {
    if (filterType !== 'all' && job.job_type !== filterType) return false
    return matchesSearch(job, searchQuery)
  }

  const getJobsByStatus = (status: JobStatus) => {
    const filtered = activeJobs.filter(job => {
      if (job.status !== status) return false
      return matchesActiveFilters(job)
    })

    const priorityWeight: Record<string, number> = { urgent: 3, high: 2, normal: 1 }

    // Keep "Sold" focused on active work by surfacing highest-action and most-recent accounts first.
    if (status === 'sold') {
      return [...filtered].sort((a, b) => {
        const aNeedsMaterials = a.materials_status === 'not_ordered' ? 1 : 0
        const bNeedsMaterials = b.materials_status === 'not_ordered' ? 1 : 0
        if (aNeedsMaterials !== bNeedsMaterials) return bNeedsMaterials - aNeedsMaterials

        const aPriority = priorityWeight[a.priority] ?? 0
        const bPriority = priorityWeight[b.priority] ?? 0
        if (aPriority !== bPriority) return bPriority - aPriority

        const aSaleDate = a.sale_date ? new Date(a.sale_date).getTime() : 0
        const bSaleDate = b.sale_date ? new Date(b.sale_date).getTime() : 0
        if (aSaleDate !== bSaleDate) return bSaleDate - aSaleDate

        return a.job_number.localeCompare(b.job_number)
      })
    }

    return filtered
  }

  const filteredActiveJobs = activeJobs.filter(matchesActiveFilters)
  const filteredCompletedJobs = completedJobs.filter((job) => matchesSearch(job, completedSearchQuery))

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

  const stats = {
    sold: getJobsByStatus('sold').length,
    materials: getJobsByStatus('materials').length,
    scheduled: getJobsByStatus('scheduled').length,
    inProgress: getJobsByStatus('in_progress').length,
    complete: getJobsByStatus('complete').length,
    totalValue: activeJobs.reduce((sum, j) => sum + (j.sale_amount || 0), 0),
  }

  const updateMaterialsStatus = async (jobId: string, newStatus: string) => {
    await supabase
      .from('production_jobs')
      .update({ materials_status: newStatus })
      .eq('id', jobId)
    await loadData()
  }

  const JobCard = ({ job }: { job: Job }) => {
    const priority = priorityConfig[job.priority] || priorityConfig.normal
    const materials = materialsConfig[job.materials_status] || materialsConfig.not_ordered
    const profitability = getProfitability(job)
    const handoffPreview = handoffPreviewForJobBoard(job.project ?? null)
    const hasOpsSnapshot = hasOperationsSnapshotData(job.project ?? null)

    // Status indicators
    const needsMaterials = job.materials_status === 'not_ordered'
    const needsCrew = job.scheduled_date && !job.assigned_crew && !job.assigned_sub
    const isPastDue = job.scheduled_date && new Date(job.scheduled_date + 'T23:59:59') < new Date() && job.status !== 'complete' && job.status !== 'collected'
    // Note: For balance check, we'd need payment data. For now, show on complete status without collected
    const mayHaveBalance = job.status === 'complete'

    return (
      <div 
        className="group bg-white rounded-lg border shadow-sm p-4 hover:shadow-md transition cursor-pointer relative"
        onClick={() => router.push(`/ops/jobs/${job.id}`)}
      >
        {/* Status Indicator Dots */}
        <div className="absolute top-2 right-2 flex gap-1">
          {needsMaterials && (
            <div className="w-2.5 h-2.5 rounded-full bg-red-500" title="Materials not ordered" />
          )}
          {needsCrew && (
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" title="No crew assigned" />
          )}
          {isPastDue && (
            <div className="w-2.5 h-2.5 rounded-full bg-orange-500" title="Past scheduled date" />
          )}
          {mayHaveBalance && (
            <div className="w-2.5 h-2.5 rounded-full bg-purple-500" title="Check balance" />
          )}
        </div>

        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            {priority.icon && <span>{priority.icon}</span>}
            <span className="text-xs font-mono text-gray-500">{job.job_number}</span>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full mr-6 ${
            job.job_type === 'roofing' ? 'bg-blue-100 text-blue-700' :
            job.job_type === 'siding' ? 'bg-green-100 text-green-700' :
            job.job_type === 'windows' ? 'bg-purple-100 text-purple-700' :
            'bg-gray-100 text-gray-700'
          }`}>
            {job.job_type}
          </span>
        </div>

        <div className="mb-3">
          {job.customer?.name && (
            <div className="font-medium text-gray-900 truncate">{job.customer.name}</div>
          )}
          <div className="text-sm text-gray-500 truncate">{job.address_text}</div>
        </div>

        {(handoffPreview || hasOpsSnapshot) && (
          <div className="mb-3 rounded-md border border-indigo-100 bg-indigo-50/80 px-2.5 py-2">
            {handoffPreview && (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-700">Sales handoff</p>
                <p className="text-xs text-gray-700 line-clamp-4 mt-0.5 leading-snug">{handoffPreview}</p>
              </>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setSnapshotJob(job)
              }}
              className={`text-xs font-medium text-indigo-700 hover:text-indigo-900 underline ${handoffPreview ? 'mt-2' : ''}`}
            >
              Full operations snapshot
            </button>
          </div>
        )}

        <div className="flex items-center gap-3 text-xs text-gray-500 mb-3">
          {job.sale_amount && (
            <span className="font-medium text-gray-700">
              ${job.sale_amount.toLocaleString()}
            </span>
          )}
          <span className={materials.color}>{materials.label}</span>
        </div>

        {canViewProfitability && (
          <div className="mb-3 rounded-md border border-gray-200 bg-gray-50 p-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Profitability</p>
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <div>
                <p className="text-gray-500">Revenue</p>
                <p className="font-semibold text-gray-800">${profitability.revenue.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-gray-500">Costs</p>
                <p className="font-semibold text-gray-800">
                  {profitability.hasCompleteCosts ? `$${profitability.directCosts.toLocaleString()}` : 'Incomplete'}
                </p>
              </div>
              <div>
                <p className="text-gray-500">Profit</p>
                <p className={`font-semibold ${profitability.profit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {profitability.hasCompleteCosts
                    ? `$${profitability.profit.toLocaleString()}`
                    : 'TBD'}
                </p>
              </div>
            </div>
          </div>
        )}

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

        {job.scheduled_date && (
          <div className={`text-xs font-medium ${isPastDue ? 'text-orange-600' : 'text-indigo-600'}`}>
            📅 {new Date(job.scheduled_date + 'T12:00:00').toLocaleDateString('en-US', { 
              weekday: 'short', 
              month: 'short', 
              day: 'numeric',
              timeZone: 'America/New_York'
            })}
            {isPastDue && <span className="ml-1 text-orange-600">(overdue)</span>}
          </div>
        )}

        {/* Default Actions */}
        <div className="flex gap-2 mt-3 pt-3 border-t group-hover:hidden">
          {job.status === 'sold' && (
            <button
              onClick={(e) => { e.stopPropagation(); updateJobStatus(job.id, 'materials'); }}
              className="flex-1 text-xs py-1.5 px-2 bg-amber-50 text-amber-600 rounded hover:bg-amber-100"
            >
              Start Materials
            </button>
          )}
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
              Start Job
            </button>
          )}
          {job.status === 'in_progress' && (
            <button
              onClick={(e) => { e.stopPropagation(); updateJobStatus(job.id, 'complete'); }}
              className="flex-1 text-xs py-1.5 px-2 bg-green-50 text-green-600 rounded hover:bg-green-100"
            >
              Mark Complete
            </button>
          )}
        </div>

        {/* Hover Quick Actions */}
        <div className="hidden group-hover:flex gap-1 mt-3 pt-3 border-t flex-wrap">
          {needsCrew && (
            <button
              onClick={(e) => { e.stopPropagation(); openScheduleModal(job); }}
              className="text-xs py-1 px-2 bg-yellow-50 text-yellow-700 rounded hover:bg-yellow-100"
            >
              Assign Crew
            </button>
          )}
          {needsMaterials && (
            <button
              onClick={(e) => { e.stopPropagation(); updateMaterialsStatus(job.id, 'ordered'); }}
              className="text-xs py-1 px-2 bg-red-50 text-red-700 rounded hover:bg-red-100"
            >
              Mark Materials Ordered
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); router.push(`/ops/jobs/${job.id}#payments-section`); }}
            className="text-xs py-1 px-2 bg-purple-50 text-purple-700 rounded hover:bg-purple-100"
          >
            Add Payment
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); openScheduleModal(job); }}
            className="text-xs py-1 px-2 bg-indigo-50 text-indigo-600 rounded hover:bg-indigo-100"
          >
            {job.scheduled_date ? 'Reschedule' : 'Schedule'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <Nav />
      
      <div className="max-w-[1800px] mx-auto px-4 py-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Production Board</h1>
            <p className="text-gray-500 text-sm">Track each job from sold through payment</p>
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

        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
          <div className="bg-white rounded-lg border p-4">
            <div className="text-2xl font-bold text-blue-600">{stats.sold}</div>
            <div className="text-xs text-gray-500">Sold - Not Scheduled</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-2xl font-bold text-amber-600">{stats.materials}</div>
            <div className="text-xs text-gray-500">Ordering Materials</div>
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
            <div className="text-xs text-gray-500">Completed - Awaiting Final Collection</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-2xl font-bold text-gray-900">
              ${(stats.totalValue / 1000).toFixed(0)}k
            </div>
            <div className="text-xs text-gray-500">Pipeline Value</div>
          </div>
          {canViewProfitability && (
            <div className="bg-white rounded-lg border p-4">
              <div className="text-2xl font-bold text-green-700">
                ${jobs
                  .filter((j) => j.status !== 'collected')
                  .filter((j) => typeof j.labor_cost === 'number' && typeof j.material_cost === 'number')
                  .reduce((sum, j) => sum + ((j.sale_amount || 0) - ((j.labor_cost || 0) + (j.material_cost || 0))), 0)
                  .toLocaleString()}
              </div>
              <div className="text-xs text-gray-500">Gross Profit (Known)</div>
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg border p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <input
                type="text"
                placeholder="Search by job number, address, or customer..."
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
                    {status === 'sold' && statusJobs.length > 1 && (
                      <p className="mt-1 text-[11px] text-blue-700">
                        Ordered by action needed, priority, and newest sale.
                      </p>
                    )}
                  </div>
                  <div className="p-3 space-y-3 max-h-[calc(100vh-400px)] overflow-y-auto">
                    {statusJobs.length === 0 ? (
                      <div className="text-center py-8 text-gray-400 text-sm">
                        No jobs in this stage
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

        {viewMode === 'list' && (
          <>
            <div className="md:hidden space-y-3">
              {jobs.filter(job => {
                return matchesActiveFilters(job)
              }).map(job => {
                const config = statusConfig[job.status]
                const profitability = getProfitability(job)
                const handoffPreview = handoffPreviewForJobBoard(job.project ?? null)
                return (
                  <div key={job.id} className="bg-white rounded-lg border p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-mono text-sm text-gray-900">{job.job_number}</p>
                        <p className="text-sm text-gray-700">{job.customer?.name || '-'}</p>
                        <p className="text-xs text-gray-500 truncate">{job.address_text}</p>
                        {handoffPreview && (
                          <p className="text-xs text-indigo-900 mt-2 line-clamp-3 bg-indigo-50/80 border border-indigo-100 rounded px-2 py-1.5">
                            <span className="font-semibold text-indigo-700">Handoff: </span>
                            {handoffPreview}
                          </p>
                        )}
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full ${config.bgColor} ${config.color}`}>
                        {config.label}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <p className="text-gray-500">Value</p>
                        <p className="font-semibold text-gray-900">{job.sale_amount ? `$${job.sale_amount.toLocaleString()}` : '-'}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">Scheduled</p>
                        <p className="font-semibold text-gray-900">
                          {job.scheduled_date
                            ? new Date(job.scheduled_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })
                            : '-'}
                        </p>
                      </div>
                    </div>
                    {canViewProfitability && (
                      <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-2.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Profitability</p>
                        <div className="grid grid-cols-3 gap-2 text-[11px]">
                          <div>
                            <p className="text-gray-500">Revenue</p>
                            <p className="font-semibold text-gray-800">${profitability.revenue.toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Costs</p>
                            <p className="font-semibold text-gray-800">
                              {profitability.hasCompleteCosts ? `$${profitability.directCosts.toLocaleString()}` : 'Incomplete'}
                            </p>
                          </div>
                          <div>
                            <p className="text-gray-500">Profit</p>
                            <p className={`font-semibold ${profitability.profit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                              {profitability.hasCompleteCosts ? `$${profitability.profit.toLocaleString()}` : 'TBD'}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="mt-3 flex justify-end">
                      <Link href={`/ops/jobs/${job.id}`} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                        View Job
                      </Link>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="hidden md:block bg-white rounded-lg border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Job</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Material Delivery</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Assigned</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Scheduled</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Value</th>
                  {canViewProfitability && (
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Profitability</th>
                  )}
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredActiveJobs.map(job => {
                  const config = statusConfig[job.status]
                  const materials = materialsConfig[job.materials_status] || materialsConfig.not_ordered
                  const priority = priorityConfig[job.priority] || priorityConfig.normal
                  const profitability = getProfitability(job)
                  const handoffPreview = handoffPreviewForJobBoard(job.project ?? null)

                  return (
                    <tr key={job.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {priority.icon && <span>{priority.icon}</span>}
                          <div>
                            <div className="font-mono text-sm text-gray-900">{job.job_number}</div>
                            <div className="text-xs text-gray-500 truncate max-w-[200px]">{job.address_text}</div>
                            {handoffPreview && (
                              <div className="text-[11px] text-gray-600 mt-1 max-w-[280px] line-clamp-2" title={handoffPreview}>
                                <span className="font-semibold text-indigo-700">Handoff: </span>
                                {handoffPreview}
                              </div>
                            )}
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
                      {canViewProfitability && (
                        <td className="px-4 py-3 text-xs">
                          {profitability.hasCompleteCosts ? (
                            <div>
                              <div className={`font-semibold ${profitability.profit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                                ${profitability.profit.toLocaleString()}
                              </div>
                              <div className="text-gray-500">
                                Costs ${profitability.directCosts.toLocaleString()} · {profitability.marginPercent.toFixed(1)}%
                              </div>
                            </div>
                          ) : (
                            <span className="text-amber-700 font-medium">Costs incomplete</span>
                          )}
                        </td>
                      )}
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
          </>
        )}

        <div className="mt-8 bg-white rounded-lg border p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Completed Jobs</h2>
              <p className="text-xs text-gray-500">Fully closed-out jobs (collected)</p>
            </div>
            <div className="w-full sm:w-[360px]">
              <input
                type="text"
                placeholder="Search completed by job #, customer, or address..."
                value={completedSearchQuery}
                onChange={(e) => setCompletedSearchQuery(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          </div>

          <div className="md:hidden space-y-3">
            {filteredCompletedJobs.length === 0 ? (
              <div className="text-sm text-gray-500 py-4">No completed jobs found.</div>
            ) : (
              filteredCompletedJobs.map((job) => (
                <div key={job.id} className="rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-sm text-gray-900">{job.job_number}</p>
                      <p className="text-sm text-gray-700">{job.customer?.name || '-'}</p>
                      <p className="text-xs text-gray-500 truncate">{job.address_text}</p>
                    </div>
                    <span className="text-xs px-2 py-1 rounded-full bg-gray-50 border border-gray-200 text-gray-700">
                      Collected
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-gray-500">Value</p>
                      <p className="font-semibold text-gray-900">{job.sale_amount ? `$${job.sale_amount.toLocaleString()}` : '-'}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Job Type</p>
                      <p className="font-semibold text-gray-900 capitalize">{job.job_type}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <Link href={`/ops/jobs/${job.id}`} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                      View Job
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="hidden md:block rounded-lg border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Job</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Address</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Value</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredCompletedJobs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-sm text-gray-500 text-center">
                      No completed jobs found.
                    </td>
                  </tr>
                ) : (
                  filteredCompletedJobs.map((job) => (
                    <tr key={job.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-mono text-sm text-gray-900">{job.job_number}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">{job.customer?.name || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 max-w-[360px] truncate">{job.address_text}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 capitalize">{job.job_type}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {job.sale_amount ? `$${job.sale_amount.toLocaleString()}` : '-'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/ops/jobs/${job.id}`} className="text-xs text-indigo-600 hover:text-indigo-800">
                          View
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {snapshotJob && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
          onClick={() => setSnapshotJob(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b px-5 py-4 flex justify-between items-start gap-3 z-10">
              <div>
                <p className="font-mono text-sm text-gray-500">{snapshotJob.job_number}</p>
                <p className="font-medium text-gray-900 mt-1">{snapshotJob.customer?.name || '—'}</p>
                <p className="text-sm text-gray-600">{snapshotJob.address_text}</p>
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setSnapshotJob(null)}
                  className="text-gray-500 hover:text-gray-800 text-sm"
                >
                  Close
                </button>
                <Link
                  href={`/ops/jobs/${snapshotJob.id}`}
                  className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
                >
                  Open job →
                </Link>
              </div>
            </div>
            <div className="p-5">
              {hasOperationsSnapshotData(snapshotJob.project) ? (
                <OperationsSnapshotCard
                  project={snapshotJob.project}
                  headerAction={
                    <Link
                      href={`/projects/${snapshotJob.project_id}`}
                      className="text-sm font-medium text-indigo-600 hover:text-indigo-800 shrink-0"
                    >
                      View project →
                    </Link>
                  }
                />
              ) : (
                <p className="text-sm text-gray-500">
                  No operations snapshot on the linked project yet. Add details or a project review on the{' '}
                  <Link href={`/projects/${snapshotJob.project_id}`} className="text-indigo-600 hover:underline">
                    project page
                  </Link>
                  .
                </p>
              )}
            </div>
          </div>
        </div>
      )}

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
