'use client'

import { useState, useEffect, useCallback } from 'react'
import { 
  JobPayment, 
  JobPaymentSummary, 
  PaymentType, 
  PaymentMethod,
  PaymentPayer,
  PAYMENT_TYPE_LABELS, 
  PAYMENT_METHOD_LABELS,
  PAYMENT_PAYER_LABELS,
} from '@/lib/types/job-payments'
import { formatCurrency } from '@/lib/job-payments'
import AddPaymentModal from './AddPaymentModal'
import { toast } from '@/components/ui/toast'
import { undoRefusal, undoKey } from '@/lib/job-payment-undo-rules'

interface JobPaymentsCardProps {
  jobId: string
  saleAmount: number | null
  onPaymentChange?: () => void
}

export default function JobPaymentsCard({ jobId, saleAmount, onPaymentChange }: JobPaymentsCardProps) {
  const [summary, setSummary] = useState<JobPaymentSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)

  const loadPayments = useCallback(async () => {
    try {
      const response = await fetch(`/api/ops/jobs/${jobId}/payments`, {
        cache: 'no-store',
      })
      if (response.ok) {
        const data = await response.json()
        setSummary(data)
      }
    } catch (error) {
      console.error('Error loading payments:', error)
    } finally {
      setLoading(false)
    }
  }, [jobId])

  useEffect(() => {
    loadPayments()
  }, [loadPayments])

  const handlePaymentAdded = () => {
    setShowModal(false)
    loadPayments()
    onPaymentChange?.()
  }

  const [undoing, setUndoing] = useState<JobPayment | null>(null)
  const [reason, setReason] = useState('')
  const [undoBusy, setUndoBusy] = useState(false)
  const undone = new Set((summary?.payments ?? []).map((p) => p.idempotency_key).filter((k): k is string => !!k && k.startsWith('undo:')))
  const canUndo = (p: JobPayment) => !undone.has(undoKey(p.id)) && !undoRefusal(p)

  const submitUndo = async () => {
    if (!undoing || !reason.trim()) return
    setUndoBusy(true)
    try {
      const response = await fetch(`/api/ops/jobs/${jobId}/payments/${undoing.id}/undo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      })
      if (response.ok) {
        setUndoing(null)
        setReason('')
        loadPayments()
        onPaymentChange?.()
      } else {
        const data = await response.json().catch(() => ({}))
        toast.error(data.error || 'Could not undo this payment')
      }
    } catch (error) {
      console.error('Error undoing payment:', error)
      toast.error('Could not undo this payment')
    } finally {
      setUndoBusy(false)
    }
  }

  const saleAmountCents = Math.round((saleAmount || 0) * 100)
  const collectedCents = summary?.collected_cents || 0
  const remainingCents = saleAmountCents - collectedCents
  const percentCollected = saleAmountCents > 0 
    ? Math.round((collectedCents / saleAmountCents) * 100) 
    : 0

  return (
    <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base sm:text-lg font-semibold text-gray-900">Payments</h2>
        <button
          onClick={() => setShowModal(true)}
          className="min-h-[44px] text-sm px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
        >
          + Add Payment
        </button>
      </div>

      {/* Summary stats + progress bar directly under Collected / Remaining */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 mb-2">
        <div className="p-3 bg-gray-50 rounded-lg">
          <div className="text-xs text-gray-700 mb-1">Sale Amount</div>
          <div className="text-base sm:text-lg font-semibold text-gray-900">
            {formatCurrency(saleAmountCents)}
          </div>
        </div>
        <div className="p-3 bg-indigo-50 rounded-lg">
          <div className="text-xs text-gray-700 mb-1">% Collected</div>
          <div className="text-base sm:text-lg font-semibold text-indigo-700">
            {percentCollected}%
          </div>
        </div>
        <div className="p-3 bg-green-50 rounded-lg">
          <div className="text-xs text-gray-700 mb-1">Collected</div>
          <div className="text-base sm:text-lg font-semibold text-green-700">
            {formatCurrency(collectedCents)}
          </div>
        </div>
        <div className="p-3 bg-amber-50 rounded-lg">
          <div className="text-xs text-gray-700 mb-1">Remaining</div>
          <div className={`text-base sm:text-lg font-semibold ${remainingCents > 0 ? 'text-amber-700' : 'text-green-700'}`}>
            {formatCurrency(remainingCents)}
          </div>
        </div>
      </div>

      <div className="mb-4 sm:mb-6">
        <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-gray-700">
          <span>Collected</span>
          <span>Remaining</span>
        </div>
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 transition-all duration-300 rounded-full"
            style={{ width: `${Math.min(percentCollected, 100)}%` }}
          />
        </div>
      </div>

      {/* Payments List - Mobile card layout, desktop table */}
      {loading ? (
        <div className="text-center py-4 text-gray-700 text-sm">Loading...</div>
      ) : summary?.payments && summary.payments.length > 0 ? (
        <>
          {/* Mobile card layout */}
          <div className="sm:hidden space-y-3">
            {summary.payments.map((payment) => (
              <div key={payment.id} className="p-3 bg-gray-50 rounded-lg">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="font-medium text-gray-900">
                      {formatCurrency(payment.amount_cents)}
                    </div>
                    <div className="text-xs text-gray-600">
                      {new Date(payment.paid_at + 'T12:00:00').toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        timeZone: 'America/New_York',
                      })}
                    </div>
                  </div>
                  {canUndo(payment) && (
                    <button
                      onClick={() => setUndoing(payment)}
                      className="min-h-[44px] px-3 text-sm font-medium text-red-700"
                    >
                      Undo payment
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="px-2 py-1 bg-white rounded text-gray-700">
                    {PAYMENT_TYPE_LABELS[payment.payment_type as PaymentType]}
                  </span>
                  <span className="px-2 py-1 bg-white rounded text-gray-700">
                    {PAYMENT_PAYER_LABELS[payment.payer as PaymentPayer]}
                  </span>
                  <span className="px-2 py-1 bg-white rounded text-gray-700">
                    {PAYMENT_METHOD_LABELS[payment.method as PaymentMethod]}
                  </span>
                </div>
                {payment.note && (
                  <p className="mt-2 text-xs text-gray-600 break-words">{payment.note}</p>
                )}
              </div>
            ))}
          </div>

          {/* Desktop table layout */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 text-xs font-medium text-gray-700">Date</th>
                  <th className="text-left py-2 text-xs font-medium text-gray-700">Type</th>
                  <th className="text-left py-2 text-xs font-medium text-gray-700">Payer</th>
                  <th className="text-left py-2 text-xs font-medium text-gray-700">Method</th>
                  <th className="text-right py-2 text-xs font-medium text-gray-700">Amount</th>
                  <th className="text-left py-2 text-xs font-medium text-gray-700 pl-3">Note</th>
                  <th className="text-right py-2 text-xs font-medium text-gray-700"></th>
                </tr>
              </thead>
              <tbody>
                {summary.payments.map((payment) => (
                  <tr key={payment.id} className="border-b last:border-0">
                    <td className="py-2 text-gray-900">
                      {new Date(payment.paid_at + 'T12:00:00').toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        timeZone: 'America/New_York',
                      })}
                    </td>
                    <td className="py-2 text-gray-700">
                      {PAYMENT_TYPE_LABELS[payment.payment_type as PaymentType]}
                    </td>
                    <td className="py-2 text-gray-700">
                      {PAYMENT_PAYER_LABELS[payment.payer as PaymentPayer]}
                    </td>
                    <td className="py-2 text-gray-700">
                      {PAYMENT_METHOD_LABELS[payment.method as PaymentMethod]}
                    </td>
                    <td className="py-2 text-right font-medium text-gray-900">
                      {formatCurrency(payment.amount_cents)}
                    </td>
                    <td className="py-2 text-gray-700 text-xs pl-3 max-w-[150px] truncate" title={payment.note || ''}>
                      {payment.note || '—'}
                    </td>
                    <td className="py-2 text-right">
                      {canUndo(payment) && (
                        <button
                          onClick={() => setUndoing(payment)}
                          className="min-h-[44px] px-2 text-sm font-medium text-red-700 hover:underline"
                        >
                          Undo payment
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="text-center py-6 text-gray-600 text-sm">
          No payments recorded
        </div>
      )}

      {undoing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-t-2xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:rounded-2xl">
            <h3 className="text-lg font-semibold text-gray-900">Undo this {formatCurrency(undoing.amount_cents)} payment?</h3>
            <p className="mt-1 text-sm text-gray-900">
              The payment stays on the list with a matching minus line, so the history is kept. The balance comes back.
            </p>
            <label className="mt-3 block text-sm font-medium text-gray-900" htmlFor="undo-reason">Why?</label>
            <input
              id="undo-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              placeholder="Check bounced, entered on the wrong job…"
              className="mt-1 w-full min-h-[44px] rounded-lg border border-gray-400 px-3 text-base text-gray-900"
              autoFocus
            />
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button onClick={() => { setUndoing(null); setReason('') }} className="min-h-[44px] rounded-lg border border-gray-400 px-4 text-gray-900">
                Keep it
              </button>
              <button
                onClick={submitUndo}
                disabled={undoBusy || !reason.trim()}
                className="min-h-[44px] rounded-lg bg-red-700 px-4 font-medium text-white disabled:opacity-50"
              >
                {undoBusy ? 'Undoing…' : 'Undo payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <AddPaymentModal
          jobId={jobId}
          onClose={() => setShowModal(false)}
          onSave={handlePaymentAdded}
        />
      )}
    </div>
  )
}
