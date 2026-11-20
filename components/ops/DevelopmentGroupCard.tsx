'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'

import type { OpsBoardJob } from '@/lib/ops-board-types'
import { formatDate } from '@/lib/format'
import { isJobPastDue } from '@/lib/job-status'

/**
 * Job Board: a builder's lots in one development, in one stage, as ONE card ("Oak Ridge · 40 lots"). "Show lots" opens the
 * normal job cards underneath; "Open development" goes to the lot-by-trade grid (/ops/developments).
 */
export default function DevelopmentGroupCard({
  name,
  builder,
  customerId,
  jobs,
  renderJob,
}: {
  name: string
  builder: string | null
  customerId: string | null
  jobs: OpsBoardJob[]
  renderJob: (job: OpsBoardJob) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const dates = jobs.map((j) => j.scheduled_date).filter((d): d is string => Boolean(d)).sort()
  const overdue = jobs.filter((j) => isJobPastDue(j)).length
  const urgent = jobs.filter((j) => j.priority === 'urgent').length
  const stuck = jobs.filter((j) => j.catch_up?.stuck).length
  const flags = [overdue && `${overdue} overdue`, urgent && `${urgent} urgent`, stuck && `${stuck} stuck`].filter(Boolean).join(' · ')
  const lots = jobs.map((j) => j.development?.lot).filter((l): l is string => Boolean(l))
  const href = `/ops/developments?development=${encodeURIComponent(name)}${customerId ? `&customer=${encodeURIComponent(customerId)}` : ''}`
  return (
    <div className="rounded-lg border-2 border-gray-300 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-[#2c2c2a]">{name}</p>
          {builder && <p className="truncate text-sm text-[#2c2c2a]">{builder}</p>}
        </div>
        <span className="shrink-0 rounded-full bg-gray-900 px-2.5 py-1 text-sm font-semibold text-white">
          {jobs.length} lots
        </span>
      </div>
      {flags && <p className="mt-2 text-sm font-semibold text-red-700">{flags}</p>}
      {lots.length > 0 && (
        <p className="mt-2 line-clamp-2 text-sm text-[#2c2c2a]">
          Lots {lots.slice(0, 12).join(', ')}
          {lots.length > 12 ? ` +${lots.length - 12} more` : ''}
        </p>
      )}
      {dates.length > 0 && (
        <p className="mt-1 text-sm text-[#2c2c2a]">
          {dates.length === jobs.length ? 'Booked' : `${dates.length} booked`}: {formatDate(dates[0])}
          {dates[dates.length - 1] !== dates[0] ? ` – ${formatDate(dates[dates.length - 1])}` : ''}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="min-h-[44px] flex-1 rounded-md border border-gray-300 px-3 text-sm font-semibold text-[#2c2c2a] hover:bg-gray-50"
        >
          {open ? 'Hide lots' : 'Show lots'}
        </button>
        <Link
          href={href}
          className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md bg-gray-900 px-3 text-sm font-semibold text-white hover:bg-gray-800"
        >
          Open development
        </Link>
      </div>
      {open && <div className="mt-3 space-y-3">{jobs.map((j) => renderJob(j))}</div>}
    </div>
  )
}
