'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import type { WaitingItem } from '@/lib/threads/waiting'

function age(iso: string) {
  const mins = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60000))
  if (mins < 60) return `${mins}m`
  const h = Math.round(mins / 60)
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`
}

/** One list of what people are waiting on you for: urgent first, then needs-reply, then mentions. Empties as you work. */
export default function WaitingOnYou({ items }: { items: WaitingItem[] }) {
  const router = useRouter()
  const [gone, setGone] = useState<Set<string>>(new Set())
  const [err, setErr] = useState<string | null>(null)
  const shown = items.filter((i) => !gone.has(i.id))
  if (shown.length === 0) return null

  async function act(id: string, action: 'done' | 'snooze') {
    setErr(null)
    const res = await fetch(`/api/threads/waiting/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
    if (!res.ok) return setErr('That did not save. Try again.')
    setGone(new Set(gone).add(id))
    router.refresh()
  }

  return (
    <Card aria-label="Waiting on you">
      <CardHeader><CardTitle>Waiting on you ({shown.length})</CardTitle></CardHeader>
      <CardContent>
        {err && <p role="alert" className="mb-2 text-ui-sm text-danger">{err}</p>}
        <ul className="divide-y divide-surface-line">
          {shown.map((i) => (
            <li key={i.id} className="py-3">
              <div className="flex flex-wrap items-center gap-2 text-ui-sm text-ink-muted">
                {i.priority === 'urgent' && <Badge tone="danger">Urgent</Badge>}
                {i.priority === 'needs_reply' && <Badge tone="info">Needs reply</Badge>}
                <span className="font-semibold text-ink">{i.title}</span>
                <span>{age(i.created_at)}</span>
              </div>
              <p className="mt-1 break-words text-ui-base text-ink">{i.body}</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {i.link_url && <Link href={i.link_url} className="inline-flex min-h-tap items-center rounded-ui bg-brand-700 px-4 text-ui-sm font-semibold text-white">{i.blind ? 'Open the job' : 'Reply'}</Link>}
                <button type="button" onClick={() => act(i.id, 'done')} className="min-h-tap rounded-ui border border-surface-line px-4 text-ui-sm font-semibold text-ink">Done</button>
                <button type="button" onClick={() => act(i.id, 'snooze')} className="min-h-tap rounded-ui border border-surface-line px-4 text-ui-sm text-ink">Snooze 1h</button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
