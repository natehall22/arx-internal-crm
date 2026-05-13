'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  customerId: string
}

export default function CreateAddOnOpportunityButton({ customerId }: Props) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createAddOnOpportunity = async () => {
    const ok = window.confirm(
      'Create a new add-on opportunity for this customer? This keeps the original completed project separate.'
    )
    if (!ok) return

    setCreating(true)
    setError(null)

    try {
      const response = await fetch(`/api/customers/${customerId}/add-on-opportunity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create add-on opportunity')
      }

      if (data.opportunity_id) {
        router.push(`/opportunities/${data.opportunity_id}`)
        return
      }

      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create add-on opportunity')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => void createAddOnOpportunity()}
        disabled={creating}
        className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        {creating ? 'Creating...' : 'New Add-On Opportunity'}
      </button>
      {error && <p className="max-w-xs text-right text-xs text-red-600">{error}</p>}
    </div>
  )
}
