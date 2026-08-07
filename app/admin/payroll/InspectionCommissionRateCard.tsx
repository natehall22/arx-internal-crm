'use client'

/**
 * Admin control for `orgs.inspection_commission_rate` — the automatic inspection
 * commission line (published ladder: 1.5% to whoever ran the inspection).
 *
 * Lives on /admin/payroll because that route's layout already gates to
 * PAYROLL_ADMIN_ROLES; the API behind it re-checks the same gate server-side.
 *
 * A rate of 0 disables the derived line for every job in the org, so 0 is rendered as a
 * loud OFF state and saving 0 requires an explicit confirmation round-trip.
 */

import { useCallback, useEffect, useState } from 'react'

const INK = '#2c2c2a'

type LoadState = 'loading' | 'ready' | 'forbidden' | 'error'

export default function InspectionCommissionRateCard() {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [savedRate, setSavedRate] = useState<number>(0)
  const [draft, setDraft] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoadState('loading')
    setError('')
    try {
      const res = await fetch('/api/admin/payroll/inspection-rate')
      if (res.status === 403) {
        setLoadState('forbidden')
        return
      }
      if (!res.ok) {
        setLoadState('error')
        return
      }
      const data = (await res.json()) as { rate?: number }
      const rate = Number(data.rate) || 0
      setSavedRate(rate)
      setDraft(rate.toFixed(2))
      setLoadState('ready')
    } catch {
      setLoadState('error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    setError('')
    setNotice('')

    const parsed = Number(draft.trim())
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      setError('Enter a rate, for example 1.5')
      return
    }

    // Turning the feature off is a deliberate act, not a keystroke.
    let confirmDisable = false
    if (parsed === 0) {
      const ok = window.confirm(
        'Set the inspection commission rate to 0%?\n\n' +
          'This turns OFF the automatic inspection commission line for every job in the org. ' +
          'Nobody will be paid for running an inspection unless an admin adds an explicit ' +
          'inspector line to each job by hand.\n\n' +
          'Already-locked pay periods keep the amounts they were locked with.'
      )
      if (!ok) return
      confirmDisable = true
    }

    setSaving(true)
    try {
      const res = await fetch('/api/admin/payroll/inspection-rate', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rate: parsed, confirm_disable: confirmDisable }),
      })
      const data = (await res.json().catch(() => ({}))) as { rate?: number; error?: string }
      if (!res.ok) {
        setError(data.error || 'Failed to save the inspection rate')
        return
      }
      const rate = Number(data.rate) || 0
      setSavedRate(rate)
      setDraft(rate.toFixed(2))
      setNotice(
        rate > 0
          ? `Saved. Inspections now pay ${rate}% of the job's commissionable base.`
          : 'Saved. The inspection commission line is now OFF.'
      )
    } catch {
      setError('Failed to save the inspection rate')
    } finally {
      setSaving(false)
    }
  }

  if (loadState === 'forbidden') return null

  const dirty = draft.trim() !== '' && Number(draft) !== savedRate
  const isOff = savedRate <= 0

  return (
    <section className="mt-6 bg-white rounded-xl shadow-sm border p-6 sm:p-8">
      <h2 className="text-lg font-semibold" style={{ color: INK }}>
        Inspection commission rate
      </h2>
      <p className="mt-2 max-w-3xl text-sm" style={{ color: INK }}>
        Pays the rep who <strong>ran the inspection</strong> a percent of that job&apos;s
        commissionable base, without anyone hand-entering a line per deal. The published ladder
        sets this at <strong>1.5%</strong>. A per-job inspector line entered by an admin always
        wins over this rate, and the amount counts inside the 18% commission pool cap.
      </p>

      {loadState === 'loading' && (
        <p className="mt-4 text-sm" style={{ color: INK }}>
          Loading…
        </p>
      )}

      {loadState === 'error' && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium text-red-700">Could not load the current rate.</p>
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
          <div
            className={`mt-4 rounded-lg border px-4 py-3 ${
              isOff ? 'border-amber-300 bg-amber-50' : 'border-emerald-300 bg-emerald-50'
            }`}
          >
            <p className="text-sm font-semibold" style={{ color: isOff ? '#78350f' : '#064e3b' }}>
              {isOff
                ? 'Currently OFF — inspections pay nothing'
                : `Currently ON — inspections pay ${savedRate}% of the commissionable base`}
            </p>
            <p className="mt-1 text-sm" style={{ color: isOff ? '#78350f' : '#064e3b' }}>
              {isOff
                ? 'A rate of 0 disables the automatic inspection line entirely. Inspection pay has to be added to each job by hand until a rate is set.'
                : 'Applied when a job has no explicit inspector line. The inspector is the rep on the earliest non-cancelled inspection appointment for that opportunity.'}
            </p>
          </div>

          <div className="mt-5 flex flex-wrap items-end gap-4">
            <div>
              <label
                htmlFor="inspection-commission-rate"
                className="block text-sm font-medium"
                style={{ color: INK }}
              >
                Rate (% of commissionable base)
              </label>
              <input
                id="inspection-commission-rate"
                type="number"
                inputMode="decimal"
                min={0}
                max={25}
                step="0.05"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value)
                  setNotice('')
                  setError('')
                }}
                className="mt-1 w-36 border border-gray-300 rounded-lg px-3 py-2 tabular-nums"
                style={{ color: INK }}
                aria-describedby="inspection-commission-rate-help"
              />
            </div>
            <button
              type="button"
              onClick={save}
              disabled={saving || !dirty}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium"
            >
              {saving ? 'Saving…' : 'Save rate'}
            </button>
            {savedRate !== 1.5 && (
              <button
                type="button"
                onClick={() => {
                  setDraft('1.50')
                  setNotice('')
                  setError('')
                }}
                className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50"
                style={{ color: INK }}
              >
                Use ladder rate (1.5%)
              </button>
            )}
          </div>

          <p id="inspection-commission-rate-help" className="mt-2 text-sm" style={{ color: INK }}>
            Enter <strong>0</strong> to switch the inspection commission off. Already-locked pay
            periods keep the amounts they were locked with; the new rate applies to periods locked
            from now on. The preview and CSV above are calculated live, so they use the new rate
            even for past dates.
          </p>

          {error && <p className="mt-3 text-sm font-medium text-red-700">{error}</p>}
          {notice && <p className="mt-3 text-sm font-medium text-emerald-800">{notice}</p>}
        </>
      )}
    </section>
  )
}
