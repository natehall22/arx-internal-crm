'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'

interface Integration {
  id: string
  provider: string
  is_enabled: boolean
  api_key: string | null
  settings: any
}

const integrationProviders = [
  {
    id: 'eagleview',
    name: 'EagleView',
    description: 'Aerial roof measurements and reports',
    logo: '🦅',
    category: 'Roofing',
    features: ['Roof measurements', 'Aerial imagery', 'Detailed reports', 'Pitch detection'],
    setupUrl: 'https://www.eagleview.com/partners',
  },
  {
    id: 'roofr',
    name: 'Roofr',
    description: 'Instant roof measurements and proposals',
    logo: '🏠',
    category: 'Roofing',
    features: ['Instant measurements', 'Proposal generation', 'Material calculator'],
    setupUrl: 'https://www.roofr.com/integrations',
  },
  {
    id: 'solo',
    name: 'Solo',
    description: 'Solar design and proposal software',
    logo: '☀️',
    category: 'Solar',
    features: ['Solar design', 'Shade analysis', 'Production estimates', 'Financing'],
    setupUrl: 'https://www.solo.io',
  },
  {
    id: 'aurora',
    name: 'Aurora Solar',
    description: 'Solar design and sales platform',
    logo: '🌅',
    category: 'Solar',
    features: ['3D design', 'Shade analysis', 'Proposals', 'Permitting'],
    setupUrl: 'https://www.aurorasolar.com/integrations',
  },
  {
    id: 'gaf_quickmeasure',
    name: 'GAF QuickMeasure',
    description: 'Roof measurement reports',
    logo: '📐',
    category: 'Roofing',
    features: ['Roof reports', 'Material estimates', 'GAF integration'],
    setupUrl: 'https://www.gaf.com/quickmeasure',
  },
  {
    id: 'hover',
    name: 'HOVER',
    description: '3D property models from photos',
    logo: '📱',
    category: 'General',
    features: ['3D models', 'Measurements', 'Visualizations', 'Estimates'],
    setupUrl: 'https://hover.to/integrations',
  },
  {
    id: 'nearmap',
    name: 'Nearmap',
    description: 'High-resolution aerial imagery',
    logo: '🛰️',
    category: 'Imagery',
    features: ['Aerial imagery', 'AI insights', 'Roof measurements', 'Change detection'],
    setupUrl: 'https://www.nearmap.com/integrations',
  },
  {
    id: 'google_solar',
    name: 'Google Solar API',
    description: 'Solar potential data from Google',
    logo: '🌐',
    category: 'Solar',
    features: ['Solar potential', 'Roof data', 'Shade analysis', 'Free tier available'],
    setupUrl: 'https://developers.google.com/maps/documentation/solar',
  },
]

export default function AdminIntegrationsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [orgId, setOrgId] = useState<string>('')
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [formData, setFormData] = useState({
    api_key: '',
    api_secret: '',
    client_id: '',
  })

  useEffect(() => {
    loadIntegrations()
  }, [])

  const loadIntegrations = async () => {
    try {
      const response = await fetch('/api/admin/integrations')
      
      if (response.status === 401) {
        router.push('/login')
        return
      }
      
      if (response.status === 403) {
        router.push('/dashboard')
        return
      }
      
      if (!response.ok) {
        console.error('Failed to load integrations')
        setLoading(false)
        return
      }
      
      const data = await response.json()
      setIntegrations(data.integrations || [])
      setOrgId(data.orgId || '')
      setLoading(false)
    } catch (error) {
      console.error('Error loading integrations:', error)
      setLoading(false)
    }
  }

  const getIntegrationStatus = (providerId: string) => {
    const integration = integrations.find(i => i.provider === providerId)
    return integration?.is_enabled ? 'connected' : 'disconnected'
  }

  const openConfigModal = (providerId: string) => {
    const existing = integrations.find(i => i.provider === providerId)
    setFormData({
      api_key: existing?.api_key || '',
      api_secret: '',
      client_id: '',
    })
    setSelectedProvider(providerId)
  }

  const saveIntegration = async () => {
    if (!selectedProvider) return
    
    setSaving(true)

    try {
      const response = await fetch('/api/admin/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: selectedProvider,
          api_key: formData.api_key,
          settings: {
            api_secret: formData.api_secret || null,
            client_id: formData.client_id || null,
          },
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        alert(data.error || 'Failed to save integration')
        setSaving(false)
        return
      }

      await loadIntegrations()
      setSelectedProvider(null)
    } catch (error) {
      console.error('Error saving integration:', error)
      alert('Failed to save integration')
    }
    setSaving(false)
  }

  const disconnectIntegration = async (providerId: string) => {
    if (!confirm('Disconnect this integration?')) return

    const integration = integrations.find(i => i.provider === providerId)
    if (!integration) return

    await supabase
      .from('integration_configs')
      .update({ is_enabled: false, api_key: null })
      .eq('id', integration.id)

    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('users')
        .select('org_id')
        .eq('id', user.id)
        .single()
      if (profile) {
        await loadIntegrations(profile.org_id)
      }
    }
  }

  const providerInfo = selectedProvider 
    ? integrationProviders.find(p => p.id === selectedProvider)
    : null

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Nav />
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-6">
          <Link href="/admin" className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">
            ← Back to Admin
          </Link>
        </div>

        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Proposal Integrations</h1>
          <p className="text-gray-500 mt-1">Connect external measurement and proposal tools</p>
        </div>

        {/* Category: Roofing */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Roofing Tools</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {integrationProviders.filter(p => p.category === 'Roofing').map((provider) => {
              const status = getIntegrationStatus(provider.id)
              return (
                <div key={provider.id} className="bg-white rounded-xl shadow-sm border p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center text-2xl">
                        {provider.logo}
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">{provider.name}</h3>
                        <p className="text-sm text-gray-500">{provider.description}</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="mb-4">
                    <div className="flex flex-wrap gap-1">
                      {provider.features.slice(0, 3).map((feature) => (
                        <span key={feature} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">
                          {feature}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t">
                    <span className={`flex items-center gap-1.5 text-sm ${
                      status === 'connected' ? 'text-green-600' : 'text-gray-400'
                    }`}>
                      <span className={`w-2 h-2 rounded-full ${
                        status === 'connected' ? 'bg-green-500' : 'bg-gray-300'
                      }`} />
                      {status === 'connected' ? 'Connected' : 'Not connected'}
                    </span>
                    {status === 'connected' ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => openConfigModal(provider.id)}
                          className="px-3 py-1.5 text-sm text-indigo-600 hover:bg-indigo-50 rounded-lg"
                        >
                          Settings
                        </button>
                        <button
                          onClick={() => disconnectIntegration(provider.id)}
                          className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg"
                        >
                          Disconnect
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => openConfigModal(provider.id)}
                        className="px-4 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
                      >
                        Connect
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Category: Solar */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Solar Tools</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {integrationProviders.filter(p => p.category === 'Solar').map((provider) => {
              const status = getIntegrationStatus(provider.id)
              return (
                <div key={provider.id} className="bg-white rounded-xl shadow-sm border p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center text-2xl">
                        {provider.logo}
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">{provider.name}</h3>
                        <p className="text-sm text-gray-500">{provider.description}</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="mb-4">
                    <div className="flex flex-wrap gap-1">
                      {provider.features.slice(0, 3).map((feature) => (
                        <span key={feature} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">
                          {feature}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t">
                    <span className={`flex items-center gap-1.5 text-sm ${
                      status === 'connected' ? 'text-green-600' : 'text-gray-400'
                    }`}>
                      <span className={`w-2 h-2 rounded-full ${
                        status === 'connected' ? 'bg-green-500' : 'bg-gray-300'
                      }`} />
                      {status === 'connected' ? 'Connected' : 'Not connected'}
                    </span>
                    {status === 'connected' ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => openConfigModal(provider.id)}
                          className="px-3 py-1.5 text-sm text-indigo-600 hover:bg-indigo-50 rounded-lg"
                        >
                          Settings
                        </button>
                        <button
                          onClick={() => disconnectIntegration(provider.id)}
                          className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg"
                        >
                          Disconnect
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => openConfigModal(provider.id)}
                        className="px-4 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
                      >
                        Connect
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Category: Other */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Imagery & Other</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {integrationProviders.filter(p => ['General', 'Imagery'].includes(p.category)).map((provider) => {
              const status = getIntegrationStatus(provider.id)
              return (
                <div key={provider.id} className="bg-white rounded-xl shadow-sm border p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center text-2xl">
                        {provider.logo}
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">{provider.name}</h3>
                        <p className="text-sm text-gray-500">{provider.description}</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="mb-4">
                    <div className="flex flex-wrap gap-1">
                      {provider.features.slice(0, 3).map((feature) => (
                        <span key={feature} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">
                          {feature}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t">
                    <span className={`flex items-center gap-1.5 text-sm ${
                      status === 'connected' ? 'text-green-600' : 'text-gray-400'
                    }`}>
                      <span className={`w-2 h-2 rounded-full ${
                        status === 'connected' ? 'bg-green-500' : 'bg-gray-300'
                      }`} />
                      {status === 'connected' ? 'Connected' : 'Not connected'}
                    </span>
                    {status === 'connected' ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => openConfigModal(provider.id)}
                          className="px-3 py-1.5 text-sm text-indigo-600 hover:bg-indigo-50 rounded-lg"
                        >
                          Settings
                        </button>
                        <button
                          onClick={() => disconnectIntegration(provider.id)}
                          className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg"
                        >
                          Disconnect
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => openConfigModal(provider.id)}
                        className="px-4 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
                      >
                        Connect
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Website Lead Webhook */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Website Lead Integration</h2>
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <div className="flex items-start gap-4 mb-6">
              <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center text-2xl">
                🌐
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900">Webhook for Website Leads</h3>
                <p className="text-sm text-gray-500 mt-1">
                  Connect your website (Lovable, Webflow, WordPress, etc.) to automatically create leads in your CRM.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Webhook URL</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={typeof window !== 'undefined' ? `${window.location.origin}/api/webhooks/leads` : '/api/webhooks/leads'}
                    className="flex-1 px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm font-mono"
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/api/webhooks/leads`)
                      alert('Webhook URL copied!')
                    }}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm"
                  >
                    Copy
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Your Org ID</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={orgId || 'Loading...'}
                    className="flex-1 px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm font-mono"
                  />
                  <button
                    onClick={() => {
                      if (orgId) {
                        navigator.clipboard.writeText(orgId)
                        alert('Org ID copied!')
                      }
                    }}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm"
                  >
                    Copy
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">Include this in your webhook payload as "org_id"</p>
              </div>

              <div className="p-4 bg-blue-50 rounded-lg">
                <p className="text-sm text-blue-800 font-medium mb-2">How to connect your website:</p>
                <ol className="text-sm text-blue-700 space-y-1 list-decimal list-inside">
                  <li>Copy the webhook URL above</li>
                  <li>In your website builder, add a webhook action to your contact form</li>
                  <li>Set the method to POST and paste the webhook URL</li>
                  <li>Map your form fields: name, email, phone, address, message</li>
                  <li>Add org_id to the payload (required)</li>
                </ol>
              </div>

              <details className="group">
                <summary className="cursor-pointer text-sm font-medium text-indigo-600 hover:text-indigo-800">
                  View example payload →
                </summary>
                <pre className="mt-2 p-4 bg-gray-900 text-green-400 rounded-lg text-xs overflow-x-auto">
{`{
  "org_id": "${orgId || 'your-org-id'}",
  "name": "John Smith",
  "phone": "555-123-4567",
  "email": "john@example.com",
  "address": "123 Main St, City, ST 12345",
  "source": "web",
  "message": "I need a roof inspection"
}`}
                </pre>
              </details>
            </div>
          </div>
        </div>

        {/* In-House Tool Promo */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-2xl p-8 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold mb-2">ARX Roof Measure</h2>
              <p className="text-indigo-100 mb-4">
                Our built-in roof measurement tool. Get instant measurements from satellite imagery without leaving the app.
              </p>
              <ul className="text-sm text-indigo-100 space-y-1 mb-4">
                <li>✓ Instant satellite measurements</li>
                <li>✓ Automatic pitch detection</li>
                <li>✓ Draw and measure roof sections</li>
                <li>✓ No external subscriptions needed</li>
              </ul>
              <Link
                href="/tools/roof-measure"
                className="inline-flex items-center gap-2 px-6 py-3 bg-white text-indigo-600 font-semibold rounded-xl hover:bg-indigo-50"
              >
                Open Roof Measure
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
            <div className="hidden lg:block text-8xl opacity-20">
              📐
            </div>
          </div>
        </div>

        {/* Config Modal */}
        {selectedProvider && providerInfo && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full">
              <div className="p-6 border-b">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center text-2xl">
                    {providerInfo.logo}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">{providerInfo.name}</h2>
                    <p className="text-sm text-gray-500">Configure integration</p>
                  </div>
                </div>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">API Key</label>
                  <input
                    type="password"
                    value={formData.api_key}
                    onChange={(e) => setFormData(prev => ({ ...prev, api_key: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    placeholder="Enter your API key"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">API Secret (if required)</label>
                  <input
                    type="password"
                    value={formData.api_secret}
                    onChange={(e) => setFormData(prev => ({ ...prev, api_secret: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    placeholder="Enter API secret"
                  />
                </div>
                <div className="p-4 bg-blue-50 rounded-lg">
                  <p className="text-sm text-blue-800">
                    <strong>Need API credentials?</strong><br />
                    <a href={providerInfo.setupUrl} target="_blank" rel="noopener noreferrer" className="underline">
                      Visit {providerInfo.name}'s partner portal →
                    </a>
                  </p>
                </div>
              </div>
              <div className="p-6 border-t flex justify-end gap-3">
                <button
                  onClick={() => setSelectedProvider(null)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-900"
                >
                  Cancel
                </button>
                <button
                  onClick={saveIntegration}
                  disabled={saving || !formData.api_key}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
