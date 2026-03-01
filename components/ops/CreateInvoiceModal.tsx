'use client'

import { useState } from 'react'
import { formatCurrency } from '@/lib/job-payments'

interface DepositInfo {
  hasDeposit: boolean
  depositPaymentId: string | null
  depositAmountCents: number
}

interface CreateInvoiceModalProps {
  jobId: string
  saleAmountCents: number
  depositInfo: DepositInfo
  onClose: () => void
  onCreated: () => void
}

export default function CreateInvoiceModal({
  jobId,
  saleAmountCents,
  depositInfo,
  onClose,
  onCreated,
}: CreateInvoiceModalProps) {
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreateDepositInvoice = async () => {
    setCreating(true)
    setError(null)
    try {
      const response = await fetch(`/api/ops/jobs/${jobId}/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_type: 'deposit',
          deposit_payment_id: depositInfo.depositPaymentId,
          deposit_amount_cents: depositInfo.depositAmountCents,
        }),
      })

      if (response.ok) {
        onCreated()
        onClose()
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to create invoice')
      }
    } catch (err) {
      setError('Failed to create invoice')
    } finally {
      setCreating(false)
    }
  }

  const handleCreateFullInvoice = async () => {
    setCreating(true)
    setError(null)
    try {
      const response = await fetch(`/api/ops/jobs/${jobId}/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_from_job_total: true }),
      })

      if (response.ok) {
        onCreated()
        onClose()
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to create invoice')
      }
    } catch (err) {
      setError('Failed to create invoice')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Create Invoice</h2>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
            {error}
          </div>
        )}

        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="font-medium text-blue-900">Deposit Detected</span>
          </div>
          <p className="text-sm text-blue-800">
            A deposit payment of <strong>{formatCurrency(depositInfo.depositAmountCents)}</strong> has been recorded.
          </p>
        </div>

        <div className="space-y-3">
          <button
            onClick={handleCreateDepositInvoice}
            disabled={creating}
            className="w-full p-4 border-2 border-green-500 rounded-lg hover:bg-green-50 text-left transition disabled:opacity-50"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-gray-900">Deposit Invoice</div>
                <div className="text-sm text-gray-600">
                  {formatCurrency(depositInfo.depositAmountCents)} - Auto-applies deposit payment
                </div>
              </div>
              <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded">
                Recommended
              </span>
            </div>
          </button>

          <button
            onClick={handleCreateFullInvoice}
            disabled={creating}
            className="w-full p-4 border border-gray-300 rounded-lg hover:bg-gray-50 text-left transition disabled:opacity-50"
          >
            <div className="font-medium text-gray-900">Full Contract Invoice</div>
            <div className="text-sm text-gray-600">
              {formatCurrency(saleAmountCents)} - Deposit not auto-applied
            </div>
          </button>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            disabled={creating}
            className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900"
          >
            Cancel
          </button>
        </div>

        {creating && (
          <div className="absolute inset-0 bg-white/80 flex items-center justify-center rounded-lg">
            <div className="text-gray-600">Creating invoice...</div>
          </div>
        )}
      </div>
    </div>
  )
}
