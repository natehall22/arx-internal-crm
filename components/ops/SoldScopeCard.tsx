'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClientBrowser } from '@/lib/supabase/client'
import GenerateJobPacketButton from './GenerateJobPacketButton'

interface LineItem {
  id: string
  name: string
  description: string | null
  category: string
  quantity: number
  unit: string
  unit_price: number
  line_total: number
}

interface SoldScopeCardProps {
  projectId: string
  acceptedProposalId?: string | null
  acceptedEstimateId?: string | null
  jobId?: string
  showJobPacketButton?: boolean
}

export default function SoldScopeCard({ 
  projectId, 
  acceptedProposalId, 
  acceptedEstimateId,
  jobId,
  showJobPacketButton = false
}: SoldScopeCardProps) {
  const [loading, setLoading] = useState(true)
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [scopeText, setScopeText] = useState<string | null>(null)
  const [proposalInfo, setProposalInfo] = useState<{ 
    id: string
    proposal_number: string
    total: number
    accepted_at?: string | null 
  } | null>(null)
  const [estimateInfo, setEstimateInfo] = useState<{ id: string; total: number } | null>(null)

  useEffect(() => {
    loadSoldScope()
  }, [projectId, acceptedProposalId, acceptedEstimateId])

  const loadSoldScope = async () => {
    const supabase = createClientBrowser()

    try {
      // Strategy 1: Use acceptedProposalId if provided
      if (acceptedProposalId) {
        const { data: proposal } = await supabase
          .from('proposals')
          .select('id, proposal_number, total, scope_of_work, accepted_at')
          .eq('id', acceptedProposalId)
          .single()

        if (proposal) {
          setProposalInfo({ 
            id: proposal.id, 
            proposal_number: proposal.proposal_number, 
            total: proposal.total,
            accepted_at: proposal.accepted_at
          })
          setScopeText(proposal.scope_of_work)

          const { data: items } = await supabase
            .from('proposal_line_items')
            .select('id, name, description, category, quantity, unit, unit_price, line_total')
            .eq('proposal_id', acceptedProposalId)
            .order('sort_order')

          setLineItems(items || [])
          setLoading(false)
          return
        }
      }

      // Strategy 2: Use acceptedEstimateId if provided
      if (acceptedEstimateId) {
        const { data: estimate } = await supabase
          .from('estimates')
          .select('id, total, scope_text')
          .eq('id', acceptedEstimateId)
          .single()

        if (estimate) {
          setEstimateInfo({ id: estimate.id, total: estimate.total })
          setScopeText(estimate.scope_text)

          const { data: items } = await supabase
            .from('estimate_lines')
            .select('id, name, category, qty, unit, unit_price, line_total')
            .eq('estimate_id', acceptedEstimateId)
            .order('sort_order')

          setLineItems((items || []).map(item => ({
            id: item.id,
            name: item.name,
            description: null,
            category: item.category,
            quantity: item.qty,
            unit: item.unit,
            unit_price: item.unit_price,
            line_total: item.line_total,
          })))
          setLoading(false)
          return
        }
      }

      // Strategy 3: Fallback - find accepted proposal by project_id
      if (projectId) {
        const { data: proposals } = await supabase
          .from('proposals')
          .select('id, proposal_number, total, scope_of_work, accepted_at')
          .eq('project_id', projectId)
          .not('accepted_at', 'is', null)
          .order('accepted_at', { ascending: false })
          .limit(1)

        if (proposals && proposals.length > 0) {
          const proposal = proposals[0]
          setProposalInfo({ 
            id: proposal.id, 
            proposal_number: proposal.proposal_number, 
            total: proposal.total,
            accepted_at: proposal.accepted_at
          })
          setScopeText(proposal.scope_of_work)

          const { data: items } = await supabase
            .from('proposal_line_items')
            .select('id, name, description, category, quantity, unit, unit_price, line_total')
            .eq('proposal_id', proposal.id)
            .order('sort_order')

          setLineItems(items || [])
          setLoading(false)
          return
        }

        // Strategy 4: Fallback - find accepted estimate by project_id (via jobs table)
        const { data: estimates } = await supabase
          .from('estimates')
          .select('id, total, scope_text, status')
          .eq('project_id', projectId)
          .eq('status', 'approved')
          .order('created_at', { ascending: false })
          .limit(1)

        if (estimates && estimates.length > 0) {
          const estimate = estimates[0]
          setEstimateInfo({ id: estimate.id, total: estimate.total })
          setScopeText(estimate.scope_text)

          const { data: items } = await supabase
            .from('estimate_lines')
            .select('id, name, category, qty, unit, unit_price, line_total')
            .eq('estimate_id', estimate.id)
            .order('sort_order')

          setLineItems((items || []).map(item => ({
            id: item.id,
            name: item.name,
            description: null,
            category: item.category,
            quantity: item.qty,
            unit: item.unit,
            unit_price: item.unit_price,
            line_total: item.line_total,
          })))
        }
      }
    } catch (err) {
      console.error('Error loading sold scope:', err)
    } finally {
      setLoading(false)
    }
  }

  // Group line items by category
  const groupedItems = lineItems.reduce((acc, item) => {
    const cat = item.category || 'Other'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(item)
    return acc
  }, {} as Record<string, LineItem[]>)

  return (
    <div className="bg-white rounded-xl shadow-sm border p-6">
      {/* Header with title and Job Packet button */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-gray-900">Sold Scope</h2>
          {proposalInfo && (
            <Link
              href={`/proposals/${proposalInfo.id}`}
              className="text-sm text-indigo-600 hover:text-indigo-800"
            >
              View Proposal →
            </Link>
          )}
        </div>
        {showJobPacketButton && jobId && (
          <GenerateJobPacketButton jobId={jobId} />
        )}
      </div>

      {loading ? (
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          <div className="h-4 bg-gray-200 rounded w-2/3"></div>
        </div>
      ) : !proposalInfo && !estimateInfo && lineItems.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-sm text-gray-500">No accepted proposal linked to this job's project.</p>
          <p className="text-xs text-gray-400 mt-1">
            Create and accept a proposal on the project to see sold line items here.
          </p>
        </div>
      ) : (
        <>
          {/* Accepted Proposal/Estimate Info */}
          {proposalInfo && (
            <div className="mb-4 p-3 bg-green-50 rounded-lg border border-green-200">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-green-800">
                    {proposalInfo.proposal_number}
                  </span>
                  {proposalInfo.accepted_at && (
                    <span className="text-xs text-green-600 ml-2">
                      Accepted {new Date(proposalInfo.accepted_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <span className="text-sm font-bold text-green-800">
                  ${proposalInfo.total.toLocaleString()}
                </span>
              </div>
            </div>
          )}

          {estimateInfo && !proposalInfo && (
            <div className="mb-4 p-3 bg-green-50 rounded-lg border border-green-200">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-green-800">Accepted Estimate</span>
                <span className="text-sm font-bold text-green-800">
                  ${estimateInfo.total.toLocaleString()}
                </span>
              </div>
            </div>
          )}

          {/* Scope of Work */}
          {scopeText && (
            <div className="mb-4">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Scope of Work</h3>
              <p className="text-sm text-gray-600 whitespace-pre-wrap bg-gray-50 p-3 rounded-lg max-h-32 overflow-y-auto">
                {scopeText}
              </p>
            </div>
          )}

          {/* Line Items */}
          {lineItems.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">
                Line Items ({lineItems.length})
              </h3>
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {Object.entries(groupedItems).map(([category, items]) => (
                  <div key={category}>
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                      {category}
                    </div>
                    <div className="space-y-1">
                      {items.map(item => (
                        <div key={item.id} className="flex items-start justify-between py-1.5 border-b border-gray-100 last:border-0">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-900">{item.name}</p>
                            {item.description && (
                              <p className="text-xs text-gray-500 truncate">{item.description}</p>
                            )}
                          </div>
                          <div className="text-right ml-4 flex-shrink-0">
                            <p className="text-sm text-gray-600">
                              {item.quantity} {item.unit}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
