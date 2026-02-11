'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface DeleteLeadButtonProps {
  leadId: string
}

export default function DeleteLeadButton({ leadId }: DeleteLeadButtonProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this lead? This action cannot be undone.')) {
      return
    }

    setIsDeleting(true)
    setError(null)

    try {
      const response = await fetch(`/api/leads/${leadId}`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to delete lead')
        setIsDeleting(false)
        return
      }

      // Redirect to leads list
      router.push('/leads')
      router.refresh()
    } catch (err) {
      setError('Failed to delete lead')
      setIsDeleting(false)
    }
  }

  return (
    <div>
      <button
        onClick={handleDelete}
        disabled={isDeleting}
        className="px-4 py-2 text-sm font-medium text-red-600 border border-red-300 rounded-lg hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isDeleting ? 'Deleting...' : 'Delete Lead'}
      </button>
      {error && (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      )}
    </div>
  )
}
