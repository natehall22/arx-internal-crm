'use client'

import { useState, useEffect } from 'react'
import { createClientBrowser } from '@/lib/supabase/client'

interface Props {
  isOpen: boolean
  onClose: () => void
  address: string
  lat?: number
  lng?: number
  opportunityId?: string
}

interface Integration {
  provider: string
  is_enabled: boolean
}

const providerInfo: Record<string, { name: string; logo: string; description: string }> = {
  eagleview: {
    name: 'EagleView',
    logo: '🦅',
    description: 'Professional aerial roof reports (1-2 business days)',
  },
  roofr: {
    name: 'Roofr',
    logo: '🏠',
    description: 'Instant roof measurements and proposals',
  },
  gaf_quickmeasure: {
    name: 'GAF QuickMeasure',
    logo: '📐',
    description: 'Detailed roof measurement reports',
  },
  google_solar: {
    name: 'Google Solar API',
    logo: '🌐',
    description: 'Free solar potential and roof data (instant)',
  },
}

export default function RequestMeasurementModal({ isOpen, onClose, address, lat, lng, opportunityId }: Props) {
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [loading, setLoading] = useState(true)
  const [requesting, setRequesting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const supabase = createClientBrowser()

  useEffect(() => {
    if (isOpen) {
      loadIntegrations()
    }
  }, [isOpen])

  const loadIntegrations = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: profile } = await supabase
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile) return

    const { data } = await supabase
      .from('integration_configs')
      .select('provider, is_enabled')
      .eq('org_id', profile.org_id)
      .eq('is_enabled', true)

    setIntegrations(data || [])
    setLoading(false)
  }

  const requestMeasurement = async (provider: string) => {
    setRequesting(provider)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/integrations/request-measurement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          address,
          lat,
          lng,
          opportunity_id: opportunityId,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || data.message || 'Request failed')
      }

      if (data.status === 'completed') {
        setSuccess('Measurement completed! Refreshing...')
        setTimeout(() => {
          onClose()
          window.location.reload()
        }, 1500)
      } else {
        setSuccess('Report requested! You\'ll be notified when it\'s ready.')
        setTimeout(() => onClose(), 2000)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setRequesting(null)
    }
  }

  if (!isOpen) return null

  const enabledProviders = ['eagleview', 'roofr', 'gaf_quickmeasure', 'google_solar'].filter(
    p => integrations.some(i => i.provider === p)
  )

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full">
        <div className="p-6 border-b">
          <h2 className="text-xl font-bold text-gray-900">Request Roof Measurement</h2>
          <p className="text-sm text-gray-500 mt-1">{address}</p>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto" />
            </div>
          ) : enabledProviders.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-gray-600 mb-2">No measurement providers connected</p>
              <p className="text-sm text-gray-500">
                Ask your admin to connect EagleView, Roofr, or other providers in Admin → Integrations.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {enabledProviders.map((provider) => {
                const info = providerInfo[provider]
                const isRequesting = requesting === provider

                return (
                  <button
                    key={provider}
                    onClick={() => requestMeasurement(provider)}
                    disabled={requesting !== null}
                    className="w-full flex items-center gap-4 p-4 border rounded-xl hover:border-indigo-300 hover:bg-indigo-50/50 transition disabled:opacity-50"
                  >
                    <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center text-2xl">
                      {info.logo}
                    </div>
                    <div className="flex-1 text-left">
                      <div className="font-medium text-gray-900">{info.name}</div>
                      <div className="text-sm text-gray-500">{info.description}</div>
                    </div>
                    {isRequesting ? (
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-600" />
                    ) : (
                      <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    )}
                  </button>
                )
              })}

              {/* Always show in-house option */}
              <div className="pt-3 border-t">
                <a
                  href={`/tools/roof-measure?opportunity=${opportunityId}`}
                  className="w-full flex items-center gap-4 p-4 border-2 border-indigo-200 bg-indigo-50 rounded-xl hover:border-indigo-400 transition"
                >
                  <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center text-2xl">
                    📐
                  </div>
                  <div className="flex-1 text-left">
                    <div className="font-medium text-indigo-900">ARX Roof Measure</div>
                    <div className="text-sm text-indigo-600">Draw and measure from satellite imagery (free)</div>
                  </div>
                  <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </a>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          {success && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
              {success}
            </div>
          )}
        </div>

        <div className="p-6 border-t flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
