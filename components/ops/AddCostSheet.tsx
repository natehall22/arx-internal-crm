'use client'

import { useEffect, useState } from 'react'

import { toast } from '@/components/ui/toast'
import { JOB_COST_TYPE_LABELS, normalizeJobCostType, type JobCostType } from '@/lib/job-cost-ledger'

/**
 * THE "Add a cost" sheet — the only form that creates (or edits) a job cost, used by the Materials card, Photos & files, the
 * Budget card and the job page shortcut. One writer behind it: /api/ops/jobs/[id]/cost-lines (lib/job-cost-ledger.ts).
 * A bottom sheet on a phone (dvh, thumb-reachable buttons), a dialog on desktop.
 */
export type CostSheetLine = { id: string; description: string; amount: number | null; cost_type: string; vendors?: { name?: string | null } | null }
export type CostSheetCode = { code: string; label: string; active?: boolean }

const TYPE_OPTIONS: JobCostType[] = ['material', 'labor', 'subcontractor', 'permit', 'misc']

type Form = { description: string; supplier: string; amount: string; cost_type: JobCostType; credit: boolean; code: string }
const EMPTY: Form = { description: '', supplier: '', amount: '', cost_type: 'material', credit: false, code: '' }

export default function AddCostSheet({
  jobId,
  line = null,
  costCodes = null,
  canSeeAmounts = true,
  onClose,
  onSaved,
}: {
  jobId: string
  /** Set to edit an existing cost; omitted to add one. */
  line?: CostSheetLine | null
  /** The company's cost codes (project tools): shows a code picker; the code decides the type. */
  costCodes?: CostSheetCode[] | null
  /** A viewer who may not see money adds the line without an amount (office fills it in). */
  canSeeAmounts?: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const editing = !!line
  const [form, setForm] = useState<Form>(EMPTY)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!line) return setForm(EMPTY)
    const amount = Number(line.amount ?? 0)
    setForm({
      description: line.description,
      supplier: line.vendors?.name ?? '',
      amount: line.amount == null ? '' : String(Math.abs(amount)),
      cost_type: normalizeJobCostType(line.cost_type, 'misc'),
      credit: amount < 0,
      code: '',
    })
  }, [line])

  const amountLocked = editing && line?.amount == null
  const needsAmount = canSeeAmounts && !amountLocked
  const ready = form.description.trim().length > 0 && (!needsAmount || form.amount !== '') && (!costCodes || editing || !!form.code)

  async function save() {
    if (!ready || saving) return
    setSaving(true)
    try {
      const payload: Record<string, unknown> = { description: form.description.trim(), supplier: form.supplier.trim() || null, cost_type: form.cost_type }
      if (needsAmount) {
        payload.amount = Number(form.amount)
        payload.credit = form.credit
      }
      if (!editing && form.code) payload.cost_code = form.code
      const response = await fetch(`/api/ops/jobs/${jobId}/cost-lines${editing ? `/${line!.id}` : ''}`, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      })
      const out = (await response.json().catch(() => ({}))) as { error?: string; warning?: string }
      if (!response.ok) {
        toast.error(out.error || (editing ? 'Could not save this cost' : 'Could not add this cost'))
        return
      }
      if (out.warning) toast.error(out.warning)
      onSaved()
    } catch (error) {
      console.error('AddCostSheet', error)
      toast.error(editing ? 'Could not save this cost' : 'Could not add this cost')
    } finally {
      setSaving(false)
    }
  }

  const field = 'w-full min-h-[44px] rounded-lg border border-gray-400 px-3 text-base text-gray-900'
  const label = 'mb-1 block text-sm font-medium text-gray-900'
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={editing ? 'Edit a cost' : 'Add a cost'}>
      <div className="flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white sm:max-w-md sm:rounded-xl">
        <div className="border-b p-4">
          <h3 className="text-lg font-semibold text-gray-900">{editing ? 'Edit this cost' : 'Add a cost'}</h3>
        </div>
        <div className="space-y-4 overflow-y-auto p-4">
          <div>
            <label className={label} htmlFor="cost-what">What was it for?</label>
            <input id="cost-what" className={field} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Shingles, dump fee, crew labor…" autoFocus />
          </div>
          {costCodes && !editing ? (
            <div>
              <label className={label} htmlFor="cost-code">Cost code</label>
              <select id="cost-code" className={field} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}>
                <option value="">Pick one…</option>
                {costCodes.filter((c) => c.active !== false).map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </div>
          ) : null}
          <div>
            <label className={label} htmlFor="cost-supplier">Supplier or crew (optional)</label>
            <input id="cost-supplier" className={field} value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
          </div>
          {!form.code ? (
            <div>
              <label className={label} htmlFor="cost-type">Type</label>
              <select id="cost-type" className={field} value={form.cost_type} onChange={(e) => setForm({ ...form, cost_type: e.target.value as JobCostType })}>
                {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{JOB_COST_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
          ) : null}
          {needsAmount ? (
            <>
              <div>
                <label className={label} htmlFor="cost-amount">Amount</label>
                <input id="cost-amount" className={field} type="number" inputMode="decimal" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
              </div>
              <label className="flex min-h-[44px] items-center gap-2 text-sm text-gray-900">
                <input type="checkbox" className="h-5 w-5" checked={form.credit} onChange={(e) => setForm({ ...form, credit: e.target.checked })} />
                Return or refund (takes this amount off the job&apos;s cost)
              </label>
            </>
          ) : null}
        </div>
        <div className="flex gap-3 border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button type="button" onClick={onClose} className="min-h-[44px] flex-1 rounded-lg border border-gray-400 px-4 text-gray-900">Cancel</button>
          <button type="button" onClick={() => void save()} disabled={!ready || saving} className="min-h-[44px] flex-1 rounded-lg bg-indigo-700 px-4 font-medium text-white disabled:opacity-50">
            {saving ? 'Saving…' : editing ? 'Save' : 'Add cost'}
          </button>
        </div>
      </div>
    </div>
  )
}
