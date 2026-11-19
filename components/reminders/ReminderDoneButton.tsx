'use client'

import { useRouter } from 'next/navigation'
import * as React from 'react'

import { Button, toast } from '@/components/ui'

/** One tap marks a reminder done (PATCH /api/reminders/<id>) and refreshes the page it sits on. */
export function ReminderDoneButton({ id }: { id: string }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  async function done() {
    setBusy(true)
    const res = await fetch(`/api/reminders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done: true }) }).catch(() => null)
    setBusy(false)
    if (!res || !res.ok) return toast.error('Could not save')
    router.refresh()
  }
  return (
    <Button size="sm" variant="secondary" disabled={busy} onClick={() => void done()}>
      Done
    </Button>
  )
}
