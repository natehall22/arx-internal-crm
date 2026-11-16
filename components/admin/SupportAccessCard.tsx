'use client'

import { useCallback, useEffect, useState } from 'react'

import { Button, Card, CardContent, CardHeader, CardTitle, toast } from '@/components/ui'

export type SupportAccessData = {
  always: boolean
  active: { grantedAt: string; expiresAt: string } | null
  durations: Array<{ key: string; label: string }>
  log: Array<{ id: number; at: string; event: string; level: string; staff: string; actingAs: string | null; detail: Record<string, unknown> }>
}

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const EVENT_WORDS: Record<string, string> = { enter: 'Entered', exit: 'Left', upgrade: 'Switched to full access', write: 'Changed something', blocked_send: 'Send blocked' }

function what(r: SupportAccessData['log'][number]): string {
  const base = EVENT_WORDS[r.event] ?? r.event
  const d = r.detail as { method?: string; route?: string; what?: string }
  if (r.event === 'write' && d.route) return `${base}: ${d.method ?? ''} ${d.route}`.trim()
  if (r.event === 'blocked_send' && d.what) return `${base}: ${d.what.replace(/_/g, ' ')}`
  return base
}

/** Settings → Support access (owners only): grant for a time, end it now, and the company's own support log. */
export default function SupportAccessCard() {
  const [data, setData] = useState<SupportAccessData | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/support-access').catch(() => null)
    if (!res || !res.ok) return toast.error('Could not load')
    setData((await res.json()) as SupportAccessData)
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  async function send(body: Record<string, unknown>, key: string, done: string) {
    setBusy(key)
    const res = await fetch('/api/admin/support-access', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    setBusy(null)
    if (!res || !res.ok) return toast.error('Could not save')
    toast.success(done)
    void load()
  }

  if (!data) return <p className="text-ui-sm text-ink">Loading…</p>

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Support access</CardTitle>
        </CardHeader>
        <CardContent>
          {data.always ? (
            <p className="text-[16px] font-semibold text-[#2c2c2a]">Always on for your company</p>
          ) : data.active ? (
            <div className="flex flex-col gap-3">
              <p className="text-[16px] text-[#2c2c2a]">
                <span className="font-semibold">On</span> until {when(data.active.expiresAt)}. Support can look around in view-only mode, and switch to full access only when needed. Every visit is listed below.
              </p>
              <div>
                <Button variant="danger" disabled={busy !== null} onClick={() => void send({ end: true }, 'end', 'Support access ended')} className="min-h-[44px]">
                  End access now
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-[16px] text-[#2c2c2a]">
              <span className="font-semibold">Off.</span> Support cannot enter your company. Turn it on only when you want their help.
            </p>
          )}
          {!data.always ? (
            <div className="mt-4">
              <p className="mb-2 text-[14px] font-semibold text-[#2c2c2a]">{data.active ? 'Change how long' : 'Allow support access for'}</p>
              <div className="flex flex-wrap gap-2">
                {data.durations.map((d) => (
                  <Button key={d.key} variant="secondary" disabled={busy !== null} onClick={() => void send({ duration: d.key }, d.key, `Support access on for ${d.label}`)} className="min-h-[44px]">
                    {d.label}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What support did in your company</CardTitle>
        </CardHeader>
        <CardContent>
          {data.log.length === 0 ? (
            <p className="text-[16px] text-[#2c2c2a]">Nothing yet.</p>
          ) : (
            <ul className="divide-y divide-surface-line">
              {data.log.map((r) => (
                <li key={r.id} className="py-2 text-[14px] text-[#2c2c2a]">
                  <p className="font-semibold">{what(r)}</p>
                  <p>
                    {r.staff}
                    {r.actingAs ? ` as ${r.actingAs}` : ''} · {r.level === 'full' ? 'full access' : 'view only'} · {when(r.at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
