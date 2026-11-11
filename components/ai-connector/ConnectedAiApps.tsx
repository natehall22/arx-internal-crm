'use client'

import { useCallback, useEffect, useState } from 'react'

import { formatDate } from '@/lib/format'
import { Button, Card, CardContent, CardHeader, CardTitle, toast } from '@/components/ui'

type App = { id: string; app: string; scopes: string[]; connected_at: string; last_used_at: string | null }

const day = (iso: string | null) => (iso ? formatDate(iso) : 'never')

/** The signed-in person's own AI apps, each with a Disconnect button. */
export default function ConnectedAiApps() {
  const [apps, setApps] = useState<App[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/me/ai-apps').catch(() => null)
    const j = res && res.ok ? ((await res.json().catch(() => null)) as { apps?: App[] } | null) : null
    setApps(j?.apps ?? [])
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  async function disconnect(id: string) {
    setBusy(id)
    const res = await fetch('/api/me/ai-apps', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => null)
    setBusy(null)
    if (!res || !res.ok) return toast.error('Could not disconnect. Try again.')
    toast.success('Disconnected')
    void load()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected AI apps</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-ui-base text-ink">AI apps you have allowed to look things up as you. They can only read, and only what you can see. Disconnect one and it stops right away.</p>
        {apps === null ? <p className="text-ui-base text-ink">Loading…</p> : null}
        {apps?.length === 0 ? <p className="text-ui-base text-ink">No AI apps connected.</p> : null}
        <ul className="divide-y divide-surface-line">
          {(apps ?? []).map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-ui-base font-semibold text-ink">{a.app}</p>
                <p className="text-ui-sm text-ink">Connected {day(a.connected_at)} · last used {day(a.last_used_at)}</p>
              </div>
              <Button variant="secondary" className="min-h-tap" loading={busy === a.id} onClick={() => void disconnect(a.id)}>
                Disconnect
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
