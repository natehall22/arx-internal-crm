'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { formatCurrency } from '@/lib/job-payments'

interface CompleteJobModalProps {
  jobId: string
  remainingCents: number
  onClose: () => void
  onConfirm: (reason?: string) => void
  /** complete = job not done yet; collect = close to payroll despite unpaid contract balance */
  variant?: 'complete' | 'collect'
  /** collect only: viewer is a super admin (owner). Only they may close a job with a balance. */
  canForce?: boolean
}

export default function CompleteJobModal({
  jobId: _jobId,
  remainingCents,
  onClose,
  onConfirm,
  variant = 'complete',
  canForce = false,
}: CompleteJobModalProps) {
  const isCollect = variant === 'collect'
  // Closing with a balance is an owner decision and must say why (lib/job-collection.ts).
  const blocked = isCollect && !canForce
  const [mounted, setMounted] = useState(false)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => setMounted(true), [])

  const handleConfirm = async () => {
    if (blocked || (isCollect && !reason.trim())) return
    setSaving(true)
    await onConfirm(reason || undefined)
    setSaving(false)
  }

  const modalUi = (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-[100] sm:p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose()
      }}
    >
      <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl max-w-md w-full max-h-[92vh] overflow-y-auto p-5 sm:p-6">
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
                ? 'Payments recorded do not cover the contract'
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

        {isCollect ? (
          blocked ? (
            <p className="text-sm mb-6 p-3 rounded-lg border border-amber-300 bg-amber-50" style={{ color: '#2c2c2a' }}>
              Only an owner can close a job that still owes money. Record the missing payment first, or ask an owner to
              close it with a reason.
            </p>
          ) : (
            <>
              <p className="text-sm mb-4" style={{ color: '#2c2c2a' }}>
                Closing this job counts it as paid in full for payroll even though the payments don&apos;t add up. The
                unpaid amount stays on the job, and your name, the time and your reason are saved.
              </p>
              <div className="mb-6">
                <label className="block text-sm font-medium mb-1" style={{ color: '#2c2c2a' }}>
                  Reason <span className="font-normal">(required)</span>
                </label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g., Insurance kept depreciation — we are accepting the short pay"
                  autoComplete="off"
                  className="w-full min-h-[44px] px-3 py-2 border border-gray-400 rounded-lg text-base"
                  style={{ color: '#2c2c2a' }}
                />
              </div>
            </>
          )
        ) : (
          <p className="text-sm mb-6" style={{ color: '#2c2c2a' }}>
            Mark this job complete while money is still owed? It stays open for payments, and payroll won&apos;t pay it
            until it is paid in full.
          </p>
        )}

        <div className="sticky bottom-0 -mx-5 sm:mx-0 px-5 sm:px-0 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-white flex gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 min-h-[44px] px-4 py-2 border border-gray-300 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            {blocked ? 'Close' : 'Cancel'}
          </button>
          {!blocked && (
          <button
            onClick={handleConfirm}
            disabled={saving || (isCollect && !reason.trim())}
            className="flex-1 min-h-[44px] px-4 py-2 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 disabled:opacity-50"
          >
            {saving
              ? variant === 'collect'
                ? 'Saving…'
                : 'Completing...'
              : variant === 'collect'
                ? 'Close with balance'
                : 'Complete Anyway'}
          </button>
          )}
        </div>
      </div>
    </div>
  )

  if (!mounted || typeof document === 'undefined') return null

  return createPortal(modalUi, document.body)
}
