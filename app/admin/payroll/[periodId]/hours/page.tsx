'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import PayrollPeriodHoursEditor, {
  type HoursRow,
} from '@/components/payroll/PayrollPeriodHoursEditor'

type PeriodMeta = {
  id: string
  period_label: string
  status: string
  scheduled_pay_date: string
}

export default function PayrollPeriodHoursPage() {
  const params = useParams()
  const router = useRouter()
  const periodId = params.periodId as string

  const [period, setPeriod] = useState<PeriodMeta | null>(null)
  const [rows, setRows] = useState<HoursRow[]>([])
  const [readOnly, setReadOnly] = useState(false)
  const [drafts, setDrafts] = useState<
    Record<string, { regular_hours: string; overtime_hours: string; notes: string }>
  >({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saveReason, setSaveReason] = useState('Period hours entry')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/payroll/${periodId}/hours`)
      if (res.status === 401) {
        router.push('/login')
        return
      }
      if (!res.ok) {
        setError('Failed to load hours')
        return
      }
      const j = await res.json()
      setPeriod(j.period)
      setReadOnly(Boolean(j.readOnly))
      const list = (j.rows || []) as HoursRow[]
      setRows(list)
      const d: Record<string, { regular_hours: string; overtime_hours: string; notes: string }> = {}
      for (const r of list) {
        d[r.user_id] = {
          regular_hours: String(r.regular_hours),
          overtime_hours: String(r.overtime_hours),
          notes: r.notes || '',
        }
      }
      setDrafts(d)
    } catch {
      setError('Failed to load hours')
    } finally {
      setLoading(false)
    }
  }, [periodId, router])

  useEffect(() => {
    load()
  }, [load])

  const onDraftChange = (
    userId: string,
    field: 'regular_hours' | 'overtime_hours' | 'notes',
    value: string
  ) => {
    setDrafts((prev) => ({
      ...prev,
      [userId]: { ...prev[userId], [field]: value },
    }))
  }

  const saveAll = async () => {
    setSaving(true)
    setError('')
    try {
      const entries = rows.map((r) => {
        const d = drafts[r.user_id]
        return {
          user_id: r.user_id,
          regular_hours: Number(d?.regular_hours) || 0,
          overtime_hours: Number(d?.overtime_hours) || 0,
          notes: d?.notes || null,
          reason: saveReason,
        }
      })
      const res = await fetch(`/api/admin/payroll/${periodId}/hours`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError((j as { error?: string }).error || 'Save failed')
        return
      }
      await load()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 py-8">
        <Link href="/admin/payroll/periods" className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">
          ← Pay periods
        </Link>

        <div className="bg-white rounded-xl shadow-sm border p-6 sm:p-8 mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Hourly entry</h1>
              <p className="text-gray-600 mt-1 text-sm">
                {period?.period_label || periodId}
                {period?.scheduled_pay_date && ` · Pay ${period.scheduled_pay_date}`}
              </p>
            </div>
            {readOnly ? (
              <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900">
                Read-only (period locked)
              </span>
            ) : (
              <button
                type="button"
                disabled={saving || loading}
                onClick={saveAll}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save All'}
              </button>
            )}
          </div>

          {!readOnly && (
            <label className="block mt-4 text-sm max-w-md">
              <span className="text-gray-600">Audit reason (optional)</span>
              <input
                className="mt-1 w-full rounded border px-3 py-2"
                value={saveReason}
                onChange={(e) => setSaveReason(e.target.value)}
              />
            </label>
          )}

          {error && (
            <p className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="mt-6">
            {loading ? (
              <p className="text-sm text-gray-500 text-center py-8">Loading…</p>
            ) : (
              <PayrollPeriodHoursEditor
                rows={rows}
                drafts={drafts}
                readOnly={readOnly}
                onDraftChange={onDraftChange}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
