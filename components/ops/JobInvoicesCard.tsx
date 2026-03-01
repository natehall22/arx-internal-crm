'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { 
  JobInvoice, 
  InvoiceWithItems,
  INVOICE_STATUS_LABELS, 
  INVOICE_STATUS_COLORS,
  INVOICE_KIND_LABELS,
  DepositInfo,
} from '@/lib/types/invoices'
import { formatCurrency } from '@/lib/job-payments'
import SendInvoiceModal from './SendInvoiceModal'
import ApplyPaymentModal from './ApplyPaymentModal'
import InvoiceDetailModal from './InvoiceDetailModal'
import CreateInvoiceModal from './CreateInvoiceModal'

interface JobInvoicesCardProps {
  jobId: string
  saleAmount: number | null
  customerEmail?: string | null
  onInvoiceChange?: () => void
}

const defaultDepositInfo: DepositInfo = {
  hasDeposit: false,
  depositPayments: [],
  totalDepositCents: 0,
  saleAmountCents: 0,
  requiredDepositCents: 0,
  hasActiveDepositInvoice: false,
  appliedDepositCents: 0,
}

export default function JobInvoicesCard({ 
  jobId, 
  saleAmount, 
  customerEmail,
  onInvoiceChange 
}: JobInvoicesCardProps) {
  const router = useRouter()
  const [invoices, setInvoices] = useState<JobInvoice[]>([])
  const [depositInfo, setDepositInfo] = useState<DepositInfo>(defaultDepositInfo)
  const [loading, setLoading] = useState(true)
  const [showSendModal, setShowSendModal] = useState<string | null>(null)
  const [showApplyModal, setShowApplyModal] = useState<string | null>(null)
  const [showDetailModal, setShowDetailModal] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)

  const loadData = async () => {
    try {
      const response = await fetch(`/api/ops/jobs/${jobId}/invoices`, {
        cache: 'no-store',
      })
      if (response.ok) {
        const data = await response.json()
        setInvoices(data.invoices || [])
        if (data.depositInfo) {
          setDepositInfo(data.depositInfo)
        }
      }
    } catch (error) {
      console.error('Error loading invoices:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [jobId])

  const handleCreateInvoice = () => {
    // Always show modal to give user choice
    setShowCreateModal(true)
  }

  const handleInvoiceCreated = async () => {
    await loadData()
    router.refresh()
    onInvoiceChange?.()
  }

  const handleSendComplete = () => {
    setShowSendModal(null)
    loadData()
    router.refresh()
    onInvoiceChange?.()
  }

  const handleApplyComplete = () => {
    setShowApplyModal(null)
    loadData()
    router.refresh()
    onInvoiceChange?.()
  }

  const handleDetailClose = () => {
    setShowDetailModal(null)
    loadData()
  }

  const handleVoidInvoice = async (invoiceId: string) => {
    const reason = prompt('Enter reason for voiding this invoice:')
    if (!reason) return

    try {
      const response = await fetch(`/api/invoices/${invoiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'void', reason }),
      })

      if (response.ok) {
        loadData()
        router.refresh()
        onInvoiceChange?.()
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to void invoice')
      }
    } catch (error) {
      console.error('Error voiding invoice:', error)
      alert('Failed to void invoice')
    }
  }

  const handleViewPdf = async (invoiceId: string) => {
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/pdf`)
      const data = await response.json()
      
      if (response.ok && data.pdf_url) {
        window.open(data.pdf_url, '_blank')
      } else {
        alert(data.error || 'Failed to get PDF')
      }
    } catch (error) {
      console.error('Error getting PDF:', error)
      alert('Failed to get PDF')
    }
  }

  // Filter out void invoices for display purposes
  const activeInvoices = invoices.filter(i => i.status !== 'void')
  const voidedInvoices = invoices.filter(i => i.status === 'void')

  return (
    <div className="bg-white rounded-xl shadow-sm border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Invoices</h2>
        <button
          onClick={handleCreateInvoice}
          className="text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
        >
          + Create Invoice
        </button>
      </div>

      {loading ? (
        <div className="text-center py-4 text-gray-900 text-sm">Loading...</div>
      ) : activeInvoices.length > 0 ? (
        <div className="space-y-3">
          {activeInvoices.map((invoice) => (
            <div
              key={invoice.id}
              className="border rounded-lg p-4 hover:bg-gray-50"
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="font-medium text-gray-900 flex items-center gap-2">
                    {invoice.invoice_number}
                    {invoice.invoice_kind && invoice.invoice_kind !== 'standard' && (
                      <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-900 rounded">
                        {INVOICE_KIND_LABELS[invoice.invoice_kind]}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-900">
                    {invoice.sent_at ? (
                      <>Sent {new Date(invoice.sent_at).toLocaleDateString()}</>
                    ) : (
                      <>Created {new Date(invoice.created_at).toLocaleDateString()}</>
                    )}
                  </div>
                </div>
                <span className={`px-2 py-1 text-xs font-medium rounded-full ${INVOICE_STATUS_COLORS[invoice.status]}`}>
                  {INVOICE_STATUS_LABELS[invoice.status]}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                <div>
                  <span className="text-gray-900">Total:</span>{' '}
                  <span className="font-medium text-gray-900">{formatCurrency(invoice.total_cents)}</span>
                </div>
                {invoice.sent_to_email && (
                  <div className="text-gray-900 truncate" title={invoice.sent_to_email}>
                    To: {invoice.sent_to_email}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setShowDetailModal(invoice.id)}
                  className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-100 text-gray-900"
                >
                  View Details
                </button>

                {invoice.status !== 'draft' && invoice.status !== 'void' && (
                  <button
                    onClick={() => handleViewPdf(invoice.id)}
                    className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-100 text-gray-900"
                  >
                    View PDF
                  </button>
                )}

                {invoice.status === 'draft' && (
                  <button
                    onClick={() => setShowSendModal(invoice.id)}
                    className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    Send Invoice
                  </button>
                )}

                {['sent', 'partially_paid'].includes(invoice.status) && (
                  <button
                    onClick={() => setShowApplyModal(invoice.id)}
                    className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                  >
                    Apply Payment
                  </button>
                )}

                {invoice.status !== 'void' && invoice.status !== 'paid' && (
                  <button
                    onClick={() => handleVoidInvoice(invoice.id)}
                    className="text-xs px-2 py-1 text-red-600 border border-red-300 rounded hover:bg-red-50"
                  >
                    Void
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* Show voided invoices collapsed */}
          {voidedInvoices.length > 0 && (
            <details className="mt-4">
              <summary className="text-sm text-gray-700 cursor-pointer hover:text-gray-900">
                {voidedInvoices.length} voided invoice{voidedInvoices.length !== 1 ? 's' : ''}
              </summary>
              <div className="mt-2 space-y-2">
                {voidedInvoices.map((invoice) => (
                  <div
                    key={invoice.id}
                    className="border border-dashed border-gray-300 rounded-lg p-3 bg-gray-50 opacity-60"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-900">{invoice.invoice_number}</span>
                      <span className="text-xs text-red-600">Voided</span>
                    </div>
                    {invoice.void_reason && (
                      <p className="text-xs text-gray-700 mt-1">Reason: {invoice.void_reason}</p>
                    )}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      ) : (
        <div className="text-center py-6 text-gray-900 text-sm">
          No invoices yet
          {saleAmount && saleAmount > 0 && (
            <div className="mt-2">
              <button
                onClick={handleCreateInvoice}
                className="text-indigo-600 hover:text-indigo-800 underline"
              >
                Create first invoice
              </button>
            </div>
          )}
        </div>
      )}

      {showSendModal && (
        <SendInvoiceModal
          invoiceId={showSendModal}
          defaultEmail={customerEmail || ''}
          onClose={() => setShowSendModal(null)}
          onSent={handleSendComplete}
        />
      )}

      {showApplyModal && (
        <ApplyPaymentModal
          invoiceId={showApplyModal}
          onClose={() => setShowApplyModal(null)}
          onApplied={handleApplyComplete}
        />
      )}

      {showDetailModal && (
        <InvoiceDetailModal
          invoiceId={showDetailModal}
          onClose={handleDetailClose}
        />
      )}

      {showCreateModal && (
        <CreateInvoiceModal
          jobId={jobId}
          saleAmountCents={depositInfo.saleAmountCents || Math.round((saleAmount || 0) * 100)}
          depositInfo={depositInfo}
          onClose={() => setShowCreateModal(false)}
          onCreated={handleInvoiceCreated}
        />
      )}
    </div>
  )
}
