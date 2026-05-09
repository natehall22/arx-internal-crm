'use client'

import { useEffect, useState } from 'react'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { createClientBrowser } from '@/lib/supabase/client'

type Campaign = {
  id: string
  name: string
  description: string | null
  source_type: string
  channel: string
  budget: number | null
  spent: number | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  google_campaign_id: string | null
  facebook_campaign_id: string | null
  is_active: boolean
  start_date: string | null
  end_date: string | null
  total_leads: number
  total_appointments: number
  total_sales: number
  total_revenue: number
  cost_per_lead: number | null
  created_at: string
}

type LeadSource = {
  id: string
  name: string
  source_type: string
  webhook_token: string
  webhook_enabled: boolean
  default_campaign_id: string | null
  auto_assign_user_id: string | null
  is_active: boolean
  total_leads_received: number
  last_lead_at: string | null
  campaigns: { id: string; name: string } | null
  auto_assign_user: { id: string; full_name: string; email: string } | null
}

type User = {
  id: string
  full_name: string
  email: string
}

const sourceTypes = [
  { value: 'website', label: 'Website' },
  { value: 'google_ads', label: 'Google Ads' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'bing_ads', label: 'Bing Ads' },
  { value: 'referral', label: 'Referral' },
  { value: 'canvass', label: 'Canvass' },
  { value: 'door_knock', label: 'Door Knock' },
  { value: 'phone_call', label: 'Phone Call' },
  { value: 'walk_in', label: 'Walk-In' },
  { value: 'home_show', label: 'Home Show' },
  { value: 'partner', label: 'Partner' },
  { value: 'other', label: 'Other' },
]

const channelTypes = [
  { value: 'inbound', label: 'Inbound' },
  { value: 'outbound', label: 'Outbound' },
]

export default function CampaignsPage() {
  const [activeTab, setActiveTab] = useState<'campaigns' | 'sources'>('campaigns')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [leadSources, setLeadSources] = useState<LeadSource[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  
  // Campaign modal state
  const [showCampaignModal, setShowCampaignModal] = useState(false)
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null)
  const [campaignForm, setCampaignForm] = useState({
    name: '',
    description: '',
    source_type: 'website',
    channel: 'inbound',
    budget: '',
    utm_source: '',
    utm_medium: '',
    utm_campaign: '',
    google_campaign_id: '',
    facebook_campaign_id: '',
    start_date: '',
    end_date: '',
  })
  
  // Lead source modal state
  const [showSourceModal, setShowSourceModal] = useState(false)
  const [editingSource, setEditingSource] = useState<LeadSource | null>(null)
  const [sourceForm, setSourceForm] = useState({
    name: '',
    source_type: 'website',
    default_campaign_id: '',
    auto_assign_user_id: '',
  })
  
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const supabase = createClientBrowser()

      const [campaignsRes, sourcesRes] = await Promise.all([
        fetch('/api/campaigns'),
        fetch('/api/lead-sources'),
      ])

      const campaignsJson = campaignsRes.ok ? await campaignsRes.json() : { campaigns: [] }
      const sourcesJson = sourcesRes.ok ? await sourcesRes.json() : { leadSources: [] }

      setCampaigns(campaignsJson.campaigns || [])
      setLeadSources(sourcesJson.leadSources || [])

      // User options are helpful for assignment, but they should not block the campaign list.
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: profile } = await supabase
          .from('users')
          .select('org_id')
          .eq('id', user.id)
          .single()

        if (profile?.org_id) {
          const { data: userRows } = await supabase
            .from('users')
            .select('id, full_name, email')
            .eq('org_id', profile.org_id)
            .eq('active', true)
            .order('full_name')

          setUsers(userRows || [])
        }
      }
    } catch (err) {
      console.error('Error loading campaigns data:', err)
    } finally {
      setLoading(false)
    }
  }

  // Campaign functions
  const openCampaignModal = (campaign?: Campaign) => {
    if (campaign) {
      setEditingCampaign(campaign)
      setCampaignForm({
        name: campaign.name,
        description: campaign.description || '',
        source_type: campaign.source_type,
        channel: campaign.channel,
        budget: campaign.budget?.toString() || '',
        utm_source: campaign.utm_source || '',
        utm_medium: campaign.utm_medium || '',
        utm_campaign: campaign.utm_campaign || '',
        google_campaign_id: campaign.google_campaign_id || '',
        facebook_campaign_id: campaign.facebook_campaign_id || '',
        start_date: campaign.start_date || '',
        end_date: campaign.end_date || '',
      })
    } else {
      setEditingCampaign(null)
      setCampaignForm({
        name: '',
        description: '',
        source_type: 'website',
        channel: 'inbound',
        budget: '',
        utm_source: '',
        utm_medium: '',
        utm_campaign: '',
        google_campaign_id: '',
        facebook_campaign_id: '',
        start_date: '',
        end_date: '',
      })
    }
    setError(null)
    setShowCampaignModal(true)
  }

  const saveCampaign = async () => {
    if (!campaignForm.name.trim()) {
      setError('Name is required')
      return
    }

    setSaving(true)
    setError(null)

    const payload = {
      id: editingCampaign?.id,
      name: campaignForm.name.trim(),
      description: campaignForm.description.trim() || null,
      source_type: campaignForm.source_type,
      channel: campaignForm.channel,
      budget: campaignForm.budget ? parseFloat(campaignForm.budget) : null,
      utm_source: campaignForm.utm_source || null,
      utm_medium: campaignForm.utm_medium || null,
      utm_campaign: campaignForm.utm_campaign || null,
      google_campaign_id: campaignForm.google_campaign_id || null,
      facebook_campaign_id: campaignForm.facebook_campaign_id || null,
      start_date: campaignForm.start_date || null,
      end_date: campaignForm.end_date || null,
    }

    const response = await fetch('/api/campaigns', {
      method: editingCampaign ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const result = await response.json()

    if (!response.ok) {
      setError(result.error || 'Failed to save campaign')
      setSaving(false)
      return
    }

    setShowCampaignModal(false)
    await loadData()
    setSaving(false)
  }

  const deleteCampaign = async (campaign: Campaign) => {
    if (!confirm(`Delete "${campaign.name}"? This cannot be undone.`)) return

    const response = await fetch(`/api/campaigns?id=${campaign.id}`, {
      method: 'DELETE',
    })

    if (response.ok) {
      await loadData()
    } else {
      const result = await response.json()
      alert(result.error || 'Failed to delete campaign')
    }
  }

  const toggleCampaignActive = async (campaign: Campaign) => {
    const response = await fetch('/api/campaigns', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: campaign.id, is_active: !campaign.is_active }),
    })

    if (response.ok) {
      await loadData()
    }
  }

  // Lead source functions
  const openSourceModal = (source?: LeadSource) => {
    if (source) {
      setEditingSource(source)
      setSourceForm({
        name: source.name,
        source_type: source.source_type,
        default_campaign_id: source.default_campaign_id || '',
        auto_assign_user_id: source.auto_assign_user_id || '',
      })
    } else {
      setEditingSource(null)
      setSourceForm({
        name: '',
        source_type: 'website',
        default_campaign_id: '',
        auto_assign_user_id: '',
      })
    }
    setError(null)
    setShowSourceModal(true)
  }

  const saveSource = async () => {
    if (!sourceForm.name.trim()) {
      setError('Name is required')
      return
    }

    setSaving(true)
    setError(null)

    const payload = {
      id: editingSource?.id,
      name: sourceForm.name.trim(),
      source_type: sourceForm.source_type,
      default_campaign_id: sourceForm.default_campaign_id || null,
      auto_assign_user_id: sourceForm.auto_assign_user_id || null,
    }

    const response = await fetch('/api/lead-sources', {
      method: editingSource ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const result = await response.json()

    if (!response.ok) {
      setError(result.error || 'Failed to save lead source')
      setSaving(false)
      return
    }

    setShowSourceModal(false)
    await loadData()
    setSaving(false)
  }

  const deleteSource = async (source: LeadSource) => {
    if (!confirm(`Delete "${source.name}"? This cannot be undone.`)) return

    const response = await fetch(`/api/lead-sources?id=${source.id}`, {
      method: 'DELETE',
    })

    if (response.ok) {
      await loadData()
    } else {
      const result = await response.json()
      alert(result.error || 'Failed to delete lead source')
    }
  }

  const toggleSourceActive = async (source: LeadSource) => {
    const response = await fetch('/api/lead-sources', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: source.id, is_active: !source.is_active }),
    })

    if (response.ok) {
      await loadData()
    }
  }

  const regenerateToken = async (source: LeadSource) => {
    if (!confirm('Regenerate webhook token? The old token will stop working immediately.')) return

    const supabase = createClientBrowser()
    
    // Generate new token
    const newToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    const { error } = await supabase
      .from('lead_sources')
      .update({ webhook_token: newToken })
      .eq('id', source.id)

    if (!error) {
      await loadData()
    }
  }

  const copyWebhookUrl = (source: LeadSource) => {
    const url = `${window.location.origin}/api/webhooks/leads?token=${source.webhook_token}`
    navigator.clipboard.writeText(url)
    alert('Webhook URL copied to clipboard!')
  }

  const formatCurrency = (value: number | null) => {
    if (value === null) return '-'
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
  }

  const formatDate = (date: string | null) => {
    if (!date) return '-'
    return new Date(date).toLocaleDateString()
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
              <Link href="/admin" className="hover:text-indigo-600">Admin</Link>
              <span>/</span>
              <span>Campaigns & Lead Sources</span>
            </div>
            <h1 className="text-3xl font-bold text-gray-900">Campaigns & Lead Sources</h1>
            <p className="mt-1 text-gray-600">Track marketing campaigns and configure inbound lead sources</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('campaigns')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'campaigns'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Campaigns ({campaigns.length})
            </button>
            <button
              onClick={() => setActiveTab('sources')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'sources'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Lead Sources ({leadSources.length})
            </button>
          </nav>
        </div>

        {loading ? (
          <div className="bg-white rounded-xl shadow-sm border p-8 text-center text-gray-500">
            Loading...
          </div>
        ) : activeTab === 'campaigns' ? (
          /* Campaigns Tab */
          <div>
            <div className="flex justify-end mb-4">
              <button
                onClick={() => openCampaignModal()}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                New Campaign
              </button>
            </div>

            {campaigns.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm border p-8 text-center">
                <p className="text-gray-500 mb-4">No campaigns yet</p>
                <button
                  onClick={() => openCampaignModal()}
                  className="text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  Create your first campaign →
                </button>
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Campaign</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Leads</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Budget</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">CPL</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {campaigns.map((campaign) => (
                      <tr key={campaign.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <div className="font-medium text-gray-900">{campaign.name}</div>
                          {campaign.description && (
                            <div className="text-sm text-gray-500 truncate max-w-xs">{campaign.description}</div>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded capitalize">
                            {campaign.source_type.replace('_', ' ')}
                          </span>
                          <span className={`ml-2 px-2 py-1 text-xs rounded ${
                            campaign.channel === 'inbound' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                          }`}>
                            {campaign.channel}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">
                          {campaign.total_leads}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">
                          {formatCurrency(campaign.budget)}
                          {campaign.spent && campaign.spent > 0 && (
                            <div className="text-xs text-gray-500">
                              Spent: {formatCurrency(campaign.spent)}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">
                          {formatCurrency(campaign.cost_per_lead)}
                        </td>
                        <td className="px-6 py-4">
                          <button
                            onClick={() => toggleCampaignActive(campaign)}
                            className={`px-2 py-1 text-xs rounded font-medium ${
                              campaign.is_active
                                ? 'bg-green-100 text-green-700'
                                : 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {campaign.is_active ? 'Active' : 'Inactive'}
                          </button>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => openCampaignModal(campaign)}
                            className="text-indigo-600 hover:text-indigo-900 text-sm font-medium mr-3"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteCampaign(campaign)}
                            className="text-red-600 hover:text-red-900 text-sm font-medium"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          /* Lead Sources Tab */
          <div>
            <div className="flex justify-between items-start mb-4">
              <div className="p-4 bg-blue-50 rounded-lg border border-blue-200 flex-1 mr-4">
                <p className="text-sm text-blue-800">
                  <strong>Lead Sources</strong> are webhook endpoints that receive leads from external systems.
                  Each source has a unique URL that you can configure in your website forms, Google Ads, Facebook Lead Ads, etc.
                </p>
              </div>
              <button
                onClick={() => openSourceModal()}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium flex items-center gap-2 whitespace-nowrap"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                New Lead Source
              </button>
            </div>

            {leadSources.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm border p-8 text-center">
                <p className="text-gray-500 mb-4">No lead sources configured yet</p>
                <button
                  onClick={() => openSourceModal()}
                  className="text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  Create your first lead source →
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {leadSources.map((source) => (
                  <div key={source.id} className="bg-white rounded-xl shadow-sm border p-6">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-3">
                          <h3 className="font-semibold text-gray-900">{source.name}</h3>
                          <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded capitalize">
                            {source.source_type.replace('_', ' ')}
                          </span>
                          <span className={`px-2 py-1 text-xs rounded font-medium ${
                            source.is_active
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-100 text-gray-500'
                          }`}>
                            {source.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <div className="mt-2 text-sm text-gray-500">
                          {source.total_leads_received} leads received
                          {source.last_lead_at && (
                            <span> • Last lead: {formatDate(source.last_lead_at)}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleSourceActive(source)}
                          className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded"
                        >
                          {source.is_active ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          onClick={() => openSourceModal(source)}
                          className="px-3 py-1.5 text-sm text-indigo-600 hover:bg-indigo-50 rounded"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteSource(source)}
                          className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    {/* Webhook URL */}
                    <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-medium text-gray-500 uppercase mb-1">Webhook URL</p>
                          <code className="text-sm text-gray-700 break-all">
                            {typeof window !== 'undefined' && `${window.location.origin}/api/webhooks/leads?token=${source.webhook_token}`}
                          </code>
                        </div>
                        <div className="flex items-center gap-2 ml-4">
                          <button
                            onClick={() => copyWebhookUrl(source)}
                            className="px-3 py-1.5 text-sm bg-white border rounded hover:bg-gray-50"
                          >
                            Copy
                          </button>
                          <button
                            onClick={() => regenerateToken(source)}
                            className="px-3 py-1.5 text-sm text-orange-600 bg-white border rounded hover:bg-orange-50"
                          >
                            Regenerate
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Configuration summary */}
                    <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-gray-500">Default Campaign</p>
                        <p className="font-medium">{source.campaigns?.name || 'None'}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">Auto-Assign To</p>
                        <p className="font-medium">
                          {source.auto_assign_user?.full_name || 'Queue'}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-500">Webhook</p>
                        <p className="font-medium">{source.webhook_enabled ? 'Enabled' : 'Disabled'}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Campaign Modal */}
        {showCampaignModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="px-6 py-4 border-b flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900">
                  {editingCampaign ? 'Edit Campaign' : 'New Campaign'}
                </h2>
                <button
                  onClick={() => setShowCampaignModal(false)}
                  className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="p-6 space-y-4">
                {error && (
                  <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                    <input
                      type="text"
                      value={campaignForm.name}
                      onChange={(e) => setCampaignForm({ ...campaignForm, name: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500"
                      placeholder="Spring 2024 Google Ads"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                    <textarea
                      value={campaignForm.description}
                      onChange={(e) => setCampaignForm({ ...campaignForm, description: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500"
                      rows={2}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Source Type</label>
                    <select
                      value={campaignForm.source_type}
                      onChange={(e) => setCampaignForm({ ...campaignForm, source_type: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white"
                    >
                      {sourceTypes.map((type) => (
                        <option key={type.value} value={type.value}>{type.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Channel</label>
                    <select
                      value={campaignForm.channel}
                      onChange={(e) => setCampaignForm({ ...campaignForm, channel: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white"
                    >
                      {channelTypes.map((type) => (
                        <option key={type.value} value={type.value}>{type.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Budget</label>
                    <input
                      type="number"
                      value={campaignForm.budget}
                      onChange={(e) => setCampaignForm({ ...campaignForm, budget: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500"
                      placeholder="5000"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                    <input
                      type="date"
                      value={campaignForm.start_date}
                      onChange={(e) => setCampaignForm({ ...campaignForm, start_date: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                {/* UTM Parameters */}
                <div className="border-t pt-4">
                  <h3 className="text-sm font-medium text-gray-900 mb-3">UTM Parameters</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">utm_source</label>
                      <input
                        type="text"
                        value={campaignForm.utm_source}
                        onChange={(e) => setCampaignForm({ ...campaignForm, utm_source: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                        placeholder="google"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">utm_medium</label>
                      <input
                        type="text"
                        value={campaignForm.utm_medium}
                        onChange={(e) => setCampaignForm({ ...campaignForm, utm_medium: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                        placeholder="cpc"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">utm_campaign</label>
                      <input
                        type="text"
                        value={campaignForm.utm_campaign}
                        onChange={(e) => setCampaignForm({ ...campaignForm, utm_campaign: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                        placeholder="spring_sale"
                      />
                    </div>
                  </div>
                </div>

                {/* External IDs */}
                <div className="border-t pt-4">
                  <h3 className="text-sm font-medium text-gray-900 mb-3">External Campaign IDs</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Google Ads Campaign ID</label>
                      <input
                        type="text"
                        value={campaignForm.google_campaign_id}
                        onChange={(e) => setCampaignForm({ ...campaignForm, google_campaign_id: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Facebook Campaign ID</label>
                      <input
                        type="text"
                        value={campaignForm.facebook_campaign_id}
                        onChange={(e) => setCampaignForm({ ...campaignForm, facebook_campaign_id: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 border-t bg-gray-50 flex justify-end gap-3">
                <button
                  onClick={() => setShowCampaignModal(false)}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={saveCampaign}
                  disabled={saving}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingCampaign ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Lead Source Modal */}
        {showSourceModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
              <div className="px-6 py-4 border-b flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900">
                  {editingSource ? 'Edit Lead Source' : 'New Lead Source'}
                </h2>
                <button
                  onClick={() => setShowSourceModal(false)}
                  className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="p-6 space-y-4">
                {error && (
                  <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                  <input
                    type="text"
                    value={sourceForm.name}
                    onChange={(e) => setSourceForm({ ...sourceForm, name: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500"
                    placeholder="Website Contact Form"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Source Type</label>
                  <select
                    value={sourceForm.source_type}
                    onChange={(e) => setSourceForm({ ...sourceForm, source_type: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white"
                  >
                    {sourceTypes.map((type) => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Default Campaign</label>
                  <select
                    value={sourceForm.default_campaign_id}
                    onChange={(e) => setSourceForm({ ...sourceForm, default_campaign_id: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white"
                  >
                    <option value="">No default campaign</option>
                    {campaigns.filter(c => c.is_active).map((campaign) => (
                      <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
                    ))}
                  </select>
                </div>

                <div className="border-t pt-4">
                  <h3 className="text-sm font-medium text-gray-900 mb-3">Lead Assignment</h3>
                  
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm text-gray-700 mb-1">Auto-assign to User</label>
                      <select
                        value={sourceForm.auto_assign_user_id}
                        onChange={(e) => setSourceForm({ ...sourceForm, auto_assign_user_id: e.target.value })}
                        className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white"
                      >
                        <option value="">Don't auto-assign</option>
                        {users.map((user) => (
                          <option key={user.id} value={user.id}>{user.full_name}</option>
                        ))}
                      </select>
                    </div>

                  </div>
                </div>
              </div>

              <div className="px-6 py-4 border-t bg-gray-50 flex justify-end gap-3">
                <button
                  onClick={() => setShowSourceModal(false)}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={saveSource}
                  disabled={saving}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingSource ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
