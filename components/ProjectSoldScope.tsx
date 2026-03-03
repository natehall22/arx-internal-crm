'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClientBrowser } from '@/lib/supabase/client'

interface LineItem {
  id: string
  name: string
  description: string | null
  category: string
  quantity: number
  unit: string
}

interface ProjectSoldScopeProps {
  projectId: string
}

export default function ProjectSoldScope({ projectId }: ProjectSoldScopeProps) {
  const [loading, setLoading] = useState(true)
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [scopeText, setScopeText] = useState<string | null>(null)
  const [proposalInfo, setProposalInfo] = useState<{ id: string; proposal_number: string; total: number; accepted_at: string } | null>(null)

  useEffect(() => {
    loadSoldScope()
  }, [projectId])

  const loadSoldScope = async () => {
    const supabase = createClientBrowser()

    try {
      // Find accepted proposal by project_id
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
          .select('id, name, description, category, quantity, unit')
          .eq('proposal_id', proposal.id)
          .order('sort_order')

        setLineItems(items || [])
      }
    } catch (err) {
      console.error('Error loading sold scope:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">What Was Sold</h2>
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    )
  }

  if (!proposalInfo) {
    return null
  }

  // Group line items by category
  const groupedItems = lineItems.reduce((acc, item) => {
    const cat = item.category || 'Other'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(item)
    return acc
  }, {} as Record<string, LineItem[]>)

  return (
    <div className="bg-white shadow rounded-lg p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-900">What Was Sold</h2>
        <Link
          href={`/proposals/${proposalInfo.id}`}
          className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
        >
          View Proposal →
        </Link>
      </div>

      <div className="mb-4 p-3 bg-green-50 rounded-lg border border-green-200">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-medium text-green-800">
              {proposalInfo.proposal_number}
            </span>
            <span className="text-xs text-green-600 ml-2">
              Accepted {new Date(proposalInfo.accepted_at).toLocaleDateString()}
            </span>
          </div>
          <span className="text-lg font-bold text-green-800">
            ${proposalInfo.total.toLocaleString()}
          </span>
        </div>
      </div>

      {scopeText && (
        <div className="mb-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Scope of Work</h3>
          <p className="text-sm text-gray-600 whitespace-pre-wrap bg-gray-50 p-3 rounded-lg">
            {scopeText}
          </p>
        </div>
      )}

      {lineItems.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-2">Sold Line Items</h3>
          <div className="space-y-3">
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
    </div>
  )
}
