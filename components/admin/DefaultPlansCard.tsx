'use client'

import { useCallback, useEffect, useState } from 'react'

import { COMP_PLAN_ROLE_OPTIONS } from '@/lib/comp-plan-roles'

type Plan = { id: string; name: string; is_active: boolean; base_percentage: number | string | null; applicable_roles: string[] | null }
type Row = { id: string; role: string; roleLabel: string; planId: string; planName: string | null; ratePercent: number | null; effectiveFrom: string }
type Gap = { role: string; roleLabel: string; people: Array<{ id: string; name: string }> }

const INK = '#2c2c2a'

/**
 * Default pay plan by role: the plan used when someone has no assignment. Applies from the day it is set —
 * earlier sales are never restated. Anyone with an assignment keeps it.
 */
export default function DefaultPlansCard() {
  const [rows, setRows] = useState<Row[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [gaps, setGaps] = useState<Gap[]>([])
  const [role, setRole] = useState('')
  const [planId, setPlanId] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/comp-plans/defaults')
      if (!res.ok) return
      const json = await res.json()
      setRows(json.defaults ?? [])
      setPlans(json.plans ?? [])
      setGaps(json.gaps ?? [])
    } catch {
      /* card stays empty */
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  // The current default per role is the most recent row that has started.
  const current = new Map<string, Row>()
  for (const r of [...rows].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))) if (!current.has(r.role)) current.set(r.role, r)

  async function save() {
    if (!role || !planId) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/comp-plans/defaults', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, compPlanId: planId }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'Could not save')
      setMessage('Saved. It applies to sales from today on.')
      setRole('')
      setPlanId('')
      await load()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  const planOptions = plans.filter((p) => !role || (p.applicable_roles ?? []).includes(role) || (p.applicable_roles ?? []).length === 0)

  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-white p-4 sm:p-6" aria-labelledby="default-plans-heading">
      <h2 id="default-plans-heading" className="text-lg font-semibold" style={{ color: INK }}>Default pay plan by role</h2>
      <p className="mt-1 text-sm" style={{ color: INK }}>
        Used when someone has no plan of their own. Starts the day you set it; earlier sales are not changed.
      </p>

      {gaps.length > 0 && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-900" role="status">
          {gaps.reduce((n, g) => n + g.people.length, 0)} people are paid nothing right now (no plan):{' '}
          {gaps.map((g) => `${g.roleLabel}: ${g.people.map((p) => p.name).join(', ')}`).join(' · ')}
        </p>
      )}

      <ul className="mt-4 divide-y divide-gray-200">
        {Array.from(current.values()).map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2 text-sm" style={{ color: INK }}>
            <span className="font-semibold">{r.roleLabel}</span>
            <span>
              {r.planName ?? 'Plan'}{r.ratePercent != null ? ` · ${r.ratePercent}%` : ''} <span className="text-[#57574f]">since {r.effectiveFrom}</span>
            </span>
          </li>
        ))}
        {current.size === 0 && <li className="py-2 text-sm" style={{ color: INK }}>No defaults set yet.</li>}
      </ul>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <label className="text-sm font-medium" style={{ color: INK }}>
          Role
          <select value={role} onChange={(e) => { setRole(e.target.value); setPlanId('') }} className="mt-1 block min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 text-base">
            <option value="">Choose a role…</option>
            {COMP_PLAN_ROLE_OPTIONS.map((o) => <option key={o.role} value={o.role}>{o.label}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium" style={{ color: INK }}>
          Plan
          <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="mt-1 block min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 text-base" disabled={!role}>
            <option value="">Choose a plan…</option>
            {planOptions.map((p) => <option key={p.id} value={p.id}>{p.name}{p.base_percentage != null ? ` (${Number(p.base_percentage)}%)` : ''}{p.is_active ? '' : ' — inactive'}</option>)}
          </select>
        </label>
        <button type="button" onClick={save} disabled={busy || !role || !planId} className="min-h-[44px] self-end rounded-lg bg-[#2b0a3d] px-4 text-sm font-semibold text-white hover:bg-[#3d1257] disabled:opacity-50">
          {busy ? 'Saving…' : 'Set default'}
        </button>
      </div>
      {message && <p className="mt-2 text-sm" style={{ color: INK }} role="status">{message}</p>}
    </section>
  )
}
