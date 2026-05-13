'use client'

import { useState } from 'react'
import type { JobPaymentSummary } from '@/lib/types/job-payments'

type JobStatus = 'sold' | 'materials' | 'scheduled' | 'in_progress' | 'complete' | 'collected' | 'on_hold'

interface JobPayrollSentBannerProps {
  jobId: string
  status: JobStatus
  payrollSentAt: string | null
  paymentSummary: JobPaymentSummary | null
  saleAmount: number | null
  /** When true, job may be marked collected despite contract balance (e.g. insurer short-paid depreciation). */
  allowCloseWithBalance?: boolean | null
  canViewBilling: boolean
  onUpdated: () => void | Promise<void>
}

/**
 * Internal payroll handoff: after the job is complete or collected and the contract is paid,
 * ops marks "Ready for payroll" → persisted as payroll_sent_at ("Sent to payroll").
 */
export default function JobPayrollSentBanner({
  jobId,
  status,
  payrollSentAt,
  paymentSummary,
  saleAmount,
  allowCloseWithBalance,
  canViewBilling,
  onUpdated,
}: JobPayrollSentBannerProps) {
  const [saving, setSaving] = useState(false)

  if (!canViewBilling || !paymentSummary) return null

  const saleCents = Math.round((saleAmount || 0) * 100)
  if (saleCents <= 0) return null

  const collected = paymentSummary.collected_cents ?? 0
  const fullyPaid = collected >= saleCents
  const collectedShortClosed =
    status === 'collected' && Boolean(allowCloseWithBalance) && !fullyPaid

  if (!fullyPaid && !collectedShortClosed) return null

  if (status !== 'complete' && status !== 'collected') return null

  const formattedSent = payrollSentAt
    ? new Date(payrollSentAt).toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'America/New_York',
      })
    : null

  const markSent = async () => {
    if (saving || payrollSentAt) return
    setSaving(true)
    try {
      const res = await fetch(`/api/ops/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payroll_sent_at: new Date().toISOString() }),
      })
      const errBody = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(typeof errBody.error === 'string' ? errBody.error : 'Could not update payroll status')
        return
      }
      await onUpdated()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 mb-6 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <span className="text-2xl leading-none shrink-0" aria-hidden>
            📋
          </span>
          <div>
            <div className="font-semibold text-indigo-900">Payroll</div>
            {payrollSentAt ? (
              <p className="text-sm text-indigo-900/90 mt-0.5">
                Sent to payroll
                {formattedSent ? ` · ${formattedSent} ET` : ''}
              </p>
            ) : (
              <p className="text-sm text-indigo-900/90 mt-0.5">
                {collectedShortClosed ? (
                  <>
                    Job is marked collected with a documented unpaid balance (e.g. insurer withheld depreciation).
                    You can still send this job to payroll; record additional payments later if funds arrive.
                  </>
                ) : (
                  <>Contract is paid in full. When you&apos;re ready, mark this job as sent to payroll.</>
                )}
              </p>
            )}
          </div>
        </div>
        {!payrollSentAt && (
          <button
            type="button"
            disabled={saving}
            onClick={markSent}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 shrink-0"
          >
            {saving ? 'Saving…' : 'Ready for payroll'}
          </button>
        )}
      </div>
    </div>
  )
}
