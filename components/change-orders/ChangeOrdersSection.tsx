'use client'

import { useState } from 'react'
import ChangeOrderModal from './ChangeOrderModal'

interface ChangeOrder {
  id: string
  co_number: string
  signed_at: string
  customer_signed_at?: string | null
  updated_total: number
  pdf_url: string | null
  status?: string
  signing_token?: string | null
}

interface ChangeOrdersSectionProps {
  projectId: string
  projectAddress: string
  customerName: string
  customerEmail: string | null
  originalContractAmount: number
  originalContractDate: string | null
  originalContractId: string | null
  paymentMethod: string | null
  amountCollected: number
  jobId: string | null
  repName: string
  changeOrders: ChangeOrder[]
}

export default function ChangeOrdersSection({
  projectId,
  projectAddress,
  customerName,
  customerEmail,
  originalContractAmount,
  originalContractDate,
  originalContractId,
  paymentMethod,
  amountCollected,
  jobId,
  repName,
  changeOrders: initialChangeOrders,
}: ChangeOrdersSectionProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [changeOrders, setChangeOrders] = useState(initialChangeOrders)

  const getNextCoNumber = () => {
    if (changeOrders.length === 0) return 'CO-001'
    
    const maxNum = changeOrders.reduce((max, co) => {
      const num = parseInt(co.co_number.replace('CO-', ''), 10)
      return num > max ? num : max
    }, 0)
    
    return `CO-${String(maxNum + 1).padStart(3, '0')}`
  }

  const handleSuccess = () => {
    window.location.reload()
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount)
  }

  return (
    <div className="bg-white shadow rounded-lg p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-900">Change Orders</h2>
        <button
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 min-h-[44px]"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Change Order
        </button>
      </div>

      {changeOrders.length === 0 ? (
        <p className="text-gray-500 text-sm">No change orders yet.</p>
      ) : (
        <div className="space-y-3">
          {changeOrders.map((co) => (
            <div
              key={co.id}
              className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{co.co_number}</p>
                  <p className="text-sm text-gray-600">
                    {formatDate(co.customer_signed_at || co.signed_at)} • Updated Total: {formatCurrency(co.updated_total)}
                  </p>
                  {co.status === 'pending_customer' && (
                    <p className="text-xs text-amber-700 mt-1">Awaiting customer signature</p>
                  )}
                </div>
              </div>
              {co.status === 'pending_customer' && co.signing_token ? (
                <button
                  type="button"
                  onClick={() => {
                    const url = `${window.location.origin}/change-orders/sign/${co.signing_token}`
                    navigator.clipboard.writeText(url)
                    alert('Signing link copied to clipboard.')
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 min-h-[44px]"
                >
                  Copy Signing Link
                </button>
              ) : co.pdf_url ? (
                <a
                  href={co.pdf_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 min-h-[44px]"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  View PDF
                </a>
              ) : (
                <span className="text-sm text-gray-500 flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  PDF generating...
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <ChangeOrderModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        projectId={projectId}
        projectAddress={projectAddress}
        customerName={customerName}
        customerEmail={customerEmail}
        originalContractAmount={originalContractAmount}
        originalContractDate={originalContractDate}
        originalContractId={originalContractId}
        paymentMethod={paymentMethod}
        amountCollected={amountCollected}
        jobId={jobId}
        repName={repName}
        nextCoNumber={getNextCoNumber()}
        onSuccess={handleSuccess}
      />
    </div>
  )
}
