'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'

type WorksheetRow = {
  jobId: string
  jobNumber: string
  customerName?: string | null
  bucket: string
  blockReasons: string[]
  payrollEligibleAt: string | null
  nextCutoffAt: string
  beforeNextCutoff: boolean | null
}

export default function WeeklyPayrollWorksheetPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState<Record<string, number>>({})
  const [rows, setRows] = useState<WorksheetRow[]>([])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await fetch('/api/admin/payroll/weekly/worksheet?limit=200')
        if (res.status === 401) {
          router.push('/login')
          return
        }
        if (res.status === 403) {
          setError('You do not have access to weekly payroll.')
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
        if (!cancelled) {
          setSummary(data.summary || {})
          setRows(data.rows || [])
        }
      } catch {
        if (!cancelled) setError('Failed to load worksheet')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [router])

  const bucketLabel: Record<string, string> = {
    ready: 'Ready (next lock)',
    eligible_next: 'Eligible — next period',
    blocked: 'Blocked',
    needs_review: 'Needs review',
    locked: 'Locked / snapshotted',
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center gap-4">
          <Link href="/admin/payroll" className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">
            ← Commission export
          </Link>
          <Link href="/admin" className="text-gray-600 hover:text-gray-900 text-sm font-medium">
            Admin
          </Link>
        </div>

        <div className="bg-white rounded-xl shadow-sm border p-6 sm:p-8">
          <h1 className="text-2xl font-semibold text-gray-900">Weekly sales payroll</h1>
          <p className="text-gray-600 mt-2 max-w-3xl text-sm">
            Exception-queue preview: jobs are bucketed using install / cleared funding / approved costs, sales rep + comp
            plan assignment, and Wednesday 11:59:59 PM Eastern cutoff rules. Subcontractor pay stays in job costs, not
            payroll lines. Lock, snapshots, chargebacks, and overrides use the tables added in migration 121.
          </p>

          {loading && <p className="mt-4 text-sm text-gray-500">Loading…</p>}
          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

          {!loading && !error && Object.keys(summary).length > 0 && (
            <div className="mt-6 flex flex-wrap gap-3">
              {Object.entries(summary).map(([k, v]) => (
                <div key={k} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
                  <span className="text-gray-600">{bucketLabel[k] || k}: </span>
                  <span className="font-semibold text-gray-900">{v}</span>
                </div>
              ))}
            </div>
          )}

          {!loading && !error && rows.length > 0 && (
            <div className="mt-6 overflow-x-auto border rounded-lg">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-gray-700">
                  <tr>
                    <th className="px-3 py-2 font-medium min-w-[160px]">Job</th>
                    <th className="px-3 py-2 font-medium">Bucket</th>
                    <th className="px-3 py-2 font-medium">Eligible at</th>
                    <th className="px-3 py-2 font-medium">Next cutoff (ET)</th>
                    <th className="px-3 py-2 font-medium">Block reasons</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.jobId} className="border-t border-gray-100">
                      <td className="px-3 py-2 align-top">
                        <Link
                          href={`/ops/jobs/${r.jobId}`}
                          className="font-mono text-sm font-medium text-indigo-600 hover:text-indigo-800 whitespace-nowrap"
                        >
                          {r.jobNumber}
                        </Link>
                        <div
                          className="text-xs text-gray-700 mt-0.5 max-w-[240px] leading-snug"
                          title={r.customerName || undefined}
                        >
                          {r.customerName?.trim() ? (
                            r.customerName
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">{bucketLabel[r.bucket] || r.bucket}</td>
                      <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                        {r.payrollEligibleAt
                          ? new Date(r.payrollEligibleAt).toLocaleString('en-US', { timeZone: 'America/New_York' })
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                        {new Date(r.nextCutoffAt).toLocaleString('en-US', { timeZone: 'America/New_York' })}
                      </td>
                      <td className="px-3 py-2 text-gray-600 text-xs max-w-md">
                        {r.blockReasons?.length ? r.blockReasons.join(', ') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !error && rows.length === 0 && (
            <p className="mt-6 text-sm text-gray-500">No production jobs found for this org.</p>
          )}
        </div>
      </div>
    </div>
  )
}
