'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { createClientBrowser } from '@/lib/supabase/client'

interface Measurement {
  id: string
  address_text: string
  source: string
  status: string
  total_area_sqft: number
  total_squares: number
  predominant_pitch: string
  facet_count: number
  created_at: string
  opportunity_id: string | null
  opportunities?: {
    id: string
    status: string
  }
}

const sourceLabels: Record<string, { label: string; color: string }> = {
  manual: { label: 'Manual', color: 'bg-gray-100 text-gray-700' },
  in_house: { label: 'ARX Measure', color: 'bg-indigo-100 text-indigo-700' },
  eagleview: { label: 'EagleView', color: 'bg-blue-100 text-blue-700' },
  roofr: { label: 'Roofr', color: 'bg-green-100 text-green-700' },
  solo: { label: 'Solo', color: 'bg-yellow-100 text-yellow-700' },
  aurora: { label: 'Aurora', color: 'bg-orange-100 text-orange-700' },
  google_solar: { label: 'Google Solar', color: 'bg-cyan-100 text-cyan-700' },
}

export default function MeasurementsListPage() {
  const router = useRouter()
  const [measurements, setMeasurements] = useState<Measurement[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  const supabase = createClientBrowser()

  useEffect(() => {
    loadMeasurements()
  }, [])

  const loadMeasurements = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    const { data: profile } = await supabase
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile) return

    const { data } = await supabase
      .from('roof_measurements')
      .select('*, opportunities(id, status)')
      .eq('org_id', profile.org_id)
      .order('created_at', { ascending: false })

    setMeasurements(data || [])
    setLoading(false)
  }

  const filteredMeasurements = measurements.filter(m =>
    m.address_text.toLowerCase().includes(searchQuery.toLowerCase())
  )

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
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Roof Measurements</h1>
            <p className="text-gray-500 mt-1">All saved roof measurements</p>
          </div>
          <Link
            href="/tools/roof-measure"
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Measurement
          </Link>
        </div>

        {/* Search */}
        <div className="mb-6">
          <input
            type="text"
            placeholder="Search by address..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-lg"
          />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <div className="text-2xl font-bold text-gray-900">{measurements.length}</div>
            <div className="text-sm text-gray-500">Total Measurements</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <div className="text-2xl font-bold text-indigo-600">
              {measurements.filter(m => m.source === 'in_house').length}
            </div>
            <div className="text-sm text-gray-500">ARX Measured</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <div className="text-2xl font-bold text-blue-600">
              {measurements.filter(m => ['eagleview', 'roofr', 'gaf_quickmeasure'].includes(m.source)).length}
            </div>
            <div className="text-sm text-gray-500">External Reports</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <div className="text-2xl font-bold text-green-600">
              {measurements.reduce((sum, m) => sum + (m.total_squares || 0), 0).toFixed(0)}
            </div>
            <div className="text-sm text-gray-500">Total Squares</div>
          </div>
        </div>

        {/* List */}
        {filteredMeasurements.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No measurements yet</h3>
            <p className="text-gray-500 mb-4">Start measuring roofs to build your database</p>
            <Link
              href="/tools/roof-measure"
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              Create First Measurement
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Address</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Squares</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Pitch</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sections</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredMeasurements.map((measurement) => {
                  const source = sourceLabels[measurement.source] || sourceLabels.manual
                  return (
                    <tr key={measurement.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-gray-900 max-w-xs truncate">
                          {measurement.address_text}
                        </div>
                        {measurement.opportunity_id && (
                          <Link
                            href={`/opportunities/${measurement.opportunity_id}`}
                            className="text-xs text-indigo-600 hover:underline"
                          >
                            View Opportunity →
                          </Link>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${source.color}`}>
                          {source.label}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm font-semibold text-gray-900">
                          {measurement.total_squares?.toFixed(1) || '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {measurement.predominant_pitch || '-'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {measurement.facet_count || '-'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {new Date(measurement.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">
                            View
                          </button>
                          <button className="text-gray-600 hover:text-gray-800 text-sm font-medium">
                            Use
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
