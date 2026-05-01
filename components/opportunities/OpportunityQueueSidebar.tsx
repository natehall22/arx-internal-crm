'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  DEFAULT_INSPECTION_OUTCOMES,
  sortInspectionOutcomes,
  type InspectionOutcomeConfigRow,
} from '@/lib/inspection-outcomes'
import {
  applyOpportunityListFilters,
  buildOpportunityListQuery,
  type OpportunityListFilters,
} from '@/lib/opportunity-list-filters'
import {
  getInspectionOutcomeDisplay,
  opportunityStatusColors as statusColors,
  type OpportunityListRow,
} from '@/components/opportunities/opportunity-list-shared'

type Props = {
  currentOpportunityId: string
  filters: OpportunityListFilters
}

export default function OpportunityQueueSidebar({ currentOpportunityId, filters }: Props) {
  const [opportunities, setOpportunities] = useState<OpportunityListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [inspectionOutcomeRows, setInspectionOutcomeRows] = useState<InspectionOutcomeConfigRow[]>(() =>
    sortInspectionOutcomes([...DEFAULT_INSPECTION_OUTCOMES], { includeInactive: true })
  )

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
        const response = await fetch('/api/inspections/outcomes?include_inactive=1', {
          credentials: 'same-origin',
        })
        if (!response.ok) return
        const data = await response.json()
        if (!cancelled && Array.isArray(data.outcomes)) {
          setInspectionOutcomeRows(data.outcomes)
        }
      } catch {
        /* keep defaults */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`/api/opportunities?full=true&_t=${Date.now()}`, {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data.error || 'Failed to load opportunities')
        }
        const data = await response.json()
        if (!cancelled) {
          setOpportunities(Array.isArray(data.opportunities) ? data.opportunities : [])
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load opportunities')
          setOpportunities([])
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [filters])

  const filteredOpportunities = useMemo(
    () => applyOpportunityListFilters(opportunities, filters),
    [filters, opportunities]
  )
  const currentSearch = buildOpportunityListQuery(filters, { queue: '1' })
  const activeFilterLabels = [
    filters.inspection_outcome && `Result: ${filters.inspection_outcome.replace(/_/g, ' ')}`,
    filters.status && `Status: ${filters.status.replace(/_/g, ' ')}`,
    filters.project_type && `Type: ${filters.project_type}`,
    filters.q && `Search: ${filters.q}`,
  ].filter(Boolean)

  return (
    <aside className="hidden xl:block xl:w-80 xl:shrink-0">
      <div className="sticky top-24 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-4 py-4">
          <h2 className="text-sm font-semibold text-gray-900">Opportunity Queue</h2>
          <p className="mt-1 text-xs text-gray-500">
            {loading ? 'Loading...' : `${filteredOpportunities.length} in this view`}
          </p>
          {activeFilterLabels.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {activeFilterLabels.map((label) => (
                <span key={label} className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="max-h-[calc(100vh-8rem)] overflow-y-auto">
          {error ? (
            <div className="p-4 text-sm text-red-600">{error}</div>
          ) : filteredOpportunities.length === 0 && !loading ? (
            <div className="p-4 text-sm text-gray-500">No opportunities match this view.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredOpportunities.map((opportunity) => {
                const customerName =
                  opportunity.leads?.homeowner_name || opportunity.customers?.name || 'Unknown'
                const outcomeInfo = getInspectionOutcomeDisplay(
                  opportunity.inspection_outcome,
                  outcomeLookup
                )
                const isActive = opportunity.id === currentOpportunityId

                return (
                  <Link
                    key={opportunity.id}
                    href={`/opportunities/${opportunity.id}${currentSearch ? `?${currentSearch}` : ''}`}
                    className={`block px-4 py-3 transition hover:bg-gray-50 ${
                      isActive ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-200' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-900">{customerName}</p>
                        <p className="mt-0.5 truncate text-xs text-gray-500">
                          {opportunity.address_text || 'No address'}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${
                          statusColors[opportunity.status] || 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {String(opportunity.status || '—').replace(/_/g, ' ')}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 capitalize">
                        {opportunity.project_type || '—'}
                      </span>
                      {outcomeInfo ? (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            outcomeInfo.style ? '' : outcomeInfo.color
                          }`}
                          style={outcomeInfo.style}
                        >
                          {outcomeInfo.label}
                        </span>
                      ) : (
                        <span className="rounded-full bg-yellow-50 px-2 py-0.5 text-[11px] font-medium text-yellow-700">
                          No inspection yet
                        </span>
                      )}
                    </div>

                    <p className="mt-2 text-[11px] text-gray-400">
                      {opportunity.users?.full_name || 'Unassigned'}
                    </p>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
