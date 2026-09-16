'use client'

import { useState } from 'react'

export type SolarCandidatePeek = {
  candidateId: string
  ownerName: string | null
}

interface Props {
  candidate: SolarCandidatePeek
  /** Called after a successful save so the map can drop or recolor the marker. */
  onAnswered: (candidateId: string, hasSolar: boolean) => void
  onClose: () => void
}

/**
 * The question a purple ring is asking, answered at the curb.
 *
 * Two buttons and a name. No explanation of where the marker came from or why we
 * want to know — a rep on a doorstep needs the fact, not the reasoning. "No" is
 * given the same visual weight as "Yes" on purpose: it is real feedback on the
 * detector, not a way to dismiss the prompt, and under-weighting it would bias
 * the answers we get back.
 */
export default function SolarVerifySheet({ candidate, onAnswered, onClose }: Props) {
  const [saving, setSaving] = useState<null | boolean>(null)
  const [error, setError] = useState<string | null>(null)

  const answer = async (hasSolar: boolean) => {
    setSaving(hasSolar)
    setError(null)
    try {
      const res = await fetch('/api/canvass/solar/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId: candidate.candidateId, hasSolar }),
      })
      if (!res.ok) throw new Error(String(res.status))
      onAnswered(candidate.candidateId, hasSolar)
      onClose()
    } catch {
      // Say what to do, not what broke.
      setError('Not saved. Check signal and try again.')
      setSaving(null)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-lg rounded-t-2xl bg-white shadow-xl animate-slide-up">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="text-lg font-semibold text-[#2c2c2a]">Solar on this house?</h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 p-2 text-gray-500 hover:text-gray-700"
            aria-label="Close"
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4 p-4">
          {candidate.ownerName ? (
            <p className="text-sm font-semibold uppercase tracking-wide text-[#2c2c2a]">
              {candidate.ownerName}
            </p>
          ) : null}

          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">{error}</p>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => answer(true)}
              disabled={saving !== null}
              className="rounded-xl bg-[#2c2c2a] py-4 text-base font-bold text-white shadow-sm active:scale-[0.99] disabled:opacity-60"
            >
              {saving === true ? 'Saving…' : 'Yes'}
            </button>
            <button
              type="button"
              onClick={() => answer(false)}
              disabled={saving !== null}
              className="rounded-xl border-2 border-[#2c2c2a] bg-white py-4 text-base font-bold text-[#2c2c2a] active:scale-[0.99] disabled:opacity-60"
            >
              {saving === false ? 'Saving…' : 'No'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
