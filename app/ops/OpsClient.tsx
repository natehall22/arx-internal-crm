'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { jobDirectCost } from '@/lib/job-cost-ledger'
import { handoffPreviewForJobBoard } from '@/lib/project-review'
import OperationsSnapshotCard, {
  hasOperationsSnapshotData,
} from '@/components/ops/OperationsSnapshotCard'
import { OpsBoardJobCard } from '@/components/ops/OpsBoardJobCard'
import {
  JOB_STATUS_CONFIG,
  jobStatusConfig,
  isJobPastDue,
  paymentStatusChip,
  resumeStatusForJob,
  CANCELLED_JOB_STATUS,
  jobCancellationReasonLabel,
} from '@/lib/job-status'
import {
  canShowCompletionCertificateBoardLink,
  opsJobCompletionCertificateHref,
} from '@/lib/ops-completion-cert-link'
import type { JobStatus, OpsBoardJob } from '@/lib/ops-board-types'
import { toast } from '@/components/ui/toast'
import type { ColumnDef } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { StatusPill } from '@/components/ui/badge'
import { formatDate, formatMoney } from '@/lib/format'
import { DataTable, type TableFilter, type TableView } from '@/components/ui/data-table'

/** Paused jobs render in a strip above the board; cancelled ones in a list below it. */
type BoardColumnStatus = Exclude<JobStatus, 'collected' | 'on_hold' | 'cancelled'>

interface OpsClientProps {
  initialJobs: OpsBoardJob[]
  orgId: string
  canViewProfitability: boolean
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

const LIST_VIEWS: TableView[] = [
  { id: 'sys:all', name: 'All active jobs', state: { sorting: [{ id: 'scheduled', desc: false }], search: '', filters: {} } },
  { id: 'sys:unscheduled', name: 'Needs scheduling', state: { sorting: [{ id: 'job', desc: false }], search: '', filters: { scheduled: 'no' } } },
  { id: 'sys:materials', name: 'Materials not ordered', state: { sorting: [{ id: 'scheduled', desc: false }], search: '', filters: { materials: 'not_ordered' } } },
  { id: 'sys:late', name: 'Past due', state: { sorting: [{ id: 'scheduled', desc: false }], search: '', filters: { scheduled: 'late' } } },
  { id: 'sys:hold', name: 'On hold', state: { sorting: [{ id: 'job', desc: false }], search: '', filters: { status: 'on_hold' } } },
]

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

export default function OpsClient({ initialJobs, orgId, canViewProfitability }: OpsClientProps) {
  const router = useRouter()
  const [jobs, setJobs] = useState<OpsBoardJob[]>(initialJobs)
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board')

  // Default to list view on mobile — board's 5 columns stack awkwardly on small screens
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setViewMode('list')
    }
  }, [])
  const [snapshotJob, setSnapshotJob] = useState<OpsBoardJob | null>(null)
  const [filterType, setFilterType] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [completedSearchQuery, setCompletedSearchQuery] = useState('')


  const markPayrollSent = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/ops/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payroll_sent_at: new Date().toISOString() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(typeof data.error === 'string' ? data.error : 'Could not update payroll status')
        return
      }
      if (data.job) {
        setJobs((prev) =>
          prev.map((j) => (j.id === jobId ? { ...j, payroll_sent_at: data.job.payroll_sent_at } : j))
        )
      }
    } catch (e) {
      console.error(e)
      toast.error('Could not update payroll status')
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

  // Costs come from the one job cost ledger (`job.job_costs`, attached server-side by
  // enrichJobsWithCostLedger) — never the old production_jobs.labor_cost/material_cost columns.
  const getProfitability = (job: OpsBoardJob) => {
    const revenue = job.sale_amount ?? 0
    const costs = job.job_costs ?? null
    const hasCompleteCosts = Boolean(costs?.hasMaterials && costs?.hasLabor)
    const dealerFee = job.dealer_fee_amount ?? 0
    const directCosts = jobDirectCost(costs, dealerFee)
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

  const listColumns = useMemo<ColumnDef<OpsBoardJob, any>[]>(() => {
    const cols: ColumnDef<OpsBoardJob, any>[] = [
      {
        id: 'job',
        header: 'Job',
        accessorFn: (j) => `${j.job_number} ${j.address_text ?? ''} ${j.customer?.name ?? ''} ${handoffPreviewForJobBoard(j.project ?? null) ?? ''}`,
        cell: (c) => {
          const j = c.row.original
          const handoff = handoffPreviewForJobBoard(j.project ?? null)
          const priority = priorityConfig[j.priority] || priorityConfig.normal
          return (
            <span>
              <span className="font-mono">{priority.icon} {j.job_number}</span>
              <span className="block max-w-[14rem] truncate text-ui-sm text-ink-muted">{j.address_text}</span>
              {handoff ? <span className="block max-w-[18rem] text-ui-sm text-ink-muted line-clamp-2" title={handoff}><span className="font-semibold">Handoff: </span>{handoff}</span> : null}
            </span>
          )
        },
        meta: { mobile: 'title' },
      },
      { id: 'customer', header: 'Customer', accessorFn: (j) => j.customer?.name ?? '' , cell: (c) => c.getValue() || '—' },
      { id: 'type', header: 'Type', accessorFn: (j) => j.job_type, cell: (c) => <span className="capitalize">{formatJobTypeLabel(String(c.getValue() ?? ''))}</span>, meta: { mobile: 'hide' } },
      { id: 'status', header: 'Status', accessorFn: (j) => j.status, cell: (c) => <StatusPill domain="job" value={c.getValue()} /> },
      {
        id: 'payment',
        header: 'Payment',
        accessorFn: (j) => paymentStatusChip(j)?.label ?? '',
        cell: (c) => c.getValue() || '—',
      },
      { id: 'materials', header: 'Materials', accessorFn: (j) => (materialsConfig[j.materials_status] || materialsConfig.not_ordered).label },
      { id: 'assigned', header: 'Assigned', accessorFn: (j) => j.assigned_crew?.name ?? j.assigned_sub?.company_name ?? 'Unassigned' },
      {
        id: 'scheduled',
        header: 'Scheduled',
        accessorFn: (j) => j.scheduled_date ?? '9999-12-31',
        cell: (c) => (c.row.original.scheduled_date ? <span className={isJobPastDue(c.row.original) ? 'font-semibold text-danger' : ''}>{formatDate(`${c.row.original.scheduled_date}T12:00:00`)}</span> : 'Not scheduled'),
      },
      { id: 'value', header: 'Value', accessorFn: (j) => j.sale_amount ?? 0, cell: (c) => (c.getValue() ? formatMoney(Number(c.getValue())) : '—'), meta: { align: 'right' as const } },
    ]
    if (canViewProfitability) {
      cols.push({
        id: 'profit',
        header: 'Profit',
        accessorFn: (j) => (getProfitability(j).hasCompleteCosts ? getProfitability(j).profit : null),
        cell: (c) => {
          const p = getProfitability(c.row.original)
          return p.hasCompleteCosts ? (
            <span>
              {formatMoney(p.profit)}
              <span className="block text-ui-sm text-ink-muted">Costs {formatMoney(p.directCosts)} · {p.marginPercent.toFixed(1)}%</span>
            </span>
          ) : (
            <span className="font-semibold">Costs incomplete</span>
          )
        },
        meta: { align: 'right' as const },
      })
    }
    return cols
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewProfitability])

  const activeJobs = useMemo(
    () => jobs.filter((job) => job.status !== 'collected' && job.status !== CANCELLED_JOB_STATUS),
    [jobs]
  )
  const cancelledJobs = useMemo(
    () =>
      jobs
        .filter((job) => job.status === CANCELLED_JOB_STATUS)
        .sort((a, b) => String(b.cancelled_at ?? '').localeCompare(String(a.cancelled_at ?? ''))),
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

  const listFilters = useMemo<TableFilter<OpsBoardJob>[]>(
    () => [
      { key: 'status', label: 'Status', options: Object.keys(JOB_STATUS_CONFIG).filter((k) => k !== 'collected' && k !== CANCELLED_JOB_STATUS).map((k) => ({ value: k, label: JOB_STATUS_CONFIG[k as JobStatus].label })), accessor: (j) => j.status },
      { key: 'type', label: 'Type', options: jobTypeOptions.map((t) => ({ value: t, label: formatJobTypeLabel(t) })), accessor: (j) => j.job_type },
      { key: 'materials', label: 'Materials', options: Object.entries(materialsConfig).map(([value, m]) => ({ value, label: m.label })), accessor: (j) => j.materials_status },
      { key: 'scheduled', label: 'Scheduled', options: [{ value: 'no', label: 'Not scheduled' }, { value: 'yes', label: 'Scheduled' }, { value: 'late', label: 'Past due' }], accessor: (j) => (isJobPastDue(j) ? 'late' : j.scheduled_date ? 'yes' : 'no') },
    ],
    [jobTypeOptions]
  )

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

  const onHoldJobs = useMemo(
    () => filteredActiveJobs.filter((job) => job.status === 'on_hold'),
    [filteredActiveJobs]
  )

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
      .filter((j) => Boolean(j.job_costs?.hasMaterials && j.job_costs?.hasLabor))
      .reduce((sum, j) => sum + ((j.sale_amount || 0) - jobDirectCost(j.job_costs, j.dealer_fee_amount)), 0)
  }, [filteredActiveJobs, canViewProfitability])

  /** A job's crews (roofing, gutters, siding…) are each scheduled on the job page. */
  const openJobCrews = useCallback(
    (job: OpsBoardJob) => {
      router.push(`/ops/jobs/${job.id}#job-trades`)
    },
    [router]
  )

  const updateJobStatus = useCallback(async (jobId: string, newStatus: JobStatus) => {
    const current = jobs.find((j) => j.id === jobId)
    const updates: Record<string, unknown> = { status: newStatus }
    // Never overwrite a real start/finish date (e.g. resuming a paused job that had already started).
    if (newStatus === 'in_progress' && !current?.started_at) {
      updates.started_at = new Date().toISOString()
    } else if (newStatus === 'complete' && !current?.completed_at) {
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
      toast(message)
    }

    await loadData()
  }, [jobs, loadData])

  // Board one-tap "Mark ordered" goes through the same server event as the job page
  // (records the date, moves Sold → Material Ordering) instead of a raw browser-side
  // status write that skipped both.
  const markMaterialsOrdered = useCallback(
    async (jobId: string) => {
      const response = await fetch(`/api/ops/jobs/${jobId}/materials-ordered`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'board' }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => null)
        toast.error(err?.error || 'Could not save. Try again.')
      }
      await loadData()
    },
    [loadData]
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
      void markMaterialsOrdered(jobId)
    },
    [markMaterialsOrdered]
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
              href="/ops/schedule"
              className="px-4 py-2 border border-gray-300 bg-white rounded-lg hover:bg-gray-50 text-sm font-medium text-gray-700"
            >
              🔨 Install Schedule
            </Link>
            <Link
              href="/ops/calendar"
              className="px-4 py-2 border border-gray-300 bg-white rounded-lg hover:bg-gray-50 text-sm font-medium text-gray-700"
            >
              📅 Calendar View
            </Link>
            {/* Points at subs, not crews. The in-house crew path is retired (1 dead row,
                0 jobs) and installs go to subcontractors — and this is where the
                scheduling email that actually notifies a crew gets entered, which
                the board had no route to at all. */}
            <Link
              href="/admin/subs"
              className="px-4 py-2 border border-gray-300 bg-white rounded-lg hover:bg-gray-50 text-sm font-medium text-gray-700"
            >
              👷 Manage Subs
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
            <div className={`flex-1 ${viewMode === 'list' ? 'hidden' : ''}`}>
              <input
                id="ops-job-search"
                name="ops-job-search"
                type="text"
                placeholder="Search by job number, address, or customer..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full min-h-[44px] px-4 py-2 border border-gray-300 rounded-lg text-base sm:text-sm"
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <select
                hidden={viewMode === 'list'}
                id="ops-job-type-filter"
                name="ops-job-type-filter"
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="min-h-[44px] px-4 py-2 border border-gray-300 rounded-lg text-base sm:text-sm"
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
                  className={`min-h-[44px] px-4 py-2 text-sm ${viewMode === 'board' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-700'}`}
                >
                  Board
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`min-h-[44px] px-4 py-2 text-sm ${viewMode === 'list' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-700'}`}
                >
                  List
                </button>
              </div>
            </div>
          </div>
        </div>

        {viewMode === 'board' && onHoldJobs.length > 0 && (
          <div className={`mb-4 rounded-lg border ${JOB_STATUS_CONFIG.on_hold.panelClass}`}>
            <div className="p-3 border-b border-orange-200 flex items-center justify-between">
              <h3 className={`font-semibold ${JOB_STATUS_CONFIG.on_hold.color}`}>On Hold</h3>
              <span className={`text-sm font-medium ${JOB_STATUS_CONFIG.on_hold.color}`}>{onHoldJobs.length}</span>
            </div>
            <div className="p-3 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {onHoldJobs.map((job) => (
                <OpsBoardJobCard
                  key={job.id}
                  job={job}
                  onNavigateToJob={navigateToJob}
                  onOpenSnapshot={setSnapshotJob}
                  onSchedule={openJobCrews}
                  onStartMaterials={onBoardStartMaterials}
                  onMarkOrdered={onBoardMarkOrdered}
                  onJobStatus={updateJobStatus}
                />
              ))}
            </div>
          </div>
        )}

        {viewMode === 'board' && (
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {(['sold', 'materials', 'scheduled', 'in_progress', 'complete'] as BoardColumnStatus[]).map((status) => {
              const config = JOB_STATUS_CONFIG[status]
              const statusJobs = jobsByBoardStatus[status]

              return (
                <div key={status} className={`rounded-lg border ${config.panelClass}`}>
                  <div className={`p-3 border-b ${config.panelClass}`}>
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
                          onSchedule={openJobCrews}
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
          <DataTable
            columns={listColumns}
            data={activeJobs}
            tableKey="job_board"
            getRowId={(j) => j.id}
            getRowHref={(j) => `/ops/jobs/${j.id}`}
            searchPlaceholder="Search job number, address, customer or handoff"
            filters={listFilters}
            systemViews={LIST_VIEWS}
            defaultViewId="sys:all"
            initialSorting={[{ id: 'scheduled', desc: false }]}
            rowActions={(job) => (
              <div className="flex flex-wrap justify-end gap-1">
                {job.status === 'on_hold' ? (
                  <Button variant="ghost" size="sm" onClick={() => updateJobStatus(job.id, resumeStatusForJob(job))}>
                    Resume → {JOB_STATUS_CONFIG[resumeStatusForJob(job)].label}
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => openJobCrews(job)}>{job.scheduled_date ? 'Crews' : 'Schedule'}</Button>
                )}
                {canShowCompletionCertificateBoardLink(job.status) && (
                  <Button asChild variant="ghost" size="sm"><Link href={opsJobCompletionCertificateHref(job.id)} prefetch={false}>Email certificate</Link></Button>
                )}
              </div>
            )}
            empty={{ title: 'No jobs match', body: 'Try another view or clear a filter.' }}
          />
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
                className="w-full min-h-[44px] px-4 py-2 border border-gray-300 rounded-lg text-base sm:text-sm"
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

        {cancelledJobs.length > 0 && (
          <details className="mt-6 bg-white rounded-lg border p-4">
            <summary className="cursor-pointer select-none text-lg font-semibold text-[#2c2c2a]">
              Cancelled Jobs <span className="text-sm font-normal text-gray-600">({cancelledJobs.length})</span>
            </summary>
            <ul className="mt-3 divide-y">
              {cancelledJobs.map((job) => (
                <li key={job.id} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-4">
                  <div className="min-w-0">
                    <p className="text-sm text-[#2c2c2a]">
                      <span className="font-mono">{job.job_number}</span>
                      {' · '}
                      {job.customer?.name || '-'}
                    </p>
                    <p className="text-xs text-gray-600 truncate">{job.address_text}</p>
                    <p className="text-sm text-rose-800 mt-0.5">
                      {jobCancellationReasonLabel(job.cancellation_reason)}
                      {job.cancellation_notes ? <span className="text-[#2c2c2a]"> — {job.cancellation_notes}</span> : null}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-xs text-gray-600">
                    {job.cancelled_at && <span>{new Date(job.cancelled_at).toLocaleDateString()}</span>}
                    <Link href={`/ops/jobs/${job.id}`} className="text-indigo-700 hover:underline font-medium">
                      View
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        )}
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
                  defaultExpanded
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

    </div>
  )
}
