'use client'

import { useCallback, useEffect, useState } from 'react'

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, toast } from '@/components/ui'
import type { ActivityItem, ActivityState } from '@/lib/quickbooks/activity'

type Data = { items: ActivityItem[]; counts: Record<ActivityState, number> }

const FILTERS: Array<{ key: ActivityState | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'needs_you', label: 'Needs you' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'sent', label: 'Sent' },
  { key: 'skipped', label: 'Skipped' },
]
const TONE: Record<ActivityState, 'success' | 'warning' | 'neutral'> = { sent: 'success', needs_you: 'warning', waiting: 'neutral', working: 'neutral', skipped: 'neutral' }
const WORD: Record<ActivityState, string> = { sent: 'Sent', needs_you: 'Needs you', waiting: 'Will retry', working: 'Sending', skipped: 'Skipped' }

/** Settings → QuickBooks → Activity (owners): what was sent, when, the QuickBooks link, and anything stuck with Retry / Skip. */
export default function QuickBooksActivityCard({ initial = null }: { initial?: Data | null }) {
  const [data, setData] = useState<Data | null>(initial)
  const [filter, setFilter] = useState<ActivityState | 'all'>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [skipping, setSkipping] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/quickbooks/activity?filter=${filter}`, { cache: 'no-store' }).catch(() => null)
    if (res?.ok) setData((await res.json()) as Data)
  }, [filter])

  useEffect(() => {
    void load()
  }, [load])

  async function act(id: string, action: 'retry' | 'skip', why?: string) {
    setBusy(id)
    const res = await fetch('/api/admin/quickbooks/activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action, reason: why }) }).catch(() => null)
    const body = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : null
    setBusy(null)
    if (!res || !res.ok) toast.error(body?.error ?? 'Something went wrong. Please try again.')
    else if (action === 'skip') {
      setSkipping(null)
      setReason('')
    }
    await load()
  }

  return (
    <Card id="quickbooks-activity" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>QuickBooks activity</CardTitle>
        {data && data.counts.needs_you > 0 ? <Badge tone="warning">{data.counts.needs_you} need you</Badge> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Button key={f.key} variant={filter === f.key ? 'primary' : 'secondary'} className="min-h-tap" onClick={() => setFilter(f.key)}>
              {f.label}
              {data && f.key !== 'all' ? ` (${data.counts[f.key]})` : ''}
            </Button>
          ))}
        </div>
        {!data ? <p className="text-ui-sm text-ink">Loading…</p> : null}
        {data && data.items.length === 0 ? <p className="text-ui-base text-ink">Nothing here yet.</p> : null}
        <ul className="flex flex-col gap-2">
          {data?.items.map((i) => (
            <li key={i.id} className="flex flex-col gap-1 rounded-ui border border-surface-line bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-ui-base font-semibold text-ink">{i.title}</span>
                <Badge tone={TONE[i.state]}>{WORD[i.state]}</Badge>
              </div>
              <span className="text-ui-sm text-ink">{new Date(i.when).toLocaleString()}</span>
              {i.message ? <p className="text-ui-base text-ink">{i.message}</p> : null}
              {i.qbUrl ? <a className="min-h-tap py-2 text-ui-base font-semibold text-ink underline" href={i.qbUrl} target="_blank" rel="noreferrer">Open in QuickBooks</a> : null}
              {i.state === 'skipped' ? <p className="text-ui-base text-ink">Skipped{i.skippedBy ? ` by ${i.skippedBy}` : ''}{i.skippedAt ? ` on ${new Date(i.skippedAt).toLocaleDateString()}` : ''}{i.skipReason ? `: ${i.skipReason}` : ''}</p> : null}
              {skipping === i.id ? (
                <div className="flex flex-col gap-2 rounded-ui border border-surface-line bg-surface-subtle p-3">
                  <p className="text-ui-base font-semibold text-ink">Skip this? It will not be sent to QuickBooks. It stays in this log with your reason.</p>
                  <label className="flex flex-col gap-1 text-ui-base font-semibold text-ink">
                    Why are you skipping it?
                    <input className="min-h-tap w-full rounded-ui border border-surface-line bg-white px-3 text-base text-ink" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="For example: already entered in QuickBooks" />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button className="min-h-tap" loading={busy === i.id} disabled={reason.trim().length < 3} onClick={() => void act(i.id, 'skip', reason.trim())}>Yes, skip it</Button>
                    <Button variant="secondary" className="min-h-tap" onClick={() => setSkipping(null)}>Cancel</Button>
                  </div>
                </div>
              ) : null}
              {i.canAct && skipping !== i.id ? (
                <div className="flex flex-wrap gap-2">
                  <Button className="min-h-tap" loading={busy === i.id} onClick={() => void act(i.id, 'retry')}>Retry</Button>
                  <Button variant="secondary" className="min-h-tap" onClick={() => { setSkipping(i.id); setReason('') }}>Skip</Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
