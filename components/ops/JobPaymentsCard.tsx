'use client'

import { useState, useEffect } from 'react'
import { 
  JobPayment, 
  JobPaymentSummary, 
  PaymentType, 
  PaymentMethod,
  PAYMENT_TYPE_LABELS, 
  PAYMENT_METHOD_LABELS 
} from '@/lib/types/job-payments'
import { formatCurrency } from '@/lib/job-payments'
import AddPaymentModal from './AddPaymentModal'

interface JobPaymentsCardProps {
  jobId: string
  saleAmount: number | null
}

export default function JobPaymentsCard({ jobId, saleAmount }: JobPaymentsCardProps) {
  const [summary, setSummary] = useState<JobPaymentSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)

  const loadPayments = async () => {
    try {
      const response = await fetch(`/api/ops/jobs/${jobId}/payments`)
      if (response.ok) {
        const data = await response.json()
        setSummary(data)
      }
    } catch (error) {
      console.error('Error loading payments:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPayments()
  }, [jobId])

  const handlePaymentAdded = () => {
    setShowModal(false)
    loadPayments()
  }

  const handleDeletePayment = async (paymentId: string) => {
    if (!confirm('Delete this payment?')) return

    try {
      const response = await fetch(`/api/ops/jobs/${jobId}/payments/${paymentId}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        loadPayments()
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
    <div className="bg-white rounded-xl shadow-sm border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Payments</h2>
        <button
          onClick={() => setShowModal(true)}
          className="text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
        >
          + Add Payment
        </button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="p-3 bg-gray-50 rounded-lg">
          <div className="text-xs text-gray-500 mb-1">Sale Amount</div>
          <div className="text-lg font-semibold text-gray-900">
            {formatCurrency(saleAmountCents)}
          </div>
        </div>
        <div className="p-3 bg-green-50 rounded-lg">
          <div className="text-xs text-gray-500 mb-1">Collected</div>
          <div className="text-lg font-semibold text-green-700">
            {formatCurrency(collectedCents)}
          </div>
        </div>
        <div className="p-3 bg-amber-50 rounded-lg">
          <div className="text-xs text-gray-500 mb-1">Remaining</div>
          <div className={`text-lg font-semibold ${remainingCents > 0 ? 'text-amber-700' : 'text-green-700'}`}>
            {formatCurrency(remainingCents)}
          </div>
        </div>
        <div className="p-3 bg-indigo-50 rounded-lg">
          <div className="text-xs text-gray-500 mb-1">% Collected</div>
          <div className="text-lg font-semibold text-indigo-700">
            {percentCollected}%
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-6">
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <div 
            className="h-full bg-green-500 transition-all duration-300"
            style={{ width: `${Math.min(percentCollected, 100)}%` }}
          />
        </div>
      </div>

      {/* Payments Table */}
      {loading ? (
        <div className="text-center py-4 text-gray-500 text-sm">Loading...</div>
      ) : summary?.payments && summary.payments.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 text-xs font-medium text-gray-500">Date</th>
                <th className="text-left py-2 text-xs font-medium text-gray-500">Type</th>
                <th className="text-left py-2 text-xs font-medium text-gray-500">Method</th>
                <th className="text-right py-2 text-xs font-medium text-gray-500">Amount</th>
                <th className="text-right py-2 text-xs font-medium text-gray-500"></th>
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
                    {PAYMENT_METHOD_LABELS[payment.method as PaymentMethod]}
                  </td>
                  <td className="py-2 text-right font-medium text-gray-900">
                    {formatCurrency(payment.amount_cents)}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => handleDeletePayment(payment.id)}
                      className="text-gray-400 hover:text-red-600 text-xs"
                      title="Delete payment"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {summary.payments.some(p => p.note) && (
            <div className="mt-3 space-y-1">
              {summary.payments.filter(p => p.note).map((payment) => (
                <div key={payment.id} className="text-xs text-gray-500">
                  <span className="font-medium">
                    {new Date(payment.paid_at + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })}:
                  </span>{' '}
                  {payment.note}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-6 text-gray-400 text-sm">
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
