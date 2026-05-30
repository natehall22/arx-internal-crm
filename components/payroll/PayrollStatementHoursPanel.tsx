'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatPayrollMoney } from '@/lib/payroll-format'
import { computeHourlyEarnings } from '@/lib/weekly-payroll/hourly-earnings'

type HoursRow = {
  user_id: string
  full_name: string
  hourly_rate: number | null
  regular_hours: number
  overtime_hours: number
  hourly_earnings: number
  notes: string | null
}

type Props = {
  periodId: string
  userId: string
  readOnly: boolean
  onSaved?: () => void
}

export default function PayrollStatementHoursPanel({
  periodId,
  userId,
  readOnly,
  onSaved,
}: Props) {
  const [row, setRow] = useState<HoursRow | null>(null)
  const [regularHours, setRegularHours] = useState('0')
  const [overtimeHours, setOvertimeHours] = useState('0')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/payroll/${periodId}/hours`)
      if (!res.ok) {
        setRow(null)
        return
      }
      const j = await res.json()
      const match = ((j.rows || []) as HoursRow[]).find((r) => r.user_id === userId) || null
      setRow(match)
      if (match) {
        setRegularHours(String(match.regular_hours))
        setOvertimeHours(String(match.overtime_hours))
        setNotes(match.notes || '')
      }
    } catch {
      setError('Failed to load hours')
    } finally {
      setLoading(false)
    }
  }, [periodId, userId])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return <p className="text-sm text-gray-500">Loading hourly entry…</p>
  }

  if (!row || row.hourly_rate == null) {
    return (
      <p className="text-sm text-gray-500 rounded-lg border border-dashed p-4">
        No hourly or hybrid comp plan for this rep, or no hourly rate on file. Use{' '}
        <a href={`/admin/payroll/${periodId}/hours`} className="text-indigo-600 hover:underline">
          period hours entry
        </a>{' '}
        for bulk entry.
      </p>
    )
  }

  const reg = Number(regularHours) || 0
  const ot = Number(overtimeHours) || 0
  const preview = computeHourlyEarnings({
    regularHours: reg,
    overtimeHours: ot,
    hourlyRate: row.hourly_rate,
  })

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/payroll/${periodId}/hours`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: [
            {
              user_id: userId,
              regular_hours: reg,
              overtime_hours: ot,
              notes: notes || null,
              reason: 'Admin statement hours edit',
            },
          ],
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((j as { error?: string }).error || 'Failed to save hours')
        return
      }
      await load()
      onSaved?.()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border bg-gray-50/50 p-4 text-sm space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-gray-900">Hourly entry</h3>
        <span className="text-gray-600">
          Rate {formatPayrollMoney(row.hourly_rate)} · Preview {formatPayrollMoney(preview.total)}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-gray-600">
          Regular hours
          <input
            type="number"
            step="0.25"
            min="0"
            disabled={readOnly}
            className="mt-1 w-full rounded border px-2 py-1 text-sm disabled:bg-gray-100"
            value={regularHours}
            onChange={(e) => setRegularHours(e.target.value)}
          />
        </label>
        <label className="text-xs text-gray-600">
          Overtime hours
          <input
            type="number"
            step="0.25"
            min="0"
            disabled={readOnly}
            className="mt-1 w-full rounded border px-2 py-1 text-sm disabled:bg-gray-100"
            value={overtimeHours}
            onChange={(e) => setOvertimeHours(e.target.value)}
          />
        </label>
        <label className="text-xs text-gray-600 sm:col-span-1">
          Notes
          <input
            type="text"
            disabled={readOnly}
            className="mt-1 w-full rounded border px-2 py-1 text-sm disabled:bg-gray-100"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </div>
      {error && <p className="text-red-700 text-xs">{error}</p>}
      {!readOnly && (
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="px-3 py-1.5 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save hours'}
        </button>
      )}
    </div>
  )
}
