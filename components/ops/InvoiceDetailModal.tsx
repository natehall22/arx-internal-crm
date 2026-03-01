'use client'

import { useState, useEffect } from 'react'
import { InvoiceWithItems, INVOICE_STATUS_LABELS, INVOICE_STATUS_COLORS, INVOICE_NOTE_TEMPLATES } from '@/lib/types/invoices'
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
  const [publicNote, setPublicNote] = useState('')
  const [internalNote, setInternalNote] = useState('')
  const [notesChanged, setNotesChanged] = useState(false)

  const loadInvoice = async () => {
    try {
      const response = await fetch(`/api/invoices/${invoiceId}`)
      if (response.ok) {
        const data = await response.json()
        setInvoice(data.invoice)
        setPublicNote(data.invoice?.public_note || '')
        setInternalNote(data.invoice?.internal_note || '')
        setNotesChanged(false)
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

  useEffect(() => {
    if (invoice && invoice.status === 'draft' && !publicNote && !notesChanged) {
      if (invoice.invoice_kind === 'deposit') {
        setPublicNote(INVOICE_NOTE_TEMPLATES.deposit)
      } else if (invoice.invoice_kind === 'final') {
        setPublicNote(INVOICE_NOTE_TEMPLATES.final)
      }
    }
  }, [invoice?.invoice_kind, invoice?.status])

  const handleInsertTemplate = (templateKey: keyof typeof INVOICE_NOTE_TEMPLATES) => {
    const template = INVOICE_NOTE_TEMPLATES[templateKey]
    if (publicNote && publicNote !== template) {
      if (!confirm('Replace existing note with template?')) return
    }
    setPublicNote(template)
    setNotesChanged(true)
  }

  const handleSaveNotes = async () => {
    setSaving(true)
    try {
      const response = await fetch(`/api/invoices/${invoiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_notes',
          public_note: publicNote,
          internal_note: internalNote,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setInvoice(data.invoice)
        setNotesChanged(false)
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to save notes')
      }
    } catch (error) {
      console.error('Error saving notes:', error)
    } finally {
      setSaving(false)
    }
  }

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
      <div className="bg-white border border-gray-200 rounded-lg shadow-md max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-200">
          <div>
            <h3 className="text-xl font-semibold text-gray-900">
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
            className="w-8 h-8 flex items-center justify-center rounded-full text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
          >
            <span className="text-lg">✕</span>
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-900">Loading...</div>
        ) : invoice ? (
          <>
            {/* Invoice Info */}
            <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
              <div>
                <span className="text-gray-600">Created:</span>{' '}
                <span className="text-gray-900 font-medium">{new Date(invoice.created_at).toLocaleDateString()}</span>
              </div>
              {invoice.sent_at && (
                <div>
                  <span className="text-gray-600">Sent:</span>{' '}
                  <span className="text-gray-900 font-medium">{new Date(invoice.sent_at).toLocaleDateString()}</span>
                </div>
              )}
              {invoice.due_at && (
                <div>
                  <span className="text-gray-600">Due:</span>{' '}
                  <span className="text-gray-900 font-medium">{new Date(invoice.due_at + 'T12:00:00').toLocaleDateString()}</span>
                </div>
              )}
              {invoice.sent_to_email && (
                <div>
                  <span className="text-gray-600">Sent to:</span>{' '}
                  <span className="text-gray-900 font-medium">{invoice.sent_to_email}</span>
                </div>
              )}
            </div>

            {/* Line Items Table */}
            <div className="border border-gray-200 rounded-lg overflow-hidden mb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Description</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-700 w-20">Qty</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-700 w-28">Unit Price</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-700 w-28">Total</th>
                    {isDraft && <th className="w-10"></th>}
                  </tr>
                </thead>
                <tbody>
                  {invoice.items.map((item, index) => (
                    <tr key={item.id} className={index > 0 ? 'border-t border-gray-100' : ''}>
                      <td className="px-4 py-3 text-gray-900">{item.description}</td>
                      <td className="px-4 py-3 text-right text-gray-900 font-medium tabular-nums">{item.qty}</td>
                      <td className="px-4 py-3 text-right text-gray-900 font-medium tabular-nums">{formatCurrency(item.unit_price_cents)}</td>
                      <td className="px-4 py-3 text-right text-gray-900 font-medium tabular-nums">{formatCurrency(item.line_total_cents)}</td>
                      {isDraft && (
                        <td className="px-2 py-3 text-center">
                          <button
                            onClick={() => handleDeleteItem(item.id)}
                            disabled={saving}
                            className={`text-red-600 hover:text-red-800 ${saving ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            ✕
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {invoice.items.length === 0 && (
                    <tr>
                      <td colSpan={isDraft ? 5 : 4} className="px-4 py-6 text-center text-gray-600">
                        No line items
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* Totals Section - Clean white background with borders */}
              <div className="border-t border-gray-200">
                <div className="flex justify-end px-4 py-3 border-b border-gray-100">
                  <span className="text-gray-600 mr-8">Subtotal:</span>
                  <span className="text-gray-900 font-medium tabular-nums w-28 text-right">{formatCurrency(invoice.subtotal_cents)}</span>
                  {isDraft && <span className="w-10"></span>}
                </div>
                <div className="flex justify-end px-4 py-3">
                  <span className="text-gray-900 font-semibold mr-8">Total:</span>
                  <span className="text-gray-900 font-semibold text-lg tabular-nums w-28 text-right">{formatCurrency(invoice.total_cents)}</span>
                  {isDraft && <span className="w-10"></span>}
                </div>
              </div>
            </div>

            {/* Add Item Form (Draft only) */}
            {isDraft && (
              <div className="mb-6">
                {showAddItem ? (
                  <form onSubmit={handleAddItem} className="border border-gray-200 rounded-lg p-4">
                    <div className="grid grid-cols-12 gap-3">
                      <div className="col-span-6">
                        <input
                          type="text"
                          placeholder="Description"
                          value={newItem.description}
                          onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
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
                          className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 tabular-nums focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
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
                          className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 tabular-nums focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                          required
                        />
                      </div>
                      <div className="col-span-2 flex gap-2">
                        <button
                          type="submit"
                          disabled={saving}
                          className={`flex-1 px-3 py-2 bg-indigo-600 text-white rounded text-sm font-medium hover:bg-indigo-700 ${saving ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          Add
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowAddItem(false)}
                          className="px-3 py-2 bg-white border border-gray-300 text-gray-700 rounded text-sm hover:bg-gray-50"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </form>
                ) : (
                  <button
                    onClick={() => setShowAddItem(true)}
                    className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    + Add Line Item
                  </button>
                )}
              </div>
            )}

            {/* Payment Summary */}
            {invoice.applied_cents > 0 && (
              <div className="border border-gray-200 rounded-lg p-4 mb-6">
                <div className="flex justify-between text-sm">
                  <span className="text-green-700 font-medium">Payments Applied:</span>
                  <span className="text-green-700 font-medium tabular-nums">-{formatCurrency(invoice.applied_cents)}</span>
                </div>
                <div className="flex justify-between text-sm mt-3 pt-3 border-t border-gray-200">
                  <span className={`font-semibold ${invoice.balance_cents <= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    Balance Due:
                  </span>
                  <span className={`font-semibold tabular-nums ${invoice.balance_cents <= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {invoice.balance_cents <= 0 ? 'PAID' : formatCurrency(invoice.balance_cents)}
                  </span>
                </div>
              </div>
            )}

            {/* Customer Note / Terms (Draft: editable, Sent+: read-only) */}
            {isDraft ? (
              <div className="mb-6 border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-900">Customer Note / Terms</label>
                  <span className="text-xs text-gray-600">Appears on PDF</span>
                </div>
                
                {/* Template buttons */}
                <div className="flex flex-wrap gap-1 mb-2">
                  <span className="text-xs text-gray-600 mr-1">Insert:</span>
                  <button
                    type="button"
                    onClick={() => handleInsertTemplate('deposit')}
                    className="text-xs px-2 py-0.5 bg-white border border-gray-300 rounded hover:bg-gray-50 text-gray-700"
                  >
                    Deposit Terms
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInsertTemplate('final')}
                    className="text-xs px-2 py-0.5 bg-white border border-gray-300 rounded hover:bg-gray-50 text-gray-700"
                  >
                    Final Terms
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInsertTemplate('net7')}
                    className="text-xs px-2 py-0.5 bg-white border border-gray-300 rounded hover:bg-gray-50 text-gray-700"
                  >
                    Net 7
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInsertTemplate('net14')}
                    className="text-xs px-2 py-0.5 bg-white border border-gray-300 rounded hover:bg-gray-50 text-gray-700"
                  >
                    Net 14
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInsertTemplate('due_upon_completion')}
                    className="text-xs px-2 py-0.5 bg-white border border-gray-300 rounded hover:bg-gray-50 text-gray-700"
                  >
                    Due Upon Completion
                  </button>
                </div>
                
                <textarea
                  value={publicNote}
                  onChange={(e) => { setPublicNote(e.target.value); setNotesChanged(true) }}
                  placeholder="Payment terms or notes for the customer..."
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 mb-3 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />

                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-900">Internal Note</label>
                  <span className="text-xs text-red-600 font-medium">Staff only - NOT on PDF</span>
                </div>
                <textarea
                  value={internalNote}
                  onChange={(e) => { setInternalNote(e.target.value); setNotesChanged(true) }}
                  placeholder="Internal notes (not visible to customer)..."
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />

                {notesChanged && (
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={handleSaveNotes}
                      disabled={saving}
                      className={`text-sm px-4 py-2 bg-indigo-600 text-white rounded font-medium hover:bg-indigo-700 ${saving ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {saving ? 'Saving...' : 'Save Notes'}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* Read-only public note for sent invoices */}
                {invoice.public_note && (
                  <div className="mb-6">
                    <div className="text-sm font-semibold text-gray-900 mb-2">Customer Note / Terms</div>
                    <div className="text-sm text-gray-900 border border-amber-200 bg-amber-50 rounded-lg p-3">
                      {invoice.public_note}
                    </div>
                  </div>
                )}
                {/* Read-only internal note for sent invoices */}
                {invoice.internal_note && (
                  <div className="mb-6">
                    <div className="text-sm font-semibold text-gray-900 mb-2">
                      Internal Note <span className="text-xs text-red-600 font-medium">(Staff only)</span>
                    </div>
                    <div className="text-sm text-gray-900 border border-gray-200 rounded-lg p-3">
                      {invoice.internal_note}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Legacy Notes (for backward compatibility) */}
            {invoice.notes && (
              <div className="mb-6">
                <div className="text-sm font-semibold text-gray-900 mb-2">Notes (Legacy)</div>
                <div className="text-sm text-gray-900 border border-gray-200 rounded-lg p-3">
                  {invoice.notes}
                </div>
              </div>
            )}

            {/* Void Info */}
            {invoice.status === 'void' && invoice.void_reason && (
              <div className="border border-red-200 rounded-lg p-4 mb-6">
                <div className="text-sm text-red-800">
                  <strong>Voided:</strong> {invoice.void_reason}
                </div>
                {invoice.voided_at && (
                  <div className="text-xs text-red-700 mt-1">
                    {new Date(invoice.voided_at).toLocaleString()}
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-between pt-4 border-t border-gray-200">
              <div>
                {!isDraft && invoice.status !== 'void' && (
                  <button
                    onClick={handleDuplicate}
                    disabled={saving}
                    className={`text-sm px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded font-medium hover:bg-gray-50 ${saving ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    Duplicate as Draft
                  </button>
                )}
              </div>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </>
        ) : (
          <div className="text-center py-8 text-gray-900">Invoice not found</div>
        )}
      </div>
    </div>
  )
}
