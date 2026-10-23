'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/** One tap: make `planName` the default pay plan for everyone in this role from today (owners only; the server checks). */
export default function FixPayPlanButton({ role, compPlanId, label }: { role: string; compPlanId: string; label: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/comp-plans/defaults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, compPlanId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'Could not save')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="flex flex-col gap-1 w-full sm:w-auto">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="inline-flex min-h-[44px] w-full sm:w-auto items-center justify-center rounded-lg bg-[#2b0a3d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3d1257] disabled:opacity-60"
      >
        {busy ? 'Saving…' : label}
      </button>
      {error && <span className="text-sm text-red-800" role="alert">{error}</span>}
    </span>
  )
}
