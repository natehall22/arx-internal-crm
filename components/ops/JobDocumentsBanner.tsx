'use client'

import Link from 'next/link'

/**
 * Single "Job documents" banner — replaces the former {@link JobRunSheetBanner} and
 * MaterialsOrderBanner, which were deliberate visual twins (same geometry, same yellow
 * primary button, differing only in hue and icon) for two DIFFERENT one-page documents:
 * the crew run sheet and the supplier order sheet. Two look-alike full-width banners was a
 * misclick waiting to happen on a phone, and cost two full bands of vertical space.
 *
 * This merges them into one banner with two clearly-labeled groups so the crew document and
 * the supplier document are never confused, while keeping every link, gating rule, and touch
 * target (44px+) from the originals unchanged.
 */
export default function JobDocumentsBanner({
  jobId,
  jobNumber,
  roofReportId,
  showOrderSheet,
  onEditOrderQuantities,
}: {
  jobId: string
  jobNumber: string
  /** Present only when the linked opportunity has a roof report with a generated PDF. */
  roofReportId?: string | null
  /** Gate identical to MaterialsOrderCard: job.sold_scope && job.job_type === 'roofing'. */
  showOrderSheet: boolean
  /** Switches to the materials tab on mobile and scrolls the order list into view. */
  onEditOrderQuantities: () => void
}) {
  const runSheetPdfUrl = `/api/ops/jobs/${jobId}/run-sheet/pdf`
  const orderSheetPdfUrl = `/api/ops/jobs/${jobId}/material-order/pdf`

  return (
    <div className="mb-4 rounded-xl bg-[#2b0a3d] p-3 shadow-sm sm:p-4">
      <h2 className="mb-3 px-1 text-xs font-bold uppercase tracking-wide text-white/70">
        Job documents — {jobNumber}
      </h2>
      <div className={`grid gap-3 ${showOrderSheet ? 'sm:grid-cols-2' : ''}`}>
        {/* Crew run sheet group */}
        <div className="rounded-lg bg-[#e6007a] p-3 sm:p-4">
          <div className="flex items-start gap-2.5">
            <svg
              className="mt-0.5 h-6 w-6 shrink-0 text-white"
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
            <div className="min-w-0">
              <p className="text-sm font-bold leading-tight text-white">Crew run sheet</p>
              <p className="text-xs leading-snug text-white/90">One page for the crew. Print it or email it.</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={runSheetPdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-[44px] items-center justify-center rounded-lg bg-[#fff100] px-4 py-2.5 sm:min-h-[36px] sm:py-1.5 text-sm font-extrabold uppercase tracking-wide text-[#c40068] hover:bg-[#ffe600]"
            >
              Open PDF
            </a>
            <Link
              href={`/ops/jobs/${jobId}/run-sheet`}
              className="flex min-h-[44px] items-center justify-center rounded-lg border-2 border-white px-4 py-2.5 sm:min-h-[36px] sm:py-1.5 text-sm font-bold text-white hover:bg-white/15"
            >
              Edit sheet
            </Link>
            {roofReportId && (
              <a
                href={`/api/inspection-reports/${roofReportId}/pdf?redirect=1`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-[44px] items-center justify-center rounded-lg border-2 border-white px-4 py-2.5 sm:min-h-[36px] sm:py-1.5 text-sm font-bold text-white hover:bg-white/15"
              >
                View Roof Report
              </a>
            )}
          </div>
        </div>

        {/* Supplier order sheet group — gated exactly like MaterialsOrderCard so this can never
            promise an order sheet the job has no measurement or sold scope to build. */}
        {showOrderSheet && (
          <div className="rounded-lg bg-[#7000e0] p-3 sm:p-4">
            <div className="flex items-start gap-2.5">
              <svg
                className="mt-0.5 h-6 w-6 shrink-0 text-white"
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
              <div className="min-w-0">
                <p className="text-sm font-bold leading-tight text-white">Supplier order sheet</p>
                <p className="text-xs leading-snug text-white/90">Everything to order. Send it straight to the supplier.</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={orderSheetPdfUrl}
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
                onClick={onEditOrderQuantities}
                className="flex min-h-[44px] items-center justify-center rounded-lg border-2 border-white px-4 py-2.5 sm:min-h-[36px] sm:py-1.5 text-sm font-bold text-white hover:bg-white/15"
              >
                Edit quantities
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
