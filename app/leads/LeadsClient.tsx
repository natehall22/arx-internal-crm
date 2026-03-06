'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useVirtualizer } from '@tanstack/react-virtual'

type Lead = {
  id: string
  homeowner_name: string | null
  email: string | null
  phone: string | null
  address_text: string | null
  status: string
  source: string | null
  source_type: string | null
  channel: string | null
  campaign_id: string | null
  lead_source_id: string | null
  owner_user_id: string | null
  created_at: string
  users: { full_name: string } | null
  campaigns: { name: string } | null
  lead_sources: { name: string } | null
  opportunity_id: string | null
}

type Campaign = {
  id: string
  name: string
}

type LeadSource = {
  id: string
  name: string
}

type User = {
  id: string
  full_name: string
}

type Pagination = {
  page: number
  limit: number
  total: number
  totalPages: number
  hasMore: boolean
}

type Props = {
  profile: {
    id: string
    org_id: string
    role: string
  }
  canViewInbound: boolean
  campaigns: Campaign[]
  leadSources: LeadSource[]
  users: User[]
}

const statusColors: Record<string, string> = {
  new: 'bg-blue-100 text-blue-800',
  contacted: 'bg-yellow-100 text-yellow-800',
  appointment: 'bg-purple-100 text-purple-800',
  inspection: 'bg-indigo-100 text-indigo-800',
  estimate_sent: 'bg-orange-100 text-orange-800',
  won: 'bg-green-100 text-green-800',
  lost: 'bg-red-100 text-red-800',
}

const channelColors: Record<string, string> = {
  inbound: 'bg-green-100 text-green-700',
  outbound: 'bg-blue-100 text-blue-700',
}

const ITEMS_PER_PAGE = 50

export default function LeadsClient({ profile, canViewInbound, campaigns, leadSources, users }: Props) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: ITEMS_PER_PAGE,
    total: 0,
    totalPages: 0,
    hasMore: false,
  })
  
  // Filters - these trigger API calls
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [filterCampaign, setFilterCampaign] = useState<string>('')
  const [filterSource, setFilterSource] = useState<string>('')
  const [filterOwner, setFilterOwner] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [debouncedSearch, setDebouncedSearch] = useState<string>('')
  
  // View mode
  const [viewMode, setViewMode] = useState<'all' | 'inbound' | 'outbound'>('all')

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Reset to page 1 when filters change
  useEffect(() => {
    setPagination(prev => ({ ...prev, page: 1 }))
  }, [filterStatus, filterCampaign, filterSource, filterOwner, debouncedSearch, viewMode])

  const loadLeads = useCallback(async (page: number) => {
    setLoading(true)
    
    try {
      // Build query params
      const params = new URLSearchParams()
      params.set('page', page.toString())
      params.set('limit', ITEMS_PER_PAGE.toString())
      
      if (filterStatus) params.set('status', filterStatus)
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (filterCampaign) params.set('campaign_id', filterCampaign)
      if (filterSource) params.set('source_id', filterSource)
      if (filterOwner) params.set('owner_id', filterOwner)
      
      // Channel filter based on view mode
      if (viewMode === 'inbound') {
        params.set('channel', 'inbound')
      } else if (viewMode === 'outbound') {
        params.set('channel', 'outbound')
      }

      const response = await fetch(`/api/leads?${params.toString()}`)
      if (!response.ok) {
        console.error('Failed to fetch leads')
        setLeads([])
        setLoading(false)
        return
      }
      
      const data = await response.json()
      
      // Apply client-side channel filter for permission check
      let filteredData = data.leads || []
      if (!canViewInbound) {
        filteredData = filteredData.filter((lead: Lead) => 
          lead.channel === 'outbound' || !lead.channel || lead.owner_user_id === profile.id
        )
      }

      setLeads(filteredData)
      setPagination(data.pagination || {
        page: 1,
        limit: ITEMS_PER_PAGE,
        total: filteredData.length,
        totalPages: 1,
        hasMore: false,
      })
    } catch (error) {
      console.error('Error loading leads:', error)
      setLeads([])
    }

    setLoading(false)
  }, [filterStatus, debouncedSearch, filterCampaign, filterSource, filterOwner, viewMode, canViewInbound, profile.id])

  // Load leads when page or filters change
  useEffect(() => {
    loadLeads(pagination.page)
  }, [pagination.page, loadLeads])

  const goToPage = (newPage: number) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      setPagination(prev => ({ ...prev, page: newPage }))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const clearFilters = () => {
    setFilterStatus('')
    setFilterCampaign('')
    setFilterSource('')
    setFilterOwner('')
    setSearchQuery('')
    setDebouncedSearch('')
    setViewMode('all')
  }

  const hasActiveFilters = filterStatus || filterCampaign || filterSource || filterOwner || debouncedSearch

  // Virtual scrolling for desktop table
  const parentRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: leads.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 10,
  })

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4 sm:mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Leads</h1>
          <p className="text-gray-500 text-sm sm:text-base mt-1">
            {pagination.total.toLocaleString()} total leads
            {pagination.totalPages > 1 && ` • Page ${pagination.page} of ${pagination.totalPages}`}
          </p>
        </div>
        <Link
          href="/leads/new"
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 font-medium flex items-center justify-center gap-2 text-sm sm:text-base self-start sm:self-auto"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          <span className="hidden sm:inline">New Lead</span>
          <span className="sm:hidden">Add</span>
        </Link>
      </div>

      {/* View Mode Tabs (if can view inbound) */}
      {canViewInbound && (
        <div className="flex gap-1 sm:gap-2 mb-3 sm:mb-4 overflow-x-auto pb-1">
          <button
            onClick={() => setViewMode('all')}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg font-medium text-xs sm:text-sm whitespace-nowrap ${
              viewMode === 'all'
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-gray-700 border hover:bg-gray-50'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setViewMode('inbound')}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg font-medium text-xs sm:text-sm whitespace-nowrap ${
              viewMode === 'inbound'
                ? 'bg-green-600 text-white'
                : 'bg-white text-gray-700 border hover:bg-gray-50'
            }`}
          >
            Inbound
          </button>
          <button
            onClick={() => setViewMode('outbound')}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg font-medium text-xs sm:text-sm whitespace-nowrap ${
              viewMode === 'outbound'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700 border hover:bg-gray-50'
            }`}
          >
            Outbound
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border p-3 sm:p-4 mb-4 sm:mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-4">
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Name, email, phone..."
              className="w-full px-3 py-2 border rounded-lg text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm bg-white"
            >
              <option value="">All</option>
              <option value="new">New</option>
              <option value="contacted">Contacted</option>
              <option value="appointment">Appointment</option>
              <option value="inspection">Inspection</option>
              <option value="estimate_sent">Estimate Sent</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
            </select>
          </div>

          {canViewInbound && campaigns.length > 0 && (
            <div className="hidden sm:block">
              <label className="block text-xs font-medium text-gray-500 mb-1">Campaign</label>
              <select
                value={filterCampaign}
                onChange={(e) => setFilterCampaign(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm bg-white"
              >
                <option value="">All campaigns</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {canViewInbound && leadSources.length > 0 && (
            <div className="hidden lg:block">
              <label className="block text-xs font-medium text-gray-500 mb-1">Source</label>
              <select
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm bg-white"
              >
                <option value="">All sources</option>
                {leadSources.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}

          {users.length > 0 && (
            <div className="hidden lg:block">
              <label className="block text-xs font-medium text-gray-500 mb-1">Owner</label>
              <select
                value={filterOwner}
                onChange={(e) => setFilterOwner(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm bg-white"
              >
                <option value="">All owners</option>
                <option value="unassigned">Unassigned</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-end">
            <button
              onClick={clearFilters}
              className="px-3 py-2 text-xs sm:text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      {/* Leads - Mobile Card View */}
      <div className="sm:hidden space-y-3">
        {loading ? (
          <div className="p-8 text-center text-gray-500 bg-white rounded-lg">Loading leads...</div>
        ) : leads.length === 0 ? (
          <div className="p-8 text-center text-gray-500 bg-white rounded-lg">
            No leads found
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="block mx-auto mt-2 text-indigo-600 hover:text-indigo-700"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
            {leads.map((lead) => (
              <Link
                key={lead.id}
                href={`/leads/${lead.id}`}
                className="block bg-white rounded-lg shadow-sm border p-3 hover:border-indigo-300"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900 truncate">
                      {lead.homeowner_name || 'N/A'}
                    </p>
                    <p className="text-sm text-gray-500 truncate">
                      {lead.phone || lead.email || 'No contact'}
                    </p>
                  </div>
                  <span className={`ml-2 px-2 py-1 text-xs font-semibold rounded-full capitalize flex-shrink-0 ${
                    statusColors[lead.status] || 'bg-gray-100 text-gray-800'
                  }`}>
                    {lead.status.replace('_', ' ')}
                  </span>
                </div>
                <p className="text-sm text-gray-600 truncate mb-2">
                  {lead.address_text || 'No address'}
                </p>
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>{lead.users?.full_name || <span className="text-orange-600">Unassigned</span>}</span>
                  {canViewInbound && lead.channel && (
                    <span className={`px-2 py-0.5 rounded ${channelColors[lead.channel] || 'bg-gray-100'}`}>
                      {lead.channel}
                    </span>
                  )}
                </div>
              </Link>
            ))}
            
            {/* Mobile Pagination */}
            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-between bg-white rounded-lg shadow-sm border p-3">
                <button
                  onClick={() => goToPage(pagination.page - 1)}
                  disabled={pagination.page === 1}
                  className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="text-sm text-gray-600">
                  {pagination.page} / {pagination.totalPages}
                </span>
                <button
                  onClick={() => goToPage(pagination.page + 1)}
                  disabled={!pagination.hasMore}
                  className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Leads Table - Desktop with Virtual Scrolling */}
      <div className="hidden sm:block bg-white shadow rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading leads...</div>
        ) : leads.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No leads found
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="block mx-auto mt-2 text-indigo-600 hover:text-indigo-700"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
            <div 
              ref={parentRef}
              className="overflow-auto"
              style={{ maxHeight: 'calc(100vh - 400px)', minHeight: '400px' }}
            >
              <table className="w-full divide-y divide-gray-200">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                      Lead
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                      Address
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                      Status
                    </th>
                    {canViewInbound && (
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                        Channel
                      </th>
                    )}
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                      Source
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                      Owner
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                      Opportunity
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const lead = leads[virtualRow.index]
                    return (
                      <tr 
                        key={lead.id} 
                        className="hover:bg-gray-50"
                        style={{
                          height: `${virtualRow.size}px`,
                        }}
                      >
                        <td className="px-4 py-4 whitespace-nowrap">
                          <Link
                            href={`/leads/${lead.id}`}
                            className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
                          >
                            {lead.homeowner_name || 'N/A'}
                          </Link>
                          <div className="text-sm text-gray-500">
                            {lead.phone || lead.email || 'No contact'}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="text-sm text-gray-900 max-w-[200px] truncate" title={lead.address_text || ''}>
                            {lead.address_text || 'N/A'}
                          </div>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full capitalize ${
                            statusColors[lead.status] || 'bg-gray-100 text-gray-800'
                          }`}>
                            {lead.status.replace('_', ' ')}
                          </span>
                        </td>
                        {canViewInbound && (
                          <td className="px-4 py-4 whitespace-nowrap">
                            {lead.channel && (
                              <span className={`px-2 py-1 text-xs font-medium rounded capitalize ${
                                channelColors[lead.channel] || 'bg-gray-100 text-gray-700'
                              }`}>
                                {lead.channel}
                              </span>
                            )}
                          </td>
                        )}
                        <td className="px-4 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">
                            {lead.lead_sources?.name || lead.source || '-'}
                          </div>
                          {lead.campaigns?.name && (
                            <div className="text-xs text-gray-500">{lead.campaigns.name}</div>
                          )}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                          {lead.users?.full_name || (
                            <span className="text-orange-600 font-medium">Unassigned</span>
                          )}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm">
                          {lead.opportunity_id ? (
                            <Link
                              href={`/opportunities/${lead.opportunity_id}`}
                              className="text-indigo-600 hover:text-indigo-800"
                            >
                              Open
                            </Link>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm font-medium">
                          <Link
                            href={`/leads/${lead.id}`}
                            className="text-indigo-600 hover:text-indigo-900"
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Desktop Pagination */}
            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-t">
                <div className="text-sm text-gray-700">
                  Showing <span className="font-medium">{((pagination.page - 1) * pagination.limit) + 1}</span> to{' '}
                  <span className="font-medium">{Math.min(pagination.page * pagination.limit, pagination.total)}</span> of{' '}
                  <span className="font-medium">{pagination.total.toLocaleString()}</span> leads
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => goToPage(1)}
                    disabled={pagination.page === 1}
                    className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    First
                  </button>
                  <button
                    onClick={() => goToPage(pagination.page - 1)}
                    disabled={pagination.page === 1}
                    className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  
                  {/* Page numbers */}
                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                      let pageNum: number
                      if (pagination.totalPages <= 5) {
                        pageNum = i + 1
                      } else if (pagination.page <= 3) {
                        pageNum = i + 1
                      } else if (pagination.page >= pagination.totalPages - 2) {
                        pageNum = pagination.totalPages - 4 + i
                      } else {
                        pageNum = pagination.page - 2 + i
                      }
                      
                      return (
                        <button
                          key={pageNum}
                          onClick={() => goToPage(pageNum)}
                          className={`px-3 py-1.5 text-sm font-medium rounded-lg ${
                            pagination.page === pageNum
                              ? 'bg-indigo-600 text-white'
                              : 'text-gray-700 bg-white border hover:bg-gray-50'
                          }`}
                        >
                          {pageNum}
                        </button>
                      )
                    })}
                  </div>

                  <button
                    onClick={() => goToPage(pagination.page + 1)}
                    disabled={!pagination.hasMore}
                    className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                  <button
                    onClick={() => goToPage(pagination.totalPages)}
                    disabled={pagination.page === pagination.totalPages}
                    className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Last
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
