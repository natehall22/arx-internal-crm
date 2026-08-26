'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Nav from '@/components/Nav'

interface ProductOrder {
  id: string
  description: string
  supplier: string | null
  amount: number
  status: 'ordered' | 'received' | 'paid' | 'returned'
  created_at: string
}

type OrderStatus = ProductOrder['status']

interface ProductOrdersClientProps {
  jobId: string
  jobNumber: string
  address: string
  userRole: string
}

const statusConfig = {
  ordered: { label: 'Ordered', bg: 'bg-blue-100', text: 'text-blue-700' },
  received: { label: 'Delivered', bg: 'bg-green-100', text: 'text-green-700' },
  paid: { label: 'Paid', bg: 'bg-gray-100', text: 'text-gray-700' },
  returned: { label: 'Returned', bg: 'bg-red-100', text: 'text-red-700' },
}

const statusOrder: Array<'ordered' | 'received' | 'paid' | 'returned'> = ['ordered', 'received', 'paid', 'returned']

export default function ProductOrdersClient({ jobId, jobNumber, address, userRole }: ProductOrdersClientProps) {
  const [orders, setOrders] = useState<ProductOrder[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [newOrder, setNewOrder] = useState({
    description: '',
    supplier: '',
    amount: '',
    status: 'ordered' as OrderStatus,
  })
  const [editingOrder, setEditingOrder] = useState<ProductOrder | null>(null)
  const [editForm, setEditForm] = useState({
    description: '',
    supplier: '',
    amount: '',
    status: 'ordered' as OrderStatus,
  })
  const [savingEdit, setSavingEdit] = useState(false)

  const isAdmin = userRole === 'admin'

  useEffect(() => {
    loadOrders()
  }, [jobId])

  const loadOrders = async () => {
    try {
      const response = await fetch(`/api/jobs/${jobId}/product-orders`)
      if (response.ok) {
        const data = await response.json()
        setOrders(data.orders || [])
        setTotal(data.total || 0)
      }
    } catch (error) {
      console.error('Error loading orders:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleAddOrder = async () => {
    if (!newOrder.description.trim() || !newOrder.amount) return
    setSaving(true)

    try {
      const response = await fetch(`/api/jobs/${jobId}/product-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newOrder),
      })

      if (response.ok) {
        setNewOrder({ description: '', supplier: '', amount: '', status: 'ordered' })
        setShowAddForm(false)
        loadOrders()
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to add order')
      }
    } catch (error) {
      console.error('Error adding order:', error)
      alert('Failed to add order')
    } finally {
      setSaving(false)
    }
  }

  const openEdit = (order: ProductOrder) => {
    setEditingOrder(order)
    setEditForm({
      description: order.description,
      supplier: order.supplier ?? '',
      amount: String(order.amount),
      status: order.status,
    })
  }

  const handleSaveEdit = async () => {
    if (!editingOrder) return
    if (!editForm.description.trim() || !editForm.amount) return
    setSavingEdit(true)
    try {
      const response = await fetch(`/api/jobs/${jobId}/product-orders/${editingOrder.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: editForm.description.trim(),
          supplier: editForm.supplier.trim() || null,
          amount: Number(editForm.amount),
          status: editForm.status,
        }),
      })
      if (response.ok) {
        setEditingOrder(null)
        loadOrders()
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to update order')
      }
    } catch (error) {
      console.error('Error updating order:', error)
      alert('Failed to update order')
    } finally {
      setSavingEdit(false)
    }
  }

  const cycleStatus = async (order: ProductOrder) => {
    const currentIndex = statusOrder.indexOf(order.status)
    const nextIndex = (currentIndex + 1) % statusOrder.length
    const nextStatus = statusOrder[nextIndex]

    // Optimistic update
    setOrders(prev => prev.map(o => 
      o.id === order.id ? { ...o, status: nextStatus } : o
    ))
    setUpdatingId(order.id)

    try {
      const response = await fetch(`/api/jobs/${jobId}/product-orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      })

      if (!response.ok) {
        // Revert on error
        setOrders(prev => prev.map(o => 
          o.id === order.id ? { ...o, status: order.status } : o
        ))
        const error = await response.json()
        alert(error.error || 'Failed to update status')
      } else {
        // Recalculate total
        loadOrders()
      }
    } catch (error) {
      // Revert on error
      setOrders(prev => prev.map(o => 
        o.id === order.id ? { ...o, status: order.status } : o
      ))
      console.error('Error updating status:', error)
      alert('Failed to update status')
    } finally {
      setUpdatingId(null)
    }
  }

  const handleDelete = async (orderId: string) => {
    if (!confirm('Delete this order?')) return

    try {
      const response = await fetch(`/api/jobs/${jobId}/product-orders/${orderId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        loadOrders()
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to delete order')
      }
    } catch (error) {
      console.error('Error deleting order:', error)
      alert('Failed to delete order')
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      
      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-6">
          <Link
            href={`/ops/jobs/${jobId}`}
            className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-2"
          >
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Job
          </Link>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Material Orders</h1>
          <p className="text-sm text-gray-600">{jobNumber} • {address}</p>
        </div>

        {/* Total */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <div className="text-sm text-gray-600 mb-1">Total Materials Cost</div>
          <div className="text-2xl font-bold text-gray-900">
            {loading ? '...' : formatCurrency(total)}
          </div>
        </div>

        {/* Orders List */}
        {loading ? (
          <div className="text-center py-8 text-gray-500">Loading orders...</div>
        ) : orders.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No material orders added yet. Tap the + button to add one.
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => {
              const config = statusConfig[order.status]
              return (
                <div
                  key={order.id}
                  className="bg-white rounded-xl border p-4 flex items-start gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-base font-medium text-gray-900">
                      {order.description}
                    </div>
                    {order.supplier && (
                      <div className="text-sm text-gray-500 mt-0.5">
                        {order.supplier}
                      </div>
                    )}
                    <div className="text-lg font-semibold text-gray-900 mt-2">
                      {formatCurrency(order.amount)}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <button
                      onClick={() => cycleStatus(order)}
                      disabled={updatingId === order.id}
                      className={`px-3 py-1.5 text-sm font-medium rounded-full min-h-[36px] transition-all ${config.bg} ${config.text} ${updatingId === order.id ? 'opacity-50' : 'active:scale-95'}`}
                    >
                      {updatingId === order.id ? '...' : config.label}
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(order)}
                      className="text-sm text-indigo-600 hover:text-indigo-800 min-h-[36px] px-2"
                    >
                      Edit
                    </button>
                    {isAdmin && (
                      <button
                        onClick={() => handleDelete(order.id)}
                        className="text-xs text-red-600 hover:text-red-800 min-h-[36px] px-2"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Floating Add Button */}
        <button
          onClick={() => setShowAddForm(true)}
          className="fixed bottom-6 right-6 w-14 h-14 bg-indigo-600 text-white rounded-full shadow-lg hover:bg-indigo-700 flex items-center justify-center text-2xl"
        >
          +
        </button>

        {/* Add Order Modal */}
        {showAddForm && (
          <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
              <div className="p-4 border-b">
                <h3 className="text-lg font-semibold text-gray-900">Add Job Cost</h3>
              </div>
              <div className="p-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Material or Item *
                  </label>
                  <input
                    type="text"
                    value={newOrder.description}
                    onChange={(e) => setNewOrder({ ...newOrder, description: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-black min-h-[44px]"
                    placeholder="e.g., 40 squares architectural shingles"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Supplier
                  </label>
                  <input
                    type="text"
                    value={newOrder.supplier}
                    onChange={(e) => setNewOrder({ ...newOrder, supplier: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-black min-h-[44px]"
                    placeholder="e.g., ABC Supply"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Amount *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={newOrder.amount}
                    onChange={(e) => setNewOrder({ ...newOrder, amount: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-black min-h-[44px]"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Status
                  </label>
                  <select
                    value={newOrder.status}
                    onChange={(e) =>
                      setNewOrder({ ...newOrder, status: e.target.value as OrderStatus })
                    }
                    className="w-full px-3 py-2 border rounded-lg text-black min-h-[44px]"
                  >
                    <option value="ordered">Ordered</option>
                    <option value="received">Delivered</option>
                    <option value="paid">Paid</option>
                    <option value="returned">Returned</option>
                  </select>
                </div>
              </div>
              <div className="p-4 border-t flex gap-3">
                <button
                  onClick={() => setShowAddForm(false)}
                  className="flex-1 px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50 min-h-[44px]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddOrder}
                  disabled={saving || !newOrder.description.trim() || !newOrder.amount}
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 min-h-[44px]"
                >
                  {saving ? 'Adding...' : 'Add Job Cost'}
                </button>
              </div>
            </div>
          </div>
        )}

        {editingOrder && (
          <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
              <div className="p-4 border-b">
                <h3 className="text-lg font-semibold text-gray-900">Edit Material Order</h3>
              </div>
              <div className="p-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Material or Item *
                  </label>
                  <input
                    type="text"
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-black min-h-[44px]"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                  <input
                    type="text"
                    value={editForm.supplier}
                    onChange={(e) => setEditForm({ ...editForm, supplier: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-black min-h-[44px]"
                    placeholder="e.g., ABC Supply"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Amount *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editForm.amount}
                    onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-black min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={editForm.status}
                    onChange={(e) =>
                      setEditForm({ ...editForm, status: e.target.value as OrderStatus })
                    }
                    className="w-full px-3 py-2 border rounded-lg text-black min-h-[44px]"
                  >
                    <option value="ordered">Ordered</option>
                    <option value="received">Delivered</option>
                    <option value="paid">Paid</option>
                    <option value="returned">Returned</option>
                  </select>
                </div>
              </div>
              <div className="p-4 border-t flex gap-3">
                <button
                  type="button"
                  onClick={() => setEditingOrder(null)}
                  className="flex-1 px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50 min-h-[44px]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={savingEdit || !editForm.description.trim() || !editForm.amount}
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 min-h-[44px]"
                >
                  {savingEdit ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
