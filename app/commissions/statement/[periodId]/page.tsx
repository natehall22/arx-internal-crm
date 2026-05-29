'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import PayrollStatementView from '@/components/payroll/PayrollStatementView'
import type { PayrollStatementPayload } from '@/lib/payroll-statement'

type PeriodOption = {
  id: string
  period_label: string
  scheduled_pay_date: string
  status: string
}

export default function CommissionStatementPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const periodId = params.periodId as string
  const userIdParam = searchParams.get('user_id')

  const [periods, setPeriods] = useState<PeriodOption[]>([])
  const [statement, setStatement] = useState<PayrollStatementPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/commissions/periods')
      .then((r) => (r.ok ? r.json() : { periods: [] }))
      .then((j) => setPeriods(j.periods || []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!periodId) return
    setLoading(true)
    setError(null)
    const q = userIdParam ? `&user_id=${encodeURIComponent(userIdParam)}` : ''
    fetch(`/api/commissions/statement?period_id=${encodeURIComponent(periodId)}${q}`)
      .then(async (res) => {
        if (res.status === 401) {
          router.push('/login')
          return null
        }
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error((j as { error?: string }).error || 'Failed to load statement')
        }
        return res.json()
      })
      .then((data) => {
        if (data) setStatement(data as PayrollStatementPayload)
      })
      .catch((e) => {
        setStatement(null)
        setError(e instanceof Error ? e.message : 'Failed to load')
      })
      .finally(() => setLoading(false))
  }, [periodId, userIdParam, router])

  const changePeriod = (id: string) => {
    const base = `/commissions/statement/${id}`
    router.push(userIdParam ? `${base}?user_id=${encodeURIComponent(userIdParam)}` : base)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center gap-4">
          <Link href="/dashboard" className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">
            ← Dashboard
          </Link>
          {userIdParam && (
            <Link href="/commissions/team" className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">
              Team pay
            </Link>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm border p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Pay statement</h1>
              <p className="text-gray-600 mt-1 text-sm">
                Read-only commission and hourly breakdown for the selected pay period.
              </p>
            </div>
            {periods.length > 0 && (
              <label className="text-sm">
                <span className="text-gray-600 block mb-1">Pay period</span>
                <select
                  className="rounded-lg border px-3 py-2 min-w-[200px]"
                  value={periodId}
                  onChange={(e) => changePeriod(e.target.value)}
                >
                  {periods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.period_label} — pay {p.scheduled_pay_date} ({p.status})
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <PayrollStatementView statement={statement} loading={loading} error={error} />
        </div>
      </div>
    </div>
  )
}
