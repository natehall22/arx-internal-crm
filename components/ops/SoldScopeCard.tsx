'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { createClientBrowser } from '@/lib/supabase/client'
import GenerateJobPacketButton from './GenerateJobPacketButton'
import AIJobPacketModal from '@/components/jobs/AIJobPacketModal'
import type { JobNoteWithAuthor } from '@/lib/types/job-notes'
import type { JobSoldScope } from '@/lib/job-sold-scope'

/** Display shape shared by proposal line items (from `scope`) and estimate lines (fetched here). */
type DisplayLineItem = {
  id: string
  name: string
  description: string | null
  category: string
  quantity: number
  unit: string
  unit_price: number
  line_total: number
}

interface AdditionalScopeItem {
  id: string
  description: string
  quantity: number
  unit: string
  unit_price: number
  line_total: number
}

interface AvailableProposal {
  id: string
  proposal_number: string
  total: number
  scope_of_work?: string | null
  accepted_at: string | null
}

interface JobCostLine {
  id: string
  description: string
  amount: number
  cost_type: string | null
  status: string | null
}

/** Cosmetic proposal metadata `lib/job-sold-scope.ts` doesn't carry ($ total, free-text scope, accepted date). */
interface ProposalMeta {
  id: string
  proposal_number: string
  total: number
  scope_of_work: string | null
  accepted_at: string | null
}

interface SoldScopeCardProps {
  /**
   * The single source of truth for "what was sold on this job" — see `lib/job-sold-scope.ts`.
   * `null` means nothing sold and nothing measured resolved for this job.
   */
  scope: JobSoldScope | null
  projectId: string
  acceptedEstimateId?: string | null
  opportunityId?: string | null
  jobId?: string
  orgId?: string
  showJobPacketButton?: boolean
  jobScopeOfWork?: string | null
  jobMaterialsNotes?: string | null
}

export default function SoldScopeCard({
  scope,
  projectId,
  acceptedEstimateId,
  opportunityId,
  jobId,
  orgId,
  showJobPacketButton = false,
  jobScopeOfWork = null,
  jobMaterialsNotes = null,
}: SoldScopeCardProps) {
  const [loading, setLoading] = useState(true)
  const [lineItems, setLineItems] = useState<DisplayLineItem[]>([])
  const [scopeText, setScopeText] = useState<string | null>(null)
  const [proposalMeta, setProposalMeta] = useState<ProposalMeta | null>(null)
  const [estimateInfo, setEstimateInfo] = useState<{ id: string; total: number } | null>(null)

  // Manual linking state
  const [showLinkDropdown, setShowLinkDropdown] = useState(false)
  const [availableProposals, setAvailableProposals] = useState<AvailableProposal[]>([])
  const [linkingProposal, setLinkingProposal] = useState(false)

  // Add scope item state
  const [showAddForm, setShowAddForm] = useState(false)
  const [newItem, setNewItem] = useState({ description: '', quantity: '1', unit: 'each', unit_price: '0' })
  const [savingItem, setSavingItem] = useState(false)
  const [packetModalOpen, setPacketModalOpen] = useState(false)
  const [jobCostLines, setJobCostLines] = useState<JobCostLine[]>([])
  const [notes, setNotes] = useState<JobNoteWithAuthor[]>([])
  const [additionalScope, setAdditionalScope] = useState<AdditionalScopeItem[]>([])

  const proposalId = scope?.proposal_id ?? null
  const hasProposal = proposalId != null

  const loadSoldScope = useCallback(async () => {
    setLoading(true)
    setProposalMeta(null)
    setEstimateInfo(null)
    setScopeText(null)
    setLineItems([])

    const supabase = createClientBrowser()

    try {
      if (proposalId) {
        // The proposal id is already authoritative (resolved server-side by buildJobSoldScope) —
        // this only fills in cosmetic fields it doesn't model ($ total, free-text scope, accepted
        // date). Squares, waste, and line items all come from `scope`, so this fetch can never
        // disagree with the rest of the page about *which* proposal was sold.
        const { data: proposal } = await supabase
          .from('proposals')
          .select('id, proposal_number, total, scope_of_work, accepted_at')
          .eq('id', proposalId)
          .maybeSingle()

        if (proposal) {
          setProposalMeta({
            id: proposal.id,
            proposal_number: proposal.proposal_number ?? scope?.proposal_number ?? '',
            total: Number(proposal.total) || 0,
            scope_of_work: proposal.scope_of_work ?? null,
            accepted_at: proposal.accepted_at ?? null,
          })
          setScopeText(proposal.scope_of_work ?? null)
        }
        setLineItems(scope?.line_items ?? [])
        return
      }

      // No proposal backs this job — fall back to an accepted estimate: explicit id first, then
      // the most recently approved estimate on the project.
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

          setLineItems(
            (items || []).map((item) => ({
              id: item.id,
              name: item.name,
              description: null,
              category: item.category,
              quantity: item.qty,
              unit: item.unit,
              unit_price: item.unit_price,
              line_total: item.line_total,
            }))
          )
          return
        }
      }

      if (projectId) {
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

          setLineItems(
            (items || []).map((item) => ({
              id: item.id,
              name: item.name,
              description: null,
              category: item.category,
              quantity: item.qty,
              unit: item.unit,
              unit_price: item.unit_price,
              line_total: item.line_total,
            }))
          )
        }
      }
    } catch (err) {
      console.error('Error loading sold scope:', err)
    } finally {
      setLoading(false)
    }
  }, [scope, proposalId, acceptedEstimateId, projectId])

  const loadAdditionalScope = useCallback(async () => {
    if (!jobId) return

    try {
      const response = await fetch(`/api/jobs/${jobId}/additional-scope`)
      if (response.ok) {
        const data = await response.json()
        setAdditionalScope(data || [])
      }
    } catch (err) {
      console.log('Additional scope not available')
    }
  }, [jobId])

  const loadAvailableProposals = async () => {
    const supabase = createClientBrowser()

    try {
      // Find accepted proposals from the same opportunity, for manual linking only.
      let query = supabase
        .from('proposals')
        .select('id, proposal_number, total, scope_of_work, accepted_at')
        .not('accepted_at', 'is', null)
        .order('accepted_at', { ascending: false })
        .limit(20)

      if (opportunityId) {
        query = query.eq('opportunity_id', opportunityId)
      }

      const { data } = await query
      setAvailableProposals(data || [])
    } catch (err) {
      console.error('Error loading available proposals:', err)
    }
  }

  const loadAIContextData = useCallback(async () => {
    if (!jobId) return

    const supabase = createClientBrowser()

    try {
      const { data: notesData } = await supabase
        .from('production_job_notes')
        .select('id, note, is_internal, created_at, user:users(full_name)')
        .eq('job_id', jobId)
        .order('created_at', { ascending: true })
        .limit(20)
      setNotes((notesData as JobNoteWithAuthor[]) || [])
    } catch {
      setNotes([])
    }

    try {
      const { data: costData } = await supabase
        .from('production_job_cost_lines')
        .select('id, description, amount, cost_type, status')
        .eq('job_id', jobId)
        .order('created_at', { ascending: true })
        .limit(50)
      setJobCostLines((costData as JobCostLine[]) || [])
    } catch {
      setJobCostLines([])
    }
  }, [jobId])

  useEffect(() => {
    loadSoldScope()
    if (jobId) {
      loadAdditionalScope()
      loadAIContextData()
    }
  }, [jobId, loadSoldScope, loadAdditionalScope, loadAIContextData])

  const handleLinkProposal = async (proposalIdToLink: string) => {
    if (!jobId) return
    setLinkingProposal(true)

    const supabase = createClientBrowser()

    try {
      const { error } = await supabase
        .from('production_jobs')
        .update({ linked_proposal_id: proposalIdToLink })
        .eq('id', jobId)

      if (!error) {
        setShowLinkDropdown(false)
        // Reload so the server recomputes `job.sold_scope` (buildJobSoldScope) for the new link.
        window.location.reload()
      }
    } catch (err) {
      console.error('Error linking proposal:', err)
    } finally {
      setLinkingProposal(false)
    }
  }

  const handleAddScopeItem = async () => {
    if (!jobId || !newItem.description.trim()) {
      console.log('[AddScopeItem] Missing required fields:', { jobId, description: newItem.description })
      return
    }
    setSavingItem(true)

    try {
      const response = await fetch(`/api/jobs/${jobId}/additional-scope`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: newItem.description.trim(),
          quantity: newItem.quantity,
          unit: newItem.unit,
          unit_price: newItem.unit_price,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to add item')
      }

      const data = await response.json()
      console.log('[AddScopeItem] Success:', data)
      setAdditionalScope([...additionalScope, data])
      setNewItem({ description: '', quantity: '1', unit: 'each', unit_price: '0' })
      setShowAddForm(false)
    } catch (err: any) {
      console.error('[AddScopeItem] Error:', err)
      alert(`Failed to add item: ${err?.message || 'Unknown error'}`)
    } finally {
      setSavingItem(false)
    }
  }

  const handleDeleteScopeItem = async (itemId: string) => {
    if (!jobId) return

    try {
      const response = await fetch(`/api/jobs/${jobId}/additional-scope?itemId=${itemId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        setAdditionalScope(additionalScope.filter((item) => item.id !== itemId))
      }
    } catch (err) {
      console.error('Error deleting scope item:', err)
    }
  }

  // Group line items by category
  const groupedItems = lineItems.reduce((acc, item) => {
    const cat = item.category || 'Other'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(item)
    return acc
  }, {} as Record<string, DisplayLineItem[]>)

  const soldRoofSquares = scope?.total_squares ?? null
  const measuredSquares = scope?.measured_squares ?? null
  const soldWastePercentRaw = scope?.waste_percent ?? null
  const measureSuggestedWastePercent = scope?.measure_suggested_waste_percent ?? null
  const wasteIsEstimateOnly = soldWastePercentRaw == null && measureSuggestedWastePercent != null
  const effectiveWastePercent = soldWastePercentRaw ?? measureSuggestedWastePercent

  const hasSquareData =
    soldRoofSquares != null || measuredSquares != null || effectiveWastePercent != null

  const showEstimateBox = Boolean(estimateInfo) && !hasProposal
  const showEmptyState = !hasProposal && !estimateInfo

  return (
    <div className="bg-white rounded-xl shadow-sm border p-6">
      {/* Header with title and Job Packet button */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-gray-900">Sold Scope</h2>
          {hasProposal && (
            <Link
              href={`/proposals/${proposalId}`}
              className="text-sm text-indigo-600 hover:text-indigo-800"
            >
              View Proposal →
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2">
          {jobId && orgId && (
            <button
              onClick={() => setShowAddForm(true)}
              className="text-sm text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Item
            </button>
          )}
          {showJobPacketButton && jobId && (
            <GenerateJobPacketButton jobId={jobId} />
          )}
          {showJobPacketButton && jobId && (
            <button
              onClick={() => setPacketModalOpen(true)}
              className="min-h-[44px] px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm"
            >
              ✨ AI Summary
            </button>
          )}
        </div>
      </div>

      {hasSquareData && (
        <div className="mb-4 flex flex-wrap gap-2">
          {soldRoofSquares != null && (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
              Sold {soldRoofSquares.toFixed(1)} sq
            </span>
          )}
          {measuredSquares != null && (
            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
              Measured {measuredSquares.toFixed(1)} sq
            </span>
          )}
          {effectiveWastePercent != null && (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
              Waste {wasteIsEstimateOnly ? '(est.) ' : ''}
              {effectiveWastePercent.toFixed(1)}%
            </span>
          )}
        </div>
      )}

      {!hasProposal && scope?.total_squares_source === 'project_legacy' && (
        <p className="mb-4 text-xs text-gray-600">
          Squares stored on the project record — no proposal is linked to this job.
        </p>
      )}

      {loading ? (
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          <div className="h-4 bg-gray-200 rounded w-2/3"></div>
        </div>
      ) : showEmptyState ? (
        <div className="text-center py-4">
          <p className="text-sm text-gray-500">No accepted proposal linked to this job.</p>

          {/* Manual Link Dropdown */}
          {jobId && (
            <div className="mt-3">
              {!showLinkDropdown ? (
                <button
                  onClick={() => {
                    setShowLinkDropdown(true)
                    loadAvailableProposals()
                  }}
                  className="text-sm text-indigo-600 hover:text-indigo-800"
                >
                  Link a proposal manually →
                </button>
              ) : (
                <div className="mt-2 p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500 mb-2">Select an accepted proposal:</p>
                  {availableProposals.length === 0 ? (
                    <p className="text-sm text-gray-400">No accepted proposals found</p>
                  ) : (
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {availableProposals.map(p => (
                        <button
                          key={p.id}
                          onClick={() => handleLinkProposal(p.id)}
                          disabled={linkingProposal}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 rounded flex justify-between items-center"
                        >
                          <span>{p.proposal_number}</span>
                          <span className="text-gray-500">${p.total.toLocaleString()}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => setShowLinkDropdown(false)}
                    className="mt-2 text-xs text-gray-500 hover:text-gray-700"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Accepted Proposal/Estimate Info */}
          {hasProposal && (
            <div className="mb-4 p-3 bg-green-50 rounded-lg border border-green-200">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-green-800">
                    {scope?.proposal_number || proposalMeta?.proposal_number || 'Proposal'}
                  </span>
                  {proposalMeta?.accepted_at && (
                    <span className="text-xs text-green-600 ml-2">
                      Accepted {new Date(proposalMeta.accepted_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
                {proposalMeta && (
                  <span className="text-sm font-bold text-green-800">
                    ${proposalMeta.total.toLocaleString()}
                  </span>
                )}
              </div>
              {hasSquareData && (
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <div className="rounded-md bg-white/70 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-green-700">Sold</div>
                    <div className="text-sm font-semibold text-green-900">
                      {soldRoofSquares != null ? `${soldRoofSquares.toFixed(1)} sq` : 'Not available'}
                    </div>
                  </div>
                  <div className="rounded-md bg-white/70 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-green-700">Measured</div>
                    <div className="text-sm font-semibold text-green-900">
                      {measuredSquares != null ? `${measuredSquares.toFixed(1)} sq` : 'Not available'}
                    </div>
                  </div>
                  <div className="rounded-md bg-white/70 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-green-700">Waste</div>
                    <div className="text-sm font-semibold text-green-900">
                      {effectiveWastePercent != null
                        ? `${wasteIsEstimateOnly ? 'Est. ' : ''}${effectiveWastePercent.toFixed(1)}%`
                        : 'Not available'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {showEstimateBox && estimateInfo && (
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
            <div className="mb-4">
              <h3 className="text-sm font-medium text-gray-700 mb-2">
                Proposal Items ({lineItems.length})
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

      {/* Additional Scope Items */}
      {additionalScope.length > 0 && (
        <div className="mt-4 pt-4 border-t">
          <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
            <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-xs rounded">Additional</span>
            Added Scope ({additionalScope.length})
          </h3>
          <div className="space-y-1">
            {additionalScope.map(item => (
              <div key={item.id} className="flex items-start justify-between py-1.5 border-b border-gray-100 last:border-0 group">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900">{item.description}</p>
                </div>
                <div className="text-right ml-4 flex-shrink-0 flex items-center gap-2">
                  <p className="text-sm text-gray-600">
                    {item.quantity} {item.unit}
                    {item.unit_price > 0 && (
                      <span className="text-gray-400 ml-1">@ ${item.unit_price}</span>
                    )}
                  </p>
                  <button
                    onClick={() => handleDeleteScopeItem(item.id)}
                    className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 p-1"
                    title="Delete"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Scope Item Form */}
      {showAddForm && (
        <div className="mt-4 pt-4 border-t">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Add Scope Item</h3>
          <div className="space-y-3">
            <div>
              <input
                type="text"
                placeholder="Description (e.g., Additional decking replacement)"
                value={newItem.description}
                onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-gray-500">Quantity</label>
                <input
                  type="number"
                  step="0.01"
                  value={newItem.quantity}
                  onChange={(e) => setNewItem({ ...newItem, quantity: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Unit</label>
                <select
                  value={newItem.unit}
                  onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                >
                  <option value="each">each</option>
                  <option value="squares">squares</option>
                  <option value="lf">lf (linear ft)</option>
                  <option value="sf">sf (sq ft)</option>
                  <option value="sheets">sheets</option>
                  <option value="hours">hours</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500">Unit Price ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={newItem.unit_price}
                  onChange={(e) => setNewItem({ ...newItem, unit_price: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
            </div>
            {parseFloat(newItem.quantity) > 0 && parseFloat(newItem.unit_price) > 0 && (
              <p className="text-sm text-gray-500">
                Total: ${(parseFloat(newItem.quantity) * parseFloat(newItem.unit_price)).toFixed(2)}
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleAddScopeItem}
                disabled={savingItem || !newItem.description.trim()}
                className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {savingItem ? 'Adding...' : 'Add Item'}
              </button>
              <button
                onClick={() => {
                  setShowAddForm(false)
                  setNewItem({ description: '', quantity: '1', unit: 'each', unit_price: '0' })
                }}
                className="px-4 py-2 text-gray-600 text-sm hover:text-gray-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      <AIJobPacketModal
        isOpen={packetModalOpen}
        onClose={() => setPacketModalOpen(false)}
        job={{
          scope_of_work: jobScopeOfWork,
          materials_notes: jobMaterialsNotes,
        }}
        proposals={proposalMeta ? [proposalMeta] : []}
        proposalLineItems={lineItems}
        jobCostLines={jobCostLines}
        notes={notes}
      />
    </div>
  )
}
