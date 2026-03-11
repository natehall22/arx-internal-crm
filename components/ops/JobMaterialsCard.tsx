'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface ProductOrder {
  id: string
  description: string
  supplier: string | null
  amount: number
  status: 'ordered' | 'received' | 'paid' | 'returned'
  created_at: string
}

interface JobMaterialsCardProps {
  jobId: string
  userRole: string
  title?: string
  materialsStatus?: string
  onMaterialsStatusChange?: (status: string) => void
  updatingMaterialsStatus?: boolean
  laborCost?: number | null
  onSaveLaborCost?: (amount: number | null) => Promise<void> | void
  savingLaborCost?: boolean
  materialsOrderedAt?: string | null
  materialsEta?: string | null
  materialsNotes?: string | null
  onTotalChange?: (total: number) => void
  onAttachReceiptInvoice?: () => void
}

const statusConfig = {
  ordered: { label: 'Ordered', bg: 'bg-blue-100', text: 'text-blue-700' },
  received: { label: 'Received', bg: 'bg-green-100', text: 'text-green-700' },
  paid: { label: 'Paid', bg: 'bg-gray-100', text: 'text-gray-700' },
  returned: { label: 'Returned', bg: 'bg-red-100', text: 'text-red-700' },
}

const materialsWorkflowStatuses = ['not_ordered', 'ordered', 'partial', 'received'] as const
const getMaterialDeliveryLabel = (status?: string) => {
  if (status === 'ordered') return 'Ordered'
  if (status === 'partial') return 'Partially Delivered'
  if (status === 'received') return 'Fully Delivered'
  return 'Not Ordered'
}

export default function JobMaterialsCard({
  jobId,
  userRole,
  title = 'Materials',
  materialsStatus,
  onMaterialsStatusChange,
  updatingMaterialsStatus = false,
  laborCost,
  onSaveLaborCost,
  savingLaborCost = false,
  materialsOrderedAt,
  materialsEta,
  materialsNotes,
  onTotalChange,
  onAttachReceiptInvoice,
}: JobMaterialsCardProps) {
  const [orders, setOrders] = useState<ProductOrder[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newOrder, setNewOrder] = useState({
    description: '',
    supplier: '',
    amount: '',
    status: 'ordered' as const,
  })
  const [laborCostInput, setLaborCostInput] = useState(laborCost?.toString() || '')

  useEffect(() => {
    setLaborCostInput(laborCost != null ? laborCost.toString() : '')
  }, [laborCost])

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
        onTotalChange?.(data.total || 0)
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

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount)
  }

  const handleSaveLaborCost = async () => {
    if (!onSaveLaborCost) return
    const trimmed = laborCostInput.trim()
    const parsed = trimmed === '' ? null : Number(trimmed)
    if (parsed !== null && (isNaN(parsed) || parsed < 0)) {
      alert('Please enter a valid non-negative labor cost')
      return
    }
    await onSaveLaborCost(parsed)
  }

  const displayOrders = orders.slice(0, 5)
  const hasMore = orders.length > 5

  return (
    <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base sm:text-lg font-semibold text-gray-900">{title}</h2>
        <div className="flex items-center gap-2">
          {onAttachReceiptInvoice && (
            <button
              type="button"
              onClick={onAttachReceiptInvoice}
              className="min-h-[44px] text-sm px-3 py-2 border border-indigo-600 text-indigo-700 rounded-lg hover:bg-indigo-50"
            >
              Attach Receipt / Invoice
            </button>
          )}
          {orders.length > 0 && (
            <Link
              href={`/ops/jobs/${jobId}/orders`}
              className="text-sm text-indigo-600 hover:text-indigo-800"
            >
              View All Orders
            </Link>
          )}
          <button
            onClick={() => setShowAddForm(true)}
            className="min-h-[44px] text-sm px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            + Add Material Order
          </button>
        </div>
      </div>

      {/* Total */}
      <div className="p-3 bg-amber-50 rounded-lg mb-4">
        <div className="text-xs text-gray-600 mb-1">Total Materials Cost</div>
        <div className="text-lg font-semibold text-gray-900">
          {loading ? '...' : formatCurrency(total)}
        </div>
      </div>

      {(materialsStatus || onSaveLaborCost) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
          {materialsStatus && (
            <div className="border rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-900">Material Delivery</p>
                <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                  materialsStatus === 'received' ? 'bg-green-100 text-green-700' :
                  materialsStatus === 'ordered' ? 'bg-blue-100 text-blue-700' :
                  materialsStatus === 'partial' ? 'bg-amber-100 text-amber-700' :
                  'bg-gray-100 text-gray-600'
                }`}>
                  {getMaterialDeliveryLabel(materialsStatus)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {materialsWorkflowStatuses.map((status) => (
                  <button
                    key={status}
                    onClick={() => onMaterialsStatusChange?.(status)}
                    disabled={updatingMaterialsStatus || materialsStatus === status}
                    className={`min-h-[40px] px-2 py-2 text-xs rounded-lg border transition ${
                      materialsStatus === status
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'border-gray-300 hover:bg-gray-50 text-gray-900'
                    } disabled:opacity-50`}
                  >
                    {status === 'not_ordered' ? 'Not Ordered' :
                     status === 'ordered' ? 'Ordered' :
                     status === 'partial' ? 'Partially Delivered' : 'Fully Delivered'}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                This tracks material delivery only.
              </p>
            </div>
          )}

          {onSaveLaborCost && (
            <div className="border rounded-lg p-3">
              <p className="text-sm font-medium text-gray-900 mb-2">Labor Cost</p>
              <div className="flex gap-2">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={laborCostInput}
                  onChange={(e) => setLaborCostInput(e.target.value)}
                  className="flex-1 min-h-[40px] px-3 py-2 border rounded-lg text-gray-900"
                  placeholder="0.00"
                />
                <button
                  onClick={handleSaveLaborCost}
                  disabled={savingLaborCost}
                  className="min-h-[40px] px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm disabled:opacity-50"
                >
                  {savingLaborCost ? 'Saving...' : 'Save Labor Cost'}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">Enter labor cost for this job.</p>
            </div>
          )}
        </div>
      )}

      {(materialsOrderedAt || materialsEta || materialsNotes) && (
        <div className="mb-4 p-3 bg-gray-50 rounded-lg space-y-1">
          {materialsOrderedAt && (
            <p className="text-sm text-gray-900">
              Ordered: {new Date(materialsOrderedAt).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}
            </p>
          )}
          {materialsEta && (
            <p className="text-sm text-gray-900">
              ETA: {new Date(materialsEta).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}
            </p>
          )}
          {materialsNotes && (
            <p className="text-sm text-gray-700 break-words">{materialsNotes}</p>
          )}
        </div>
      )}

      {/* Orders List */}
      {loading ? (
        <div className="text-center py-4 text-gray-500">Loading...</div>
      ) : orders.length === 0 ? (
        <div className="text-center py-4 text-gray-500 text-sm">
          No material orders added yet
        </div>
      ) : (
        <div className="space-y-2">
          {displayOrders.map((order) => {
            const config = statusConfig[order.status]
            return (
              <div
                key={order.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
              >
                <div className="flex-1 min-w-0 mr-3">
                  <div className="text-sm font-medium text-gray-900 truncate">
                    {order.description}
                  </div>
                  {order.supplier && (
                    <div className="text-xs text-gray-500 truncate">
                      {order.supplier}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">
                    {formatCurrency(order.amount)}
                  </span>
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${config.bg} ${config.text}`}>
                    {config.label}
                  </span>
                </div>
              </div>
            )
          })}
          {hasMore && (
            <Link
              href={`/ops/jobs/${jobId}/orders`}
              className="block text-center py-2 text-sm text-indigo-600 hover:text-indigo-800"
            >
              +{orders.length - 5} more orders
            </Link>
          )}
        </div>
      )}

      {/* Add Order Form */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-4 border-b">
              <h3 className="text-lg font-semibold text-gray-900">Add Material Order</h3>
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
                  placeholder="e.g., 30 squares GAF Timberline"
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
                  onChange={(e) => setNewOrder({ ...newOrder, status: e.target.value as any })}
                  className="w-full px-3 py-2 border rounded-lg text-black min-h-[44px]"
                >
                  <option value="ordered">Ordered</option>
                  <option value="received">Received</option>
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
                {saving ? 'Adding...' : 'Add Order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
