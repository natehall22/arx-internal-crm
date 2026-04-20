'use client'

import type { JobPaymentSummary } from '@/lib/types/job-payments'

type JobStatus = 'sold' | 'materials' | 'scheduled' | 'in_progress' | 'complete' | 'collected' | 'on_hold'

interface JobReadyToPayBannerProps {
  status: JobStatus
  paymentSummary: JobPaymentSummary | null
  saleAmount: number | null
  canViewBilling: boolean
  onMarkCollected: () => void
  onMarkJobComplete?: () => void
}

/**
 * Shown when recorded payments cover the contract (fully collected on the job).
 * CTA for payroll closeout + marking the job collected.
 */
export default function JobReadyToPayBanner({
  status,
  paymentSummary,
  saleAmount,
  canViewBilling,
  onMarkCollected,
  onMarkJobComplete,
}: JobReadyToPayBannerProps) {
  if (!canViewBilling || !paymentSummary) return null

  const saleCents = Math.round((saleAmount || 0) * 100)
  if (saleCents <= 0) return null

  const collected = paymentSummary.collected_cents ?? 0
  const fullyPaid = collected >= saleCents
  if (!fullyPaid || status === 'collected') return null

  const scrollPayroll = () => {
    const el =
      document.getElementById('payroll-attribution-section') || document.getElementById('payments-section')
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const scrollPayments = () => {
    document.getElementById('payments-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <div className="rounded-lg border border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 p-4 mb-6 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <span className="text-2xl leading-none shrink-0" aria-hidden>
            💵
          </span>
          <div>
            <div className="font-semibold text-emerald-900">Ready to pay</div>
            <p className="text-sm text-emerald-900/85 mt-0.5">
              Contract paid in full ({paymentSummary.collected_dollars.toLocaleString('en-US', {
                style: 'currency',
                currency: 'USD',
              })}{' '}
              of{' '}
              {paymentSummary.sale_amount_dollars.toLocaleString('en-US', {
                style: 'currency',
                currency: 'USD',
              })}
              ). Run payroll and close out when work is done.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={scrollPayroll}
            className="px-3 py-2 rounded-lg text-sm font-medium bg-white border border-emerald-300 text-emerald-900 hover:bg-emerald-50"
          >
            Payroll
          </button>
          <button
            type="button"
            onClick={scrollPayments}
            className="px-3 py-2 rounded-lg text-sm font-medium bg-white border border-emerald-300 text-emerald-900 hover:bg-emerald-50"
          >
            Payments
          </button>
          {status === 'complete' && (
            <button
              type="button"
              onClick={onMarkCollected}
              className="px-3 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700"
            >
              Mark as collected
            </button>
          )}
          {status !== 'complete' && status !== 'on_hold' && (
            <button
              type="button"
              onClick={() => onMarkJobComplete?.()}
              className="px-3 py-2 rounded-lg text-sm font-medium bg-emerald-700 text-white hover:bg-emerald-800"
            >
              Mark job complete
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
