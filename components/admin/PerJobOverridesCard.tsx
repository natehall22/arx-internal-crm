'use client'

/**
 * Read-only, org-wide register of every `deal_commission_roles` row — the per-job
 * commission overrides — joined to the latest matching `payroll_override_audit`
 * row for actor/reason/when. Phase 2 of docs/prompts/comp-plan-admin-editing.md.
 *
 * This is a READ surface only. Editing an override stays on
 * `/admin/payroll/statements` (PATCH /api/admin/payroll/deal-commission-roles),
 * so there remains exactly one write path.
 */

import { useCallback, useEffect, useState } from 'react'

const INK = '#2c2c2a'

type OverrideRow = {
  id: string
  jobId: string
  jobNumber: string | null
  saleDate: string | null
  role: string
  userId: string
  userName: string | null
  overrideAmount: number | null
  overridePercent: number | null
  premierPricingAmount: number | null
  createdAt: string
  updatedAt: string
  audit: {
    actorUserId: string | null
    actorName: string | null
    reason: string | null
    createdAt: string
  } | null
}

type LoadState = 'loading' | 'ready' | 'forbidden' | 'error'

function formatRole(role: string): string {
  return role
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatOverride(row: OverrideRow): string {
  const parts: string[] = []
  if (row.overrideAmount != null) parts.push(`$${Number(row.overrideAmount).toLocaleString()}`)
  if (row.overridePercent != null) parts.push(`${row.overridePercent}%`)
  if (row.premierPricingAmount != null) {
    parts.push(`premier pricing $${Number(row.premierPricingAmount).toLocaleString()}`)
  }
  if (parts.length === 0) return '$0 (explicit zero)'
  return parts.join(' / ')
}

export default function PerJobOverridesCard() {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [overrides, setOverrides] = useState<OverrideRow[]>([])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoadState('loading')
    setError('')
    try {
      const res = await fetch('/api/admin/payroll/deal-commission-roles')
      if (res.status === 403) {
        setLoadState('forbidden')
        return
      }
      if (!res.ok) {
        setLoadState('error')
        return
      }
      const data = (await res.json()) as { overrides: OverrideRow[] }
      setOverrides(data.overrides || [])
      setLoadState('ready')
    } catch {
      setLoadState('error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loadState === 'forbidden') return null

  return (
    <section className="mb-8 bg-white rounded-xl shadow-sm border p-6 sm:p-8">
      <h2 className="text-lg font-semibold" style={{ color: INK }}>
        Per-job commission overrides
      </h2>
      <p className="mt-2 max-w-3xl text-sm" style={{ color: INK }}>
        Every explicit override on a job&apos;s commission — set from the payroll
        statement page — beats the org rate for that job and role, <strong>including a
        deliberate $0</strong>. This list is read-only; to change an override, open the
        job&apos;s statement and edit it there, so there remains exactly one write path.
      </p>

      {loadState === 'loading' && (
        <p className="mt-4 text-sm" style={{ color: INK }}>
          Loading…
        </p>
      )}

      {loadState === 'error' && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium text-red-700">Could not load commission overrides.</p>
          <button
            type="button"
            onClick={() => void load()}
            className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50"
            style={{ color: INK }}
          >
            Retry
          </button>
        </div>
      )}

      {loadState === 'ready' && (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left border-b" style={{ color: INK }}>
                <th className="py-2 pr-4">Job</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">User</th>
                <th className="py-2 pr-4">Override</th>
                <th className="py-2 pr-4">Changed by</th>
                <th className="py-2 pr-4">Reason</th>
                <th className="py-2 pr-4">When</th>
              </tr>
            </thead>
            <tbody>
              {overrides.map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-medium" style={{ color: INK }}>
                    <a
                      href={`/ops/jobs/${row.jobId}`}
                      className="text-indigo-600 hover:text-indigo-800 hover:underline"
                    >
                      {row.jobNumber || row.jobId.slice(0, 8)}
                    </a>
                  </td>
                  <td className="py-2 pr-4" style={{ color: INK }}>{formatRole(row.role)}</td>
                  <td className="py-2 pr-4" style={{ color: INK }}>{row.userName || '—'}</td>
                  <td className="py-2 pr-4 font-medium" style={{ color: INK }}>{formatOverride(row)}</td>
                  <td className="py-2 pr-4" style={{ color: INK }}>{row.audit?.actorName || '—'}</td>
                  <td className="py-2 pr-4" style={{ color: INK }}>{row.audit?.reason || '—'}</td>
                  <td className="py-2 pr-4 whitespace-nowrap" style={{ color: INK }}>
                    {row.audit?.createdAt ? new Date(row.audit.createdAt).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
              {overrides.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-3 text-sm" style={{ color: INK }}>
                    No per-job overrides exist yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
