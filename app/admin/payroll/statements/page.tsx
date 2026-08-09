'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import PayrollStatementView from '@/components/payroll/PayrollStatementView'
import type { PayrollStatementPayload } from '@/lib/payroll-statement'

type Period = { id: string; period_label: string; scheduled_pay_date: string; status: string }
type Consultant = { id: string; full_name: string | null; role: string }

export default function AdminPayrollStatementsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialPeriod = searchParams.get('period_id') || ''
  const initialUser = searchParams.get('user_id') || ''

  const [periods, setPeriods] = useState<Period[]>([])
  const [consultants, setConsultants] = useState<Consultant[]>([])
  const [periodId, setPeriodId] = useState(initialPeriod)
  const [userId, setUserId] = useState(initialUser)
  const [statement, setStatement] = useState<PayrollStatementPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [overrideDrafts, setOverrideDrafts] = useState<Record<string, string>>({})
  const [savingOverrideKey, setSavingOverrideKey] = useState<string | null>(null)
  const [lockLoading, setLockLoading] = useState(false)
  const [emailLoading, setEmailLoading] = useState(false)
  const [emailSuccess, setEmailSuccess] = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/payroll/periods'),
      fetch('/api/admin/payroll/consultants'),
    ]).then(async ([pRes, cRes]) => {
      if (pRes.status === 401 || cRes.status === 401) {
        router.push('/login')
        return
      }
      if (pRes.ok) {
        const j = await pRes.json()
        const ps = j.periods || []
        setPeriods(ps)
        setPeriodId((prev) => prev || initialPeriod || ps[0]?.id || '')
      }
      if (cRes.ok) {
        const j = await cRes.json()
        const cs = j.consultants || []
        setConsultants(cs)
        setUserId((prev) => prev || initialUser || cs[0]?.id || '')
      }
    })
  }, [router, initialPeriod, initialUser])

  const loadStatement = useCallback(async () => {
    if (!periodId || !userId) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(
        `/api/commissions/statement?period_id=${encodeURIComponent(periodId)}&user_id=${encodeURIComponent(userId)}`
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError((j as { error?: string }).error || 'Failed to load')
        setStatement(null)
        return
      }
      setStatement((await res.json()) as PayrollStatementPayload)
    } catch {
      setError('Failed to load statement')
      setStatement(null)
    } finally {
      setLoading(false)
    }
  }, [periodId, userId])

  useEffect(() => {
    loadStatement()
    setEmailSuccess('')
  }, [loadStatement])

  const emailStatement = async () => {
    if (!periodId || !userId) return
    setEmailLoading(true)
    setError('')
    setEmailSuccess('')
    try {
      const res = await fetch('/api/admin/payroll/statements/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period_id: periodId, user_id: userId, attach_pdf: true }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((j as { error?: string }).error || 'Email failed')
        return
      }
      setEmailSuccess(`Pay statement emailed to ${(j as { sent_to?: string }).sent_to || 'consultant'}.`)
    } finally {
      setEmailLoading(false)
    }
  }

  const saveOverride = async (jobId: string, role: string) => {
    const key = `${jobId}|${role}`
    const raw = overrideDrafts[key]
    const amount = raw === '' || raw == null ? null : Number(raw)
    if (amount != null && !Number.isFinite(amount)) return

    // An override changes what someone gets paid, and the reason is what lands in
    // payroll_override_audit. A hardcoded constant here would satisfy the API's
    // non-empty check while making every audit row say the same meaningless thing,
    // so ask for the actual reason instead.
    const reason = window.prompt(
      'Why is this commission being overridden? This is recorded in the payroll audit trail.'
    )
    if (reason == null) return
    if (!reason.trim()) {
      setError('A change reason is required to save a commission override.')
      return
    }

    setSavingOverrideKey(key)
    try {
      const res = await fetch('/api/admin/payroll/deal-commission-roles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: jobId,
          user_id: userId,
          role,
          override_amount: amount,
          reason: reason.trim(),
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError((j as { error?: string }).error || 'Override save failed')
        return
      }
      await loadStatement()
    } finally {
      setSavingOverrideKey(null)
    }
  }

  const lockPeriod = async () => {
    if (!periodId) return
    setLockLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/payroll/periods/${periodId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'lock' }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((j as { error?: string }).error || 'Lock failed')
        return
      }
      const pRes = await fetch('/api/admin/payroll/periods')
      if (pRes.ok) {
        const pj = await pRes.json()
        setPeriods(pj.periods || [])
      }
      await loadStatement()
    } finally {
      setLockLoading(false)
    }
  }

  const currentPeriod = periods.find((p) => p.id === periodId)
  const canEmailStatement =
    currentPeriod?.status === 'locked' || currentPeriod?.status === 'paid'

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 py-8">
        <Link href="/admin/payroll/periods" className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">
          ← Pay periods
        </Link>

        <div className="bg-white rounded-xl shadow-sm border p-6 sm:p-8 mt-6">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Consultant statements</h1>
              <p className="text-gray-600 mt-1 text-sm">
                Review payouts, edit deal overrides, and lock the period when ready.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {currentPeriod?.status === 'open' && (
                <button
                  type="button"
                  disabled={lockLoading}
                  onClick={lockPeriod}
                  className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
                >
                  {lockLoading ? 'Locking…' : 'Lock period'}
                </button>
              )}
              {currentPeriod?.status === 'locked' && (
                <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900">
                  Period locked
                </span>
              )}
              {currentPeriod?.status === 'paid' && (
                <span className="inline-flex items-center rounded-full bg-indigo-100 px-3 py-1 text-sm font-medium text-indigo-800">
                  Period paid
                </span>
              )}
              {canEmailStatement && (
                <button
                  type="button"
                  disabled={emailLoading || loading || lockLoading || !statement || !periodId || !userId}
                  onClick={emailStatement}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                >
                  {emailLoading ? 'Sending…' : 'Email statement'}
                </button>
              )}
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className="text-sm">
              <span className="text-gray-600">Consultant</span>
              <select
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
              >
                {consultants.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name || c.id} ({c.role})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-gray-600">Pay period</span>
              <select
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={periodId}
                onChange={(e) => setPeriodId(e.target.value)}
              >
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.period_label} ({p.status})
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error && (
            <p className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {emailSuccess && (
            <p className="mt-4 text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              {emailSuccess}
            </p>
          )}

          <div className="mt-8">
            <PayrollStatementView
              statement={statement}
              loading={loading}
              error={error && !statement ? error : null}
              adminMode
              overrideDrafts={overrideDrafts}
              onOverrideDraftChange={(jobId, role, value) =>
                setOverrideDrafts((d) => ({ ...d, [`${jobId}|${role}`]: value }))
              }
              onSaveOverride={saveOverride}
              savingOverrideKey={savingOverrideKey}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
