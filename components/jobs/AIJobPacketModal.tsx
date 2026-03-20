'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAISettings } from '@/hooks/useAISettings'

interface AIJobPacketModalProps {
  isOpen: boolean
  onClose: () => void
  job: {
    scope_of_work: string | null
    materials_notes: string | null
  }
  proposals: Array<{
    id: string
    proposal_number: string
    total: number
    scope_of_work: string | null
    accepted_at: string | null
  }>
  proposalLineItems: Array<{
    id: string
    name: string
    description: string | null
    category: string | null
    quantity: number
    unit: string | null
    unit_price: number
    line_total: number
  }>
  jobCostLines: Array<{
    id: string
    description: string
    amount: number
    cost_type: string | null
    status: string | null
  }>
  notes: Array<{
    id: string
    note: string
    is_internal: boolean
    created_at: string
    user?: { full_name?: string | null } | null
  }>
}

type PacketSummaryResponse = {
  bullets: string[]
}

function parseResult(result: unknown): PacketSummaryResponse | null {
  if (!result) return null

  const parsed =
    typeof result === 'string'
      ? (() => {
          try {
            return JSON.parse(result)
          } catch {
            return null
          }
        })()
      : result

  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as any).bullets)) {
    return null
  }

  const bullets = (parsed as any).bullets.filter((b: unknown) => typeof b === 'string' && b.trim())
  if (!bullets.length) return null

  return { bullets }
}

export default function AIJobPacketModal({
  isOpen,
  onClose,
  job,
  proposals,
  proposalLineItems,
  notes,
}: AIJobPacketModalProps) {
  const { aiEnabled } = useAISettings()
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [fetchedForCycle, setFetchedForCycle] = useState(false)
  const [summary, setSummary] = useState<PacketSummaryResponse | null>(null)

  const acceptedProposal = useMemo(() => {
    const accepted = proposals.filter((p) => !!p.accepted_at)
    if (!accepted.length) return null
    return accepted.sort((a, b) => {
      const aTime = a.accepted_at ? new Date(a.accepted_at).getTime() : 0
      const bTime = b.accepted_at ? new Date(b.accepted_at).getTime() : 0
      return bTime - aTime
    })[0]
  }, [proposals])

  useEffect(() => {
    if (!isOpen) {
      setFetchedForCycle(false)
      setLoading(false)
      setFailed(false)
      return
    }

    if (!aiEnabled || fetchedForCycle) return

    const loadSummary = async () => {
      setLoading(true)
      setFailed(false)
      setFetchedForCycle(true)
      try {
        const response = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'job_packet_summary',
            context: {
              scopeOfWork: job.scope_of_work,
              proposalScope: acceptedProposal?.scope_of_work ?? null,
              lineItems: proposalLineItems.map((i) => `${i.quantity} ${i.unit ?? ''} ${i.name} @ $${i.unit_price}`.trim()),
              materialNotes: job.materials_notes,
              recentNotes: notes.filter((n) => n.is_internal).slice(-3).map((n) => n.note),
            },
          }),
        })

        if (!response.ok) {
          setFailed(true)
          return
        }

        const data = await response.json()
        const parsed = parseResult(data?.result)
        if (!parsed) {
          setFailed(true)
          return
        }
        setSummary(parsed)
      } catch {
        setFailed(true)
      } finally {
        setLoading(false)
      }
    }

    loadSummary()
  }, [isOpen, aiEnabled, fetchedForCycle, job, acceptedProposal, proposalLineItems, notes])

  if (!aiEnabled) return null
  if (!isOpen) return null
  if (failed) return null

  const handleCopy = async () => {
    if (!summary?.bullets?.length) return
    const text = summary.bullets.map((b) => `- ${b}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Silent failure by requirement.
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">✨ AI Crew Briefing</h3>
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">
            Close
          </button>
        </div>

        <div className="px-6 py-5">
          {loading ? (
            <p className="text-sm text-gray-600">Generating crew briefing...</p>
          ) : (
            <ul className="space-y-2">
              {(summary?.bullets || []).map((bullet, index) => (
                <li key={`${bullet}-${index}`} className="flex items-start gap-2 text-sm text-gray-800">
                  <span className="text-green-600 mt-0.5">✓</span>
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-4 text-xs text-gray-500">AI-generated — review before distributing to crew</p>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-2">
          <button
            onClick={handleCopy}
            disabled={loading || !summary?.bullets?.length}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Copy to Clipboard
          </button>
          <button
            onClick={onClose}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
