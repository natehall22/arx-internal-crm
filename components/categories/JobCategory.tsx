'use client'

import * as React from 'react'

import CategoryField from '@/components/categories/CategoryField'

type State = { ready: boolean; jobCategory: string | null; customerCategory: string | null; canEdit: boolean }

/**
 * A job's category on the job page: "Same as customer (Residential)" by default; one tap on another category overrides it
 * for this job only (e.g. a residential customer's one-off new build). Loads its own state (GET /api/ops/jobs/[id]/category)
 * so both job page bodies render the same row. Shows nothing before the database update is applied, or when the company
 * has no categories on and the job has none.
 */
export default function JobCategory({ jobId }: { jobId: string }) {
  const [s, setS] = React.useState<State | null>(null)
  React.useEffect(() => {
    let live = true
    void fetch(`/api/ops/jobs/${jobId}/category`, { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<State>) : null))
      .catch(() => null)
      .then((d) => live && setS(d))
    return () => {
      live = false
    }
  }, [jobId])
  if (!s || !s.ready) return null
  return (
    <div className="mb-4 rounded-xl border bg-white p-4 shadow-sm sm:mb-6 sm:px-6" data-testid="job-category">
      <CategoryField url={`/api/ops/jobs/${jobId}/category`} value={s.jobCategory} inheritFrom={s.customerCategory} readOnly={!s.canEdit} label="Category for this job" />
    </div>
  )
}
