'use client'

import { useState } from 'react'
import { 
  PaymentType, 
  PaymentMethod,
  PAYMENT_TYPE_LABELS, 
  PAYMENT_METHOD_LABELS 
} from '@/lib/types/job-payments'

interface AddPaymentModalProps {
  jobId: string
  onClose: () => void
  onSave: () => void
}

const PAYMENT_TYPES: PaymentType[] = [
  'deposit',
  'insurance_acv',
  'insurance_supplement',
  'deductible',
  'final',
  'other',
]

const PAYMENT_METHODS: PaymentMethod[] = [
  'check',
  'cash',
  'ach',
  'card',
  'financing',
  'insurance',
  'other',
]

export default function AddPaymentModal({ jobId, onClose, onSave }: AddPaymentModalProps) {
  const [saving, setSaving] = useState(false)
  const [formData, setFormData] = useState({
    paid_at: new Date().toISOString().split('T')[0],
    amount: '',
    payment_type: 'deposit' as PaymentType,
    method: 'check' as PaymentMethod,
    note: '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    const amountDollars = parseFloat(formData.amount)
    if (isNaN(amountDollars) || amountDollars <= 0) {
      alert('Please enter a valid amount')
      return
    }

    setSaving(true)

    try {
      const response = await fetch(`/api/ops/jobs/${jobId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paid_at: formData.paid_at,
          amount_cents: Math.round(amountDollars * 100),
          payment_type: formData.payment_type,
          method: formData.method,
          note: formData.note || null,
        }),
      })

      if (response.ok) {
        onSave()
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to add payment')
      }
    } catch (error) {
      console.error('Error adding payment:', error)
      alert('Failed to add payment')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-bold text-gray-900">Add Payment</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Date
            </label>
            <input
              type="date"
              value={formData.paid_at}
              onChange={(e) => setFormData({ ...formData, paid_at: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Amount ($)
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={formData.amount}
              onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
              placeholder="0.00"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Payment Type
            </label>
            <select
              value={formData.payment_type}
              onChange={(e) => setFormData({ ...formData, payment_type: e.target.value as PaymentType })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              {PAYMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {PAYMENT_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Method
            </label>
            <select
              value={formData.method}
              onChange={(e) => setFormData({ ...formData, method: e.target.value as PaymentMethod })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {PAYMENT_METHOD_LABELS[method]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Note <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={formData.note}
              onChange={(e) => setFormData({ ...formData, note: e.target.value })}
              placeholder="Check #1234, etc."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Add Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
