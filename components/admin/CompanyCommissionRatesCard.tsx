'use client'

/**
 * Admin editor for the org's three derived commission rates — inspection, manager
 * override, self-generated — via `GET/POST /api/admin/comp-rates`.
 *
 * Canonical place to edit these (Phase 1 of docs/prompts/comp-plan-admin-editing.md).
 * `InspectionCommissionRateCard` on /admin/payroll still works as a quick-edit
 * shortcut for inspection only, and links back here.
 *
 * Three confirmation flows, each keyed off a `code` the API returns instead of a
 * generic 400:
 *  - `confirm_disable_required` — a rate is going from > 0 to 0, which turns that
 *    line off for the whole org.
 *  - `confirm_backdate_required` — the effective date is in the past, which can
 *    change what an already-open payroll period pays.
 *  - `later_rows_shadow_warning` — a row already scheduled after this date exists;
 *    the resolver always uses the LATEST row <= a sale date, so that later row
 *    would silently take back over unless the admin also updates it.
 */

import { useCallback, useEffect, useState } from 'react'

const INK = '#2c2c2a'

type RateHistoryRow = {
  id: string
  effectiveFrom: string
  inspectionRate: number
  managerOverrideRate: number
  selfGenRate: number
  changeReason: string | null
  changedByName: string | null
  createdAt: string
  isCurrent: boolean
  isScheduled: boolean
}

type LoadState = 'loading' | 'ready' | 'forbidden' | 'error'

type LaterRow = {
  effectiveFrom: string
  inspectionRate: number
  managerOverrideRate: number
  selfGenRate: number
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function CompanyCommissionRatesCard() {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [current, setCurrent] = useState({ inspectionRate: 0, managerOverrideRate: 0, selfGenRate: 0 })
  const [history, setHistory] = useState<RateHistoryRow[]>([])
  const [today, setToday] = useState(todayIso())

  const [inspectionDraft, setInspectionDraft] = useState('')
  const [managerOverrideDraft, setManagerOverrideDraft] = useState('')
  const [selfGenDraft, setSelfGenDraft] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [reason, setReason] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoadState('loading')
    setError('')
    try {
      const res = await fetch('/api/admin/comp-rates')
      if (res.status === 403) {
        setLoadState('forbidden')
        return
      }
      if (!res.ok) {
        setLoadState('error')
        return
      }
      const data = (await res.json()) as {
        today: string
        current: { inspectionRate: number; managerOverrideRate: number; selfGenRate: number }
        history: RateHistoryRow[]
      }
      setCurrent(data.current)
      setHistory(data.history || [])
      setToday(data.today)
      setEffectiveFrom((prev) => prev || data.today)
      setInspectionDraft(data.current.inspectionRate.toFixed(2))
      setManagerOverrideDraft(data.current.managerOverrideRate.toFixed(2))
      setSelfGenDraft(data.current.selfGenRate.toFixed(2))
      setLoadState('ready')
    } catch {
      setLoadState('error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (overrides?: { confirm_disable?: boolean; confirm_backdate?: boolean; apply_to_later_rows?: boolean }) => {
    setError('')
    setNotice('')

    const inspection = Number(inspectionDraft.trim())
    const managerOverride = Number(managerOverrideDraft.trim())
    const selfGen = Number(selfGenDraft.trim())
    if (![inspection, managerOverride, selfGen].every((n) => Number.isFinite(n))) {
      setError('Enter a number for all three rates')
      return
    }
    if (!effectiveFrom) {
      setError('Choose an effective date')
      return
    }
    if (!reason.trim()) {
      setError('A reason for the change is required')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/admin/comp-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inspection_rate: inspection,
          manager_override_rate: managerOverride,
          self_gen_rate: selfGen,
          effective_from: effectiveFrom,
          change_reason: reason.trim(),
          ...overrides,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        code?: string
        fields?: string[]
        laterRows?: LaterRow[]
        period?: { label: string; status: string; cutoffDate?: string }
      }

      if (!res.ok) {
        if (data.code === 'confirm_disable_required') {
          const ok = window.confirm(
            `${data.error}\n\nThis switches that pay line off for the whole org. Continue?`
          )
          if (ok) {
            await save({ ...overrides, confirm_disable: true })
            return
          }
          setError('Save cancelled.')
          return
        }
        if (data.code === 'confirm_backdate_required') {
          const ok = window.confirm(
            `${data.error}\n\nThis effective date is in the past and can change what an already-open payroll period pays. Continue?`
          )
          if (ok) {
            await save({ ...overrides, confirm_backdate: true })
            return
          }
          setError('Save cancelled.')
          return
        }
        if (data.code === 'later_rows_shadow_warning') {
          const laterRowsText = (data.laterRows || [])
            .map(
              (row) =>
                `  ${row.effectiveFrom}: inspection ${row.inspectionRate}%, manager override ${row.managerOverrideRate}%, self-gen ${row.selfGenRate}%`
            )
            .join('\n')
          const applyToLater = window.confirm(
            `${data.error}\n\nLater rate row(s) already scheduled:\n${laterRowsText}\n\n` +
              'Click OK to ALSO apply these new rates to those later row(s), or Cancel to save only ' +
              `${effectiveFrom} and leave the later row(s) as-is.`
          )
          await save({ ...overrides, apply_to_later_rows: applyToLater })
          return
        }
        setError(data.error || 'Failed to save commission rates')
        return
      }

      setNotice(`Saved. Effective ${effectiveFrom}.`)
      setReason('')
      await load()
    } catch {
      setError('Failed to save commission rates')
    } finally {
      setSaving(false)
    }
  }

  if (loadState === 'forbidden') return null

  const dirty =
    inspectionDraft.trim() !== current.inspectionRate.toFixed(2) ||
    managerOverrideDraft.trim() !== current.managerOverrideRate.toFixed(2) ||
    selfGenDraft.trim() !== current.selfGenRate.toFixed(2) ||
    (effectiveFrom && effectiveFrom !== today)
  const canSave = dirty && reason.trim().length > 0 && !saving

  return (
    <section className="mb-8 bg-white rounded-xl shadow-sm border p-6 sm:p-8">
      <h2 className="text-lg font-semibold" style={{ color: INK }}>
        Company commission rates
      </h2>
      <p className="mt-2 max-w-3xl text-sm" style={{ color: INK }}>
        The three org-wide derived pay lines added on top of the base commission: inspection,
        manager override, and self-generated. Each is a percent of a job&apos;s commissionable
        base and applies only when no explicit per-job override exists. A rate of 0 disables that
        line entirely. Changes are effective-dated — the resolver always uses the latest row on or
        before a job&apos;s sale date, so a later scheduled row can shadow one you just saved (see
        the warning below if that applies).
      </p>

      {loadState === 'loading' && (
        <p className="mt-4 text-sm" style={{ color: INK }}>
          Loading…
        </p>
      )}

      {loadState === 'error' && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium text-red-700">Could not load commission rates.</p>
          <button
            type="button"
            onClick={() => void load()}
            className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50"
            style={{ color: INK }}
          >
            Retry
          </button>
        </div>
      )}

      {loadState === 'ready' && (
        <>
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium" style={{ color: INK }}>
                Inspection %
              </label>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={25}
                step="0.05"
                value={inspectionDraft}
                onChange={(e) => {
                  setInspectionDraft(e.target.value)
                  setNotice('')
                  setError('')
                }}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 tabular-nums"
                style={{ color: INK }}
              />
              <p className="mt-1 text-xs" style={{ color: INK }}>
                Current: {current.inspectionRate}%
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium" style={{ color: INK }}>
                Manager override %
              </label>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={25}
                step="0.05"
                value={managerOverrideDraft}
                onChange={(e) => {
                  setManagerOverrideDraft(e.target.value)
                  setNotice('')
                  setError('')
                }}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 tabular-nums"
                style={{ color: INK }}
              />
              <p className="mt-1 text-xs" style={{ color: INK }}>
                Current: {current.managerOverrideRate}%
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium" style={{ color: INK }}>
                Self-generated %
              </label>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={25}
                step="0.05"
                value={selfGenDraft}
                onChange={(e) => {
                  setSelfGenDraft(e.target.value)
                  setNotice('')
                  setError('')
                }}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 tabular-nums"
                style={{ color: INK }}
              />
              <p className="mt-1 text-xs" style={{ color: INK }}>
                Current: {current.selfGenRate}%
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-4">
            <div>
              <label htmlFor="comp-rates-effective-from" className="block text-sm font-medium" style={{ color: INK }}>
                Effective date
              </label>
              <input
                id="comp-rates-effective-from"
                type="date"
                value={effectiveFrom}
                onChange={(e) => {
                  setEffectiveFrom(e.target.value)
                  setNotice('')
                  setError('')
                }}
                className="mt-1 border border-gray-300 rounded-lg px-3 py-2"
                style={{ color: INK }}
              />
            </div>
          </div>

          <div className="mt-4">
            <label htmlFor="comp-rates-reason" className="block text-sm font-medium" style={{ color: INK }}>
              Reason for change (required)
            </label>
            <textarea
              id="comp-rates-reason"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value)
                setNotice('')
                setError('')
              }}
              rows={2}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
              style={{ color: INK }}
              placeholder="e.g. Enabling the manager override line per the 2026 comp ladder"
            />
          </div>

          <div className="mt-4">
            <button
              type="button"
              onClick={() => save()}
              disabled={!canSave}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium"
            >
              {saving ? 'Saving…' : 'Save rates'}
            </button>
          </div>

          {error && <p className="mt-3 text-sm font-medium text-red-700">{error}</p>}
          {notice && <p className="mt-3 text-sm font-medium text-emerald-800">{notice}</p>}

          <div className="mt-6">
            <h3 className="text-sm font-semibold" style={{ color: INK }}>
              History
            </h3>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left border-b" style={{ color: INK }}>
                    <th className="py-2 pr-4">Effective</th>
                    <th className="py-2 pr-4">Inspection</th>
                    <th className="py-2 pr-4">Manager override</th>
                    <th className="py-2 pr-4">Self-gen</th>
                    <th className="py-2 pr-4">Changed by</th>
                    <th className="py-2 pr-4">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {history
                    .slice()
                    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))
                    .map((row) => (
                      <tr
                        key={row.id}
                        className={`border-b last:border-0 ${row.isCurrent ? 'bg-emerald-50' : ''}`}
                      >
                        <td className="py-2 pr-4 font-medium" style={{ color: INK }}>
                          {row.effectiveFrom}
                          {row.isCurrent && (
                            <span className="ml-2 inline-block px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-200 text-emerald-900">
                              in effect
                            </span>
                          )}
                          {row.isScheduled && (
                            <span className="ml-2 inline-block px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-200 text-amber-900">
                              scheduled
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-4" style={{ color: INK }}>{row.inspectionRate}%</td>
                        <td className="py-2 pr-4" style={{ color: INK }}>{row.managerOverrideRate}%</td>
                        <td className="py-2 pr-4" style={{ color: INK }}>{row.selfGenRate}%</td>
                        <td className="py-2 pr-4" style={{ color: INK }}>{row.changedByName || '—'}</td>
                        <td className="py-2 pr-4" style={{ color: INK }}>{row.changeReason || '—'}</td>
                      </tr>
                    ))}
                  {history.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-3 text-sm" style={{ color: INK }}>
                        No history yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
