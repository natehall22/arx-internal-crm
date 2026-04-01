'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import Nav from '@/components/Nav'
import Link from 'next/link'
import {
  DEFAULT_INSPECTION_OUTCOMES,
  sortInspectionOutcomes,
  type InspectionOutcomeConfigRow,
} from '@/lib/inspection-outcomes'

type Opportunity = {
  id: string
  lead_id: string | null
  customer_id: string | null
  owner_user_id: string | null
  address_text: string | null
  project_type: string
  status: string
  created_at: string
  customers: { name: string } | null
  leads: { homeowner_name: string } | null
  users: { full_name: string } | null
  inspection_outcome: string | null
  inspection_notes: string | null
  inspection_date: string | null
}

const inspectionOutcomeLabels: Record<string, { label: string; color: string }> = {
  sale: { label: 'Sale', color: 'bg-green-100 text-green-800' },
  moving_to_close: { label: 'Moving to Close', color: 'bg-emerald-100 text-emerald-800' },
  insurance_follow_up: { label: 'Insurance Follow Up', color: 'bg-cyan-100 text-cyan-800' },
  not_home: { label: 'Not Home', color: 'bg-yellow-100 text-yellow-800' },
  said_no: { label: 'Said No', color: 'bg-red-100 text-red-800' },
  needs_repair: { label: 'Needs Repair', color: 'bg-orange-100 text-orange-800' },
  rescheduled: { label: 'Rescheduled', color: 'bg-purple-100 text-purple-800' },
  no_problems_found: { label: 'No Problems Found', color: 'bg-gray-100 text-gray-800' },
  failed_credit: { label: 'Failed Credit', color: 'bg-rose-100 text-rose-800' },
}

type OutcomeBadge = { label: string; color: string; style?: CSSProperties }

function getInspectionOutcomeDisplay(
  outcome: string | null | undefined,
  lookup: Map<string, InspectionOutcomeConfigRow>
): OutcomeBadge | null {
  if (!outcome) return null
  const row = lookup.get(outcome) || lookup.get(outcome.toLowerCase())
  if (row) {
    if (row.color?.startsWith('#')) {
      return {
        label: row.label,
        color: '',
        style: {
          backgroundColor: `${row.color}26`,
          color: '#111827',
        },
      }
    }
    return { label: row.label, color: 'bg-gray-100 text-gray-800' }
  }
  const known = inspectionOutcomeLabels[outcome]
  if (known) return { label: known.label, color: known.color }
  const words = outcome.replace(/_/g, ' ')
  const label = words.replace(/\b\w/g, (c) => c.toUpperCase())
  return { label, color: 'bg-gray-100 text-gray-800' }
}

export default function OpportunitiesPage() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Filters
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterInspectionOutcome, setFilterInspectionOutcome] = useState('')
  const [filterProjectType, setFilterProjectType] = useState('')
  const [inspectionOutcomeRows, setInspectionOutcomeRows] = useState<InspectionOutcomeConfigRow[]>(() =>
    sortInspectionOutcomes([...DEFAULT_INSPECTION_OUTCOMES], { includeInactive: true })
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
  }, [filterInspectionOutcome])

  const loadOpportunities = async () => {
    setLoading(true)
    setError(null)
    
    try {
      let url = '/api/opportunities?full=true'
      if (filterInspectionOutcome) {
        url += `&inspection_outcome=${encodeURIComponent(filterInspectionOutcome)}`
      }
      
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

  // Client-side filtering for status, project type, and search
  const filteredOpportunities = opportunities.filter(opp => {
    // Status filter - compare lowercase to handle case differences
    if (filterStatus && opp.status?.toLowerCase() !== filterStatus.toLowerCase()) return false
    // Project type filter - compare lowercase
    if (filterProjectType && opp.project_type?.toLowerCase() !== filterProjectType.toLowerCase()) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      const name = opp.leads?.homeowner_name || opp.customers?.name || ''
      const address = opp.address_text || ''
      if (!name.toLowerCase().includes(q) && !address.toLowerCase().includes(q)) {
        return false
      }
    }
    return true
  })

  const statusColors: Record<string, string> = {
    open: 'bg-blue-100 text-blue-800',
    in_progress: 'bg-purple-100 text-purple-800',
    negotiation: 'bg-orange-100 text-orange-800',
    won: 'bg-green-100 text-green-800',
    lost: 'bg-red-100 text-red-800',
  }

  const clearFilters = () => {
    setSearchQuery('')
    setFilterStatus('')
    setFilterInspectionOutcome('')
    setFilterProjectType('')
  }

  const hasActiveFilters = searchQuery || filterStatus || filterInspectionOutcome || filterProjectType

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Opportunities</h1>
            <p className="text-gray-500 mt-1">{filteredOpportunities.length} opportunities</p>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white shadow rounded-lg p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
              <input
                type="text"
                placeholder="Name, address..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Inspection Result</label>
              <select
                value={filterInspectionOutcome}
                onChange={(e) => setFilterInspectionOutcome(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="">All Results</option>
                <option value="none">No Inspection Yet</option>
                {filterInspectionOutcome &&
                  filterInspectionOutcome !== 'none' &&
                  !inspectionOutcomeRows.some((o) => o.id === filterInspectionOutcome) && (
                    <option value={filterInspectionOutcome}>
                      {filterInspectionOutcome.replace(/_/g, ' ')} (legacy)
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Project Type</label>
              <select
                value={filterProjectType}
                onChange={(e) => setFilterProjectType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
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
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-md hover:bg-gray-50"
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
              {/* Mobile cards */}
              <div className="md:hidden divide-y divide-gray-200">
                {filteredOpportunities.length > 0 ? (
                  filteredOpportunities.map((opportunity) => {
                    const outcomeInfo = getInspectionOutcomeDisplay(
                      opportunity.inspection_outcome,
                      outcomeLookup
                    )
                    return (
                      <div key={opportunity.id} className="p-4">
                        <div className="text-sm font-semibold text-gray-900">
                          {opportunity.leads?.homeowner_name || opportunity.customers?.name || 'N/A'}
                        </div>
                        <div className="text-sm text-gray-600 mt-1 break-words">{opportunity.address_text || 'N/A'}</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800 capitalize">
                            {opportunity.project_type}
                          </span>
                          <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full capitalize ${
                            statusColors[opportunity.status] || 'bg-gray-100 text-gray-800'
                          }`}>
                            {opportunity.status.replace(/_/g, ' ')}
                          </span>
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
                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-600">
                              No Inspection
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-2">Assigned: {opportunity.users?.full_name || 'Unassigned'}</div>
                        <div className="mt-3">
                          <Link
                            href={`/opportunities/${opportunity.id}`}
                            className="inline-flex min-h-[40px] items-center px-3 py-2 rounded-lg border border-indigo-200 text-indigo-700 hover:bg-indigo-50 text-sm font-medium"
                          >
                            View
                          </Link>
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <div className="px-6 py-8 text-center text-gray-500">
                    {hasActiveFilters ? 'No opportunities match your filters' : 'No opportunities found'}
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
                              {opportunity.status.replace(/_/g, ' ')}
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
                              href={`/opportunities/${opportunity.id}`}
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
