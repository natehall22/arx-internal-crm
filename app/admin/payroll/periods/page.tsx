'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'

type Period = {
  id: string
  period_label: string
  cutoff_at: string
  lock_at: string
  scheduled_pay_date: string
  status: string
  locked_at: string | null
  paid_at: string | null
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    open: 'bg-green-100 text-green-800',
    locked: 'bg-amber-100 text-amber-900',
    paid: 'bg-indigo-100 text-indigo-800',
    cancelled: 'bg-gray-100 text-gray-600',
  }
  return map[status] || 'bg-gray-100 text-gray-700'
}

export default function PayrollPeriodsPage() {
  const router = useRouter()
  const [periods, setPeriods] = useState<Period[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const [label, setLabel] = useState('')
  const [cutoffAt, setCutoffAt] = useState('')
  const [payDate, setPayDate] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/payroll/periods')
      if (res.status === 401) {
        router.push('/login')
        return
      }
      if (!res.ok) {
        setError('Failed to load periods')
        return
      }
      const j = await res.json()
      setPeriods(j.periods || [])
    } catch {
      setError('Failed to load periods')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    load()
  }, [load])

  const createPeriod = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)
    setError('')
    try {
      const res = await fetch('/api/admin/payroll/periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period_label: label,
          cutoff_at: new Date(cutoffAt).toISOString(),
          lock_at: new Date(cutoffAt).toISOString(),
          scheduled_pay_date: payDate,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError((j as { error?: string }).error || 'Create failed')
        return
      }
      setLabel('')
      setCutoffAt('')
      setPayDate('')
      await load()
    } finally {
      setCreating(false)
    }
  }

  const runAction = async (id: string, action: string) => {
    setActionLoading(`${id}-${action}`)
    setError('')
    try {
      const res = await fetch(`/api/admin/payroll/periods/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((j as { error?: string; message?: string }).error || (j as { message?: string }).message || 'Action failed')
        return
      }
      await load()
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 py-8">
        <Link href="/admin/payroll" className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">
          ← Payroll hub
        </Link>

        <div className="bg-white rounded-xl shadow-sm border p-6 sm:p-8 mt-6">
          <h1 className="text-2xl font-semibold text-gray-900">Pay periods</h1>
          <p className="text-gray-600 mt-2 text-sm max-w-2xl">
            Create weekly or semi-monthly windows, enter hours, lock when ready, then mark paid.
          </p>

          {error && (
            <p className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <form onSubmit={createPeriod} className="mt-6 grid gap-4 sm:grid-cols-3 border rounded-lg p-4 bg-gray-50/50">
            <label className="text-sm">
              <span className="text-gray-600">Label</span>
              <input
                required
                className="mt-1 w-full rounded border px-3 py-2"
                placeholder="2026-W22"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <label className="text-sm">
              <span className="text-gray-600">Cutoff (local → UTC)</span>
              <input
                required
                type="datetime-local"
                className="mt-1 w-full rounded border px-3 py-2"
                value={cutoffAt}
                onChange={(e) => setCutoffAt(e.target.value)}
              />
            </label>
            <label className="text-sm">
              <span className="text-gray-600">Pay date</span>
              <input
                required
                type="date"
                className="mt-1 w-full rounded border px-3 py-2"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
              />
            </label>
            <div className="sm:col-span-3">
              <button
                type="submit"
                disabled={creating}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create period'}
              </button>
            </div>
          </form>

          <div className="mt-8 overflow-x-auto border rounded-lg">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="px-3 py-2">Label</th>
                  <th className="px-3 py-2">Cutoff</th>
                  <th className="px-3 py-2">Pay date</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                      Loading…
                    </td>
                  </tr>
                ) : periods.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                      No periods yet.
                    </td>
                  </tr>
                ) : (
                  periods.map((p) => (
                    <tr key={p.id}>
                      <td className="px-3 py-2 font-medium">{p.period_label}</td>
                      <td className="px-3 py-2 tabular-nums text-gray-600">
                        {new Date(p.cutoff_at).toLocaleString()}
                      </td>
                      <td className="px-3 py-2">{p.scheduled_pay_date}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(p.status)}`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 flex flex-wrap gap-2">
                        <Link
                          href={`/admin/payroll/${p.id}/hours`}
                          className="text-indigo-600 hover:text-indigo-800 text-xs font-medium"
                        >
                          Hours
                        </Link>
                        <Link
                          href={`/admin/payroll/statements?period_id=${p.id}`}
                          className="text-indigo-600 hover:text-indigo-800 text-xs font-medium"
                        >
                          Statements
                        </Link>
                        {p.status === 'open' && (
                          <button
                            type="button"
                            disabled={actionLoading === `${p.id}-lock`}
                            onClick={() => runAction(p.id, 'lock')}
                            className="text-xs font-medium text-amber-700 hover:text-amber-900 disabled:opacity-50"
                          >
                            Lock
                          </button>
                        )}
                        {p.status === 'locked' && (
                          <button
                            type="button"
                            disabled={actionLoading === `${p.id}-mark_paid`}
                            onClick={() => runAction(p.id, 'mark_paid')}
                            className="text-xs font-medium text-indigo-700 disabled:opacity-50"
                          >
                            Mark paid
                          </button>
                        )}
                        {p.status !== 'cancelled' && p.status !== 'paid' && (
                          <button
                            type="button"
                            disabled={actionLoading === `${p.id}-cancel`}
                            onClick={() => runAction(p.id, 'cancel')}
                            className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
