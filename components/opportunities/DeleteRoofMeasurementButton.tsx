'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function DeleteRoofMeasurementButton({ measurementId }: { measurementId: string }) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (!confirm('Delete this roof measurement? This cannot be undone.')) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/measurements/${measurementId}`, { method: 'DELETE', credentials: 'same-origin' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert((data as { error?: string }).error || 'Failed to delete')
        return
      }
      router.refresh()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={deleting}
      className="text-sm font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
    >
      {deleting ? 'Deleting…' : 'Delete'}
    </button>
  )
}
