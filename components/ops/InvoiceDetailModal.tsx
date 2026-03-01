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

  // Auto-prefill public_note based on invoice_kind (only if empty)
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

            {/* Customer Note / Terms (Draft: editable, Sent+: read-only) */}
            {isDraft ? (
              <div className="mb-6 border rounded-lg p-4 bg-gray-50">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-900">Customer Note / Terms</label>
                  <span className="text-xs text-gray-500">Appears on PDF</span>
                </div>
                
                {/* Template buttons */}
                <div className="flex flex-wrap gap-1 mb-2">
                  <span className="text-xs text-gray-500 mr-1">Insert:</span>
                  <button
                    type="button"
                    onClick={() => handleInsertTemplate('deposit')}
                    className="text-xs px-2 py-0.5 bg-white border border-gray-300 rounded hover:bg-gray-100 text-gray-700"
                  >
                    Deposit Terms
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInsertTemplate('final')}
                    className="text-xs px-2 py-0.5 bg-white border border-gray-300 rounded hover:bg-gray-100 text-gray-700"
                  >
                    Final Terms
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInsertTemplate('net7')}
                    className="text-xs px-2 py-0.5 bg-white border border-gray-300 rounded hover:bg-gray-100 text-gray-700"
                  >
                    Net 7
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInsertTemplate('net14')}
                    className="text-xs px-2 py-0.5 bg-white border border-gray-300 rounded hover:bg-gray-100 text-gray-700"
                  >
                    Net 14
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInsertTemplate('due_upon_completion')}
                    className="text-xs px-2 py-0.5 bg-white border border-gray-300 rounded hover:bg-gray-100 text-gray-700"
                  >
                    Due Upon Completion
                  </button>
                </div>
                
                <textarea
                  value={publicNote}
                  onChange={(e) => { setPublicNote(e.target.value); setNotesChanged(true) }}
                  placeholder="Payment terms or notes for the customer..."
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm mb-3"
                />

                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-900">Internal Note</label>
                  <span className="text-xs text-red-500">Staff only - NOT on PDF</span>
                </div>
                <textarea
                  value={internalNote}
                  onChange={(e) => { setInternalNote(e.target.value); setNotesChanged(true) }}
                  placeholder="Internal notes (not visible to customer)..."
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                />

                {notesChanged && (
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={handleSaveNotes}
                      disabled={saving}
                      className="text-sm px-3 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
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
                    <div className="text-sm font-medium text-gray-700 mb-1">Customer Note / Terms</div>
                    <div className="text-sm text-gray-600 bg-amber-50 border border-amber-200 rounded p-3">
                      {invoice.public_note}
                    </div>
                  </div>
                )}
                {/* Read-only internal note for sent invoices */}
                {invoice.internal_note && (
                  <div className="mb-6">
                    <div className="text-sm font-medium text-gray-700 mb-1">
                      Internal Note <span className="text-xs text-red-500">(Staff only)</span>
                    </div>
                    <div className="text-sm text-gray-600 bg-gray-50 rounded p-3">
                      {invoice.internal_note}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Legacy Notes (for backward compatibility) */}
            {invoice.notes && (
              <div className="mb-6">
                <div className="text-sm font-medium text-gray-700 mb-1">Notes (Legacy)</div>
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
