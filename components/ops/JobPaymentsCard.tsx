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

  const handleDeletePayment = async (paymentId: string) => {
    if (!confirm('Delete this payment?')) return

    try {
      const response = await fetch(`/api/ops/jobs/${jobId}/payments/${paymentId}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        loadPayments()
        onPaymentChange?.()
      } else {
        alert('Failed to delete payment')
      }
    } catch (error) {
      console.error('Error deleting payment:', error)
      alert('Failed to delete payment')
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

      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 mb-4 sm:mb-6">
        <div className="p-3 bg-gray-50 rounded-lg">
          <div className="text-xs text-gray-700 mb-1">Sale Amount</div>
          <div className="text-base sm:text-lg font-semibold text-gray-900">
            {formatCurrency(saleAmountCents)}
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
        <div className="p-3 bg-indigo-50 rounded-lg">
          <div className="text-xs text-gray-700 mb-1">% Collected</div>
          <div className="text-base sm:text-lg font-semibold text-indigo-700">
            {percentCollected}%
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-4 sm:mb-6">
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <div 
            className="h-full bg-green-500 transition-all duration-300"
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
                  <button
                    onClick={() => handleDeletePayment(payment.id)}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:text-red-600"
                    title="Delete payment"
                  >
                    ✕
                  </button>
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
                      <button
                        onClick={() => handleDeletePayment(payment.id)}
                        className="text-gray-600 hover:text-red-600 text-xs"
                        title="Delete payment"
                      >
                        ✕
                      </button>
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
