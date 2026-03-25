'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

type Props = {
  leadId: string
  hasOpportunity: boolean
}

export default function CreateOpportunityFromLeadButton({
  leadId,
  hasOpportunity,
}: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    if (hasOpportunity || loading) return
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`/api/leads/${leadId}/opportunity`, {
        method: 'POST',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Could not create opportunity')
        return
      }
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/80 p-4">
      <p className="text-xs text-gray-500 mb-3">
        Use this only when an opportunity was not created automatically (for example, inspection outcome did not
        convert). If one already exists, this stays disabled.
      </p>
      {hasOpportunity && (
        <p className="text-xs text-gray-400 mb-2">An opportunity is already linked to this lead.</p>
      )}
      <button
        type="button"
        onClick={handleClick}
        disabled={hasOpportunity || loading}
        className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 disabled:opacity-80"
      >
        {loading ? 'Creating…' : 'Create opportunity from lead'}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  )
}
