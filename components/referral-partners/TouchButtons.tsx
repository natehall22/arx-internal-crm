'use client'

import { useState } from 'react'

import { TOUCH_BUTTONS } from '@/lib/referral-partners'

/** One-tap Called / Texted / Emailed / Visited. `compact` is the dashboard-card size. */
export default function TouchButtons({
  partnerId,
  compact = false,
  onLogged,
}: {
  partnerId: string
  compact?: boolean
  onLogged?: (lastTouchedAt: string | null) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function log(type: string, label: string) {
    if (busy) return
    setBusy(type)
    setError(null)
    try {
      const res = await fetch(`/api/referral-partners/${partnerId}/touch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not log that')
      setDone(label)
      onLogged?.(json.last_touched_at ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not log that')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <div className="grid grid-cols-4 gap-2">
        {TOUCH_BUTTONS.map((b) => (
          <button
            key={b.type}
            type="button"
            disabled={busy !== null}
            onClick={() => log(b.type, b.label)}
            className={`rounded-lg border border-gray-300 bg-white font-semibold text-[#2c2c2a] hover:bg-gray-50 active:bg-gray-100 disabled:opacity-50 ${
              compact ? 'min-h-[44px] px-1 py-2 text-xs' : 'min-h-[44px] px-2 py-3 text-sm'
            }`}
          >
            {busy === b.type ? '…' : b.label}
          </button>
        ))}
      </div>
      {done && !error && <p className="mt-1 text-xs font-medium text-green-800">Logged: {done}</p>}
      {error && <p className="mt-1 text-xs font-medium text-red-800">{error}</p>}
    </div>
  )
}
