'use client'

import { useState } from 'react'

import { formatDate } from '@/lib/format'
import { ROLL_REASON_LABELS, rolledLabel, type MoveHistoryEntry } from '@/lib/work-order-rolls'

/** "Rolled 3×" — tap to see every move of that work order (staff screens). */
export default function MoveHistory({ workOrderId, rolls, className = '' }: { workOrderId: string; rolls: number; className?: string }) {
  const [open, setOpen] = useState(false)
  const [moves, setMoves] = useState<MoveHistoryEntry[] | null>(null)
  const label = rolledLabel(rolls)
  if (!label) return null
  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && !moves) {
      const res = await fetch(`/api/ops/work-orders/${workOrderId}/moves`, { cache: 'no-store' }).catch(() => null)
      const body = res && res.ok ? ((await res.json().catch(() => null)) as { moves?: MoveHistoryEntry[] } | null) : null
      setMoves(body?.moves ?? [])
    }
  }
  return (
    <span className={className}>
      <button type="button" onClick={() => void toggle()} aria-expanded={open} className="inline-flex min-h-[44px] items-center rounded-full bg-[#ffedd5] px-3 text-sm font-semibold text-[#7c2d12]">
        {label}
      </button>
      {open ? (
        <ul className="mt-1 space-y-1 text-sm text-[#2c2c2a]">
          {moves === null ? <li>Loading…</li> : moves.length === 0 ? <li>No moves recorded.</li> : null}
          {(moves ?? []).map((m) => (
            <li key={m.id}>
              {m.from ? formatDate(m.from) : '—'} → {m.to ? formatDate(m.to) : '—'}
              {m.reason ? ` · ${ROLL_REASON_LABELS[m.reason]}` : ''}
              {m.by ? ` · ${m.by}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  )
}
