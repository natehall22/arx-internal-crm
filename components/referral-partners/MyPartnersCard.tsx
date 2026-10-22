'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import TouchButtons from '@/components/referral-partners/TouchButtons'

type Summary = {
  assigned_count: number
  opening_soon: Array<{ id: string; name: string; days_until_open: number }>
  opening_soon_count: number
  jobs_this_month: number
}

/** Dashboard "My Partners": count, opening soon with one-tap touch buttons, jobs this month. */
export default function MyPartnersCard() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/referral-partners/summary')
      if (!res.ok) throw new Error()
      const json = await res.json()
      if (!json || !Array.isArray(json.opening_soon)) throw new Error()
      setSummary(json)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (failed) return null

  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-[#2c2c2a]">My Partners</h2>
        <Link href="/referral-partners" className="inline-flex min-h-[44px] items-center text-sm font-semibold text-indigo-700 hover:text-indigo-900">
          Open Referral Partners →
        </Link>
      </div>

      {!summary ? (
        <div className="mt-3 h-12 animate-pulse rounded-lg bg-gray-100" />
      ) : summary.assigned_count === 0 ? (
        <p className="mt-2 text-sm text-[#2c2c2a]">
          Add the agents and partners you network with. They&apos;re yours, and you get paid on jobs they send.{' '}
          <Link href="/referral-partners?add=1" className="font-semibold text-indigo-700">
            + Add a partner
          </Link>
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Stat value={summary.assigned_count} label="Assigned To me" />
            <Stat value={summary.opening_soon_count} label="Opening soon" warn={summary.opening_soon_count > 0} />
            <Stat value={summary.jobs_this_month} label="Jobs this month" />
          </div>

          {summary.opening_soon.length > 0 && (
            <ul className="mt-3 divide-y divide-gray-100 border-t border-gray-100">
              {summary.opening_soon.map((p) => (
                <li key={p.id} className="py-3">
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <Link href={`/referral-partners/${p.id}`} className="inline-flex min-h-[44px] items-center text-sm font-semibold text-[#2c2c2a] hover:underline">
                      {p.name}
                    </Link>
                    <span className="text-xs font-medium text-amber-900">
                      {p.days_until_open === 0 ? 'Opens today' : `Opens in ${p.days_until_open}d`}
                    </span>
                  </div>
                  <TouchButtons partnerId={p.id} compact onLogged={() => void load()} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function Stat({ value, label, warn = false }: { value: number; label: string; warn?: boolean }) {
  return (
    <div className={`rounded-lg px-2 py-2 ${warn ? 'bg-amber-50' : 'bg-gray-50'}`}>
      <p className="text-xl font-bold text-[#2c2c2a]">{value}</p>
      <p className="text-[11px] font-medium text-gray-700">{label}</p>
    </div>
  )
}
