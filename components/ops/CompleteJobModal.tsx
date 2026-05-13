'use client'

import { useState } from 'react'
import { formatCurrency } from '@/lib/job-payments'

interface CompleteJobModalProps {
  jobId: string
  remainingCents: number
  onClose: () => void
  onConfirm: (reason?: string) => void
  /** complete = job not done yet; collect = close to payroll despite unpaid contract balance */
  variant?: 'complete' | 'collect'
}

export default function CompleteJobModal({
  jobId: _jobId,
  remainingCents,
  onClose,
  onConfirm,
  variant = 'complete',
}: CompleteJobModalProps) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const handleConfirm = async () => {
    setSaving(true)
    await onConfirm(reason || undefined)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
            <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">
              {variant === 'collect' ? 'Outstanding balance' : 'Balance Remaining'}
            </h3>
            <p className="text-sm text-gray-500">
              {variant === 'collect'
                ? 'Contract is not fully paid — you can still close for payroll'
                : 'This job has an unpaid balance'}
            </p>
          </div>
        </div>

        <div className="mb-6 p-4 bg-amber-50 rounded-lg border border-amber-200">
          <div className="flex items-center justify-between">
            <span className="text-amber-800 font-medium">Remaining Balance:</span>
            <span className="text-xl font-bold text-amber-700">
              {formatCurrency(remainingCents)}
            </span>
          </div>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          {variant === 'collect' ? (
            <>
              Mark <strong>collected</strong> moves this job to the closed list so payroll can run. The unpaid amount
              stays on record — you can add another payment later if money comes in (e.g. insurer releases withheld
              depreciation).
            </>
          ) : (
            <>Are you sure you want to mark this job as complete with an outstanding balance?</>
          )}
        </p>

        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Reason <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              variant === 'collect'
                ? 'e.g., Insurance depreciation short-paid — accepting balance'
                : 'e.g., Payment pending, Insurance claim, etc.'
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={saving}
            className="flex-1 px-4 py-2 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 disabled:opacity-50"
          >
            {saving
              ? variant === 'collect'
                ? 'Saving…'
                : 'Completing...'
              : variant === 'collect'
                ? 'Mark collected anyway'
                : 'Complete Anyway'}
          </button>
        </div>
      </div>
    </div>
  )
}
