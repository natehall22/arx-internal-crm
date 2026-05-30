'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import PayrollStatementHoursPanel from '@/components/payroll/PayrollStatementHoursPanel'
import PayrollStatementView from '@/components/payroll/PayrollStatementView'
import type { PayrollStatementPayload } from '@/lib/payroll-statement'

type Period = { id: string; period_label: string; scheduled_pay_date: string; status: string }
type Consultant = { id: string; full_name: string | null; role: string }

type AuditEntry = {
  id: string
  overrideType: string
  jobId: string | null
  actorName: string
  reason: string
  beforeValue: unknown
  afterValue: unknown
  createdAt: string
}

function lineKey(jobId: string, role: string) {
  return `${jobId}|${role}`
}

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
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [error, setError] = useState('')
  const [overrideDrafts, setOverrideDrafts] = useState<Record<string, string>>({})
  const [premierDrafts, setPremierDrafts] = useState<Record<string, string>>({})
  const [percentDrafts, setPercentDrafts] = useState<Record<string, string>>({})
  const [savingOverrideKey, setSavingOverrideKey] = useState<string | null>(null)
  const [lockLoading, setLockLoading] = useState(false)
  const [emailLoading, setEmailLoading] = useState(false)
  /** Prevent double-click duplicate bulk sends (Claude P1 — 60s after "Email all"). */
  const [emailBulkCooldownUntil, setEmailBulkCooldownUntil] = useState(0)
  /** Prevent double-click duplicate consultant resends (60s after "Resend to consultant"). */
  const [emailConsultantCooldownUntil, setEmailConsultantCooldownUntil] = useState(0)
  const [emailResult, setEmailResult] = useState<{
    sentCount: number
    failedCount: number
    sent: { userId: string; name: string; email: string }[]
    failed: { userId: string; name: string; reason: string }[]
  } | null>(null)

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

  const currentPeriod = periods.find((p) => p.id === periodId)
  const periodEditable = currentPeriod?.status === 'open'
  const periodCanEmail =
    currentPeriod?.status === 'locked' || currentPeriod?.status === 'paid'

  const loadAudit = useCallback(async () => {
    if (!periodId || !userId) return
    try {
      const res = await fetch(
        `/api/admin/payroll/periods/${periodId}/override-audit?user_id=${encodeURIComponent(userId)}`
      )
      if (!res.ok) {
        setAuditEntries([])
        return
      }
      const j = await res.json()
      setAuditEntries((j.entries || []) as AuditEntry[])
    } catch {
      setAuditEntries([])
    }
  }, [periodId, userId])

  const loadStatement = useCallback(async () => {
    if (!periodId || !userId) return
    setLoading(true)
    setError('')
    try {
      if (periodEditable) {
        const res = await fetch(`/api/admin/payroll/periods/${periodId}/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId }),
        })
        if (res.status === 409) {
          const j = await res.json().catch(() => ({}))
          setError((j as { error?: string }).error || 'Period is not open for preview')
          setStatement(null)
          return
        }
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          setError((j as { error?: string }).error || 'Failed to load preview')
          setStatement(null)
          return
        }
        setStatement((await res.json()) as PayrollStatementPayload)
      } else {
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
      }
      await loadAudit()
    } catch {
      setError('Failed to load statement')
      setStatement(null)
    } finally {
      setLoading(false)
    }
  }, [periodId, userId, periodEditable, loadAudit])

  useEffect(() => {
    loadStatement()
  }, [loadStatement])

  const recalculatePreview = async () => {
    if (!periodId || !userId || !periodEditable) return
    setPreviewLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/payroll/periods/${periodId}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((j as { error?: string }).error || 'Preview failed')
        return
      }
      setStatement(j as PayrollStatementPayload)
      setOverrideDrafts({})
      setPremierDrafts({})
      setPercentDrafts({})
    } finally {
      setPreviewLoading(false)
    }
  }

  const saveDealRole = async (jobId: string, role: string) => {
    if (!periodEditable || !periodId) return
    const key = lineKey(jobId, role)
    const rawOverride = overrideDrafts[key]
    const rawPremier = premierDrafts[key]
    const rawPercent = percentDrafts[key]

    const parseNullable = (raw: string | undefined) => {
      if (raw === undefined) return undefined
      if (raw === '' || raw == null) return null
      const n = Number(raw)
      return Number.isFinite(n) ? n : null
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
          payroll_period_id: periodId,
          override_amount: parseNullable(rawOverride),
          override_percent: parseNullable(rawPercent),
          premier_pricing_amount: parseNullable(rawPremier),
          reason: 'Admin statement override',
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError((j as { error?: string }).error || 'Override save failed')
        return
      }
      await recalculatePreview()
      await loadAudit()
    } finally {
      setSavingOverrideKey(null)
    }
  }

  const sendStatements = async (targetUserId?: string) => {
    if (!periodId) return
    setEmailLoading(true)
    setError('')
    setEmailResult(null)
    try {
      const res = await fetch(`/api/admin/payroll/periods/${periodId}/send-statements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(targetUserId ? { user_id: targetUserId } : {}),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((j as { error?: string }).error || 'Failed to send statement emails')
        return
      }
      setEmailResult({
        sentCount: (j as { sentCount?: number }).sentCount ?? 0,
        failedCount: (j as { failedCount?: number }).failedCount ?? 0,
        sent: ((j as { sent?: { userId: string; name: string; email: string }[] }).sent ||
          []) as { userId: string; name: string; email: string }[],
        failed: ((j as { failed?: { userId: string; name: string; reason: string }[] }).failed ||
          []) as { userId: string; name: string; reason: string }[],
      })
      if (!targetUserId) {
        setEmailBulkCooldownUntil(Date.now() + 60_000)
      } else {
        setEmailConsultantCooldownUntil(Date.now() + 60_000)
      }
    } finally {
      setEmailLoading(false)
    }
  }

  const emailBulkOnCooldown = emailBulkCooldownUntil > Date.now()
  const emailConsultantOnCooldown = emailConsultantCooldownUntil > Date.now()

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

  const statusBadge = () => {
    const s = currentPeriod?.status
    if (s === 'open') {
      return (
        <span className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-900">
          Open — edits allowed
        </span>
      )
    }
    if (s === 'locked') {
      return (
        <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900">
          Locked — official statement frozen
        </span>
      )
    }
    if (s === 'paid') {
      return (
        <span className="inline-flex items-center rounded-full bg-indigo-100 px-3 py-1 text-sm font-medium text-indigo-900">
          Paid — no edits
        </span>
      )
    }
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 py-8">
        <Link
          href="/admin/payroll/periods"
          className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
        >
          ← Pay periods
        </Link>

        <div className="bg-white rounded-xl shadow-sm border p-6 sm:p-8 mt-6">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Consultant statements</h1>
              <p className="text-gray-600 mt-1 text-sm">
                Edit deal overrides and hours while the period is open, then recalculate preview
                before lock.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {statusBadge()}
              {periodEditable && (
                <>
                  <button
                    type="button"
                    disabled={previewLoading || !userId}
                    onClick={recalculatePreview}
                    className="px-4 py-2 border border-indigo-600 text-indigo-700 rounded-lg text-sm font-medium hover:bg-indigo-50 disabled:opacity-50"
                  >
                    {previewLoading ? 'Recalculating…' : 'Recalculate preview'}
                  </button>
                  <button
                    type="button"
                    disabled={lockLoading}
                    onClick={lockPeriod}
                    className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
                  >
                    {lockLoading ? 'Locking…' : 'Lock period'}
                  </button>
                </>
              )}
              {periodCanEmail && (
                <>
                  <button
                    type="button"
                    disabled={emailLoading || emailBulkOnCooldown}
                    onClick={() => sendStatements()}
                    title={
                      emailBulkOnCooldown
                        ? 'Wait before sending again to avoid duplicate emails'
                        : undefined
                    }
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {emailLoading
                      ? 'Sending…'
                      : emailBulkOnCooldown
                        ? 'Email all (wait 60s)'
                        : 'Email all statements'}
                  </button>
                  <button
                    type="button"
                    disabled={emailLoading || !userId || emailConsultantOnCooldown}
                    onClick={() => sendStatements(userId)}
                    title={
                      emailConsultantOnCooldown
                        ? 'Wait before resending to avoid duplicate emails'
                        : undefined
                    }
                    className="px-4 py-2 border border-gray-300 text-gray-800 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                  >
                    {emailLoading
                      ? 'Sending…'
                      : emailConsultantOnCooldown
                        ? 'Resend to consultant (wait 60s)'
                        : 'Resend to consultant'}
                  </button>
                </>
              )}
            </div>
          </div>

          {!periodEditable && currentPeriod && (
            <p className="mt-4 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              This period is {currentPeriod.status}. Deal overrides and hours cannot be changed;
              the statement below is the official payout record from lock.
            </p>
          )}

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

          {emailResult && (
            <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm space-y-3">
              <p className="font-medium text-gray-900">
                Email complete — {emailResult.sentCount} sent, {emailResult.failedCount} failed
              </p>
              {emailResult.failed.length > 0 && (
                <div>
                  <p className="text-red-800 font-medium mb-1">Failures (fix and resend)</p>
                  <ul className="list-disc pl-5 text-red-900 space-y-1">
                    {emailResult.failed.map((f) => (
                      <li key={f.userId}>
                        {f.name}: {f.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {emailResult.sent.length > 0 && emailResult.sent.length <= 10 && (
                <ul className="text-gray-700 list-disc pl-5">
                  {emailResult.sent.map((s) => (
                    <li key={s.userId}>
                      {s.name} → {s.email}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {periodId && userId && (
            <div className="mt-6">
              <PayrollStatementHoursPanel
                periodId={periodId}
                userId={userId}
                readOnly={!periodEditable}
                onSaved={recalculatePreview}
              />
            </div>
          )}

          <div className="mt-8">
            <PayrollStatementView
              statement={statement}
              loading={loading}
              error={error && !statement ? error : null}
              adminMode
              readOnly={!periodEditable}
              overrideDrafts={overrideDrafts}
              premierDrafts={premierDrafts}
              percentDrafts={percentDrafts}
              onOverrideDraftChange={(jobId, role, value) =>
                setOverrideDrafts((d) => ({ ...d, [lineKey(jobId, role)]: value }))
              }
              onPremierDraftChange={(jobId, role, value) =>
                setPremierDrafts((d) => ({ ...d, [lineKey(jobId, role)]: value }))
              }
              onPercentDraftChange={(jobId, role, value) =>
                setPercentDrafts((d) => ({ ...d, [lineKey(jobId, role)]: value }))
              }
              onSaveOverride={saveDealRole}
              savingOverrideKey={savingOverrideKey}
            />
          </div>

          {auditEntries.length > 0 && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Override audit trail</h2>
              <div className="overflow-x-auto border rounded-lg text-sm">
                <table className="min-w-full">
                  <thead className="bg-gray-50 text-left text-gray-600">
                    <tr>
                      <th className="px-3 py-2 font-medium">When</th>
                      <th className="px-3 py-2 font-medium">Actor</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium">Reason</th>
                      <th className="px-3 py-2 font-medium">Change</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {auditEntries.map((e) => (
                      <tr key={e.id}>
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                          {new Date(e.createdAt).toLocaleString()}
                        </td>
                        <td className="px-3 py-2">{e.actorName}</td>
                        <td className="px-3 py-2">{e.overrideType}</td>
                        <td className="px-3 py-2">{e.reason}</td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-700">
                          {JSON.stringify(e.beforeValue)} → {JSON.stringify(e.afterValue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
