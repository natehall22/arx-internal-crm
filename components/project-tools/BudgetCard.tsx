'use client'

import { useCallback, useEffect, useState } from 'react'

import type { BudgetRow, BudgetState, BudgetView } from '@/lib/cost-codes'
import type { CostCode } from '@/lib/cost-codes'
import { toast } from '@/components/ui/toast'
import { ymdLabel } from '@/lib/ymd-label'
import AddCostSheet from '@/components/ops/AddCostSheet'
import { api, btnGhost, btnPrimary, Card, inputCls, money, Pill, type Tone } from './ui'

type History = { id: string; cost_code: string; old_amount: number | null; new_amount: number; reason: string | null; changed_at: string; changed_by_name: string | null }
type Payload = { view: BudgetView; codes: CostCode[]; history: History[]; ready: boolean; canEdit: boolean }

const TONE: Record<BudgetState, Tone> = { none: 'gray', under: 'green', near: 'amber', over: 'red' }

function pillText(r: Pick<BudgetRow, 'budget' | 'variance' | 'state'>): string {
  if (r.budget === null || r.variance === null) return 'No budget'
  if (r.variance < 0) return `${money(-r.variance)} over`
  return r.state === 'near' ? `${money(r.variance)} left — almost used` : `${money(r.variance)} left`
}

/**
 * Budget vs actual by cost code. Budget = what the contractor planned per code (editable, every change kept); actual = the
 * job's cost ledger (the same lines the Financials card uses); variance = budget − actual. Green = under, amber = within 10%
 * of the budget, red = over. "+ Add a cost" opens the shared AddCostSheet (the one cost writer) with the code picker.
 */
export default function BudgetCard({ jobId, onLedgerMutated, canEditCodes }: { jobId: string; onLedgerMutated?: () => void; canEditCodes?: boolean }) {
  const [p, setP] = useState<Payload | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [codesOpen, setCodesOpen] = useState(false)

  const load = useCallback(async () => {
    const r = await api<Payload>(`/api/ops/jobs/${jobId}/budget`)
    if (r.ok) {
      setP(r.data)
      setErr(null)
    } else setErr(r.status === 403 ? null : r.data.error || 'Could not load the budget')
  }, [jobId])
  useEffect(() => void load(), [load])

  if (!p) return err ? <Card title="Budget vs actual"><p role="alert" className="text-base font-semibold text-[#7f1d1d]">{err}</p></Card> : null
  const { view, codes } = p

  async function saveBudget(code: string) {
    setBusy(true)
    const r = await api(`/api/ops/jobs/${jobId}/budget`, { method: 'PUT', body: JSON.stringify({ code, amount, reason }) })
    setBusy(false)
    if (!r.ok) return toast.error(r.data.error || 'Could not save')
    setEditing(null)
    setReason('')
    void load()
  }
  const labelFor = (code: string) => view.rows.find((r) => r.code === code)?.label ?? codes.find((c) => c.code === code)?.label ?? code

  return (
    <Card
      testId="budget-card"
      title="Budget vs actual"
      subtitle="Budget is your plan. Actual is the job’s cost lines."
      action={
        p.canEdit ? (
          <button type="button" className={btnGhost} onClick={() => setAdding(true)}>
            + Add a cost
          </button>
        ) : null
      }
    >
      {!p.ready ? <p className="text-base text-[#2c2c2a]">Budgets need a database update first. Ask your admin to apply it.</p> : null}

      <div className="mb-3 grid grid-cols-3 gap-2 text-center" data-testid="budget-totals">
        <div className="rounded-lg bg-[#f1efe8] p-2"><p className="text-sm text-[#2c2c2a]">Budget</p><p className="text-base font-bold tabular-nums text-[#2c2c2a]">{money(view.totalBudget)}</p></div>
        <div className="rounded-lg bg-[#f1efe8] p-2"><p className="text-sm text-[#2c2c2a]">Spent</p><p className="text-base font-bold tabular-nums text-[#2c2c2a]">{money(view.totalActual)}</p></div>
        <div className="rounded-lg bg-[#f1efe8] p-2">
          <p className="text-sm text-[#2c2c2a]">{view.totalVariance < 0 ? 'Over by' : 'Left'}</p>
          <p className="text-base font-bold tabular-nums text-[#2c2c2a]">{money(Math.abs(view.totalVariance))}</p>
        </div>
      </div>

      {adding ? (
        <AddCostSheet
          jobId={jobId}
          costCodes={codes}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false)
            onLedgerMutated?.()
            void load()
          }}
        />
      ) : null}

      <ul className="divide-y divide-[#e5e3dc]" data-testid="budget-rows">
        {view.rows.map((r) => (
          <li key={r.code} className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-base font-semibold text-[#2c2c2a]">{r.label}{r.active ? '' : ' (off)'}</span>
              <Pill tone={TONE[r.state]}>{pillText(r)}</Pill>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-base text-[#2c2c2a]">
              <span>Spent <strong className="tabular-nums">{money(r.actual)}</strong></span>
              {editing === r.code ? null : (
                <button type="button" disabled={!p.canEdit} onClick={() => { setEditing(r.code); setAmount(r.budget === null ? '' : String(r.budget)); setReason('') }} className="min-h-[44px] text-left font-semibold underline disabled:no-underline disabled:opacity-100" aria-label={`Budget for ${r.label}`}>
                  Budget <span className="tabular-nums">{r.budget === null ? (p.canEdit ? 'Set budget' : '—') : money(r.budget)}</span>
                </button>
              )}
            </div>
            {editing === r.code ? (
              <div className="mt-2 space-y-2 rounded-lg bg-[#f1efe8] p-3">
                <input className={inputCls} inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Budget amount" aria-label={`Budget amount for ${r.label}`} />
                {r.budget !== null ? <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? (optional)" aria-label="Reason for the change" /> : null}
                <div className="flex gap-2">
                  <button type="button" className={`${btnPrimary} flex-1`} disabled={busy} onClick={() => void saveBudget(r.code)}>Save</button>
                  <button type="button" className={btnGhost} onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap gap-2">
        {p.history.length > 0 ? <button type="button" className={btnGhost} onClick={() => setShowHistory((s) => !s)} aria-expanded={showHistory}>{showHistory ? 'Hide' : 'Show'} budget changes</button> : null}
        {canEditCodes ? <button type="button" className={btnGhost} onClick={() => setCodesOpen((s) => !s)} aria-expanded={codesOpen}>Cost codes</button> : null}
      </div>
      {showHistory ? (
        <ul className="mt-3 space-y-2" data-testid="budget-history">
          {p.history.map((h) => (
            <li key={h.id} className="rounded-lg bg-[#f1efe8] p-2 text-sm text-[#2c2c2a]">
              <strong>{labelFor(h.cost_code)}</strong>: {h.old_amount === null ? 'set to' : `${money(h.old_amount)} →`} {money(h.new_amount)}
              {h.reason ? ` — ${h.reason}` : ''}
              <span className="block">{h.changed_by_name ?? 'Someone'} · {ymdLabel(h.changed_at.slice(0, 10))}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {codesOpen ? <CostCodesEditor codes={p.codes} onSaved={() => void load()} /> : null}
    </Card>
  )
}

/** Owners set the company's own cost codes: rename, turn off, add. Codes are never deleted (old lines keep theirs). */
function CostCodesEditor({ codes, onSaved }: { codes: CostCode[]; onSaved: () => void }) {
  const [rows, setRows] = useState(codes)
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    const r = await api('/api/admin/cost-codes', { method: 'PUT', body: JSON.stringify({ codes: rows.map((c) => ({ code: c.code, label: c.label, costType: c.costType, active: c.active })) }) })
    setBusy(false)
    if (!r.ok) return toast.error(r.data.error || 'Could not save')
    toast.success('Cost codes saved')
    onSaved()
  }
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-[#d6d3ca] p-3" data-testid="cost-codes-editor">
      <p className="text-sm font-semibold text-[#2c2c2a]">Your cost codes (every job uses this list)</p>
      {rows.map((c, i) => (
        <div key={`${c.code}-${i}`} className="flex items-center gap-2">
          <input className={inputCls} value={c.label} aria-label="Cost code name" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <label className="flex min-h-[44px] shrink-0 items-center gap-1 text-sm text-[#2c2c2a]">
            <input type="checkbox" className="h-5 w-5" checked={c.active} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)))} /> On
          </label>
        </div>
      ))}
      <div className="flex gap-2">
        <button type="button" className={btnGhost} onClick={() => setRows([...rows, { code: '', label: '', costType: 'other', active: true }])}>+ Add a code</button>
        <button type="button" className={`${btnPrimary} flex-1`} disabled={busy} onClick={() => void save()}>Save codes</button>
      </div>
    </div>
  )
}
