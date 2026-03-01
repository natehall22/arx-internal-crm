'use client'

import { useState, useEffect } from 'react'
import { formatCurrency } from '@/lib/job-payments'
import { PAYMENT_TYPE_LABELS, PAYMENT_METHOD_LABELS } from '@/lib/types/job-payments'

interface AvailablePayment {
  id: string
  paid_at: string
  amount_cents: number
  payment_type: string
  method: string
  remaining_cents: number
}

interface ApplyPaymentModalProps {
  invoiceId: string
  onClose: () => void
  onApplied: () => void
}

export default function ApplyPaymentModal({
  invoiceId,
  onClose,
  onApplied,
}: ApplyPaymentModalProps) {
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [availablePayments, setAvailablePayments] = useState<AvailablePayment[]>([])
  const [balance, setBalance] = useState({ total_cents: 0, applied_cents: 0, balance_cents: 0 })
  const [selectedPayment, setSelectedPayment] = useState<string>('')
  const [applyAmount, setApplyAmount] = useState('')

  useEffect(() => {
    const loadData = async () => {
      try {
        const response = await fetch(`/api/invoices/${invoiceId}/payments`)
        if (response.ok) {
          const data = await response.json()
          setAvailablePayments(data.available_payments || [])
          setBalance(data.balance)
        }
      } catch (error) {
        console.error('Error loading payment data:', error)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [invoiceId])

  const selectedPaymentData = availablePayments.find(p => p.id === selectedPayment)

  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!selectedPayment) {
      alert('Please select a payment')
      return
    }

    const amountDollars = parseFloat(applyAmount)
    if (isNaN(amountDollars) || amountDollars <= 0) {
      alert('Please enter a valid amount')
      return
    }

    const appliedCents = Math.round(amountDollars * 100)

    if (selectedPaymentData && appliedCents > selectedPaymentData.remaining_cents) {
      alert(`Cannot apply more than ${formatCurrency(selectedPaymentData.remaining_cents)} from this payment`)
      return
    }

    if (appliedCents > balance.balance_cents) {
      alert(`Cannot apply more than the invoice balance of ${formatCurrency(balance.balance_cents)}`)
      return
    }

    setApplying(true)
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_payment_id: selectedPayment,
          applied_cents: appliedCents,
        }),
      })

      if (response.ok) {
        onApplied()
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to apply payment')
      }
    } catch (error) {
      console.error('Error applying payment:', error)
      alert('Failed to apply payment')
    } finally {
      setApplying(false)
    }
  }

  const handleSelectPayment = (paymentId: string) => {
    setSelectedPayment(paymentId)
    const payment = availablePayments.find(p => p.id === paymentId)
    if (payment) {
      const maxApply = Math.min(payment.remaining_cents, balance.balance_cents)
      setApplyAmount((maxApply / 100).toFixed(2))
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-bold text-gray-900">Apply Payment to Invoice</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-500">Loading...</div>
        ) : (
          <>
            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="text-gray-500">Invoice Total</div>
                  <div className="font-semibold">{formatCurrency(balance.total_cents)}</div>
                </div>
                <div>
                  <div className="text-gray-500">Applied</div>
                  <div className="font-semibold text-green-600">{formatCurrency(balance.applied_cents)}</div>
                </div>
                <div>
                  <div className="text-gray-500">Balance Due</div>
                  <div className="font-semibold text-amber-600">{formatCurrency(balance.balance_cents)}</div>
                </div>
              </div>
            </div>

            {availablePayments.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>No available payments to apply.</p>
                <p className="text-sm mt-2">Record a payment on this job first.</p>
              </div>
            ) : (
              <form onSubmit={handleApply} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select Payment
                  </label>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {availablePayments.map((payment) => (
                      <label
                        key={payment.id}
                        className={`flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50 ${
                          selectedPayment === payment.id ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200'
                        }`}
                      >
                        <input
                          type="radio"
                          name="payment"
                          value={payment.id}
                          checked={selectedPayment === payment.id}
                          onChange={() => handleSelectPayment(payment.id)}
                          className="mr-3"
                        />
                        <div className="flex-1">
                          <div className="flex justify-between">
                            <span className="font-medium">
                              {new Date(payment.paid_at + 'T12:00:00').toLocaleDateString()}
                            </span>
                            <span className="text-green-600 font-medium">
                              {formatCurrency(payment.remaining_cents)} available
                            </span>
                          </div>
                          <div className="text-sm text-gray-500">
                            {PAYMENT_TYPE_LABELS[payment.payment_type as keyof typeof PAYMENT_TYPE_LABELS] || payment.payment_type}
                            {' · '}
                            {PAYMENT_METHOD_LABELS[payment.method as keyof typeof PAYMENT_METHOD_LABELS] || payment.method}
                            {' · '}
                            Total: {formatCurrency(payment.amount_cents)}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {selectedPayment && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Amount to Apply ($)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={(selectedPaymentData?.remaining_cents || 0) / 100}
                      value={applyAmount}
                      onChange={(e) => setApplyAmount(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      required
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Max: {formatCurrency(Math.min(selectedPaymentData?.remaining_cents || 0, balance.balance_cents))}
                    </p>
                  </div>
                )}

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={applying}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={applying || !selectedPayment}
                    className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50"
                  >
                    {applying ? 'Applying...' : 'Apply Payment'}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  )
}
