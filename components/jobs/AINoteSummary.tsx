'use client'

import { useState } from 'react'
import { useAISettings } from '@/hooks/useAISettings'

type NoteType = {
  id: string
  note: string
  is_internal: boolean
  created_at: string
  user?: { full_name?: string | null } | null
}

interface AINoteSummaryProps {
  notes: NoteType[]
}

function parseSummary(result: unknown): string | null {
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

  if (!parsed || typeof parsed !== 'object') return null
  const summary = (parsed as any).summary
  if (typeof summary !== 'string' || !summary.trim()) return null
  return summary
}

export default function AINoteSummary({ notes }: AINoteSummaryProps) {
  const { aiEnabled } = useAISettings()
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [failed, setFailed] = useState(false)

  if (failed) return null
  if (!aiEnabled || notes.length < 3) return null

  const handleSummarize = async () => {
    setLoading(true)
    setDismissed(false)
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'notes_summary',
          context: {
            noteCount: notes.length,
            notes: notes.slice(-10).map((n) => ({
              author: n.user?.full_name ?? 'Unknown',
              text: n.note,
              date: n.created_at,
            })),
          },
        }),
      })

      if (!response.ok) {
        setFailed(true)
        return
      }

      const data = await response.json()
      const parsedSummary = parseSummary(data?.result)
      if (!parsedSummary) {
        setFailed(true)
        return
      }

      setSummary(parsedSummary)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mb-3">
      {!summary || dismissed ? (
        <button
          type="button"
          onClick={handleSummarize}
          disabled={loading}
          className="text-sm text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
        >
          {loading ? 'Summarizing...' : '✨ Summarize notes'}
        </button>
      ) : (
        <div className="relative rounded-lg border border-blue-200 bg-blue-50 p-3 text-blue-800">
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="absolute right-2 top-1 text-blue-700 hover:text-blue-900"
            aria-label="Dismiss summary"
          >
            ×
          </button>
          <p className="text-sm pr-6">{summary}</p>
        </div>
      )}
    </div>
  )
}
