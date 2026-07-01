'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { buildMaterialsOrderList } from '@/lib/materials-order-list'
import type { MaterialsCoverageOverrides } from '@/lib/materials-coverage-overrides'
import {
  applyMaterialOrderOverrides,
  type DisplayMaterialsOrderItem,
  type JobMaterialOrderOverrideRow,
} from '@/lib/materials-order-overrides'
import type { JobSoldScope } from '@/components/ops/JobSoldScopeSummary'

type Props = {
  scope: JobSoldScope
  jobId: string
  jobNumber?: string | null
  customerName?: string | null
  address?: string | null
  coverageOverrides?: MaterialsCoverageOverrides | null
}

/**
 * Ops-facing "what to order" list for roofing jobs, computed from the sold
 * scope (squares incl. waste) + roof measure linear footages.
 */
export default function MaterialsOrderCard({
  scope,
  jobId,
  jobNumber,
  customerName,
  address,
  coverageOverrides,
}: Props) {
  const [overrides, setOverrides] = useState<JobMaterialOrderOverrideRow[]>([])
  const [loadingOverrides, setLoadingOverrides] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const computedItems = useMemo(
    () =>
      buildMaterialsOrderList({
        totalSquaresWithWaste: scope.total_squares,
        linear: scope.roof_measurement_linear,
        ridgeSegmentCount: scope.materials_extras?.ridge_segment_count ?? null,
        lowSlopeAreaSqft: scope.materials_extras?.low_slope_area_sqft ?? null,
        lowSlopeFacetCount: scope.materials_extras?.low_slope_facet_count ?? null,
        penetrationCount: scope.materials_extras?.penetration_count ?? null,
        coverageOverrides,
      }),
    [scope, coverageOverrides]
  )

  const items = useMemo(
    () => applyMaterialOrderOverrides(computedItems, overrides),
    [computedItems, overrides]
  )

  const loadOverrides = useCallback(async () => {
    setLoadingOverrides(true)
    try {
      const res = await fetch(`/api/jobs/${jobId}/material-order`)
      if (res.ok) {
        const data = await res.json()
        setOverrides(Array.isArray(data.overrides) ? data.overrides : [])
      }
    } catch {
      // Non-blocking — list still renders computed values.
    } finally {
      setLoadingOverrides(false)
    }
  }, [jobId])

  useEffect(() => {
    loadOverrides()
  }, [loadOverrides])

  const saveOverride = async (
    itemKey: string,
    patch: { qty_text?: string | null; excluded?: boolean; note?: string | null }
  ) => {
    setSavingKey(itemKey)
    try {
      const res = await fetch(`/api/jobs/${jobId}/material-order`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_key: itemKey, ...patch }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to save')
      }
      const data = await res.json()
      const row = data.override as JobMaterialOrderOverrideRow
      setOverrides((prev) => {
        const next = prev.filter((o) => o.item_key !== itemKey)
        return [...next, row]
      })
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to save override')
    } finally {
      setSavingKey(null)
    }
  }

  if (!scope.roof_measurement_linear && !(scope.total_squares != null && scope.total_squares > 0)) {
    return null
  }

  const ready = items.filter((i) => i.status === 'ready' && !i.isExcluded)
  const confirm = items.filter((i) => i.status === 'confirm' && !i.isExcluded)
  const manual = items.filter((i) => i.status === 'manual' && !i.isExcluded)
  const excluded = items.filter((i) => i.isExcluded)

  const printHref = `/ops/jobs/${jobId}/material-order/print`

  return (
    <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <div>
          <h2 className="text-lg font-semibold text-[#2c2c2a]">Materials Order List</h2>
          <span className="text-[11px] font-medium uppercase tracking-wide text-gray-600">
            From sold scope + roof measure
          </span>
        </div>
        <div className="flex items-center gap-2">
          {loadingOverrides ? (
            <span className="text-[11px] text-gray-500">Loading edits…</span>
          ) : null}
          <Link
            href={printHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-[#2c2c2a] hover:bg-gray-50"
          >
            Print order sheet
          </Link>
        </div>
      </div>
      <p className="text-xs text-gray-600 mb-4">
        Quantities are computed from the accepted proposal and measurement. Tap a row to adjust qty,
        exclude an item, or add a note — then record actual orders below in Materials.
      </p>

      {ready.length > 0 && (
        <OrderSection
          title="Order"
          items={ready}
          savingKey={savingKey}
          onSave={saveOverride}
        />
      )}
      {confirm.length > 0 && (
        <OrderSection
          title="Confirm before ordering"
          items={confirm}
          tone="amber"
          savingKey={savingKey}
          onSave={saveOverride}
        />
      )}
      {manual.length > 0 && (
        <OrderSection
          title="Manual — count in field"
          items={manual}
          tone="gray"
          savingKey={savingKey}
          onSave={saveOverride}
        />
      )}
      {excluded.length > 0 && (
        <OrderSection
          title="Excluded from order"
          items={excluded}
          tone="gray"
          savingKey={savingKey}
          onSave={saveOverride}
          showExcluded
        />
      )}
    </div>
  )
}

function OrderSection({
  title,
  items,
  tone = 'green',
  savingKey,
  onSave,
  showExcluded = false,
}: {
  title: string
  items: DisplayMaterialsOrderItem[]
  tone?: 'green' | 'amber' | 'gray'
  savingKey: string | null
  onSave: (
    itemKey: string,
    patch: { qty_text?: string | null; excluded?: boolean; note?: string | null }
  ) => Promise<void>
  showExcluded?: boolean
}) {
  const badge =
    tone === 'green'
      ? 'bg-green-100 text-green-800'
      : tone === 'amber'
        ? 'bg-amber-100 text-amber-900'
        : 'bg-gray-100 text-gray-700'

  return (
    <div className="mb-4 last:mb-0">
      <div className="mb-1.5 flex items-center gap-2">
        <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${badge}`}>{title}</span>
        <span className="text-[11px] text-gray-500">{items.length}</span>
      </div>
      <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
        {items.map((item) => (
          <OrderRow
            key={item.key}
            item={item}
            saving={savingKey === item.key}
            showExcluded={showExcluded}
            onSave={onSave}
          />
        ))}
      </div>
    </div>
  )
}

function OrderRow({
  item,
  saving,
  showExcluded,
  onSave,
}: {
  item: DisplayMaterialsOrderItem
  saving: boolean
  showExcluded: boolean
  onSave: (
    itemKey: string,
    patch: { qty_text?: string | null; excluded?: boolean; note?: string | null }
  ) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [qtyDraft, setQtyDraft] = useState(item.qty ?? '')
  const [noteDraft, setNoteDraft] = useState(item.overrideNote ?? '')

  useEffect(() => {
    if (!editing) {
      setQtyDraft(item.qty ?? '')
      setNoteDraft(item.overrideNote ?? '')
    }
  }, [item.qty, item.overrideNote, editing])

  const commit = async () => {
    await onSave(item.key, {
      qty_text: qtyDraft.trim() === '' ? null : qtyDraft.trim(),
      note: noteDraft.trim() === '' ? null : noteDraft.trim(),
      excluded: showExcluded ? false : item.isExcluded,
    })
    setEditing(false)
  }

  return (
    <div className="px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-[#2c2c2a]">{item.label}</span>
          {item.isEdited && !showExcluded ? (
            <span className="shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-900">
              edited
            </span>
          ) : null}
        </div>
        <div className="text-right shrink-0">
          {item.isEdited && item.computedQty && item.computedQty !== item.qty ? (
            <div className="text-xs text-gray-500 line-through">{item.computedQty}</div>
          ) : null}
          {editing ? (
            <input
              type="text"
              value={qtyDraft}
              onChange={(e) => setQtyDraft(e.target.value)}
              className="w-36 rounded border border-gray-300 px-2 py-1 text-sm text-[#2c2c2a]"
              placeholder="Qty"
            />
          ) : item.qty ? (
            <span className="text-sm font-semibold tabular-nums text-[#2c2c2a]">{item.qty}</span>
          ) : null}
        </div>
      </div>
      {item.detail && <p className="mt-0.5 text-xs text-gray-600">{item.detail}</p>}
      {(item.note || item.computedNote) && !editing && (
        <p className="mt-0.5 text-xs font-medium text-amber-900">{item.note ?? item.computedNote}</p>
      )}
      {editing && (
        <textarea
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          rows={2}
          placeholder="Ops note (optional)"
          className="mt-2 w-full rounded border border-gray-300 px-2 py-1 text-xs text-[#2c2c2a]"
        />
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <button
              type="button"
              disabled={saving}
              onClick={() => commit()}
              className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-[#2c2c2a]"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-[#2c2c2a] hover:bg-gray-50"
            >
              Edit
            </button>
            {!showExcluded && (
              <button
                type="button"
                disabled={saving}
                onClick={() => onSave(item.key, { excluded: !item.isExcluded })}
                className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-[#2c2c2a] hover:bg-gray-50 disabled:opacity-50"
              >
                {item.isExcluded ? 'Include' : 'Exclude'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
