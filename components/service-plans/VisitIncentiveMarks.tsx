'use client'

import * as React from 'react'

import { Button, toast } from '@/components/ui'

type Marks = { review: boolean; callback: boolean }

/**
 * Crew incentives: two staff marks on a finished visit. "Review mentioned crew" (a 5-star review named them) and
 * "Callback / redo" (takes the company's deduction back). Both only PROPOSE a line on the Bonus approval screen; an owner
 * approves or rejects it. Shown only when the company turned crew incentives on (lib/crew-incentives.ts).
 */
export default function VisitIncentiveMarks({ workOrderId, initial, onChanged }: { workOrderId: string; initial: Marks; onChanged?: () => void }) {
  const [marks, setMarks] = React.useState<Marks>(initial)
  const [busy, setBusy] = React.useState<keyof Marks | null>(null)

  async function toggle(kind: keyof Marks) {
    const on = !marks[kind]
    setBusy(kind)
    const res = await fetch('/api/crew-incentives/marks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workOrderId, kind, on }) }).catch(() => null)
    setBusy(null)
    const out = (res ? await res.json().catch(() => ({})) : {}) as { error?: string }
    if (!res || !res.ok) return toast.error(out.error || 'Could not save')
    setMarks((m) => ({ ...m, [kind]: on }))
    toast.success(on ? 'Marked. The bonus line is waiting on Bonus approval.' : 'Mark removed')
    onChanged?.()
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant={marks.review ? 'primary' : 'secondary'} className="min-h-tap" aria-pressed={marks.review} loading={busy === 'review'} onClick={() => void toggle('review')}>
        {marks.review ? 'Review mentioned crew ✓' : 'Review mentioned crew'}
      </Button>
      <Button size="sm" variant={marks.callback ? 'primary' : 'secondary'} className="min-h-tap" aria-pressed={marks.callback} loading={busy === 'callback'} onClick={() => void toggle('callback')}>
        {marks.callback ? 'Callback / redo ✓' : 'Callback / redo'}
      </Button>
    </div>
  )
}
