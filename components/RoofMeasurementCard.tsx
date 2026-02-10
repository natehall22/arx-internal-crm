'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClientBrowser } from '@/lib/supabase/client'

interface RoofMeasurement {
  id: string
  address_text: string
  source: string
  status: string
  total_area_sqft: number
  total_squares: number
  ridges_lf: number
  hips_lf: number
  valleys_lf: number
  eaves_lf: number
  rakes_lf: number
  predominant_pitch: string
  facet_count: number
  suggested_waste_percent: number
  created_at: string
  external_report_url: string | null
}

interface RoofFacet {
  id: string
  facet_number: number
  area_sqft: number
  pitch: string
  pitch_degrees: number
  orientation: string
}

interface Props {
  opportunityId?: string
  projectId?: string
  proposalId?: string
  showActions?: boolean
}

const sourceLabels: Record<string, { label: string; color: string }> = {
  manual: { label: 'Manual', color: 'bg-gray-100 text-gray-700' },
  in_house: { label: 'ARX Measure', color: 'bg-indigo-100 text-indigo-700' },
  eagleview: { label: 'EagleView', color: 'bg-blue-100 text-blue-700' },
  roofr: { label: 'Roofr', color: 'bg-green-100 text-green-700' },
  solo: { label: 'Solo', color: 'bg-yellow-100 text-yellow-700' },
  aurora: { label: 'Aurora', color: 'bg-orange-100 text-orange-700' },
}

export default function RoofMeasurementCard({ opportunityId, projectId, proposalId, showActions = true }: Props) {
  const [measurement, setMeasurement] = useState<RoofMeasurement | null>(null)
  const [facets, setFacets] = useState<RoofFacet[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  const supabase = createClientBrowser()

  useEffect(() => {
    loadMeasurement()
  }, [opportunityId, projectId, proposalId])

  const loadMeasurement = async () => {
    let query = supabase
      .from('roof_measurements')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)

    if (opportunityId) {
      query = query.eq('opportunity_id', opportunityId)
    } else if (projectId) {
      query = query.eq('project_id', projectId)
    } else if (proposalId) {
      query = query.eq('proposal_id', proposalId)
    }

    const { data } = await query.single()

    if (data) {
      setMeasurement(data)
      
      // Load facets
      const { data: facetData } = await supabase
        .from('roof_facets')
        .select('*')
        .eq('measurement_id', data.id)
        .order('facet_number')

      setFacets(facetData || [])
    }

    setLoading(false)
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border p-6">
        <div className="animate-pulse">
          <div className="h-5 bg-gray-200 rounded w-1/3 mb-4" />
          <div className="h-20 bg-gray-100 rounded" />
        </div>
      </div>
    )
  }

  if (!measurement) {
    return (
      <div className="bg-white rounded-xl shadow-sm border p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Roof Measurements</h3>
        </div>
        <div className="text-center py-8">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          </div>
          <p className="text-gray-500 mb-4">No roof measurements yet</p>
          {showActions && opportunityId && (
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <Link
                href={`/tools/roof-measure?opportunity=${opportunityId}`}
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Measure with ARX
              </Link>
              <button className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Import Report
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  const source = sourceLabels[measurement.source] || sourceLabels.manual

  return (
    <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-gray-900">Roof Measurements</h3>
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${source.color}`}>
              {source.label}
            </span>
          </div>
          {measurement.external_report_url && (
            <a
              href={measurement.external_report_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
            >
              View Full Report →
            </a>
          )}
        </div>

        {/* Main Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-indigo-50 rounded-xl p-4 text-center">
            <div className="text-3xl font-bold text-indigo-600">
              {measurement.total_squares.toFixed(1)}
            </div>
            <div className="text-sm text-indigo-600/70">Squares</div>
          </div>
          <div className="bg-gray-50 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-gray-900">
              {measurement.total_area_sqft.toLocaleString()}
            </div>
            <div className="text-sm text-gray-500">Sq Ft</div>
          </div>
          <div className="bg-gray-50 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-gray-900">
              {measurement.predominant_pitch}
            </div>
            <div className="text-sm text-gray-500">Pitch</div>
          </div>
          <div className="bg-gray-50 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-gray-900">
              {measurement.facet_count}
            </div>
            <div className="text-sm text-gray-500">Sections</div>
          </div>
        </div>

        {/* Linear Footage */}
        <div className="grid grid-cols-3 md:grid-cols-5 gap-3 text-sm">
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="font-semibold text-gray-900">{measurement.ridges_lf} LF</div>
            <div className="text-xs text-gray-500">Ridges</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="font-semibold text-gray-900">{measurement.hips_lf} LF</div>
            <div className="text-xs text-gray-500">Hips</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="font-semibold text-gray-900">{measurement.valleys_lf} LF</div>
            <div className="text-xs text-gray-500">Valleys</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="font-semibold text-gray-900">{measurement.eaves_lf} LF</div>
            <div className="text-xs text-gray-500">Eaves</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="font-semibold text-gray-900">{measurement.rakes_lf} LF</div>
            <div className="text-xs text-gray-500">Rakes</div>
          </div>
        </div>

        {/* Expandable Facets */}
        {facets.length > 0 && (
          <div className="mt-4">
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800"
            >
              <svg 
                className={`w-4 h-4 transition-transform ${expanded ? 'rotate-90' : ''}`} 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              View {facets.length} roof sections
            </button>
            
            {expanded && (
              <div className="mt-3 border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-gray-600 font-medium">#</th>
                      <th className="px-4 py-2 text-left text-gray-600 font-medium">Area</th>
                      <th className="px-4 py-2 text-left text-gray-600 font-medium">Pitch</th>
                      <th className="px-4 py-2 text-left text-gray-600 font-medium">Direction</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {facets.map((facet) => (
                      <tr key={facet.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-900">{facet.facet_number}</td>
                        <td className="px-4 py-2 text-gray-900">{facet.area_sqft.toLocaleString()} sqft</td>
                        <td className="px-4 py-2 text-gray-900">{facet.pitch}</td>
                        <td className="px-4 py-2 text-gray-500">{facet.orientation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Waste Factor */}
        <div className="mt-4 p-3 bg-amber-50 rounded-lg flex items-center gap-3">
          <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm text-amber-800">
            Suggested waste factor: <strong>{measurement.suggested_waste_percent}%</strong>
          </span>
        </div>
      </div>

      {/* Actions Footer */}
      {showActions && (
        <div className="px-6 py-4 bg-gray-50 border-t flex justify-between items-center">
          <span className="text-xs text-gray-500">
            Measured {new Date(measurement.created_at).toLocaleDateString()}
          </span>
          <div className="flex gap-2">
            <Link
              href={`/tools/roof-measure?opportunity=${opportunityId}`}
              className="px-3 py-1.5 text-sm text-indigo-600 hover:bg-indigo-50 rounded-lg"
            >
              Re-measure
            </Link>
            <button className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
              Use in Proposal
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
