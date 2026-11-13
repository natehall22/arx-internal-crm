'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button, toast } from '@/components/ui'
import { formatDateTime } from '@/lib/format'
import { formatCurrency } from '@/lib/job-payments'
import type { PendingCollection } from '@/lib/visit-collections-db'

/**
 * Billing → At the door: cash and checks a crew wrote down at a visit. Not money until someone here confirms it — Confirm
 * records the payment on the customer's oldest open invoices; "Didn't get it" records nothing. Data: /api/ops/collections/<id>.
 */
export default function DoorCollections({ rows }: { rows: PendingCollection[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)

  async function decide(r: PendingCollection, action: 'confirm' | 'reject') {
    setBusy(r.id)
    const res = await fetch(`/api/ops/collections/${r.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }).catch(() => null)
    const out = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {}
    setBusy(null)
    if (!res || !res.ok) return toast.error(out.error || 'Could not save. Try again.')
    toast.success(action === 'confirm' ? 'Payment recorded' : 'Marked as not received')
    router.refresh()
  }

  if (rows.length === 0) return <p className="rounded-ui border border-surface-line bg-surface px-4 py-6 text-ui-base text-ink">Nothing to confirm.</p>
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => (
        <li key={r.id} className="rounded-ui border border-surface-line bg-surface p-4">
          <p className="text-ui-lg font-semibold text-ink">
            {formatCurrency(r.amountCents)} · {r.method === 'check' ? `Check${r.checkNumber ? ` #${r.checkNumber}` : ''}` : 'Cash'}
          </p>
          <p className="text-ui-base text-ink">{r.customerName}</p>
          <p className="break-words text-ui-sm text-ink">{[r.address, r.crewName ? `Taken by ${r.crewName}` : null, formatDateTime(r.collectedAt)].filter(Boolean).join(' · ')}</p>
          {r.note ? <p className="break-words text-ui-sm text-ink">Note: {r.note}</p> : null}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button className="min-h-tap" loading={busy === r.id} onClick={() => void decide(r, 'confirm')}>
              Confirm — it’s paid
            </Button>
            <Button className="min-h-tap" variant="secondary" disabled={busy === r.id} onClick={() => void decide(r, 'reject')}>
              Didn’t get it
            </Button>
          </div>
        </li>
      ))}
    </ul>
  )
}
