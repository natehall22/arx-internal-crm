'use client'

import { useState } from 'react'

interface SendInvoiceModalProps {
  invoiceId: string
  defaultEmail: string
  onClose: () => void
  onSent: () => void
}

export default function SendInvoiceModal({
  invoiceId,
  defaultEmail,
  onClose,
  onSent,
}: SendInvoiceModalProps) {
  const [email, setEmail] = useState(defaultEmail)
  const [sending, setSending] = useState(false)

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!email.trim()) {
      alert('Please enter an email address')
      return
    }

    setSending(true)
    try {
      const response = await fetch(`/api/invoices/${invoiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send', email: email.trim() }),
      })

      if (response.ok) {
        onSent()
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to send invoice')
      }
    } catch (error) {
      console.error('Error sending invoice:', error)
      alert('Failed to send invoice')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-bold text-gray-900">Send Invoice</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSend} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Send to Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="customer@example.com"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              required
            />
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
            <strong>Note:</strong> Once sent, this invoice cannot be edited. 
            You can void it and create a new one if changes are needed.
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={sending}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={sending}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {sending ? 'Sending...' : 'Send Invoice'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
