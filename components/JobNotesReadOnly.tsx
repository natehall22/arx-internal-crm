'use client'

import { useState, useEffect } from 'react'

interface JobNote {
  id: string
  note: string
  is_internal: boolean
  share_with_sub: boolean
  created_at: string
  user: { full_name: string } | null
}

interface JobNotesReadOnlyProps {
  jobId: string
  limit?: number
}

export default function JobNotesReadOnly({ jobId, limit = 5 }: JobNotesReadOnlyProps) {
  const [loading, setLoading] = useState(true)
  const [notes, setNotes] = useState<JobNote[]>([])

  useEffect(() => {
    loadNotes()
  }, [jobId])

  const loadNotes = async () => {
    // Notes live in the deal thread now; the server adapter applies the audience rules.
    const res = await fetch(`/api/ops/jobs/${jobId}/notes`, { cache: 'no-store' }).catch(() => null)
    const body = res && res.ok ? await res.json() : { notes: [] }
    const transformedNotes: JobNote[] = ((body.notes ?? []) as Array<{ id: string; note: string; created_at: string; user: { full_name: string | null } | null }>)
      .slice(0, limit)
      .map((n) => ({ id: n.id, note: n.note, is_internal: true, share_with_sub: false, created_at: n.created_at, user: n.user as JobNote['user'] }))

    setNotes(transformedNotes)
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-2">
        <div className="h-4 bg-gray-200 rounded w-3/4"></div>
        <div className="h-4 bg-gray-200 rounded w-1/2"></div>
      </div>
    )
  }

  if (notes.length === 0) {
    return <p className="text-sm text-gray-500">No job notes yet.</p>
  }

  return (
    <div className="space-y-3">
      {notes.map(note => (
        <div key={note.id} className="border-b border-gray-100 pb-3 last:border-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-gray-900">
              {note.user?.full_name || 'Unknown'}
            </span>
            <span className="text-xs text-gray-500">
              {new Date(note.created_at).toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit'
              })}
            </span>
          </div>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{note.note}</p>
          {note.is_internal && (
            <span className="inline-block mt-1 text-xs text-gray-400">Internal</span>
          )}
        </div>
      ))}
    </div>
  )
}
