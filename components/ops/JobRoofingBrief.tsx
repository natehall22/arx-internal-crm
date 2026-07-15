'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { JobSoldScope } from '@/components/ops/JobSoldScopeSummary'
import type { MaterialsCoverageOverrides } from '@/lib/materials-coverage-overrides'
import {
  buildJobRoofingBrief,
  jobRoofingBriefHasContent,
  type BriefField,
  type WorkOrderMaterialLine,
} from '@/lib/job-roofing-brief'
import {
  MATERIAL_ORDER_UPDATED_EVENT,
  type JobMaterialOrderOverrideRow,
} from '@/lib/materials-order-overrides'
import { createClientBrowser } from '@/lib/supabase/client'

type Props = {
  scope: JobSoldScope
  jobId: string
  project?: {
    product_summary?: string | null
    project_review?: unknown
  } | null
  specialInstructions?: string | null
  materialsNotes?: string | null
  coverageOverrides?: MaterialsCoverageOverrides | null
}

function BriefCell({
  label,
  field,
  emptyLabel = '—',
}: {
  label: string
  field: BriefField
  emptyLabel?: string
}) {
  const value = field.value
  return (
    <div className="min-w-0">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </span>
      <div className="mt-1 flex flex-wrap items-baseline gap-1.5">
        {value ? (
          <span className="text-sm font-semibold tabular-nums text-[#2c2c2a]">{value}</span>
        ) : (
          <span className="text-sm text-gray-400">{emptyLabel}</span>
        )}
        {field.edited ? (
          <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-900">
            edited
          </span>
        ) : null}
      </div>
      {field.edited && field.computedValue && field.computedValue !== field.value ? (
        <p className="mt-0.5 text-[11px] text-gray-500 line-through tabular-nums">{field.computedValue}</p>
      ) : null}
    </div>
  )
}

export default function JobRoofingBrief({
  scope,
  jobId,
  project,
  specialInstructions,
  materialsNotes,
  coverageOverrides,
}: Props) {
  const [overrides, setOverrides] = useState<JobMaterialOrderOverrideRow[]>([])
  const [workOrderMaterials, setWorkOrderMaterials] = useState<WorkOrderMaterialLine[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [overrideRes, workOrders] = await Promise.all([
        fetch(`/api/jobs/${jobId}/material-order`).then((res) => (res.ok ? res.json() : null)),
        loadWorkOrderMaterials(jobId),
      ])
      setOverrides(Array.isArray(overrideRes?.overrides) ? overrideRes.overrides : [])
      setWorkOrderMaterials(workOrders)
    } catch {
      setOverrides([])
      setWorkOrderMaterials([])
    } finally {
      setLoading(false)
    }
  }, [jobId])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ jobId?: string }>).detail
      if (!detail?.jobId || detail.jobId === jobId) {
        void loadData()
      }
    }
    window.addEventListener(MATERIAL_ORDER_UPDATED_EVENT, onUpdated)
    return () => window.removeEventListener(MATERIAL_ORDER_UPDATED_EVENT, onUpdated)
  }, [jobId, loadData])

  const fields = useMemo(
    () =>
      buildJobRoofingBrief({
        scope,
        overrides,
        coverageOverrides,
        project,
        workOrderMaterials,
        specialInstructions,
        materialsNotes,
      }),
    [scope, overrides, coverageOverrides, project, workOrderMaterials, specialInstructions, materialsNotes]
  )

  if (!jobRoofingBriefHasContent(fields)) {
    return null
  }

  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-3 sm:px-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-600">
          Job materials brief
        </span>
        <div className="flex items-center gap-2">
          {loading ? <span className="text-[11px] text-gray-500">Refreshing…</span> : null}
          {fields.proposalHref ? (
            <Link
              href={fields.proposalHref}
              className="text-xs font-medium text-indigo-700 underline hover:text-indigo-900"
            >
              {fields.proposalNumber ? `Proposal ${fields.proposalNumber}` : 'View proposal'}
            </Link>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <BriefCell label="Shingle color" field={fields.shingleColor} emptyLabel="Not on file" />
        <BriefCell label="Field shingles" field={fields.fieldShingleSq} />
        <BriefCell label="Ridge" field={fields.ridgeLf} />
        <BriefCell label="Ridge vent" field={fields.ridgeVentLf} />
        <BriefCell label="Starter shingles" field={fields.starterSq} />
        <BriefCell label="Step flashing" field={fields.stepFlashingLf} />
        <BriefCell label="Wall flashing" field={fields.wallFlashingLf} />
        <div className="sm:col-span-2 lg:col-span-3">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Accessories
          </span>
          {fields.accessories.value ? (
            <p className="mt-1 text-sm text-[#2c2c2a] whitespace-pre-wrap break-words">
              {fields.accessories.value}
            </p>
          ) : (
            <p className="mt-1 text-sm text-gray-400">None listed on work order or project review</p>
          )}
        </div>
      </div>

      {fields.soldAddOns.value ? (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Sold add-ons
          </span>
          <p className="mt-1 text-sm text-[#2c2c2a] whitespace-pre-wrap break-words">
            {fields.soldAddOns.value}
          </p>
        </div>
      ) : null}

      {fields.specialRemarks.value ? (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Special remarks
          </span>
          <p className="mt-1 text-sm text-[#2c2c2a] whitespace-pre-wrap break-words">
            {fields.specialRemarks.value}
          </p>
        </div>
      ) : null}

      {fields.showNoWasteWarning ? (
        <div
          className="mt-3 rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-950"
          role="status"
        >
          No waste % on file — confirm field shingle total before ordering.
        </div>
      ) : null}
    </div>
  )
}

async function loadWorkOrderMaterials(jobId: string): Promise<WorkOrderMaterialLine[]> {
  const supabase = createClientBrowser()
  if (!jobId) return []

  const { data, error } = await supabase
    .from('work_orders')
    .select('materials')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })

  if (error || !data) return []

  const lines: WorkOrderMaterialLine[] = []
  for (const row of data) {
    const materials = row.materials
    if (!Array.isArray(materials)) continue
    for (const item of materials) {
      if (!item || typeof item !== 'object') continue
      const name = typeof item.name === 'string' ? item.name : ''
      const quantity = typeof item.quantity === 'string' ? item.quantity : ''
      const unit = typeof item.unit === 'string' ? item.unit : ''
      if (!name.trim() && !quantity.trim()) continue
      lines.push({ name, quantity, unit })
    }
  }
  return lines
}
