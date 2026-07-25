'use client'

import { useState } from 'react'
import ReviewRequestCard from './ReviewRequestCard'

export type OpsReviewRow = {
  jobId: string
  jobNumber: string | null
  customerName: string | null
  address: string | null
  completedAt: string | null
  repName: string | null
  ageDays: number | null
}

function ageBadge(days: number | null): { text: string; cls: string } | null {
  if (days == null) return null
  if (days >= 7) return { text: `${days}d waiting`, cls: 'bg-red-100 text-red-800' }
  if (days >= 3) return { text: `${days}d waiting`, cls: 'bg-amber-100 text-amber-800' }
  return { text: `${days}d`, cls: 'bg-gray-100 text-gray-700' }
}

export default function OpsReviewBackstopList({ rows }: { rows: OpsReviewRow[] }) {
  const [remaining, setRemaining] = useState(rows)
  const remove = (jobId: string) => setRemaining((r) => r.filter((x) => x.jobId !== jobId))

  if (remaining.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <p className="text-sm font-semibold text-gray-900">All caught up 🎉</p>
        <p className="mt-1 text-sm text-gray-600">Every completed job has a review request out.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {remaining.map((row) => {
        const age = ageBadge(row.ageDays)
        return (
          <div key={row.jobId} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-gray-900">{row.customerName || 'Customer'}</p>
                {age && (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${age.cls}`}>{age.text}</span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-gray-600">
                {row.jobNumber ? `Job ${row.jobNumber}` : ''}
                {row.jobNumber && row.address ? ' • ' : ''}
                {row.address || ''}
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                Closer: {row.repName || 'Unassigned'}
                {row.completedAt ? ` • Completed ${new Date(row.completedAt).toLocaleDateString()}` : ''}
              </p>
            </div>
            <div className="mt-3 border-t border-gray-100 pt-3">
              <ReviewRequestCard jobId={row.jobId} variant="compact" onSent={() => remove(row.jobId)} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
