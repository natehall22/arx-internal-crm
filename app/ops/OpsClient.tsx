'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { createClientBrowser } from '@/lib/supabase/client'
import ScheduleJobModal from '@/components/ops/ScheduleJobModal'
import { handoffPreviewForJobBoard } from '@/lib/project-review'
import OperationsSnapshotCard, {
  hasOperationsSnapshotData,
} from '@/components/ops/OperationsSnapshotCard'
import { OpsBoardJobCard } from '@/components/ops/OpsBoardJobCard'
import {
  canShowCompletionCertificateBoardLink,
  opsJobCompletionCertificateHref,
} from '@/lib/ops-completion-cert-link'
import type { JobStatus, OpsBoardJob } from '@/lib/ops-board-types'

type BoardColumnStatus = Exclude<JobStatus, 'collected'>

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
  initialJobs: OpsBoardJob[]
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

function paymentStatusChip(job: OpsBoardJob): { label: string; className: string } | null {
  const saleCents = Math.round((job.sale_amount || 0) * 100)
  if (saleCents <= 0) return null
  const collected = job.collected_cents ?? 0
  if (collected >= saleCents) {
    return { label: 'Paid in full', className: 'bg-emerald-50 text-emerald-800 border border-emerald-200' }
  }
  if (collected > 0) {
    return { label: 'Partially paid', className: 'bg-amber-50 text-amber-800 border border-amber-200' }
  }
  return { label: 'Unpaid', className: 'bg-gray-50 text-gray-700 border border-gray-200' }
}

function matchesActiveSearch(job: OpsBoardJob, query: string): boolean {
  if (!query) return true
  const search = query.toLowerCase()
  const handoff = handoffPreviewForJobBoard(job.project ?? null)
  return (
    job.job_number.toLowerCase().includes(search) ||
    job.address_text.toLowerCase().includes(search) ||
    !!(job.customer?.name && job.customer.name.toLowerCase().includes(search)) ||
    (handoff ? handoff.toLowerCase().includes(search) : false)
  )
}

function sortSoldColumn(jobs: OpsBoardJob[]): OpsBoardJob[] {
  const priorityWeight: Record<string, number> = { urgent: 3, high: 2, normal: 1 }
  return [...jobs].sort((a, b) => {
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

function formatJobTypeLabel(jobType: string): string {
  return jobType
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export default function OpsClient({ initialJobs, initialCrews, initialSubs, orgId, canViewProfitability }: OpsClientProps) {
  const router = useRouter()
  const [jobs, setJobs] = useState<OpsBoardJob[]>(initialJobs)
  const [crews, setCrews] = useState<Crew[]>(initialCrews)
  const [subs, setSubs] = useState<SubContractor[]>(initialSubs)

  useEffect(() => {
    setCrews(initialCrews)
  }, [initialCrews])

  useEffect(() => {
    setSubs(initialSubs)
  }, [initialSubs])
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board')

  // Default to list view on mobile — board's 5 columns stack awkwardly on small screens
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setViewMode('list')
    }
  }, [])
  const [selectedJob, setSelectedJob] = useState<OpsBoardJob | null>(null)
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [scheduleModalMode, setScheduleModalMode] = useState<'schedule' | 'reassign'>('schedule')
  const [snapshotJob, setSnapshotJob] = useState<OpsBoardJob | null>(null)
  const [filterType, setFilterType] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [completedSearchQuery, setCompletedSearchQuery] = useState('')

  const supabase = createClientBrowser()

  const markPayrollSent = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/ops/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payroll_sent_at: new Date().toISOString() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(typeof data.error === 'string' ? data.error : 'Could not update payroll status')
        return
      }
      if (data.job) {
        setJobs((prev) =>
          prev.map((j) => (j.id === jobId ? { ...j, payroll_sent_at: data.job.payroll_sent_at } : j))
        )
      }
    } catch (e) {
      console.error(e)
      alert('Could not update payroll status')
    }
  }, [])

  const loadData = useCallback(async () => {
    const response = await fetch('/api/ops/jobs')
    if (!response.ok) return
    const { jobs: jobsData } = await response.json()

    const transformedJobs = (jobsData || []).map((job: Record<string, unknown>) => {
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
      } as OpsBoardJob
    })
    setJobs(transformedJobs)
  }, [])

  const getProfitability = (job: OpsBoardJob) => {
    const revenue = job.sale_amount ?? 0
    const hasLabor = typeof job.labor_cost === 'number'
    const hasMaterial = typeof job.material_cost === 'number'
    const hasCompleteCosts = hasLabor && hasMaterial
    const dealerFee = job.dealer_fee_amount ?? 0
    const directCosts = (job.labor_cost ?? 0) + (job.material_cost ?? 0) + dealerFee
    const profit = revenue - directCosts
    const marginPercent = revenue > 0 ? (profit / revenue) * 100 : 0

    return {
      revenue,
      directCosts,
      dealerFee,
      profit,
      marginPercent,
      hasCompleteCosts,
    }
  }

  const activeJobs = useMemo(
    () => jobs.filter((job) => job.status !== 'collected'),
    [jobs]
  )
  const completedJobs = useMemo(
    () => jobs.filter((job) => job.status === 'collected'),
    [jobs]
  )

  const filteredActiveJobs = useMemo(
    () =>
      activeJobs.filter((job) => {
        if (filterType !== 'all' && job.job_type !== filterType) return false
        return matchesActiveSearch(job, searchQuery)
      }),
    [activeJobs, filterType, searchQuery]
  )

  const jobTypeOptions = useMemo(() => {
    const preferredOrder = ['roofing', 'siding', 'windows', 'mixed']
    const seen = new Set(jobs.map((job) => job.job_type).filter(Boolean))
    return Array.from(seen).sort((a, b) => {
      const aIndex = preferredOrder.indexOf(a)
      const bIndex = preferredOrder.indexOf(b)
      if (aIndex !== -1 || bIndex !== -1) {
        if (aIndex === -1) return 1
        if (bIndex === -1) return -1
        return aIndex - bIndex
      }
      return a.localeCompare(b)
    })
  }, [jobs])

  const jobsByBoardStatus = useMemo(() => {
    const base: Record<BoardColumnStatus, OpsBoardJob[]> = {
      sold: [],
      materials: [],
      scheduled: [],
      in_progress: [],
      complete: [],
    }
    for (const job of filteredActiveJobs) {
      const s = job.status
      if (s === 'sold' || s === 'materials' || s === 'scheduled' || s === 'in_progress' || s === 'complete') {
        base[s].push(job)
      }
    }
    base.sold = sortSoldColumn(base.sold)
    return base
  }, [filteredActiveJobs])

  const filteredCompletedJobs = useMemo(
    () =>
      completedJobs.filter((job) => {
        if (filterType !== 'all' && job.job_type !== filterType) return false
        return matchesActiveSearch(job, completedSearchQuery)
      }),
    [completedJobs, filterType, completedSearchQuery]
  )

  const stats = useMemo(
    () => ({
      sold: jobsByBoardStatus.sold.length,
      materials: jobsByBoardStatus.materials.length,
      scheduled: jobsByBoardStatus.scheduled.length,
      inProgress: jobsByBoardStatus.in_progress.length,
      complete: jobsByBoardStatus.complete.length,
      totalValue: filteredActiveJobs.reduce((sum, j) => sum + (j.sale_amount || 0), 0),
    }),
    [jobsByBoardStatus, filteredActiveJobs]
  )

  const knownGrossProfit = useMemo(() => {
    if (!canViewProfitability) return null
    return filteredActiveJobs
      .filter((j) => typeof j.labor_cost === 'number' && typeof j.material_cost === 'number')
      .reduce(
        (sum, j) =>
          sum +
          ((j.sale_amount || 0) - ((j.labor_cost || 0) + (j.material_cost || 0) + (j.dealer_fee_amount || 0))),
        0
      )
  }, [filteredActiveJobs, canViewProfitability])

  const openScheduleModal = useCallback(async (job: OpsBoardJob, mode: 'schedule' | 'reassign' = 'schedule') => {
    try {
      const res = await fetch('/api/ops/scheduling-assignees')
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data.crews)) setCrews(data.crews)
        if (Array.isArray(data.subs)) setSubs(data.subs)
      }
    } catch {
      /* keep lists from last server render */
    }
    setScheduleModalMode(mode)
    setSelectedJob(job)
    setShowScheduleModal(true)
  }, [])

  const handleScheduleSave = useCallback(async () => {
    setShowScheduleModal(false)
    setSelectedJob(null)
    setScheduleModalMode('schedule')
    await loadData()
  }, [loadData])

  const updateJobStatus = useCallback(async (jobId: string, newStatus: JobStatus) => {
    const updates: Record<string, unknown> = { status: newStatus }
    if (newStatus === 'in_progress') {
      updates.started_at = new Date().toISOString()
    } else if (newStatus === 'complete') {
      updates.completed_at = new Date().toISOString()
    }

    const response = await fetch(`/api/ops/jobs/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })

    if (!response.ok) {
      let message = 'Could not update job status'
      try {
        const err = await response.json()
        if (err?.error && typeof err.error === 'string') message = err.error
      } catch {
        /* ignore */
      }
      alert(message)
    }

    await loadData()
  }, [loadData])

  const updateMaterialsStatus = useCallback(
    async (jobId: string, newStatus: string) => {
      await supabase.from('production_jobs').update({ materials_status: newStatus }).eq('id', jobId)
      await loadData()
    },
    [supabase, loadData]
  )

  const navigateToJob = useCallback(
    (jobId: string) => {
      router.push(`/ops/jobs/${jobId}`)
    },
    [router]
  )

  const onBoardStartMaterials = useCallback(
    (jobId: string) => {
      void updateJobStatus(jobId, 'materials')
    },
    [updateJobStatus]
  )

  const onBoardMarkOrdered = useCallback(
    (jobId: string) => {
      void updateMaterialsStatus(jobId, 'ordered')
    },
    [updateMaterialsStatus]
  )

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
          {canViewProfitability && knownGrossProfit !== null && (
            <div className="bg-white rounded-lg border p-4">
              <div className="text-2xl font-bold text-green-700">${knownGrossProfit.toLocaleString()}</div>
              <div className="text-xs text-gray-500">Gross Profit (Known)</div>
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg border p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <input
                id="ops-job-search"
                name="ops-job-search"
                type="text"
                placeholder="Search by job number, address, or customer..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div className="flex gap-3">
              <select
                id="ops-job-type-filter"
                name="ops-job-type-filter"
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="all">All Types</option>
                {jobTypeOptions.map((jobType) => (
                  <option key={jobType} value={jobType}>
                    {formatJobTypeLabel(jobType)}
                  </option>
                ))}
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
            {(['sold', 'materials', 'scheduled', 'in_progress', 'complete'] as BoardColumnStatus[]).map((status) => {
              const config = statusConfig[status]
              const statusJobs = jobsByBoardStatus[status]

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
                  <div className="p-3 space-y-3 max-h-[calc(100vh-400px)] overflow-y-auto overscroll-contain">
                    {statusJobs.length === 0 ? (
                      <div className="text-center py-8 text-gray-400 text-sm">
                        No jobs in this stage
                      </div>
                    ) : (
                      statusJobs.map((job) => (
                        <OpsBoardJobCard
                          key={job.id}
                          job={job}
                          onNavigateToJob={navigateToJob}
                          onOpenSnapshot={setSnapshotJob}
                          onSchedule={openScheduleModal}
                          onStartMaterials={onBoardStartMaterials}
                          onMarkOrdered={onBoardMarkOrdered}
                          onJobStatus={updateJobStatus}
                        />
                      ))
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
              {filteredActiveJobs.map((job) => {
                const config = statusConfig[job.status]
                const isPastDue = job.scheduled_date && new Date(job.scheduled_date + 'T23:59:59') < new Date() && job.status !== 'complete' && job.status !== 'collected'
                const needsMaterials = job.materials_status === 'not_ordered'
                const payChip = paymentStatusChip(job)
                return (
                  <div key={job.id} className="bg-white rounded-xl border shadow-sm p-4">
                    {/* Customer + status */}
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900 truncate text-base">
                          {job.customer?.name || 'Unknown customer'}
                        </p>
                        <p className="text-sm text-gray-500 truncate">{job.address_text}</p>
                      </div>
                      <span className={`shrink-0 text-xs px-2 py-1 rounded-full ${config.bgColor} ${config.color}`}>
                        {config.label}
                      </span>
                    </div>

                    {/* Job number + type */}
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <span className="text-xs font-mono text-gray-400">{job.job_number}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                        job.job_type === 'roofing' ? 'bg-blue-100 text-blue-700' :
                        job.job_type === 'siding' ? 'bg-green-100 text-green-700' :
                        job.job_type === 'windows' ? 'bg-purple-100 text-purple-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>{job.job_type}</span>
                      {payChip && (
                        <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${payChip.className}`}>
                          {payChip.label}
                        </span>
                      )}
                    </div>

                    {/* Alerts */}
                    {(isPastDue || needsMaterials) && (
                      <div className="flex flex-wrap gap-1 mb-3">
                        {isPastDue && <span className="text-[11px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 font-medium">Overdue</span>}
                        {needsMaterials && <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 font-medium">Materials needed</span>}
                      </div>
                    )}

                    {/* Crew + date */}
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
                      <span className="truncate">
                        {job.assigned_crew?.name || job.assigned_sub?.company_name || 'No crew assigned'}
                      </span>
                      <span className={`shrink-0 ml-2 font-medium ${isPastDue ? 'text-orange-600' : 'text-gray-700'}`}>
                        {job.scheduled_date
                          ? new Date(job.scheduled_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' })
                          : 'Not scheduled'}
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap gap-2 pt-3 border-t">
                      <button
                        onClick={() => openScheduleModal(job, 'schedule')}
                        className="flex-1 min-w-[120px] min-h-[44px] text-sm py-2 px-3 bg-indigo-50 text-indigo-700 rounded-lg font-medium border border-indigo-200 hover:bg-indigo-100"
                      >
                        {job.scheduled_date ? 'Reschedule' : 'Schedule'}
                      </button>
                      {(job.scheduled_date || job.assigned_crew || job.assigned_sub) && (
                        <button
                          type="button"
                          onClick={() => openScheduleModal(job, 'reassign')}
                          className="flex-1 min-w-[120px] min-h-[44px] text-sm py-2 px-3 bg-white text-gray-800 rounded-lg font-medium border border-gray-300 hover:bg-gray-50"
                        >
                          Reassign
                        </button>
                      )}
                      <Link
                        href={`/ops/jobs/${job.id}`}
                        className="flex-1 min-w-[120px] min-h-[44px] flex items-center justify-center text-sm text-indigo-600 font-medium border border-indigo-200 rounded-lg hover:bg-indigo-50"
                      >
                        View Job →
                      </Link>
                    </div>
                    {canShowCompletionCertificateBoardLink(job.status) && (
                      <div className="mt-2 pt-2 border-t border-gray-100">
                        <Link
                          href={opsJobCompletionCertificateHref(job.id)}
                          prefetch={false}
                          className="block w-full min-h-[44px] flex items-center justify-center text-sm font-medium text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg py-2 px-3 text-center"
                        >
                          Completion certificate — email customer
                        </Link>
                      </div>
                    )}
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
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Payment</th>
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
                  const payChip = paymentStatusChip(job)

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
                        {payChip ? (
                          <span className={`text-xs px-2 py-1 rounded font-medium ${payChip.className}`}>
                            {payChip.label}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
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
                                Costs ${profitability.directCosts.toLocaleString()}
                                {profitability.dealerFee > 0 && (
                                  <span className="text-amber-800" title="Lender dealer fee on financed sale">
                                    {' '}
                                    (dealer fee ${profitability.dealerFee.toLocaleString()})
                                  </span>
                                )}{' '}
                                · {profitability.marginPercent.toFixed(1)}%
                              </div>
                            </div>
                          ) : (
                            <span className="text-amber-700 font-medium">Costs incomplete</span>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end flex-wrap gap-x-3 gap-y-1">
                          <button
                            type="button"
                            onClick={() => openScheduleModal(job, 'schedule')}
                            className="text-xs text-indigo-600 hover:text-indigo-800"
                          >
                            {job.scheduled_date ? 'Reschedule' : 'Schedule'}
                          </button>
                          {(job.scheduled_date || job.assigned_crew || job.assigned_sub) && (
                            <button
                              type="button"
                              onClick={() => openScheduleModal(job, 'reassign')}
                              className="text-xs text-gray-700 hover:text-gray-900"
                            >
                              Reassign
                            </button>
                          )}
                          <Link
                            href={`/ops/jobs/${job.id}`}
                            className="text-xs text-gray-600 hover:text-gray-800"
                          >
                            View
                          </Link>
                          {canShowCompletionCertificateBoardLink(job.status) && (
                            <Link
                              href={opsJobCompletionCertificateHref(job.id)}
                              prefetch={false}
                              className="text-xs text-emerald-800 hover:text-emerald-950 font-medium"
                              title="Generate or email completion certificate"
                            >
                              Email certificate
                            </Link>
                          )}
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
                id="ops-completed-search"
                name="ops-completed-search"
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
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-xs">
                      {job.payroll_sent_at ? (
                        <span className="text-gray-700">
                          Sent to payroll{' '}
                          <span className="text-gray-500">
                            {new Date(job.payroll_sent_at).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                              timeZone: 'America/New_York',
                            })}
                          </span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => markPayrollSent(job.id)}
                          className="font-medium text-indigo-600 hover:text-indigo-800"
                        >
                          Ready for payroll
                        </button>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:ml-auto shrink-0">
                      <Link
                        href={opsJobCompletionCertificateHref(job.id)}
                        prefetch={false}
                        className="text-xs font-medium text-center sm:text-right text-emerald-800 hover:text-emerald-950 py-2 px-2 rounded-lg bg-emerald-50 border border-emerald-200"
                      >
                        Email completion certificate
                      </Link>
                      <Link href={`/ops/jobs/${job.id}`} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium text-center py-2">
                        View Job
                      </Link>
                    </div>
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
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Payroll</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredCompletedJobs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-sm text-gray-500 text-center">
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
                      <td className="px-4 py-3 text-sm">
                        {job.payroll_sent_at ? (
                          <span className="text-xs text-gray-700">
                            Sent to payroll
                            <span className="block text-gray-500 mt-0.5">
                              {new Date(job.payroll_sent_at).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                                timeZone: 'America/New_York',
                              })}
                            </span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => markPayrollSent(job.id)}
                            className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                          >
                            Ready for payroll
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end flex-wrap gap-x-3 gap-y-1">
                          <Link
                            href={opsJobCompletionCertificateHref(job.id)}
                            prefetch={false}
                            className="text-xs font-medium text-emerald-800 hover:text-emerald-950"
                            title="Generate or email completion certificate"
                          >
                            Email certificate
                          </Link>
                          <Link href={`/ops/jobs/${job.id}`} className="text-xs text-indigo-600 hover:text-indigo-800">
                            View
                          </Link>
                        </div>
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
          mode={scheduleModalMode}
          job={{
            ...selectedJob,
            assigned_crew_id: selectedJob.assigned_crew?.id ?? null,
            assigned_sub_id: selectedJob.assigned_sub?.id ?? null,
          }}
          crews={crews}
          subs={subs}
          onClose={() => {
            setShowScheduleModal(false)
            setSelectedJob(null)
            setScheduleModalMode('schedule')
          }}
          onSave={handleScheduleSave}
        />
      )}
    </div>
  )
}
