'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { canAccessJobBoard } from '@/lib/permissions'

interface OpsStats {
  activeJobs: number
  openWorkOrders: number
  pendingMaterials: number
  outstandingPayments: number
}

interface JobNeedingAttention {
  id: string
  job_number: string
  address_text: string
  customer_name: string
  assigned_pm: string | null
  issues: string[]
}

interface RecentMaterialOrder {
  id: string
  job_id: string
  job_number: string
  customer_name?: string
  description: string
  supplier: string | null
  amount: number
  status: 'ordered' | 'received' | 'paid' | 'returned'
  created_at: string
}

interface OpenWorkOrder {
  id: string
  job_id: string
  job_number: string
  sub_name: string | null
  work_type: string
  assigned_at: string
  is_overdue: boolean
}

interface OpsDashboardProps {
  profile: any
}

type TimeFrame =
  | 'today'
  | 'yesterday'
  | 'week'
  | 'last_week'
  | 'month'
  | 'last_month'
  | 'quarter'
  | 'year'
  | 'all'

const statusConfig = {
  ordered: { label: 'Ordered', bg: 'bg-blue-100', text: 'text-blue-700' },
  received: { label: 'Received', bg: 'bg-green-100', text: 'text-green-700' },
  paid: { label: 'Paid', bg: 'bg-gray-100', text: 'text-gray-700' },
  returned: { label: 'Returned', bg: 'bg-red-100', text: 'text-red-700' },
}

const opsTimeFrameLabel: Record<TimeFrame, string> = {
  today: 'today',
  yesterday: 'yesterday',
  week: 'this week',
  last_week: 'last week',
  month: 'this month',
  last_month: 'last month',
  quarter: 'this quarter',
  year: 'this year',
  all: 'all time',
}

export default function OpsDashboard({ profile }: OpsDashboardProps) {
  const canJobBoard = canAccessJobBoard(profile?.role)
  const [loading, setLoading] = useState(true)
  const [opsTimeframe, setOpsTimeframe] = useState<TimeFrame>('week')
  const [opsMetrics, setOpsMetrics] = useState({
    jobsSold: 0,
    installations: 0,
    cancellations: 0,
  })
  const [opsMetricsLoading, setOpsMetricsLoading] = useState(true)
  const [stats, setStats] = useState<OpsStats>({
    activeJobs: 0,
    openWorkOrders: 0,
    pendingMaterials: 0,
    outstandingPayments: 0,
  })
  const [jobsNeedingAttention, setJobsNeedingAttention] = useState<JobNeedingAttention[]>([])
  const [recentOrders, setRecentOrders] = useState<RecentMaterialOrder[]>([])
  const [openWorkOrders, setOpenWorkOrders] = useState<OpenWorkOrder[]>([])

  useEffect(() => {
    loadDashboardData()
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setOpsMetricsLoading(true)
      try {
        const res = await fetch(`/api/dashboard/ops-metrics?timeframe=${opsTimeframe}`)
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        setOpsMetrics({
          jobsSold: data.jobsSold ?? 0,
          installations: data.installations ?? 0,
          cancellations: data.cancellations ?? 0,
        })
      } catch (e) {
        console.error('ops metrics:', e)
      } finally {
        if (!cancelled) setOpsMetricsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [opsTimeframe])

  const loadDashboardData = async () => {
    try {
      const response = await fetch('/api/dashboard/ops')
      if (response.ok) {
        const data = await response.json()
        setStats(data.stats || {
          activeJobs: 0,
          openWorkOrders: 0,
          pendingMaterials: 0,
          outstandingPayments: 0,
        })
        setJobsNeedingAttention(data.jobsNeedingAttention || [])
        setRecentOrders(data.recentOrders || [])
        setOpenWorkOrders(data.openWorkOrders || [])
      }
    } catch (error) {
      console.error('Error loading ops dashboard:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount)
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-2 text-gray-500">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading dashboard...
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Top Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Active Jobs */}
        {canJobBoard ? (
          <Link
            href="/ops"
            className="block bg-white rounded-xl shadow-sm p-3 sm:p-5 border border-gray-100 hover:border-purple-200 hover:shadow transition"
          >
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm text-gray-500 truncate">Active Jobs</p>
                <p className="text-xl sm:text-2xl font-bold text-gray-900">{stats.activeJobs}</p>
              </div>
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                <svg className="w-5 h-5 sm:w-6 sm:h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
            </div>
          </Link>
        ) : (
          <div className="bg-white rounded-xl shadow-sm p-3 sm:p-5 border border-gray-100">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm text-gray-500 truncate">Active Jobs</p>
                <p className="text-xl sm:text-2xl font-bold text-gray-900">{stats.activeJobs}</p>
              </div>
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                <svg className="w-5 h-5 sm:w-6 sm:h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
            </div>
          </div>
        )}

        {/* Open Work Orders */}
        <div className="bg-white rounded-xl shadow-sm p-3 sm:p-5 border border-gray-100">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-xs sm:text-sm text-gray-500 truncate">Open Work Orders</p>
              <p className="text-xl sm:text-2xl font-bold text-gray-900">{stats.openWorkOrders}</p>
            </div>
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
              <svg className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
            </div>
          </div>
        </div>

        {/* Pending Materials */}
        <div className="bg-white rounded-xl shadow-sm p-3 sm:p-5 border border-gray-100">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-xs sm:text-sm text-gray-500 truncate">Pending Materials</p>
              <p className="text-xl sm:text-2xl font-bold text-amber-600">{stats.pendingMaterials}</p>
            </div>
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
              <svg className="w-5 h-5 sm:w-6 sm:h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
          </div>
        </div>

        {/* Outstanding Payments */}
        <div className="bg-white rounded-xl shadow-sm p-3 sm:p-5 border border-gray-100">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-xs sm:text-sm text-gray-500 truncate">Outstanding</p>
              <p className="text-xl sm:text-2xl font-bold text-red-600">{formatCurrency(stats.outstandingPayments)}</p>
            </div>
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
              <svg className="w-5 h-5 sm:w-6 sm:h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Period production metrics (aligned with sales dashboard timeframes) */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-500">
          Production metrics for{' '}
          <span className="text-gray-800 font-medium">{opsTimeFrameLabel[opsTimeframe]}</span>
        </p>
        <select
          value={opsTimeframe}
          onChange={(e) => setOpsTimeframe(e.target.value as TimeFrame)}
          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-indigo-500 w-full sm:w-auto"
          aria-label="Time period for production metrics"
        >
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="week">This Week</option>
          <option value="last_week">Last Week</option>
          <option value="month">This Month</option>
          <option value="last_month">Last Month</option>
          <option value="quarter">This Quarter</option>
          <option value="year">This Year</option>
          <option value="all">All Time</option>
        </select>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="bg-white rounded-xl shadow-sm p-3 sm:p-5 border border-gray-100">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-xs sm:text-sm text-gray-500 truncate">Jobs sold</p>
              <p className="text-xl sm:text-2xl font-bold text-emerald-700 tabular-nums">
                {opsMetricsLoading ? '—' : opsMetrics.jobsSold}
              </p>
            </div>
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
              <svg className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-3 sm:p-5 border border-gray-100">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-xs sm:text-sm text-gray-500 truncate">Installations</p>
              <p className="text-xl sm:text-2xl font-bold text-sky-700 tabular-nums">
                {opsMetricsLoading ? '—' : opsMetrics.installations}
              </p>
            </div>
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-sky-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
              <svg className="w-5 h-5 sm:w-6 sm:h-6 text-sky-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-3 sm:p-5 border border-gray-100">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-xs sm:text-sm text-gray-500 truncate">Cancellations</p>
              <p className="text-xl sm:text-2xl font-bold text-rose-700 tabular-nums">
                {opsMetricsLoading ? '—' : opsMetrics.cancellations}
              </p>
            </div>
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-rose-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
              <svg className="w-5 h-5 sm:w-6 sm:h-6 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Jobs Needing Attention */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base sm:text-lg font-semibold text-gray-900">Jobs Needing Attention</h2>
          {canJobBoard ? (
            <Link href="/ops" className="text-sm text-purple-600 hover:text-purple-800">
              View All Jobs
            </Link>
          ) : null}
        </div>
        {jobsNeedingAttention.length === 0 ? (
          <div className="p-8 text-center">
            <div className="text-3xl mb-2">✓</div>
            <p className="text-gray-500">All jobs are on track</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {jobsNeedingAttention.slice(0, 5).map((job) => (
              <div key={job.id} className="p-4 hover:bg-gray-50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-gray-900">{job.job_number}</span>
                      <span className="text-gray-400">•</span>
                      <span className="text-gray-600 truncate">{job.customer_name}</span>
                    </div>
                    <p className="text-sm text-gray-500 truncate mb-2">{job.address_text}</p>
                    <div className="flex flex-wrap gap-1">
                      {job.issues.map((issue, idx) => (
                        <span
                          key={idx}
                          className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                            issue.includes('overdue') ? 'bg-red-100 text-red-700' :
                            issue.includes('material') ? 'bg-amber-100 text-amber-700' :
                            issue.includes('payment') ? 'bg-orange-100 text-orange-700' :
                            'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {issue}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {job.assigned_pm && (
                      <span className="text-xs text-gray-500">{job.assigned_pm}</span>
                    )}
                    {canJobBoard ? (
                      <Link
                        href={`/ops/jobs/${job.id}`}
                        className="text-sm text-purple-600 hover:text-purple-800 whitespace-nowrap"
                      >
                        View Job →
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Two Column Layout for Orders and Work Orders */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent Material Orders */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900">Recent Material Orders</h2>
          </div>
          {recentOrders.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-gray-500">No recent material orders</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {recentOrders.map((order) => {
                const config = statusConfig[order.status]
                const body = (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-sm font-medium text-purple-600">{order.job_number}</span>
                        {order.customer_name ? (
                          <span className="text-sm text-gray-800 truncate max-w-[min(100%,12rem)]" title={order.customer_name}>
                            · {order.customer_name}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-sm text-gray-900 truncate">{order.description}</p>
                      {order.supplier && (
                        <p className="text-xs text-gray-500 truncate">{order.supplier}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-sm font-medium text-gray-900">
                        {formatCurrency(order.amount)}
                      </span>
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${config.bg} ${config.text}`}>
                        {config.label}
                      </span>
                    </div>
                  </div>
                )
                return canJobBoard ? (
                  <Link
                    key={order.id}
                    href={`/ops/jobs/${order.job_id}/orders`}
                    className="block p-4 hover:bg-gray-50"
                  >
                    {body}
                  </Link>
                ) : (
                  <div key={order.id} className="block p-4">
                    {body}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Open Work Orders */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900">Open Work Orders</h2>
            <Link href="/work-orders" className="text-sm text-purple-600 hover:text-purple-800">
              View All
            </Link>
          </div>
          {openWorkOrders.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-gray-500">No open work orders</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {openWorkOrders.slice(0, 8).map((wo) => (
                <Link
                  key={wo.id}
                  href={`/work-orders/${wo.id}`}
                  className={`block p-4 hover:bg-gray-50 ${wo.is_overdue ? 'bg-red-50' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-purple-600">{wo.job_number}</span>
                        {wo.is_overdue && (
                          <span className="px-1.5 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded">
                            Overdue
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-900">{wo.work_type}</p>
                      {wo.sub_name && (
                        <p className="text-xs text-gray-500">{wo.sub_name}</p>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatDate(wo.assigned_at)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
