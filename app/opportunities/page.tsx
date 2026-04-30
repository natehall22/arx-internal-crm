'use client'

import { useEffect, useMemo, useState } from 'react'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import InsideSalesFollowUpDrawer from '@/components/opportunities/InsideSalesFollowUpDrawer'
import {
  DEFAULT_INSPECTION_OUTCOMES,
  sortInspectionOutcomes,
  type InspectionOutcomeConfigRow,
} from '@/lib/inspection-outcomes'
import {
  applyOpportunityListFilters,
  buildOpportunityListQuery,
  EMPTY_OPPORTUNITY_LIST_FILTERS,
  filtersFromSearchParams,
} from '@/lib/opportunity-list-filters'
import {
  getInspectionOutcomeDisplay,
  opportunityStatusColors as statusColors,
  type OpportunityListRow as Opportunity,
} from '@/components/opportunities/opportunity-list-shared'

type InsideSalesActivity = {
  id: string
  type: string
  body: string | null
  created_at: string
  users?: { full_name?: string | null } | { full_name?: string | null }[] | null
}

type InsideSalesItem = {
  id: string
  status: string | null
  address_text: string | null
  project_type: string | null
  inspection_notes: string | null
  follow_up_at: string | null
  customerName: string
  customerPhone: string | null
  followUpKind: 'didnt_sit' | 'handoff'
  followUpOutcomeLabel?: string | null
  followUpStatus: string | null
  callableNow: boolean
  eligibleAtIso: string | null
  adminHandoffDelayDays: number | null
  assignedToName: string | null
  closerName: string | null
  activities: InsideSalesActivity[]
}

export default function OpportunitiesPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [insideSalesItems, setInsideSalesItems] = useState<InsideSalesItem[]>([])
  const [insideSalesLoading, setInsideSalesLoading] = useState(true)
  const [insideSalesError, setInsideSalesError] = useState<string | null>(null)
  const [insideSalesAccessChecked, setInsideSalesAccessChecked] = useState(false)
  const [canViewInsideSalesTab, setCanViewInsideSalesTab] = useState(false)
  const [canSelfAssignInsideSales, setCanSelfAssignInsideSales] = useState(false)
  const [inspectionOutcomeRows, setInspectionOutcomeRows] = useState<InspectionOutcomeConfigRow[]>(() =>
    sortInspectionOutcomes([...DEFAULT_INSPECTION_OUTCOMES], { includeInactive: true })
  )

  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams])
  const activeView = searchParams.get('view') === 'inside_sales' ? 'inside_sales' : 'all'

  const outcomeLookup = useMemo(() => {
    const map = new Map<string, InspectionOutcomeConfigRow>()
    for (const row of inspectionOutcomeRows) {
      map.set(row.id, row)
      map.set(row.id.toLowerCase(), row)
    }
    return map
  }, [inspectionOutcomeRows])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/inspections/outcomes?include_inactive=1', {
          credentials: 'same-origin',
        })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && Array.isArray(data.outcomes)) {
          setInspectionOutcomeRows(data.outcomes)
        }
      } catch {
        // keep defaults
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    loadOpportunities()
  }, [])

  useEffect(() => {
    loadInsideSales()
  }, [])

  useEffect(() => {
    if (insideSalesAccessChecked && activeView === 'inside_sales' && !canViewInsideSalesTab) {
      const next = new URLSearchParams(searchParams.toString())
      next.delete('view')
      router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname, { scroll: false })
    }
  }, [activeView, canViewInsideSalesTab, insideSalesAccessChecked, pathname, router, searchParams])

  const loadOpportunities = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/opportunities?full=true', { credentials: 'same-origin' })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setError(data.error || 'Failed to load opportunities')
        setOpportunities([])
        return
      }

      const { opportunities: opps } = await response.json()
      setOpportunities(opps || [])
    } catch (err) {
      console.error('Error loading opportunities:', err)
      setError('Failed to load opportunities')
      setOpportunities([])
    } finally {
      setLoading(false)
    }
  }

  const loadInsideSales = async () => {
    setInsideSalesLoading(true)
    setInsideSalesError(null)

    try {
      const response = await fetch('/api/opportunities/inside-sales', {
        credentials: 'same-origin',
      })

      if (response.status === 403) {
        setCanViewInsideSalesTab(false)
        setCanSelfAssignInsideSales(false)
        setInsideSalesItems([])
        return
      }

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to load inside sales queue')
      }

      const data = await response.json()
      setCanViewInsideSalesTab(Boolean(data.canView))
      setCanSelfAssignInsideSales(Boolean(data.canSelfAssign))
      const rawItems = Array.isArray(data.items) ? data.items : []
      setInsideSalesItems(
        rawItems.map((item: any) => ({
          ...item,
          callableNow: item.callableNow !== false,
          eligibleAtIso: item.eligibleAtIso ?? null,
          adminHandoffDelayDays:
            typeof item.adminHandoffDelayDays === 'number' ? item.adminHandoffDelayDays : null,
        }))
      )
    } catch (err) {
      console.error('Error loading inside sales queue:', err)
      setInsideSalesError(err instanceof Error ? err.message : 'Failed to load inside sales queue')
      setInsideSalesItems([])
    } finally {
      setInsideSalesAccessChecked(true)
      setInsideSalesLoading(false)
    }
  }

  const filteredOpportunities = useMemo(
    () => applyOpportunityListFilters(opportunities, filters),
    [opportunities, filters]
  )

  const filteredInsideSalesItems = useMemo(() => {
    const query = filters.q.trim().toLowerCase()
    const status = filters.status.trim().toLowerCase()
    const projectType = filters.project_type.trim().toLowerCase()
    const queueTypeRaw = filters.inspection_outcome.trim().toLowerCase()
    const queueType =
      queueTypeRaw === 'insurance' ? 'handoff' : queueTypeRaw

    return insideSalesItems.filter((item) => {
      if (query) {
        const matchesQuery = [
          item.customerName,
          item.customerPhone,
          item.address_text,
          item.assignedToName,
          item.closerName,
        ].some((value) => String(value || '').toLowerCase().includes(query))
        if (!matchesQuery) return false
      }

      if (status && String(item.status || '').toLowerCase() !== status) return false
      if (projectType && String(item.project_type || '').toLowerCase() !== projectType) return false

      if (queueTypeRaw === 'callable') {
        if (!item.callableNow) return false
      } else if (queueTypeRaw === 'waiting_rep') {
        if (item.callableNow) return false
      } else {
        if (queueType && queueType !== 'none' && item.followUpKind !== queueType) return false
        if (queueType === 'none') return false
      }

      return true
    })
  }, [filters, insideSalesItems])

  const setFilter = (key: 'q' | 'status' | 'inspection_outcome' | 'project_type', value: string) => {
    const nextFilters = { ...filters, [key]: value }
    const query = buildOpportunityListQuery(nextFilters)
    const next = query ? new URLSearchParams(query) : new URLSearchParams()
    if (activeView === 'inside_sales') next.set('view', 'inside_sales')
    router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname, { scroll: false })
  }

  const clearFilters = () => {
    const query = buildOpportunityListQuery(EMPTY_OPPORTUNITY_LIST_FILTERS)
    const next = query ? new URLSearchParams(query) : new URLSearchParams()
    if (activeView === 'inside_sales') next.set('view', 'inside_sales')
    router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname, { scroll: false })
  }

  const setView = (view: 'all' | 'inside_sales') => {
    const next = new URLSearchParams(searchParams.toString())
    if (view === 'inside_sales') {
      next.set('view', 'inside_sales')
    } else {
      next.delete('view')
    }
    router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname, { scroll: false })
  }

  const hasActiveFilters =
    filters.q || filters.status || filters.inspection_outcome || filters.project_type
  const detailQueryString = buildOpportunityListQuery(filters, { queue: '1' })
  const insideSalesDetailQueryString = useMemo(() => {
    const next = new URLSearchParams()
    next.set('view', 'inside_sales')
    if (filters.q) next.set('q', filters.q)
    if (filters.status) next.set('status', filters.status)
    if (filters.inspection_outcome) next.set('inspection_outcome', filters.inspection_outcome)
    if (filters.project_type) next.set('project_type', filters.project_type)
    return next.toString()
  }, [filters])
  const insideSalesCounts = {
    total: insideSalesItems.length,
    readyToCall: insideSalesItems.filter((item) => item.callableNow).length,
    didntSit: insideSalesItems.filter((item) => item.followUpKind === 'didnt_sit').length,
    handoff: insideSalesItems.filter((item) => item.followUpKind === 'handoff').length,
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Opportunities</h1>
            <p className="text-gray-500 mt-1 text-sm">
              {activeView === 'inside_sales'
                ? `${filteredInsideSalesItems.length} inside sales follow-ups`
                : `${filteredOpportunities.length} opportunities`}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setView('all')}
                className={`rounded-full px-3 py-2 text-sm font-medium ${
                  activeView === 'all' ? 'bg-gray-900 text-white' : 'border border-gray-200 bg-white text-gray-700'
                }`}
              >
                All Opportunities
              </button>
              {insideSalesAccessChecked && canViewInsideSalesTab && (
                <button
                  type="button"
                  onClick={() => setView('inside_sales')}
                  className={`rounded-full px-3 py-2 text-sm font-medium ${
                    activeView === 'inside_sales'
                      ? 'bg-amber-500 text-white'
                      : 'border border-gray-200 bg-white text-gray-700'
                  }`}
                >
                  Inside Sales ({insideSalesCounts.total})
                </button>
              )}
            </div>
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="md:hidden flex items-center gap-1.5 px-3 py-2 bg-white border rounded-lg text-sm text-gray-700 shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
            </svg>
            Filters
            {hasActiveFilters && <span className="w-2 h-2 rounded-full bg-indigo-600 ml-0.5" />}
          </button>
        </div>

        <div className={`bg-white shadow rounded-lg p-4 mb-4 sm:mb-6 ${showFilters ? 'block' : 'hidden'} md:block`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
            <div className="sm:col-span-2 lg:col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
              <input
                type="text"
                placeholder={activeView === 'inside_sales' ? 'Name, phone, address...' : 'Name, address...'}
                value={filters.q}
                onChange={(e) => setFilter('q', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
              <select
                value={filters.status}
                onChange={(e) => setFilter('status', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
              >
                <option value="">All Statuses</option>
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="negotiation">Negotiation</option>
                <option value="won">Won</option>
                <option value="lost">Lost</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {activeView === 'inside_sales' ? 'Queue Type' : 'Inspection Result'}
              </label>
              <select
                value={filters.inspection_outcome}
                onChange={(e) => setFilter('inspection_outcome', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
              >
                {activeView === 'inside_sales' ? (
                  <>
                    <option value="">All queue types</option>
                    <option value="callable">Ready to call (past admin wait)</option>
                    <option value="waiting_rep">Waiting on rep (admin window)</option>
                    <option value="didnt_sit">Didn&apos;t Sit</option>
                    <option value="handoff">Inspection handoff (admin)</option>
                  </>
                ) : (
                  <>
                    <option value="">All Results</option>
                    <option value="none">No Inspection Yet</option>
                    {filters.inspection_outcome &&
                      filters.inspection_outcome !== 'none' &&
                      !inspectionOutcomeRows.some((o) => o.id === filters.inspection_outcome) && (
                        <option value={filters.inspection_outcome}>
                          {filters.inspection_outcome.replace(/_/g, ' ')} (legacy)
                        </option>
                      )}
                    {inspectionOutcomeRows.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                        {o.active === false ? ' — inactive' : ''}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Project Type</label>
              <select
                value={filters.project_type}
                onChange={(e) => setFilter('project_type', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
              >
                <option value="">All Types</option>
                <option value="roofing">Roofing</option>
                <option value="siding">Siding</option>
                <option value="windows">Windows</option>
                <option value="mixed">Mixed</option>
              </select>
            </div>
            <div className="flex items-end">
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="w-full sm:w-auto px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Clear Filters
                </button>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}

        {activeView === 'inside_sales' && insideSalesError && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {insideSalesError}
          </div>
        )}

        <div className="bg-white shadow rounded-lg overflow-hidden">
          {activeView === 'inside_sales' ? (
            insideSalesLoading ? (
              <div className="p-8 text-center text-gray-500">Loading inside sales queue...</div>
            ) : filteredInsideSalesItems.length > 0 ? (
              <div className="p-4 sm:p-6 space-y-4">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
                    <p className="text-sm font-medium text-emerald-800">Ready to call</p>
                    <p className="mt-2 text-3xl font-bold text-emerald-950">{insideSalesCounts.readyToCall}</p>
                    <p className="mt-1 text-xs text-emerald-800">Past admin day rule or didn&apos;t sit</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <p className="text-sm font-medium text-gray-500">In queue</p>
                    <p className="mt-2 text-3xl font-bold text-gray-900">{insideSalesCounts.total}</p>
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
                    <p className="text-sm font-medium text-amber-800">Didn&apos;t sit</p>
                    <p className="mt-2 text-3xl font-bold text-amber-950">{insideSalesCounts.didntSit}</p>
                  </div>
                  <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-4 shadow-sm">
                    <p className="text-sm font-medium text-cyan-800">Inspection handoff</p>
                    <p className="mt-2 text-3xl font-bold text-cyan-950">{insideSalesCounts.handoff}</p>
                  </div>
                </div>

                {filteredInsideSalesItems.map((item) => {
                  const kindLabel =
                    item.followUpKind === 'handoff'
                      ? item.followUpOutcomeLabel || 'Inspection handoff'
                      : "Didn't Sit"
                  const kindClasses =
                    item.followUpKind === 'handoff'
                      ? 'bg-cyan-100 text-cyan-800'
                      : 'bg-amber-100 text-amber-800'

                  return (
                    <div key={item.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${kindClasses}`}>
                              {kindLabel}
                            </span>
                            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 capitalize">
                              {String(item.followUpStatus || 'new').replace(/_/g, ' ')}
                            </span>
                            {item.callableNow ? (
                              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-900">
                                Ready to call
                              </span>
                            ) : item.eligibleAtIso ? (
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-800">
                                Rep through{' '}
                                {new Date(item.eligibleAtIso).toLocaleString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })}
                              </span>
                            ) : (
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                                Waiting on rep
                              </span>
                            )}
                          </div>
                          <h2 className="mt-3 text-lg font-semibold text-gray-900">{item.customerName}</h2>
                          <p className="mt-1 text-sm text-gray-600">{item.address_text || 'No address'}</p>
                        </div>
                        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:min-w-[320px]">
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Phone</p>
                            <p className="mt-1 font-medium text-gray-900">{item.customerPhone || 'No phone'}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Assigned</p>
                            <p className="mt-1 font-medium text-gray-900">{item.assignedToName || 'Unassigned'}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Closer</p>
                            <p className="mt-1 font-medium text-gray-900">{item.closerName || '—'}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                              Call timing
                            </p>
                            <p className="mt-1 font-medium text-gray-900">
                              {!item.callableNow && item.eligibleAtIso
                                ? `Opens ${new Date(item.eligibleAtIso).toLocaleString(undefined, {
                                    month: 'short',
                                    day: 'numeric',
                                    hour: 'numeric',
                                    minute: '2-digit',
                                  })}`
                                : item.follow_up_at
                                  ? new Date(item.follow_up_at).toLocaleString()
                                  : item.adminHandoffDelayDays != null
                                    ? `${item.adminHandoffDelayDays}-day admin wait from inspection`
                                    : '—'}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <Link
                          href={`/opportunities/${item.id}${insideSalesDetailQueryString ? `?${insideSalesDetailQueryString}` : ''}`}
                          className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Open opportunity
                        </Link>
                      </div>

                      <InsideSalesFollowUpDrawer
                        opportunityId={item.id}
                        customerName={item.customerName}
                        customerPhone={item.customerPhone}
                        followUpKind={item.followUpKind}
                        handoffOutcomeLabel={item.followUpOutcomeLabel ?? null}
                        assignedToName={item.assignedToName}
                        statusLabel={String(item.followUpStatus || 'new').replace(/_/g, ' ')}
                        nextFollowUpAt={item.follow_up_at}
                        closerNotes={item.inspection_notes}
                        callableNow={item.callableNow}
                        eligibleAtIso={item.eligibleAtIso}
                        adminHandoffDelayDays={item.adminHandoffDelayDays}
                        visible
                        canManage
                        canSelfAssign={canSelfAssignInsideSales}
                        activities={item.activities}
                      />
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="p-8 text-center text-gray-500">
                {hasActiveFilters ? 'No inside sales follow-ups match your filters.' : 'No active inside sales follow-ups.'}
              </div>
            )
          ) : loading ? (
            <div className="p-8 text-center text-gray-500">Loading opportunities...</div>
          ) : (
            <>
              <div className="md:hidden divide-y divide-gray-100">
                {filteredOpportunities.length > 0 ? (
                  filteredOpportunities.map((opportunity) => {
                    const outcomeInfo = getInspectionOutcomeDisplay(
                      opportunity.inspection_outcome,
                      outcomeLookup
                    )
                    const customerName = opportunity.leads?.homeowner_name || opportunity.customers?.name || 'Unknown'
                    return (
                      <Link
                        key={opportunity.id}
                        href={`/opportunities/${opportunity.id}${detailQueryString ? `?${detailQueryString}` : ''}`}
                        className="block px-4 py-4 hover:bg-gray-50 active:bg-gray-100 transition"
                      >
                        <div className="flex items-start justify-between gap-3 mb-1">
                          <p className="font-semibold text-gray-900 text-base leading-snug">{customerName}</p>
                          <span className={`shrink-0 px-2.5 py-0.5 text-xs font-semibold rounded-full capitalize ${
                            statusColors[opportunity.status] || 'bg-gray-100 text-gray-800'
                          }`}>
                            {(opportunity.status || '—').replace(/_/g, ' ')}
                          </span>
                        </div>
                        <p className="text-sm text-gray-500 mb-2 truncate">{opportunity.address_text || 'No address'}</p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600 capitalize">
                            {opportunity.project_type}
                          </span>
                          {outcomeInfo ? (
                            <span
                              className={`px-2 py-0.5 text-xs font-medium rounded-full ${outcomeInfo.style ? '' : outcomeInfo.color}`}
                              style={outcomeInfo.style}
                            >
                              {outcomeInfo.label}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-50 text-yellow-700 font-medium">
                              No inspection yet
                            </span>
                          )}
                        </div>
                        {opportunity.users?.full_name && (
                          <p className="text-xs text-gray-400 mt-2">{opportunity.users.full_name}</p>
                        )}
                      </Link>
                    )
                  })
                ) : (
                  <div className="px-6 py-10 text-center text-gray-500">
                    <p className="text-sm">{hasActiveFilters ? 'No opportunities match your filters' : 'No opportunities found'}</p>
                    {hasActiveFilters && (
                      <button onClick={clearFilters} className="mt-2 text-indigo-600 text-sm hover:underline">
                        Clear filters
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="hidden md:block overflow-x-auto">
                <table className="w-full min-w-[980px] divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Lead / Customer
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Address
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Type
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Inspection Result
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Assigned
                      </th>
                      <th className="sticky right-0 z-10 bg-gray-50 px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredOpportunities.length > 0 ? (
                      filteredOpportunities.map((opportunity) => {
                        const outcomeInfo = getInspectionOutcomeDisplay(
                          opportunity.inspection_outcome,
                          outcomeLookup
                        )
                        return (
                          <tr key={opportunity.id} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm font-medium text-gray-900">
                                {opportunity.leads?.homeowner_name || opportunity.customers?.name || 'N/A'}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="text-sm text-gray-900 max-w-xs truncate">
                                {opportunity.address_text || 'N/A'}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800 capitalize">
                                {opportunity.project_type}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full capitalize ${
                                statusColors[opportunity.status] || 'bg-gray-100 text-gray-800'
                              }`}>
                                {(opportunity.status || '—').replace(/_/g, ' ')}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              {outcomeInfo ? (
                                <span
                                  className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                    outcomeInfo.style ? '' : outcomeInfo.color
                                  }`}
                                  style={outcomeInfo.style}
                                >
                                  {outcomeInfo.label}
                                </span>
                              ) : (
                                <span className="text-sm text-gray-400">—</span>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {opportunity.users?.full_name || 'Unassigned'}
                            </td>
                            <td className="sticky right-0 bg-white px-6 py-4 whitespace-nowrap text-sm font-medium">
                              <Link
                                href={`/opportunities/${opportunity.id}${detailQueryString ? `?${detailQueryString}` : ''}`}
                                className="inline-flex min-h-[36px] items-center px-2 py-1 rounded-md text-indigo-600 hover:bg-indigo-50 hover:text-indigo-900"
                              >
                                View
                              </Link>
                            </td>
                          </tr>
                        )
                      })
                    ) : (
                      <tr>
                        <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                          {hasActiveFilters ? 'No opportunities match your filters' : 'No opportunities found'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
