'use client'

import { useState } from 'react'

import { formatMoney, formatQuantity, lineTotalCents } from '@/lib/purchase-orders'
import type { VendorLinkView } from '@/lib/purchase-orders-db'

const when = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : 'to be confirmed')

export default function PoConfirmClient({ token, view }: { token: string; view: VendorLinkView | null }) {
  const [done, setDone] = useState(!!view?.acknowledgedAt)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')

  if (!view) {
    return (
      <main className="mx-auto max-w-xl p-4 text-[#2c2c2a]">
        <h1 className="text-xl font-bold">This link is no longer valid</h1>
        <p className="text-base">Please reply to the email you received about this order.</p>
      </main>
    )
  }

  const confirm = async () => {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/po/${encodeURIComponent(token)}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }) })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return setError(json.error || 'Could not confirm. Please reply to the email instead.')
    setDone(true)
  }

  const total = view.lines.reduce((sum, l) => sum + lineTotalCents(l.quantity, l.unitCostCents), 0)
  return (
    <main className="mx-auto max-w-xl p-4 pb-28 text-[#2c2c2a]">
      <p className="m-0 text-sm font-semibold">{view.orgName}</p>
      <h1 className="mb-1 mt-1 text-2xl font-bold">Purchase order {view.poLabel}</h1>
      <p className="mt-0 text-base">For {view.vendorName}</p>
      {view.cancelled && <p role="alert" className="rounded-lg border border-[#a32d2d] bg-white p-3 text-base font-semibold text-[#a32d2d]">This order was cancelled.</p>}
      <p className="text-base"><strong>{view.dateKind === 'start' ? 'Start on' : 'Deliver on'}:</strong> {when(view.date)}</p>
      {view.address && <p className="text-base"><strong>{view.dateKind === 'start' ? 'Work at' : 'Deliver to'}:</strong> {view.address}</p>}
      {view.note && <p className="text-base"><strong>Note:</strong> {view.note}</p>}
      <ul className="m-0 list-none space-y-2 p-0">
        {view.lines.map((l, i) => (
          <li key={i} className="rounded-lg border border-[#d3d1c7] bg-white p-3 text-base">
            <div className="font-semibold">{l.description}</div>
            <div>{formatQuantity(l.quantity)}{l.unit ? ` ${l.unit}` : ''}{l.unitCostCents > 0 ? ` @ ${formatMoney(l.unitCostCents)} = ${formatMoney(lineTotalCents(l.quantity, l.unitCostCents))}` : ''}</div>
          </li>
        ))}
      </ul>
      {total > 0 && <p className="mt-3 text-lg font-bold">Total {formatMoney(total)}</p>}
      {!view.cancelled && (
        <div className="fixed inset-x-0 bottom-0 border-t border-[#d3d1c7] bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {done ? (
            <p role="status" className="m-0 text-center text-base font-semibold">Thank you. {view.orgName} has been told you have this order.</p>
          ) : (
            <>
              {error && <p role="alert" className="mb-2 mt-0 text-sm font-semibold text-[#a32d2d]">{error}</p>}
              <input className="mb-2 block min-h-[44px] w-full rounded-lg border border-[#8a877d] bg-white px-3 py-2 text-base" placeholder="Anything we should know? (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              <button type="button" disabled={busy} onClick={confirm} className="inline-flex min-h-[48px] w-full items-center justify-center rounded-lg bg-[#2b0a3d] px-4 py-2 text-base font-semibold text-white disabled:opacity-50">
                {busy ? 'Confirming…' : 'I have this order'}
              </button>
            </>
          )}
        </div>
      )}
    </main>
  )
}
