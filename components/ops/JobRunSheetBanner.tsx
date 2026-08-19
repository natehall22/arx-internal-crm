'use client'

import Link from 'next/link'

/**
 * Front-and-centre entry point to the one-page job run sheet.
 *
 * Ops asked for this to be unmissable — it is the first card on the job page on every breakpoint,
 * and the loud magenta is deliberate so a field user thumbing through on a phone lands on it
 * without hunting. Touch targets are 44px+ per the field-UI rules.
 */
export default function JobRunSheetBanner({
  jobId,
  jobNumber,
}: {
  jobId: string
  jobNumber: string
}) {
  const pdfUrl = `/api/ops/jobs/${jobId}/run-sheet/pdf`

  return (
    <div className="mb-4 rounded-xl bg-[#e6007a] p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <svg
            className="mt-0.5 h-7 w-7 shrink-0 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
            />
          </svg>
          <div>
            <h2 className="text-lg font-bold leading-tight text-white sm:text-xl">
              Job Run Sheet — {jobNumber}
            </h2>
            <p className="text-sm text-white/90">
              One page with everything needed to run this job. Print it or email it to the crew.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:shrink-0">
          <a
            href={pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[44px] items-center justify-center rounded-lg bg-[#fff100] px-5 py-2.5 text-sm font-extrabold uppercase tracking-wide text-[#c40068] hover:bg-[#ffe600]"
          >
            Open PDF
          </a>
          <Link
            href={`/ops/jobs/${jobId}/run-sheet`}
            className="flex min-h-[44px] items-center justify-center rounded-lg border-2 border-white px-5 py-2.5 text-sm font-bold text-white hover:bg-white/15"
          >
            Edit sheet
          </Link>
        </div>
      </div>
    </div>
  )
}
