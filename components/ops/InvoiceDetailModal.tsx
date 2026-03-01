'use client'

import { useState, useEffect } from 'react'
import { InvoiceWithItems, INVOICE_STATUS_LABELS, INVOICE_STATUS_COLORS } from '@/lib/types/invoices'
import { formatCurrency } from '@/lib/job-payments'

interface InvoiceDetailModalProps {
  invoiceId: string
  onClose: () => void
}

export default function InvoiceDetailModal({
  invoiceId,
  onClose,
}: InvoiceDetailModalProps) {
  const [invoice, setInvoice] = useState<InvoiceWithItems | null>(null)
  const [loading, setLoading] = useState(true)
  const [editingItem, setEditingItem] = useState<string | null>(null)
  const [newItem, setNewItem] = useState({ description: '', qty: '1', unit_price: '' })
  const [showAddItem, setShowAddItem] = useState(false)
  const [saving, setSaving] = useState(false)

  const loadInvoice = async () => {
    try {
      const response = await fetch(`/api/invoices/${invoiceId}`)
      if (response.ok) {
        const data = await response.json()
        setInvoice(data.invoice)
      }
    } catch (error) {
      console.error('Error loading invoice:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadInvoice()
  }, [invoiceId])

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newItem.description || !newItem.unit_price) return

    setSaving(true)
    try {
      const response = await fetch(`/api/invoices/${invoiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_item',
          description: newItem.description,
          qty: parseFloat(newItem.qty) || 1,
          unit_price_cents: Math.round(parseFloat(newItem.unit_price) * 100),
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setInvoice(data.invoice)
        setNewItem({ description: '', qty: '1', unit_price: '' })
        setShowAddItem(false)
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to add item')
      }
    } catch (error) {
      console.error('Error adding item:', error)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteItem = async (itemId: string) => {
    if (!confirm('Delete this line item?')) return

    setSaving(true)
    try {
      const response = await fetch(`/api/invoices/${invoiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_item', item_id: itemId }),
      })

      if (response.ok) {
        const data = await response.json()
        setInvoice(data.invoice)
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to delete item')
      }
    } catch (error) {
      console.error('Error deleting item:', error)
    } finally {
      setSaving(false)
    }
  }

  const handleDuplicate = async () => {
    setSaving(true)
    try {
      const response = await fetch(`/api/invoices/${invoiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'duplicate' }),
      })

      if (response.ok) {
        alert('Invoice duplicated as new draft')
        onClose()
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to duplicate invoice')
      }
    } catch (error) {
      console.error('Error duplicating invoice:', error)
    } finally {
      setSaving(false)
    }
  }

  const isDraft = invoice?.status === 'draft'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-bold text-gray-900">
              {invoice?.invoice_number || 'Invoice'}
            </h3>
            {invoice && (
              <span className={`inline-block mt-1 px-2 py-0.5 text-xs font-medium rounded-full ${INVOICE_STATUS_COLORS[invoice.status]}`}>
                {INVOICE_STATUS_LABELS[invoice.status]}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-500">Loading...</div>
        ) : invoice ? (
          <>
            {/* Invoice Info */}
            <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
              <div>
                <span className="text-gray-500">Created:</span>{' '}
                {new Date(invoice.created_at).toLocaleDateString()}
              </div>
              {invoice.sent_at && (
                <div>
                  <span className="text-gray-500">Sent:</span>{' '}
                  {new Date(invoice.sent_at).toLocaleDateString()}
                </div>
              )}
              {invoice.due_at && (
                <div>
                  <span className="text-gray-500">Due:</span>{' '}
                  {new Date(invoice.due_at + 'T12:00:00').toLocaleDateString()}
                </div>
              )}
              {invoice.sent_to_email && (
                <div>
                  <span className="text-gray-500">Sent to:</span>{' '}
                  {invoice.sent_to_email}
                </div>
              )}
            </div>

            {/* Line Items */}
            <div className="border rounded-lg overflow-hidden mb-6">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-gray-600">Description</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-600 w-20">Qty</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-600 w-28">Unit Price</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-600 w-28">Total</th>
                    {isDraft && <th className="w-10"></th>}
                  </tr>
                </thead>
                <tbody>
                  {invoice.items.map((item) => (
                    <tr key={item.id} className="border-t">
                      <td className="px-4 py-3">{item.description}</td>
                      <td className="px-4 py-3 text-right">{item.qty}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(item.unit_price_cents)}</td>
                      <td className="px-4 py-3 text-right font-medium">{formatCurrency(item.line_total_cents)}</td>
                      {isDraft && (
                        <td className="px-2 py-3">
                          <button
                            onClick={() => handleDeleteItem(item.id)}
                            disabled={saving}
                            className="text-red-500 hover:text-red-700 disabled:opacity-50"
                          >
                            ✕
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {invoice.items.length === 0 && (
                    <tr>
                      <td colSpan={isDraft ? 5 : 4} className="px-4 py-6 text-center text-gray-400">
                        No line items
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot className="bg-gray-50 border-t">
                  <tr>
                    <td colSpan={isDraft ? 3 : 2} className="px-4 py-3 text-right font-medium">
                      Subtotal:
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {formatCurrency(invoice.subtotal_cents)}
                    </td>
                    {isDraft && <td></td>}
                  </tr>
                  <tr>
                    <td colSpan={isDraft ? 3 : 2} className="px-4 py-3 text-right font-bold">
                      Total:
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-lg">
                      {formatCurrency(invoice.total_cents)}
                    </td>
                    {isDraft && <td></td>}
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Add Item Form (Draft only) */}
            {isDraft && (
              <div className="mb-6">
                {showAddItem ? (
                  <form onSubmit={handleAddItem} className="border rounded-lg p-4 bg-gray-50">
                    <div className="grid grid-cols-12 gap-3">
                      <div className="col-span-6">
                        <input
                          type="text"
                          placeholder="Description"
                          value={newItem.description}
                          onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                          required
                        />
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number"
                          placeholder="Qty"
                          step="0.01"
                          min="0.01"
                          value={newItem.qty}
                          onChange={(e) => setNewItem({ ...newItem, qty: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                        />
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number"
                          placeholder="Price"
                          step="0.01"
                          min="0"
                          value={newItem.unit_price}
                          onChange={(e) => setNewItem({ ...newItem, unit_price: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                          required
                        />
                      </div>
                      <div className="col-span-2 flex gap-2">
                        <button
                          type="submit"
                          disabled={saving}
                          className="flex-1 px-3 py-2 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700 disabled:opacity-50"
                        >
                          Add
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowAddItem(false)}
                          className="px-3 py-2 border border-gray-300 rounded text-sm hover:bg-gray-100"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </form>
                ) : (
                  <button
                    onClick={() => setShowAddItem(true)}
                    className="text-sm text-indigo-600 hover:text-indigo-800"
                  >
                    + Add Line Item
                  </button>
                )}
              </div>
            )}

            {/* Payment Summary */}
            {invoice.applied_cents > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
                <div className="flex justify-between text-sm">
                  <span className="text-green-800">Payments Applied:</span>
                  <span className="font-medium text-green-800">{formatCurrency(invoice.applied_cents)}</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-green-800 font-medium">Balance Due:</span>
                  <span className="font-bold text-green-800">{formatCurrency(invoice.balance_cents)}</span>
                </div>
              </div>
            )}

            {/* Notes */}
            {invoice.notes && (
              <div className="mb-6">
                <div className="text-sm font-medium text-gray-700 mb-1">Notes</div>
                <div className="text-sm text-gray-600 bg-gray-50 rounded p-3">
                  {invoice.notes}
                </div>
              </div>
            )}

            {/* Void Info */}
            {invoice.status === 'void' && invoice.void_reason && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
                <div className="text-sm text-red-800">
                  <strong>Voided:</strong> {invoice.void_reason}
                </div>
                {invoice.voided_at && (
                  <div className="text-xs text-red-600 mt-1">
                    {new Date(invoice.voided_at).toLocaleString()}
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-between pt-4 border-t">
              <div>
                {!isDraft && invoice.status !== 'void' && (
                  <button
                    onClick={handleDuplicate}
                    disabled={saving}
                    className="text-sm px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    Duplicate as Draft
                  </button>
                )}
              </div>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200"
              >
                Close
              </button>
            </div>
          </>
        ) : (
          <div className="text-center py-8 text-gray-500">Invoice not found</div>
        )}
      </div>
    </div>
  )
}
