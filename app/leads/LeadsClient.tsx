'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClientBrowser } from '@/lib/supabase/client'

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

export default function LeadsClient({ profile, canViewInbound, campaigns, leadSources, users }: Props) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [opportunities, setOpportunities] = useState<Map<string, string>>(new Map())
  
  // Filters
  const [filterChannel, setFilterChannel] = useState<string>('')
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [filterCampaign, setFilterCampaign] = useState<string>('')
  const [filterSource, setFilterSource] = useState<string>('')
  const [filterOwner, setFilterOwner] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState<string>('')
  
  // View mode
  const [viewMode, setViewMode] = useState<'all' | 'inbound' | 'outbound'>('all')

  useEffect(() => {
    loadLeads()
  }, [filterChannel, filterStatus, filterCampaign, filterSource, filterOwner, viewMode])

  const loadLeads = async () => {
    setLoading(true)
    
    try {
      // Fetch leads via API to bypass RLS
      const response = await fetch('/api/leads')
      if (!response.ok) {
        console.error('Failed to fetch leads')
        setLeads([])
        setLoading(false)
        return
      }
      
      const { leads: allLeads } = await response.json()
      
      // Apply client-side filtering
      let filteredData = allLeads || []
      
      // Role-based filtering
      if (profile.role === 'rep' || profile.role === 'sales_rep' || profile.role === 'canvasser') {
        filteredData = filteredData.filter((lead: Lead) => lead.owner_user_id === profile.id)
      }

      // Channel filter based on permissions
      if (!canViewInbound) {
        filteredData = filteredData.filter((lead: Lead) => 
          lead.channel === 'outbound' || !lead.channel || lead.owner_user_id === profile.id
        )
      }

      // Apply view mode filter
      if (viewMode === 'inbound') {
        filteredData = filteredData.filter((lead: Lead) => lead.channel === 'inbound')
      } else if (viewMode === 'outbound') {
        filteredData = filteredData.filter((lead: Lead) => lead.channel === 'outbound' || !lead.channel)
      }

      // Apply filters
      if (filterChannel) {
        filteredData = filteredData.filter((lead: Lead) => lead.channel === filterChannel)
      }
      if (filterStatus) {
        filteredData = filteredData.filter((lead: Lead) => lead.status === filterStatus)
      }
      if (filterCampaign) {
        filteredData = filteredData.filter((lead: Lead) => lead.campaign_id === filterCampaign)
      }
      if (filterSource) {
        filteredData = filteredData.filter((lead: Lead) => lead.lead_source_id === filterSource)
      }
      if (filterOwner) {
        if (filterOwner === 'unassigned') {
          filteredData = filteredData.filter((lead: Lead) => !lead.owner_user_id)
        } else {
          filteredData = filteredData.filter((lead: Lead) => lead.owner_user_id === filterOwner)
        }
      }

      setLeads(filteredData)

      // Load opportunities via API
      const leadIds = filteredData.map((lead: Lead) => lead.id)
      if (leadIds.length > 0) {
        const oppsResponse = await fetch('/api/opportunities?lead_ids=' + leadIds.join(','))
        if (oppsResponse.ok) {
          const { opportunities: opps } = await oppsResponse.json()
          setOpportunities(new Map((opps || []).map((o: any) => [o.lead_id, o.id])))
        }
      }
    } catch (error) {
      console.error('Error loading leads:', error)
      setLeads([])
    }

    setLoading(false)
  }

  // Filter leads by search query
  const filteredLeads = leads.filter((lead) => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return (
      lead.homeowner_name?.toLowerCase().includes(query) ||
      lead.email?.toLowerCase().includes(query) ||
      lead.phone?.includes(query) ||
      lead.address_text?.toLowerCase().includes(query)
    )
  })

  // Stats
  const inboundCount = leads.filter(l => l.channel === 'inbound').length
  const outboundCount = leads.filter(l => l.channel === 'outbound' || !l.channel).length
  const unassignedCount = leads.filter(l => !l.owner_user_id).length

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Leads</h1>
          <p className="text-gray-500 mt-1">
            {filteredLeads.length} leads
            {canViewInbound && ` • ${inboundCount} inbound • ${outboundCount} outbound`}
            {unassignedCount > 0 && ` • ${unassignedCount} unassigned`}
          </p>
        </div>
        <Link
          href="/leads/new"
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 font-medium flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          New Lead
        </Link>
      </div>

      {/* View Mode Tabs (if can view inbound) */}
      {canViewInbound && (
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setViewMode('all')}
            className={`px-4 py-2 rounded-lg font-medium text-sm ${
              viewMode === 'all'
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-gray-700 border hover:bg-gray-50'
            }`}
          >
            All Leads
          </button>
          <button
            onClick={() => setViewMode('inbound')}
            className={`px-4 py-2 rounded-lg font-medium text-sm ${
              viewMode === 'inbound'
                ? 'bg-green-600 text-white'
                : 'bg-white text-gray-700 border hover:bg-gray-50'
            }`}
          >
            Inbound ({inboundCount})
          </button>
          <button
            onClick={() => setViewMode('outbound')}
            className={`px-4 py-2 rounded-lg font-medium text-sm ${
              viewMode === 'outbound'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700 border hover:bg-gray-50'
            }`}
          >
            Outbound ({outboundCount})
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border p-4 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          <div>
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
              <option value="">All statuses</option>
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
            <div>
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
            <div>
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
            <div>
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
              onClick={() => {
                setFilterChannel('')
                setFilterStatus('')
                setFilterCampaign('')
                setFilterSource('')
                setFilterOwner('')
                setSearchQuery('')
                setViewMode('all')
              }}
              className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              Clear filters
            </button>
          </div>
        </div>
      </div>

      {/* Leads Table */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading leads...</div>
        ) : filteredLeads.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No leads found
            {(filterStatus || filterCampaign || filterSource || filterOwner || searchQuery) && (
              <button
                onClick={() => {
                  setFilterChannel('')
                  setFilterStatus('')
                  setFilterCampaign('')
                  setFilterSource('')
                  setFilterOwner('')
                  setSearchQuery('')
                }}
                className="block mx-auto mt-2 text-indigo-600 hover:text-indigo-700"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Lead
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Address
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                {canViewInbound && (
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Channel
                  </th>
                )}
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Source
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Owner
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Opportunity
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredLeads.map((lead) => (
                <tr key={lead.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
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
                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-900 max-w-xs truncate">
                      {lead.address_text || 'N/A'}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full capitalize ${
                      statusColors[lead.status] || 'bg-gray-100 text-gray-800'
                    }`}>
                      {lead.status.replace('_', ' ')}
                    </span>
                  </td>
                  {canViewInbound && (
                    <td className="px-6 py-4 whitespace-nowrap">
                      {lead.channel && (
                        <span className={`px-2 py-1 text-xs font-medium rounded capitalize ${
                          channelColors[lead.channel] || 'bg-gray-100 text-gray-700'
                        }`}>
                          {lead.channel}
                        </span>
                      )}
                    </td>
                  )}
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {lead.lead_sources?.name || lead.source || '-'}
                    </div>
                    {lead.campaigns?.name && (
                      <div className="text-xs text-gray-500">{lead.campaigns.name}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {lead.users?.full_name || (
                      <span className="text-orange-600 font-medium">Unassigned</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {opportunities.has(lead.id) ? (
                      <Link
                        href={`/opportunities/${opportunities.get(lead.id)}`}
                        className="text-indigo-600 hover:text-indigo-800"
                      >
                        View
                      </Link>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <Link
                      href={`/leads/${lead.id}`}
                      className="text-indigo-600 hover:text-indigo-900"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
