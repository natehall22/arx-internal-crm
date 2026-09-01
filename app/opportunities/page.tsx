'use client'

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
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
  type OpportunityListFilters,
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
  followUpKind: 'didnt_sit' | 'handoff' | 'knockback' | 'storm'
  knockback_reason?: string | null
  followUpOutcomeLabel?: string | null
  followUpStatus: string | null
  callableNow: boolean
  eligibleAtIso: string | null
  adminHandoffDelayDays: number | null
  assignedToName: string | null
  closerName: string | null
  activities: InsideSalesActivity[]
  story?: string
  objective?: string
  attemptCount?: number
  lastAttemptAt?: string | null
  daysInQueue?: number | null
  overdueDays?: number | null
}

type OpportunityRowProps = {
  opportunity: Opportunity
  outcomeLookup: Map<string, InspectionOutcomeConfigRow>
  detailQueryString: string
}

/**
 * Both list renderers are memoized: the mobile card list and the desktop table are
 * mounted at the same time (one hidden by CSS), so an unmemoized keystroke re-render
 * reconciles the whole result set twice. With stable props these bail out entirely,
 * which is what makes the search box feel instant while `useDeferredValue` catches up.
 */
const OpportunityCard = memo(function OpportunityCard({
  opportunity,
  outcomeLookup,
  detailQueryString,
}: OpportunityRowProps) {
  const outcomeInfo = getInspectionOutcomeDisplay(opportunity.inspection_outcome, outcomeLookup)
  const customerName = opportunity.leads?.homeowner_name || opportunity.customers?.name || 'Unknown'
  return (
    <Link
      href={`/opportunities/${opportunity.id}${detailQueryString ? `?${detailQueryString}` : ''}`}
      className="block px-4 py-4 hover:bg-gray-50 active:bg-gray-100 transition"
    >
      <div className="flex items-start justify-between gap-3 mb-1">
        <p className="font-semibold text-gray-900 text-base leading-snug">{customerName}</p>
        <span
          className={`shrink-0 px-2.5 py-0.5 text-xs font-semibold rounded-full capitalize ${
            statusColors[opportunity.status] || 'bg-gray-100 text-gray-800'
          }`}
        >
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

const OpportunityRow = memo(function OpportunityRow({
  opportunity,
  outcomeLookup,
  detailQueryString,
}: OpportunityRowProps) {
  const outcomeInfo = getInspectionOutcomeDisplay(opportunity.inspection_outcome, outcomeLookup)
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm font-medium text-gray-900">
          {opportunity.leads?.homeowner_name || opportunity.customers?.name || 'N/A'}
        </div>
      </td>
      <td className="px-6 py-4">
        <div className="text-sm text-gray-900 max-w-xs truncate">{opportunity.address_text || 'N/A'}</div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800 capitalize">
          {opportunity.project_type}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <span
          className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full capitalize ${
            statusColors[opportunity.status] || 'bg-gray-100 text-gray-800'
          }`}
        >
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
  const [searchInput, setSearchInput] = useState(filters.q)
  const activeView = searchParams.get('view') === 'inside_sales' ? 'inside_sales' : 'all'

  useEffect(() => {
    setSearchInput(filters.q)
  }, [filters.q])

  const activeFilters = useMemo(
    () => ({ ...filters, q: searchInput }),
    [filters, searchInput]
  )
  const deferredFilters = useDeferredValue(activeFilters)

  const outcomeLookup = useMemo(() => {
    const map = new Map<string, InspectionOutcomeConfigRow>()
    for (const row of inspectionOutcomeRows) {
      map.set(row.id, row)
      map.set(row.id.toLowerCase(), row)
    }
    return map
  }, [inspectionOutcomeRows])

  const loadOpportunities = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/opportunities?full=true', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      })
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

  const loadInsideSales = useCallback(async () => {
    setInsideSalesLoading(true)
    setInsideSalesError(null)

    try {
      const response = await fetch(`/api/opportunities/inside-sales?_t=${Date.now()}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
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
      setCanViewInsideSalesTab(true)
      setInsideSalesItems([])
    } finally {
      setInsideSalesAccessChecked(true)
      setInsideSalesLoading(false)
    }
  }, [])

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
  }, [loadInsideSales])

  useEffect(() => {
    if (insideSalesAccessChecked && activeView === 'inside_sales' && !canViewInsideSalesTab) {
      const next = new URLSearchParams(searchParams.toString())
      next.delete('view')
      router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname, { scroll: false })
    }
  }, [activeView, canViewInsideSalesTab, insideSalesAccessChecked, pathname, router, searchParams])

  const pushFiltersToUrl = useCallback(
    (nextFilters: OpportunityListFilters) => {
      const query = buildOpportunityListQuery(nextFilters)
      const next = query ? new URLSearchParams(query) : new URLSearchParams()
      if (activeView === 'inside_sales') next.set('view', 'inside_sales')
      router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname, { scroll: false })
    },
    [activeView, pathname, router]
  )

  useEffect(() => {
    if (searchInput === filters.q) return
    const timer = setTimeout(() => {
      pushFiltersToUrl({ ...filters, q: searchInput })
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput, filters, pushFiltersToUrl])

  const filteredOpportunities = useMemo(
    () => applyOpportunityListFilters(opportunities, deferredFilters),
    [opportunities, deferredFilters]
  )

  const filteredInsideSalesItems = useMemo(() => {
    const query = deferredFilters.q.trim().toLowerCase()
    const status = deferredFilters.status.trim().toLowerCase()
    const projectType = deferredFilters.project_type.trim().toLowerCase()
    const queueTypeRaw = deferredFilters.inspection_outcome.trim().toLowerCase()
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
  }, [deferredFilters, insideSalesItems])

  const setFilter = (key: 'status' | 'inspection_outcome' | 'project_type', value: string) => {
    pushFiltersToUrl({ ...filters, [key]: value, q: searchInput })
  }

  const clearFilters = () => {
    setSearchInput('')
    pushFiltersToUrl(EMPTY_OPPORTUNITY_LIST_FILTERS)
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
    activeFilters.q || activeFilters.status || activeFilters.inspection_outcome || activeFilters.project_type
  // Built from the deferred filters, not the live input: these strings go into every
  // row's href, and a new href on each keystroke re-fires next/link prefetch for every
  // visible row. Deferred also keeps them in sync with the list actually on screen.
  const detailQueryString = buildOpportunityListQuery(deferredFilters, { queue: '1' })
  const insideSalesDetailQueryString = useMemo(() => {
    const next = new URLSearchParams()
    next.set('view', 'inside_sales')
    if (deferredFilters.q) next.set('q', deferredFilters.q)
    if (deferredFilters.status) next.set('status', deferredFilters.status)
    if (deferredFilters.inspection_outcome) next.set('inspection_outcome', deferredFilters.inspection_outcome)
    if (deferredFilters.project_type) next.set('project_type', deferredFilters.project_type)
    return next.toString()
  }, [deferredFilters])

  const opportunityCards = useMemo(
    () =>
      filteredOpportunities.map((opportunity) => (
        <OpportunityCard
          key={opportunity.id}
          opportunity={opportunity}
          outcomeLookup={outcomeLookup}
          detailQueryString={detailQueryString}
        />
      )),
    [filteredOpportunities, outcomeLookup, detailQueryString]
  )

  const opportunityRows = useMemo(
    () =>
      filteredOpportunities.map((opportunity) => (
        <OpportunityRow
          key={opportunity.id}
          opportunity={opportunity}
          outcomeLookup={outcomeLookup}
          detailQueryString={detailQueryString}
        />
      )),
    [filteredOpportunities, outcomeLookup, detailQueryString]
  )
  const insideSalesCounts = useMemo(() => {
    const counts = {
      total: insideSalesItems.length,
      readyToCall: 0,
      didntSit: 0,
      handoff: 0,
      knockback: 0,
      storm: 0,
    }
    for (const item of insideSalesItems) {
      if (item.callableNow) counts.readyToCall += 1
      if (item.followUpKind === 'didnt_sit') counts.didntSit += 1
      else if (item.followUpKind === 'handoff') counts.handoff += 1
      else if (item.followUpKind === 'knockback') counts.knockback += 1
      else if (item.followUpKind === 'storm') counts.storm += 1
    }
    return counts
  }, [insideSalesItems])

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Opportunities</h1>
            <p className="text-gray-500 mt-1 text-sm">
              {activeView === 'inside_sales' ? (
                <>
                  {filteredInsideSalesItems.length} below · {insideSalesCounts.readyToCall} ready for calls · waiting
                  leads after that (already sorted)
                </>
              ) : (
                `${filteredOpportunities.length} opportunities`
              )}
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
                  Inside Sales ({insideSalesCounts.readyToCall}/{insideSalesCounts.total})
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
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
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
                <option value="">All statuses</option>
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                {activeView !== 'inside_sales' && (
                  <>
                    <option value="negotiation">Negotiation</option>
                    <option value="won">Won</option>
                    <option value="lost">Lost</option>
                  </>
                )}
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
                    <option value="">Everything in queue</option>
                    <option value="callable">Ready for me (past wait)</option>
                    <option value="waiting_rep">Still with rep</option>
                    <option value="didnt_sit">Didn&apos;t sit only</option>
                    <option value="handoff">Inspection handoff only</option>
                    <option value="knockback">Knockback only</option>
                    <option value="storm">Storm only (est.)</option>
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
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
                    <p className="text-sm font-medium text-emerald-800">Ready for calls</p>
                    <p className="mt-2 text-3xl font-bold text-emerald-950">{insideSalesCounts.readyToCall}</p>
                    <p className="mt-1 text-xs text-emerald-800">Sorted with ready leads first</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <p className="text-sm font-medium text-gray-500">Total in queue</p>
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
                  <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 shadow-sm">
                    <p className="text-sm font-medium text-orange-800">Knockback</p>
                    <p className="mt-2 text-3xl font-bold text-orange-950">{insideSalesCounts.knockback}</p>
                  </div>
                  <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 shadow-sm">
                    <p className="text-sm font-medium text-sky-800">Storm (est.)</p>
                    <p className="mt-2 text-3xl font-bold text-sky-950">{insideSalesCounts.storm}</p>
                  </div>
                </div>

                {filteredInsideSalesItems.map((item) => {
                  const kindLabel =
                    item.followUpKind === 'knockback'
                      ? (item.knockback_reason?.replace(/_/g, ' ') || 'Knockback').replace(/\b\w/g, (c) => c.toUpperCase())
                      : item.followUpKind === 'storm'
                        ? 'Storm follow-up (est.)'
                        : item.followUpKind === 'handoff'
                          ? item.followUpOutcomeLabel || 'Inspection handoff'
                          : "Didn't Sit"
                  const kindClasses =
                    item.followUpKind === 'knockback'
                      ? 'bg-orange-100 text-orange-800'
                      : item.followUpKind === 'storm'
                        ? 'bg-sky-100 text-sky-900'
                        : item.followUpKind === 'handoff'
                          ? 'bg-cyan-100 text-cyan-800'
                          : 'bg-amber-100 text-amber-800'
                  const statusPretty = String(item.followUpStatus || 'new').replace(/_/g, ' ')
                  const phoneDigits = item.customerPhone ? String(item.customerPhone).replace(/\D/g, '') : ''

                  return (
                    <div key={item.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${kindClasses}`}>
                              {kindLabel}
                              <span className="font-normal opacity-90"> · {statusPretty}</span>
                            </span>
                            {item.callableNow && typeof item.overdueDays === 'number' && item.overdueDays > 0 ? (
                              <span className="rounded-full bg-red-600 px-2.5 py-1 text-xs font-bold text-white">
                                Overdue {item.overdueDays} day{item.overdueDays === 1 ? '' : 's'}
                              </span>
                            ) : item.callableNow ? (
                              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-900">
                                Ready for calls
                              </span>
                            ) : item.eligibleAtIso ? (
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-800">
                                Opens{' '}
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
                          {item.story && (
                            <p className="mt-2 text-sm text-gray-800">
                              {item.story}{' '}
                              {item.objective && (
                                <span className="font-semibold text-gray-900">→ {item.objective}</span>
                              )}
                            </p>
                          )}
                          <p className="mt-1 text-xs font-medium text-gray-500">
                            {[
                              typeof item.attemptCount === 'number'
                                ? item.attemptCount === 0
                                  ? 'Never called'
                                  : `${item.attemptCount} attempt${item.attemptCount === 1 ? '' : 's'}`
                                : null,
                              typeof item.daysInQueue === 'number' ? `in queue ${item.daysInQueue}d` : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        </div>
                        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:min-w-[320px]">
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Phone</p>
                            <p className="mt-1 font-medium text-gray-900">
                              {item.customerPhone && phoneDigits ? (
                                <a
                                  href={`tel:${phoneDigits}`}
                                  className="text-indigo-700 hover:text-indigo-900 hover:underline"
                                >
                                  {item.customerPhone}
                                </a>
                              ) : (
                                item.customerPhone || 'No phone'
                              )}
                            </p>
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
                              When to call
                            </p>
                            {typeof item.overdueDays === 'number' && item.overdueDays > 0 ? (
                              <p className="mt-1 font-semibold text-red-700">
                                Overdue by {item.overdueDays} day{item.overdueDays === 1 ? '' : 's'}
                              </p>
                            ) : (
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
                                      : 'Now'}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start">
                        <div className="min-w-0 flex-1">
                          <InsideSalesFollowUpDrawer
                            opportunityId={item.id}
                            customerName={item.customerName}
                            customerPhone={item.customerPhone}
                            followUpKind={item.followUpKind}
                            handoffOutcomeLabel={item.followUpOutcomeLabel ?? null}
                            knockbackReason={item.knockback_reason ?? null}
                            assignedToName={item.assignedToName}
                            statusLabel={String(item.followUpStatus || 'new').replace(/_/g, ' ')}
                            nextFollowUpAt={item.follow_up_at}
                            closerNotes={item.inspection_notes}
                            callableNow={item.callableNow}
                            eligibleAtIso={item.eligibleAtIso}
                            adminHandoffDelayDays={item.adminHandoffDelayDays}
                            onFollowUpCompleted={loadInsideSales}
                            visible
                            canManage
                            canSelfAssign={canSelfAssignInsideSales}
                            activities={item.activities}
                          />
                        </div>
                        <Link
                          href={`/opportunities/${item.id}${insideSalesDetailQueryString ? `?${insideSalesDetailQueryString}` : ''}`}
                          className="inline-flex shrink-0 items-center self-start rounded-lg px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-800"
                        >
                          Full record →
                        </Link>
                      </div>
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
                  opportunityCards
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
                      opportunityRows
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
