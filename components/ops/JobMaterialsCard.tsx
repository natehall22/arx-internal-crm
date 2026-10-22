'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  JOB_COST_TYPE_LABELS,
  isDealerFeeCostLine,
  normalizeJobCostType,
  type JobCostSummary,
  type JobCostType,
} from '@/lib/job-cost-ledger'

/**
 * Materials card. "+ Job Cost" writes to the job cost ledger (`job_cost_lines`, via
 * `/api/ops/jobs/[id]/cost-lines`) — the same list the Photos & files card shows and the only
 * thing the Financials card's Est. profit reads. Labor is a job cost with type "Labor"; the old
 * separate "Save Labor Cost" box (production_jobs.labor_cost) was removed 2026-10-21 because it
 * was a second place labor could be entered and 26-0037 had labor in both.
 */

interface CostLine {
  id: string
  description: string
  amount: number | null
  cost_type: string
  approved: boolean
  created_at?: string
  vendors?: { name?: string | null } | null
}

interface JobMaterialsCardProps {
  jobId: string
  userRole: string
  title?: string
  materialsOrderedAt?: string | null
  materialsEta?: string | null
  materialsNotes?: string | null
  /** Fires with the ledger summary after every load (null when the viewer can't see money). */
  onLedgerChange?: (summary: JobCostSummary | null) => void
  /** Bump to make this card reload (the Photos & files card changed the ledger). */
  ledgerVersion?: number
  /** Called after this card adds, edits or deletes a cost. */
  onLedgerMutated?: () => void
  onAttachReceiptInvoice?: () => void
  registerOpenAddJobCost?: (openForm: (() => void) | null) => void
  /** From financed sale — lender dealer fee (read-only COGS line). */
  dealerFeeAmount?: number | null
}

const COST_TYPE_OPTIONS: Array<{ value: JobCostType; label: string }> = [
  { value: 'material', label: 'Materials' },
  { value: 'labor', label: 'Labor' },
  { value: 'subcontractor', label: 'Subcontractor' },
  { value: 'permit', label: 'Permit' },
  { value: 'misc', label: 'Other' },
]

const typePill: Record<string, string> = {
  material: 'bg-blue-100 text-blue-800',
  labor: 'bg-green-100 text-green-800',
  subcontractor: 'bg-green-100 text-green-800',
  permit: 'bg-purple-100 text-purple-800',
}


type CostForm = {
  description: string
  supplier: string
  amount: string
  cost_type: JobCostType
  credit: boolean
}

const EMPTY_FORM: CostForm = { description: '', supplier: '', amount: '', cost_type: 'material', credit: false }

export default function JobMaterialsCard({
  jobId,
  userRole,
  title = 'Materials',
  materialsOrderedAt,
  materialsEta,
  materialsNotes,
  onLedgerChange,
  ledgerVersion = 0,
  onLedgerMutated,
  onAttachReceiptInvoice,
  registerOpenAddJobCost,
  dealerFeeAmount,
}: JobMaterialsCardProps) {
  const [lines, setLines] = useState<CostLine[]>([])
  const [summary, setSummary] = useState<JobCostSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newCost, setNewCost] = useState<CostForm>(EMPTY_FORM)
  const [editingLine, setEditingLine] = useState<CostLine | null>(null)
  const [editForm, setEditForm] = useState<CostForm>(EMPTY_FORM)
  const [savingEdit, setSavingEdit] = useState(false)

  const isAdmin = userRole === 'admin'

  const loadLines = useCallback(async () => {
    try {
      const response = await fetch(`/api/ops/jobs/${jobId}/cost-lines`, { cache: 'no-store' })
      if (response.ok) {
        const data = await response.json()
        const all = (data.costLines || []) as CostLine[]
        // The dealer fee shows as its own read-only row below and in Financials.
        setLines(all.filter((line) => !isDealerFeeCostLine(line)))
        setSummary(data.summary ?? null)
        onLedgerChange?.(data.summary ?? null)
      }
    } catch (error) {
      console.error('Error loading job costs:', error)
    } finally {
      setLoading(false)
    }
  }, [jobId, onLedgerChange])

  useEffect(() => {
    loadLines()
  }, [loadLines, ledgerVersion])

  useEffect(() => {
    if (!registerOpenAddJobCost) return
    registerOpenAddJobCost(() => setShowAddForm(true))
    return () => {
      registerOpenAddJobCost(null)
    }
  }, [registerOpenAddJobCost])

  const afterMutation = () => {
    loadLines()
    onLedgerMutated?.()
  }

  const handleAddCost = async () => {
    if (!newCost.description.trim() || !newCost.amount) return
    setSaving(true)
    try {
      const response = await fetch(`/api/ops/jobs/${jobId}/cost-lines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: newCost.description.trim(),
          supplier: newCost.supplier.trim() || null,
          amount: Number(newCost.amount),
          cost_type: newCost.cost_type,
          credit: newCost.credit,
        }),
      })
      if (response.ok) {
        setNewCost(EMPTY_FORM)
        setShowAddForm(false)
        afterMutation()
      } else {
        const error = await response.json().catch(() => ({}))
        alert(error.error || 'Could not add this cost')
      }
    } catch (error) {
      console.error('Error adding job cost:', error)
      alert('Could not add this cost')
    } finally {
      setSaving(false)
    }
  }

  const openEdit = (line: CostLine) => {
    setEditingLine(line)
    const amount = Number(line.amount ?? 0)
    setEditForm({
      description: line.description,
      supplier: line.vendors?.name ?? '',
      amount: line.amount == null ? '' : String(Math.abs(amount)),
      cost_type: normalizeJobCostType(line.cost_type, 'misc'),
      credit: amount < 0,
    })
  }

  const handleSaveEdit = async () => {
    if (!editingLine) return
    if (!editForm.description.trim()) return
    setSavingEdit(true)
    try {
      const payload: Record<string, unknown> = {
        description: editForm.description.trim(),
        supplier: editForm.supplier.trim() || null,
        cost_type: editForm.cost_type,
      }
      if (editingLine.amount != null && editForm.amount !== '') {
        payload.amount = Number(editForm.amount)
        payload.credit = editForm.credit
      }
      const response = await fetch(`/api/ops/jobs/${jobId}/cost-lines/${editingLine.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (response.ok) {
        setEditingLine(null)
        afterMutation()
      } else {
        const error = await response.json().catch(() => ({}))
        alert(error.error || 'Could not save this cost')
      }
    } catch (error) {
      console.error('Error updating job cost:', error)
      alert('Could not save this cost')
    } finally {
      setSavingEdit(false)
    }
  }

  const handleDelete = async (lineId: string) => {
    if (!confirm('Delete this job cost?')) return
    try {
      const response = await fetch(`/api/ops/jobs/${jobId}/cost-lines/${lineId}`, { method: 'DELETE' })
      if (response.ok) {
        afterMutation()
      } else {
        const error = await response.json().catch(() => ({}))
        alert(error.error || 'Could not delete this cost')
      }
    } catch (error) {
      console.error('Error deleting job cost:', error)
      alert('Could not delete this cost')
    }
  }

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)

  const renderForm = (form: CostForm, setForm: (f: CostForm) => void, opts: { showSupplier: boolean; amountLocked: boolean }) => (
    <div className="p-4 space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-800 mb-1">What was it for? *</label>
        <input
          type="text"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="w-full px-3 py-2 border rounded-lg text-black min-h-[44px]"
          placeholder="e.g., Shingles, Labor - roofing crew"
        />
      </div>
      {opts.showSupplier && (
        <div>
          <label className="block text-sm font-medium text-gray-800 mb-1">Supplier or crew</label>
          <input
            type="text"
            value={form.supplier}
            onChange={(e) => setForm({ ...form, supplier: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg text-black min-h-[44px]"
            placeholder="e.g., QXO"
          />
        </div>
      )}
      <div>
        <label className="block text-sm font-medium text-gray-800 mb-1">Type</label>
        <select
          value={form.cost_type}
          onChange={(e) => setForm({ ...form, cost_type: e.target.value as JobCostType })}
          className="w-full px-3 py-2 border rounded-lg text-black min-h-[44px]"
        >
          {COST_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      {!opts.amountLocked && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">Amount *</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg text-black min-h-[44px]"
              placeholder="0.00"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-900 min-h-[44px]">
            <input
              type="checkbox"
              checked={form.credit}
              onChange={(e) => setForm({ ...form, credit: e.target.checked })}
              className="h-5 w-5"
            />
            Return or refund (takes this amount off the job&apos;s cost)
          </label>
        </>
      )}
    </div>
  )

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
          <button
            onClick={() => setShowAddForm(true)}
            className="min-h-[44px] text-sm px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            + Job Cost
          </button>
        </div>
      </div>

      {/* Total — the same ledger the Financials card and every report read. */}
      <div className="p-3 bg-amber-50 rounded-lg mb-4">
        <div className="text-xs text-gray-700 mb-1">Total job costs</div>
        <div className="text-lg font-semibold text-gray-900">
          {loading ? '...' : summary ? formatCurrency(summary.total) : '—'}
        </div>
        {!loading && summary && summary.lineCount > 0 && (
          <div className="mt-1 text-xs text-gray-800">
            Materials {formatCurrency(summary.materials)} · Labor {formatCurrency(summary.labor)}
            {summary.other !== 0 ? ` · Other ${formatCurrency(summary.other)}` : ''}
          </div>
        )}
      </div>

      {/* "Materials ordered" is recorded on the Job documents banner (where the order is sent),
          not with a delivery picker here — see lib/job-status-events.ts. */}

      {dealerFeeAmount != null && dealerFeeAmount > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/80 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-gray-900">Lender / dealer fee</p>
              <p className="text-xs text-gray-700">Financing program cost from the sold proposal (not editable).</p>
            </div>
            <span className="text-lg font-semibold text-amber-900 tabular-nums">{formatCurrency(dealerFeeAmount)}</span>
          </div>
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
          {materialsNotes && <p className="text-sm text-gray-800 break-words">{materialsNotes}</p>}
        </div>
      )}

      {loading ? (
        <div className="text-center py-4 text-gray-700">Loading...</div>
      ) : lines.length === 0 ? (
        <div className="text-center py-4 text-gray-700 text-sm">No job costs added yet</div>
      ) : (
        <div className="space-y-2">
          {lines.map((line) => {
            const amount = line.amount
            const isCredit = amount != null && amount < 0
            return (
              <div key={line.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex-1 min-w-0 mr-3">
                  <div className="text-sm font-medium text-gray-900 truncate">{line.description}</div>
                  {line.vendors?.name && (
                    <div className="text-xs text-gray-700 truncate">{line.vendors.name}</div>
                  )}
                  {!line.approved && <div className="text-xs text-gray-700">Waiting for admin review</div>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-sm font-medium tabular-nums ${isCredit ? 'text-red-700' : 'text-gray-900'}`}>
                    {amount == null ? '—' : formatCurrency(amount)}
                  </span>
                  <span
                    className={`px-2 py-1 text-xs font-medium rounded-full ${
                      isCredit ? 'bg-red-100 text-red-800' : typePill[line.cost_type] || 'bg-gray-200 text-gray-900'
                    }`}
                  >
                    {isCredit ? 'Return' : JOB_COST_TYPE_LABELS[normalizeJobCostType(line.cost_type, 'other')]}
                  </span>
                  <button
                    type="button"
                    onClick={() => openEdit(line)}
                    className="text-sm text-indigo-700 hover:text-indigo-900 min-h-[44px] min-w-[44px] px-2"
                  >
                    Edit
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => handleDelete(line.id)}
                      className="text-sm text-red-700 hover:text-red-900 min-h-[44px] min-w-[44px] px-2"
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

      {showAddForm && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-xl w-full sm:max-w-md max-h-[92vh] overflow-y-auto">
            <div className="p-4 border-b">
              <h3 className="text-lg font-semibold text-gray-900">Add Job Cost</h3>
            </div>
            {renderForm(newCost, setNewCost, { showSupplier: true, amountLocked: false })}
            <div className="sticky bottom-0 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t flex gap-3">
              <button
                onClick={() => setShowAddForm(false)}
                className="flex-1 px-4 py-2 border rounded-lg text-gray-800 hover:bg-gray-50 min-h-[44px]"
              >
                Cancel
              </button>
              <button
                onClick={handleAddCost}
                disabled={saving || !newCost.description.trim() || !newCost.amount}
                className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 min-h-[44px]"
              >
                {saving ? 'Adding...' : 'Add Job Cost'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingLine && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-xl w-full sm:max-w-md max-h-[92vh] overflow-y-auto">
            <div className="p-4 border-b">
              <h3 className="text-lg font-semibold text-gray-900">Edit Job Cost</h3>
              {editingLine.approved && (
                <p className="mt-1 text-xs text-gray-800">
                  Changing the amount or type sends this cost back for admin review.
                </p>
              )}
            </div>
            {renderForm(editForm, setEditForm, { showSupplier: true, amountLocked: editingLine.amount == null })}
            <div className="sticky bottom-0 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t flex gap-3">
              <button
                type="button"
                onClick={() => setEditingLine(null)}
                className="flex-1 px-4 py-2 border rounded-lg text-gray-800 hover:bg-gray-50 min-h-[44px]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={savingEdit || !editForm.description.trim()}
                className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 min-h-[44px]"
              >
                {savingEdit ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
