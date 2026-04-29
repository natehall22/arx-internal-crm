'use client'

import { useEffect, useMemo, useState } from 'react'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
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

export default function OpportunitiesPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [inspectionOutcomeRows, setInspectionOutcomeRows] = useState<InspectionOutcomeConfigRow[]>(() =>
    sortInspectionOutcomes([...DEFAULT_INSPECTION_OUTCOMES], { includeInactive: true })
  )
  const filters = useMemo(
    () => filtersFromSearchParams(searchParams),
    [searchParams]
  )

  const outcomeLookup = useMemo(() => {
    const m = new Map<string, InspectionOutcomeConfigRow>()
    for (const r of inspectionOutcomeRows) {
      m.set(r.id, r)
      m.set(r.id.toLowerCase(), r)
    }
    return m
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
        // keep empty lookup; labels fall back to inspectionOutcomeLabels / title case
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    loadOpportunities()
  }, [])

  const loadOpportunities = async () => {
    setLoading(true)
    setError(null)
    
    try {
      const url = '/api/opportunities?full=true'
      const response = await fetch(url, { credentials: 'same-origin' })
      if (!response.ok) {
        const data = await response.json()
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

  const filteredOpportunities = useMemo(
    () => applyOpportunityListFilters(opportunities, filters),
    [opportunities, filters]
  )

  const setFilter = (key: 'q' | 'status' | 'inspection_outcome' | 'project_type', value: string) => {
    const nextFilters = { ...filters, [key]: value }
    const query = buildOpportunityListQuery(nextFilters)
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  const clearFilters = () => {
    const query = buildOpportunityListQuery(EMPTY_OPPORTUNITY_LIST_FILTERS)
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  const hasActiveFilters =
    filters.q || filters.status || filters.inspection_outcome || filters.project_type
  const detailQueryString = buildOpportunityListQuery(filters, { queue: '1' })

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Opportunities</h1>
            <p className="text-gray-500 mt-1 text-sm">{filteredOpportunities.length} opportunities</p>
          </div>
          {/* Mobile filter toggle */}
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

        {/* Filters — always visible on desktop, toggleable on mobile */}
        <div className={`bg-white shadow rounded-lg p-4 mb-4 sm:mb-6 ${showFilters ? 'block' : 'hidden'} md:block`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
            <div className="sm:col-span-2 lg:col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
              <input
                type="text"
                placeholder="Name, address..."
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
              <label className="block text-xs font-medium text-gray-500 mb-1">Inspection Result</label>
              <select
                value={filters.inspection_outcome}
                onChange={(e) => setFilter('inspection_outcome', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
              >
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

        <div className="bg-white shadow rounded-lg overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-500">Loading opportunities...</div>
          ) : (
            <>
              {/* Mobile cards — full card is tappable */}
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
                        {/* Name + status badge */}
                        <div className="flex items-start justify-between gap-3 mb-1">
                          <p className="font-semibold text-gray-900 text-base leading-snug">{customerName}</p>
                          <span className={`shrink-0 px-2.5 py-0.5 text-xs font-semibold rounded-full capitalize ${
                            statusColors[opportunity.status] || 'bg-gray-100 text-gray-800'
                          }`}>
                            {(opportunity.status || '—').replace(/_/g, ' ')}
                          </span>
                        </div>

                        {/* Address */}
                        <p className="text-sm text-gray-500 mb-2 truncate">{opportunity.address_text || 'No address'}</p>

                        {/* Type + inspection outcome */}
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

                        {/* Assigned rep */}
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

              {/* Desktop/tablet table */}
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
                              {opportunity.leads?.homeowner_name ||
                                opportunity.customers?.name ||
                                'N/A'}
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
