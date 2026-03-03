'use client'

import { useState, useEffect } from 'react'
import { createClientBrowser } from '@/lib/supabase/client'

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
    const supabase = createClientBrowser()

    const { data } = await supabase
      .from('production_job_notes')
      .select('id, note, is_internal, share_with_sub, created_at, user:users(full_name)')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })
      .limit(limit)

    const transformedNotes: JobNote[] = (data || []).map((n: any) => ({
      id: n.id,
      note: n.note,
      is_internal: n.is_internal,
      share_with_sub: n.share_with_sub ?? false,
      created_at: n.created_at,
      user: Array.isArray(n.user) ? n.user[0] : n.user,
    }))

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
