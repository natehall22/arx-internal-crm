'use client'

import Link from 'next/link'

/**
 * Front-and-centre entry point to the one-page materials order sheet.
 *
 * Deliberately the visual twin of {@link JobRunSheetBanner}: same geometry, same yellow primary
 * action, different hue. Ops has two one-pagers they actually send — the run sheet to the crew and
 * this one to the supplier — and they should look like a matched pair sitting together at the top
 * of the job, not one loud banner plus a collapsed accordion halfway down the page that nobody
 * finds. Touch targets are 44px+ per the field-UI rules.
 */
export default function MaterialsOrderBanner({
  jobId,
  jobNumber,
  onEditQuantities,
}: {
  jobId: string
  jobNumber: string
  /** Switches to the materials tab on mobile and scrolls the order list into view. */
  onEditQuantities: () => void
}) {
  return (
    <div className="mb-4 rounded-xl bg-[#7000e0] p-4 shadow-sm sm:px-5 sm:py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex items-start gap-3 sm:items-center">
          <svg
            className="mt-0.5 h-7 w-7 shrink-0 text-white sm:mt-0 sm:h-6 sm:w-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
            />
          </svg>
          <div>
            <h2 className="text-base font-bold leading-tight text-white sm:text-[17px]">
              Materials Order Sheet — {jobNumber}
            </h2>
            <p className="text-sm leading-snug text-white/90">
              Everything to order for this job on one page. Send it straight to the supplier.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:shrink-0">
          <a
            href={`/api/ops/jobs/${jobId}/material-order/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[44px] items-center justify-center rounded-lg bg-[#fff100] px-4 py-2.5 sm:min-h-[36px] sm:py-1.5 text-sm font-extrabold uppercase tracking-wide text-[#3d0080] hover:bg-[#ffe600]"
          >
            Open PDF
          </a>
          <Link
            href={`/ops/jobs/${jobId}/material-order/print`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[44px] items-center justify-center rounded-lg border-2 border-white px-4 py-2.5 sm:min-h-[36px] sm:py-1.5 text-sm font-bold text-white hover:bg-white/15"
          >
            Order sheet
          </Link>
          <button
            type="button"
            onClick={onEditQuantities}
            className="flex min-h-[44px] items-center justify-center rounded-lg border-2 border-white px-4 py-2.5 sm:min-h-[36px] sm:py-1.5 text-sm font-bold text-white hover:bg-white/15"
          >
            Edit quantities
          </button>
        </div>
      </div>
    </div>
  )
}
