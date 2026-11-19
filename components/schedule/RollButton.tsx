'use client'

import { useState } from 'react'

import { ROLL_REASONS, ROLL_REASON_LABELS, rolledLabel, type RollReason } from '@/lib/work-order-rolls'

const chipCls = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[#c9c7c0] bg-white px-3 text-base font-semibold text-[#2c2c2a] hover:bg-[#f2f1ee] disabled:opacity-50'

/** The four reason chips plus "Just roll" (one tap each). Used by RollButton and by screens that open their own sheet. */
export function RollChips({ onPick, busy = false }: { onPick: (reason: RollReason | null) => void; busy?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Why is it not ready?">
      {ROLL_REASONS.map((r) => (
        <button key={r} type="button" disabled={busy} onClick={() => onPick(r)} className={chipCls}>
          {ROLL_REASON_LABELS[r]}
        </button>
      ))}
      <button type="button" disabled={busy} onClick={() => onPick(null)} className={`${chipCls} border-[#9a3412] text-[#9a3412]`}>
        Just roll
      </button>
    </div>
  )
}

export type RollOutcome = { ok: true; to: string } | { ok: false; error: string }

/**
 * "Not ready — roll": one tap opens four reason chips; tapping a chip rolls the work to the crew's next working day with that
 * reason, "Just roll" rolls with none. The caller sends it (staff route or the crew's phone link) — this is only the control.
 * Plain classes on purpose: it also renders on the public crew page, outside the app's UI kit.
 */
export default function RollButton({
  onRoll,
  rolls = 0,
  compact = false,
  label = 'Not ready — roll',
  className = '',
}: {
  onRoll: (reason: RollReason | null) => Promise<RollOutcome>
  rolls?: number
  compact?: boolean
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const rolled = rolledLabel(rolls)

  async function go(reason: RollReason | null) {
    setBusy(true)
    setMsg(null)
    const out = await onRoll(reason).catch(() => ({ ok: false as const, error: 'Could not roll — try again' }))
    setBusy(false)
    if (out.ok) {
      setOpen(false)
      setMsg({ tone: 'ok', text: 'Rolled to the next working day' })
    } else setMsg({ tone: 'error', text: out.error })
  }

  return (
    <div className={className} data-roll-button>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          disabled={busy}
          onClick={() => setOpen((o) => !o)}
          className={`inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[#9a3412] bg-white px-3 font-semibold text-[#9a3412] hover:bg-[#fff7ed] disabled:opacity-50 ${compact ? 'text-sm' : 'text-base'}`}
        >
          {label}
        </button>
        {rolled ? <span className="text-sm font-semibold text-[#9a3412]">{rolled}</span> : null}
      </div>
      {open ? (
        <div className="mt-2">
          <RollChips busy={busy} onPick={(r) => void go(r)} />
        </div>
      ) : null}
      {msg ? (
        <p role="status" className={`mt-1 text-sm font-medium ${msg.tone === 'ok' ? 'text-[#14532d]' : 'text-[#991b1b]'}`}>
          {msg.text}
        </p>
      ) : null}
    </div>
  )
}
