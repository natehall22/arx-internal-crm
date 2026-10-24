'use client'

import { useMemo } from 'react'
import { computeHourlyEarnings } from '@/lib/weekly-payroll/hourly-earnings'
import { formatPayrollMoney } from '@/lib/payroll-format'

export type HoursRow = {
  user_id: string
  full_name: string
  role: string
  plan_name: string | null
  plan_type: string | null
  hourly_rate: number | null
  regular_hours: number
  overtime_hours: number
  hourly_earnings: number
  notes: string | null
}

type Draft = Record<
  string,
  { regular_hours: string; overtime_hours: string; notes: string }
>

type Props = {
  rows: HoursRow[]
  drafts: Draft
  readOnly: boolean
  onDraftChange: (userId: string, field: keyof Draft[string], value: string) => void
}

export default function PayrollPeriodHoursEditor({
  rows,
  drafts,
  readOnly,
  onDraftChange,
}: Props) {
  const computed = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of rows) {
      const d = drafts[r.user_id]
      const reg = Number(d?.regular_hours ?? r.regular_hours) || 0
      const ot = Number(d?.overtime_hours ?? r.overtime_hours) || 0
      const rate = r.hourly_rate ?? 0
      map.set(r.user_id, computeHourlyEarnings({ regularHours: reg, overtimeHours: ot, hourlyRate: rate }).total)
    }
    return map
  }, [rows, drafts])

  if (rows.length === 0) {
    return (
      <p className="text-sm text-gray-500 py-6 text-center border border-dashed rounded-lg">
        No reps with hourly or hybrid comp plans (or hourly rate) are active in this org.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto border rounded-lg">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-left text-gray-600">
          <tr>
            <th className="px-3 py-2 font-medium">Rep</th>
            <th className="px-3 py-2 font-medium">Role</th>
            <th className="px-3 py-2 font-medium">Plan</th>
            <th className="px-3 py-2 font-medium text-right">Hourly rate</th>
            <th className="px-3 py-2 font-medium text-right">Reg. hrs</th>
            <th className="px-3 py-2 font-medium text-right">OT hrs</th>
            <th className="px-3 py-2 font-medium text-right">Earnings</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => {
            const d = drafts[r.user_id] || {
              regular_hours: String(r.regular_hours),
              overtime_hours: String(r.overtime_hours),
              notes: r.notes || '',
            }
            const earnings = computed.get(r.user_id) ?? r.hourly_earnings
            return (
              <tr key={r.user_id}>
                <td className="px-3 py-2 font-medium text-gray-900">{r.full_name}</td>
                <td className="px-3 py-2 text-gray-600">{r.role}</td>
                <td className="px-3 py-2 text-gray-600">
                  {r.plan_name || '—'}
                  {r.plan_type && (
                    <span className="block text-xs text-gray-400">{r.plan_type}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                  {r.hourly_rate != null ? formatPayrollMoney(r.hourly_rate) : '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="number"
                    min={0}
                    step={0.25}
                    disabled={readOnly}
                    className="w-20 rounded border px-2 py-1 text-right disabled:bg-gray-100"
                    value={d.regular_hours}
                    onChange={(e) => onDraftChange(r.user_id, 'regular_hours', e.target.value)}
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="number"
                    min={0}
                    step={0.25}
                    disabled={readOnly}
                    className="w-20 rounded border px-2 py-1 text-right disabled:bg-gray-100"
                    value={d.overtime_hours}
                    onChange={(e) => onDraftChange(r.user_id, 'overtime_hours', e.target.value)}
                  />
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">
                  {formatPayrollMoney(earnings)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
