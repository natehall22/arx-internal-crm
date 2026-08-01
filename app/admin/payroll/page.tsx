'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'

type PayrollRow = {
  job_number: string
  customer_name?: string | null
  sale_date: string | null
  address_text: string
  user_name: string
  participant_role: string
  comp_plan_name: string | null
  plan_type: string | null
  commission_comp_base: number | null
  pool_cap: number | null
  raw_commission: number
  scaled_commission: number
  pool_cap_enforced: boolean
  period_volume: number
  effective_rate_pct: number
  unsupported_plan: boolean
  note: string | null
}

function formatParticipantRole(role: string): string {
  if (role === 'owner') return 'Closer'
  if (role === 'sales_rep') return 'Sales rep'
  if (role === 'setter') return 'Setter'
  if (role === 'inspector') return 'Inspector'
  return role
}

function defaultDateRange() {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const from = `${y}-${String(m + 1).padStart(2, '0')}-01`
  const last = new Date(y, m + 1, 0).getDate()
  const to = `${y}-${String(m + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`
  return { from, to }
}

export default function AdminPayrollPage() {
  const router = useRouter()
  const defaults = useMemo(() => defaultDateRange(), [])
  const [from, setFrom] = useState(defaults.from)
  const [to, setTo] = useState(defaults.to)
  const [rows, setRows] = useState<PayrollRow[]>([])
  const [rowCount, setRowCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [skippedOpportunityIds, setSkippedOpportunityIds] = useState<string[]>([])

  const load = async () => {
    setLoading(true)
    setError('')
    setSkippedOpportunityIds([])
    try {
      const res = await fetch(`/api/admin/payroll/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      if (res.status === 401) {
        router.push('/login')
        return
      }
      if (res.status === 403) {
        setError('You do not have access to payroll export.')
        setRows([])
        return
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError((j as { error?: string }).error || 'Failed to load')
        setRows([])
        return
      }
      const data = await res.json()
      setRows(data.rows || [])
      setRowCount(data.rowCount ?? 0)
      setSkippedOpportunityIds(data.warnings?.sitsSkippedForMissingTimestamp ?? [])
    } catch (e) {
      setError('Failed to load payroll data')
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  const downloadCsv = () => {
    window.location.href = `/api/admin/payroll/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&format=csv`
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-6">
          <Link href="/admin" className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">
            ← Admin
          </Link>
        </div>

        <div className="bg-white rounded-xl shadow-sm border p-6 sm:p-8">
          <h1 className="text-2xl font-semibold text-gray-900">Payroll &amp; commission export</h1>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium">
            <Link href="/admin/payroll/periods" className="text-indigo-600 hover:text-indigo-800">
              Pay periods &amp; lock →
            </Link>
            <Link href="/admin/payroll/statements" className="text-indigo-600 hover:text-indigo-800">
              Consultant statements →
            </Link>
            <Link href="/admin/payroll/weekly" className="text-indigo-600 hover:text-indigo-800">
              Weekly eligibility worksheet →
            </Link>
          </div>
          <p className="text-gray-600 mt-2 max-w-3xl">
            Preview or download commission lines by job. Each person&apos;s <strong>comp plan</strong> and{' '}
            <strong>override %</strong> come from their user assignment. Monthly <strong>volume bonuses</strong> use
            attributed sales volume. The org <strong>18% commission pool cap</strong> applies per job on top of the
            commissionable base below.
          </p>
          <div className="mt-4 max-w-3xl rounded-lg border border-indigo-100 bg-indigo-50/80 px-4 py-3 text-sm text-indigo-950">
            <p className="font-semibold text-indigo-950">Commissionable base</p>
            <p className="mt-1 text-indigo-900/90">
              Shown in the table as <strong>Commissionable base</strong>: pre-tax subtotal <strong>minus dealer fee</strong>{' '}
              (same number used for the pool cap). If the export used an estimate, a note appears on that row.
            </p>
          </div>

          <div className="mt-6 flex flex-col sm:flex-row gap-4 sm:items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700">From</label>
              <input
                type="date"
                className="mt-1 border rounded-lg px-3 py-2 text-gray-900"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">To</label>
              <input
                type="date"
                className="mt-1 border rounded-lg px-3 py-2 text-gray-900"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium"
            >
              {loading ? 'Loading…' : 'Preview'}
            </button>
            <button
              type="button"
              onClick={downloadCsv}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 text-sm font-medium"
            >
              Download CSV
            </button>
          </div>

          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

          {skippedOpportunityIds.length > 0 && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-semibold">
                {skippedOpportunityIds.length} sit{skippedOpportunityIds.length === 1 ? '' : 's'} skipped for
                missing inspection timestamp
              </p>
              <p className="mt-1 text-amber-800">
                These opportunities have a qualifying inspection outcome but no reliable date to pay it
                against, so they were excluded rather than dated from an unrelated edit. Not reflected in
                tier bonuses below — check each opportunity&apos;s inspection status history.
              </p>
            </div>
          )}

          {rowCount > 0 && (
            <p className="mt-4 text-sm text-gray-600">
              {rowCount} line{rowCount === 1 ? '' : 's'} loaded.
            </p>
          )}

          {rows.length > 0 && (
            <div className="mt-6 overflow-x-auto border rounded-lg">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-gray-700">
                  <tr>
                    <th className="px-3 py-2 font-medium min-w-[140px]">Job</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Person</th>
                    <th className="px-3 py-2 font-medium">Role</th>
                    <th className="px-3 py-2 font-medium">Plan</th>
                    <th className="px-3 py-2 font-medium text-right">Commissionable base</th>
                    <th className="px-3 py-2 font-medium text-right">Pool cap</th>
                    <th className="px-3 py-2 font-medium text-right">Vol (mo.)</th>
                    <th className="px-3 py-2 font-medium text-right">Eff. %</th>
                    <th className="px-3 py-2 font-medium text-right">Raw $</th>
                    <th className="px-3 py-2 font-medium text-right">Paid $</th>
                    <th className="px-3 py-2 font-medium">Cap</th>
                    <th className="px-3 py-2 font-medium min-w-[160px]">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-3 py-2 text-gray-900 align-top">
                        <div className="font-mono text-sm font-medium text-gray-900 whitespace-nowrap">
                          {r.job_number}
                        </div>
                        <div
                          className="text-xs text-gray-700 mt-0.5 max-w-[220px] leading-snug"
                          title={r.customer_name || undefined}
                        >
                          {r.customer_name?.trim() ? r.customer_name : <span className="text-gray-400">—</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{r.sale_date || '—'}</td>
                      <td className="px-3 py-2 text-gray-900">{r.user_name}</td>
                      <td className="px-3 py-2 text-gray-600">{formatParticipantRole(r.participant_role)}</td>
                      <td className="px-3 py-2 text-gray-700 max-w-[140px] truncate" title={r.comp_plan_name || ''}>
                        {r.comp_plan_name || '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.commission_comp_base != null ? r.commission_comp_base.toFixed(2) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.pool_cap != null ? r.pool_cap.toFixed(2) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.period_volume.toFixed(0)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.effective_rate_pct.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.raw_commission.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{r.scaled_commission.toFixed(2)}</td>
                      <td className="px-3 py-2 text-gray-600">{r.pool_cap_enforced ? 'Yes' : ''}</td>
                      <td className="px-3 py-2 text-gray-600 text-xs max-w-[220px]" title={r.note || undefined}>
                        {r.note || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-8 text-xs text-gray-500 space-y-1">
            <p>
              <strong>Who appears on a job:</strong> <strong>Sales rep</strong> from the job, plus{' '}
              <strong>Setter</strong> and <strong>Closer</strong> from the linked opportunity when set (each person once).
            </p>
            <p>
              <strong>Pool cap:</strong> if raw commissions exceed the cap, amounts are scaled down proportionally
              (same job).
            </p>
            <p>
              <strong>Hybrid / hourly / unit plans:</strong> not auto-calculated in export; row shows $0 with a note—
              enter manually or extend plans.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
