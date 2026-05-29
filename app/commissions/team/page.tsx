'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'

type Member = { id: string; full_name: string | null; role: string }
type Period = { id: string; period_label: string; scheduled_pay_date: string }

export default function CommissionsTeamPage() {
  const router = useRouter()
  const [members, setMembers] = useState<Member[]>([])
  const [periods, setPeriods] = useState<Period[]>([])
  const [selectedPeriod, setSelectedPeriod] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/commissions/team-members'),
      fetch('/api/commissions/periods'),
    ])
      .then(async ([teamRes, periodRes]) => {
        if (teamRes.status === 401 || periodRes.status === 401) {
          router.push('/login')
          return
        }
        if (teamRes.status === 403) {
          setError('Manager access required to view team pay statements.')
          return
        }
        const teamJson = teamRes.ok ? await teamRes.json() : { members: [] }
        const periodJson = periodRes.ok ? await periodRes.json() : { periods: [] }
        setMembers(teamJson.members || [])
        const ps = periodJson.periods || []
        setPeriods(ps)
        if (ps[0]?.id) setSelectedPeriod(ps[0].id)
      })
      .catch(() => setError('Failed to load team data'))
      .finally(() => setLoading(false))
  }, [router])

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-3xl mx-auto px-4 py-8">
        <Link href="/dashboard" className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">
          ← Dashboard
        </Link>

        <div className="bg-white rounded-xl shadow-sm border p-6 sm:p-8 mt-6">
          <h1 className="text-2xl font-semibold text-gray-900">Team pay statements</h1>
          <p className="text-gray-600 mt-2 text-sm">
            View read-only pay statements for your direct reports.
          </p>

          {periods.length > 0 && (
            <label className="block mt-4 text-sm">
              <span className="text-gray-600">Pay period</span>
              <select
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={selectedPeriod}
                onChange={(e) => setSelectedPeriod(e.target.value)}
              >
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.period_label} — {p.scheduled_pay_date}
                  </option>
                ))}
              </select>
            </label>
          )}

          {error && (
            <p className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {loading ? (
            <p className="mt-6 text-sm text-gray-500">Loading…</p>
          ) : members.length === 0 ? (
            <p className="mt-6 text-sm text-gray-500">No active direct reports found.</p>
          ) : (
            <ul className="mt-6 divide-y border rounded-lg">
              {members.map((m) => (
                <li key={m.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="font-medium text-gray-900">{m.full_name || m.id}</p>
                    <p className="text-xs text-gray-500">{m.role}</p>
                  </div>
                  {selectedPeriod ? (
                    <Link
                      href={`/commissions/statement/${selectedPeriod}?user_id=${encodeURIComponent(m.id)}`}
                      className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
                    >
                      View statement →
                    </Link>
                  ) : (
                    <span className="text-xs text-gray-400">No periods</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
