'use client'

import { useState } from 'react'

/** "I can't sign this" — the signer gives a reason; the office is told. Shown only when the company's decline switch is on. */
export default function DeclineBox({ kind, token, companyName, onDeclined }: { kind: 'contract' | 'change-order' | 'signature-request'; token: string; companyName: string; onDeclined: () => void }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mx-auto mt-4 block min-h-[44px] px-4 text-base font-medium text-[#2c2c2a] underline">
        I can’t sign this
      </button>
    )
  }
  return (
    <div className="mt-4 rounded-lg border border-gray-300 bg-white p-4 text-[#2c2c2a]">
      <label className="block text-base font-medium" htmlFor="decline-reason">Tell {companyName} why you can’t sign</label>
      <textarea id="decline-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} className="mt-2 w-full rounded-lg border border-gray-400 p-3 text-base text-black" />
      {error && <p className="mt-2 text-base text-red-700">{error}</p>}
      <div className="mt-3 flex gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              const res = await fetch('/api/signing/decline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, token, reason }) })
              const data = await res.json().catch(() => ({}))
              if (!res.ok) throw new Error(data.error || 'Could not send that')
              onDeclined()
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Could not send that')
            } finally {
              setBusy(false)
            }
          }}
          className="min-h-[48px] flex-1 rounded-lg bg-gray-800 px-4 text-base font-semibold text-white disabled:opacity-60"
        >
          {busy ? 'Sending…' : 'Send'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="min-h-[48px] px-4 text-base font-medium underline">Cancel</button>
      </div>
    </div>
  )
}
