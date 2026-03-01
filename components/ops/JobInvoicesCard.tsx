'use client'

import { useState, useEffect } from 'react'
import { 
  JobInvoice, 
  InvoiceWithItems,
  INVOICE_STATUS_LABELS, 
  INVOICE_STATUS_COLORS 
} from '@/lib/types/invoices'
import { formatCurrency } from '@/lib/job-payments'
import SendInvoiceModal from './SendInvoiceModal'
import ApplyPaymentModal from './ApplyPaymentModal'
import InvoiceDetailModal from './InvoiceDetailModal'
import CreateInvoiceModal from './CreateInvoiceModal'

interface DepositInfo {
  hasDeposit: boolean
  depositPaymentId: string | null
  depositAmountCents: number
}

interface JobInvoicesCardProps {
  jobId: string
  saleAmount: number | null
  customerEmail?: string | null
  onInvoiceChange?: () => void
}

export default function JobInvoicesCard({ 
  jobId, 
  saleAmount, 
  customerEmail,
  onInvoiceChange 
}: JobInvoicesCardProps) {
  const [invoices, setInvoices] = useState<JobInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceWithItems | null>(null)
  const [showSendModal, setShowSendModal] = useState<string | null>(null)
  const [showApplyModal, setShowApplyModal] = useState<string | null>(null)
  const [showDetailModal, setShowDetailModal] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [depositChecked, setDepositChecked] = useState(false)
  const [depositInfo, setDepositInfo] = useState<DepositInfo>({
    hasDeposit: false,
    depositPaymentId: null,
    depositAmountCents: 0,
  })

  const loadInvoices = async () => {
    try {
      const response = await fetch(`/api/ops/jobs/${jobId}/invoices`, {
        cache: 'no-store',
      })
      if (response.ok) {
        const data = await response.json()
        setInvoices(data.invoices || [])
      }
    } catch (error) {
      console.error('Error loading invoices:', error)
    } finally {
      setLoading(false)
    }
  }

  const checkForDeposit = async (): Promise<DepositInfo> => {
    try {
      const response = await fetch(`/api/ops/jobs/${jobId}/payments`, {
        cache: 'no-store',
      })
      if (response.ok) {
        const data = await response.json()
        // API returns JobPaymentSummary with payments array
        const payments = data.payments || []
        const depositPayment = payments.find(
          (p: any) => p.payment_type === 'deposit' && p.amount_cents > 0
        )
        if (depositPayment) {
          const info: DepositInfo = {
            hasDeposit: true,
            depositPaymentId: depositPayment.id,
            depositAmountCents: depositPayment.amount_cents,
          }
          setDepositInfo(info)
          setDepositChecked(true)
          return info
        }
      }
    } catch (error) {
      console.error('Error checking for deposit:', error)
    }
    const noDeposit: DepositInfo = {
      hasDeposit: false,
      depositPaymentId: null,
      depositAmountCents: 0,
    }
    setDepositInfo(noDeposit)
    setDepositChecked(true)
    return noDeposit
  }

  useEffect(() => {
    loadInvoices()
    checkForDeposit()
  }, [jobId])

  const handleCreateInvoice = async () => {
    // Check for deposit (always fresh check when creating first invoice)
    let currentDepositInfo = depositInfo
    if (invoices.length === 0) {
      currentDepositInfo = await checkForDeposit()
    }

    // If no invoices exist and deposit is detected, show modal
    if (invoices.length === 0 && currentDepositInfo.hasDeposit) {
      setShowCreateModal(true)
      return
    }

    // Otherwise create full invoice directly
    setCreating(true)
    try {
      const response = await fetch(`/api/ops/jobs/${jobId}/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_from_job_total: true }),
      })

      if (response.ok) {
        await loadInvoices()
        onInvoiceChange?.()
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to create invoice')
      }
    } catch (error) {
      console.error('Error creating invoice:', error)
      alert('Failed to create invoice')
    } finally {
      setCreating(false)
    }
  }

  const handleInvoiceCreated = async () => {
    await loadInvoices()
    await checkForDeposit()
    onInvoiceChange?.()
  }

  const handleSendComplete = () => {
    setShowSendModal(null)
    loadInvoices()
    onInvoiceChange?.()
  }

  const handleApplyComplete = () => {
    setShowApplyModal(null)
    loadInvoices()
    onInvoiceChange?.()
  }

  const handleDetailClose = () => {
    setShowDetailModal(null)
    loadInvoices()
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
        loadInvoices()
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
      if (response.ok) {
        const data = await response.json()
        if (data.pdf_url) {
          window.open(data.pdf_url, '_blank')
        } else {
          alert('PDF not available')
        }
      } else {
        alert('Failed to get PDF')
      }
    } catch (error) {
      console.error('Error getting PDF:', error)
      alert('Failed to get PDF')
    }
  }

  const getInvoiceBalance = (invoice: JobInvoice) => {
    return invoice.total_cents
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Invoices</h2>
        <button
          onClick={handleCreateInvoice}
          disabled={creating}
          className="text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {creating ? 'Creating...' : '+ Create Invoice'}
        </button>
      </div>

      {loading ? (
        <div className="text-center py-4 text-gray-500 text-sm">Loading...</div>
      ) : invoices.length > 0 ? (
        <div className="space-y-3">
          {invoices.map((invoice) => (
            <div
              key={invoice.id}
              className="border rounded-lg p-4 hover:bg-gray-50"
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="font-medium text-gray-900">
                    {invoice.invoice_number}
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
                  <span className="font-medium">{formatCurrency(invoice.total_cents)}</span>
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
        </div>
      ) : (
        <div className="text-center py-6 text-gray-600 text-sm">
          No invoices yet
          {saleAmount && saleAmount > 0 && (
            <div className="mt-2">
              <button
                onClick={handleCreateInvoice}
                disabled={creating}
                className="text-indigo-600 hover:text-indigo-800 underline"
              >
                Create first invoice for {formatCurrency(Math.round(saleAmount * 100))}
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
          saleAmountCents={Math.round((saleAmount || 0) * 100)}
          depositInfo={depositInfo}
          onClose={() => setShowCreateModal(false)}
          onCreated={handleInvoiceCreated}
        />
      )}
    </div>
  )
}
