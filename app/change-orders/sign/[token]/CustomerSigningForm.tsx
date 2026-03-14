'use client'

import { useState } from 'react'
import SignaturePad from '@/components/contracts/SignaturePad'

interface ChangeOrder {
  co_number: string
  description: string
  customer_print_name: string
  updated_total: number
}

interface CustomerSigningFormProps {
  changeOrder: ChangeOrder
  token: string
}

export default function CustomerSigningForm({ changeOrder, token }: CustomerSigningFormProps) {
  const [printName, setPrintName] = useState(changeOrder.customer_print_name || '')
  const [signature, setSignature] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!printName.trim()) {
      setError('Please enter your printed name.')
      return
    }
    if (!signature) {
      setError('Please add your signature.')
      return
    }

    setSubmitting(true)
    try {
      const response = await fetch('/api/change-orders/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          printName: printName.trim(),
          signature,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to sign change order')
      }

      setPdfUrl(data.pdfUrl || null)
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign change order')
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Change Order Signed</h1>
          <p className="text-gray-600 mb-5">Thank you. Your signed copy is now available.</p>
          {pdfUrl && (
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              Download Signed Change Order
            </a>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="max-w-2xl w-full bg-white rounded-xl shadow-lg p-6 space-y-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Sign Change Order {changeOrder.co_number}</h1>
          <p className="text-sm text-gray-600 mt-1">
            Please review the change summary below and sign electronically.
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 p-4 text-sm text-gray-800 space-y-2">
          <p><strong>Updated Total:</strong> ${Number(changeOrder.updated_total || 0).toLocaleString()}</p>
          <p><strong>Description:</strong> {changeOrder.description}</p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Print Name</label>
          <input
            value={printName}
            onChange={(e) => setPrintName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black bg-white"
            placeholder="Your full name"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Signature</label>
          <SignaturePad onChange={setSignature} value={signature} width={500} height={150} />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-60"
        >
          {submitting ? 'Submitting...' : 'Sign Change Order'}
        </button>
      </form>
    </div>
  )
}
