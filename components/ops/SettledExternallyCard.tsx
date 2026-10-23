'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/** Shown on a job whose commission was settled outside the CRM. Owners can bring it back (reason required, audited). */
export default function SettledExternallyCard({ jobId, settledAt, reason, canUnsettle }: { jobId: string; settledAt: string; reason: string | null; canUnsettle: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await fetch(`/api/ops/jobs/${jobId}/settled-externally`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: why }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error || 'Could not save')
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-gray-300 bg-gray-50 p-4 text-[#2c2c2a]" role="note">
      <p className="text-sm font-semibold">Settled outside the CRM</p>
      <p className="text-sm">
        {reason || 'Commission was paid outside the CRM.'} <span className="text-[#57574f]">(marked {settledAt.slice(0, 10)})</span> The CRM will not pay this job again and Needs you skips it. It still counts in sales and profit reports.
      </p>
      {canUnsettle ? (
        open ? (
          <div className="mt-2 flex flex-col gap-2">
            <p className="text-sm font-semibold text-red-800">Bringing it back means the next payroll run pays this whole job, again.</p>
            <label className="text-sm font-semibold">Why?
              <textarea value={why} onChange={(e) => setWhy(e.target.value)} maxLength={500} rows={2} className="mt-1 block min-h-[44px] w-full rounded-lg border border-gray-300 p-2 text-base" />
            </label>
            {error ? <p role="alert" className="text-sm text-red-800">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy || !why.trim()} onClick={submit} className="inline-flex min-h-[44px] items-center rounded-lg bg-red-700 px-4 text-sm font-semibold text-white disabled:opacity-50">Unsettle this job</button>
              <button type="button" onClick={() => setOpen(false)} className="inline-flex min-h-[44px] items-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold">Cancel</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setOpen(true)} className="mt-1 inline-flex min-h-[44px] items-center text-sm font-semibold underline underline-offset-2">Unsettle…</button>
        )
      ) : null}
    </div>
  )
}
