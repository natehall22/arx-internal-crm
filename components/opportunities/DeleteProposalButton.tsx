'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { userCanDeleteProposal } from '@/lib/proposal-delete-access'

type Props = {
  proposalId: string
  proposalNumber: string
  status: string
  createdBy: string | null | undefined
  currentUserId: string
  userRole: string
}

export default function DeleteProposalButton({
  proposalId,
  proposalNumber,
  status,
  createdBy,
  currentUserId,
  userRole,
}: Props) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)

  if (
    !currentUserId ||
    !userCanDeleteProposal({
      status,
      createdBy,
      currentUserId,
      role: userRole,
    })
  ) {
    return null
  }

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm(`Delete proposal ${proposalNumber}? This cannot be undone.`)) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/proposals/${proposalId}`, { method: 'DELETE', credentials: 'same-origin' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert((data as { error?: string }).error || 'Failed to delete proposal')
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
      className="shrink-0 p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
      title="Delete proposal"
    >
      {deleting ? (
        <span className="inline-block w-5 h-5 border-2 border-red-200 border-t-red-600 rounded-full animate-spin" />
      ) : (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
          />
        </svg>
      )}
    </button>
  )
}
