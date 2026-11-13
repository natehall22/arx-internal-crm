'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import ConnectAiCard from '@/components/ai-connector/ConnectAiCard'
import ConnectedAiApps from '@/components/ai-connector/ConnectedAiApps'
import { Button, Card, CardContent, CardHeader, CardTitle, toast } from '@/components/ui'

type Data = {
  enabled: boolean
  connectCard: { address: string; companyName: string } | null
  writesEnabled: boolean
  builtinRedirectUris: string[]
  extraRedirectUris: string[]
  changes: Array<{ id: string; when: string; person: string; tool: string; summary: string; links: Array<{ label: string; path: string }>; failed: boolean; stuck: boolean; saving: boolean }>
  connections: Array<{ id: string; userId: string; person: string; app: string; canWrite: boolean; connectedAt: string; lastUsedAt: string | null }>
  audit: Array<{ id: number; when: string; person: string | null; tool: string; result: string; records: number; detail: string | null }>
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never')
const RESULT_WORDS: Record<string, string> = { ok: 'Done', denied: 'Not allowed', error: 'Error', rate_limited: 'Too many requests' }

export default function AiConnectorClient() {
  const [data, setData] = useState<Data | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [extra, setExtra] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/ai-connector').catch(() => null)
    if (!res || !res.ok) return toast.error('Could not load')
    const j = (await res.json()) as Data
    setData(j)
    setExtra(j.extraRedirectUris.join('\n'))
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  async function revoke(body: Record<string, string>, key: string) {
    setBusy(key)
    const res = await fetch('/api/admin/ai-connector', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    setBusy(null)
    if (!res || !res.ok) return toast.error('Could not disconnect')
    toast.success('Disconnected')
    void load()
  }

  // The same owner-only save the Features card uses (PATCH /api/admin/settings type 'features').
  async function toggleSwitch() {
    if (!data) return
    setBusy('switch')
    const res = await fetch('/api/admin/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'features', features: { aiConnector: !data.enabled } }) }).catch(() => null)
    setBusy(null)
    if (!res || !res.ok) return toast.error('Could not save')
    toast.success(data.enabled ? 'AI connector turned off' : 'AI connector turned on')
    void load()
  }

  async function toggleWrites() {
    if (!data) return
    setBusy('writes')
    const res = await fetch('/api/admin/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'features', features: { aiConnectorWrites: !data.writesEnabled } }) }).catch(() => null)
    setBusy(null)
    if (!res || !res.ok) return toast.error('Could not save')
    toast.success(data.writesEnabled ? 'AI changes turned off' : 'AI changes turned on')
    void load()
  }

  async function saveExtra() {
    setBusy('extra')
    const uris = extra.split('\n').map((s) => s.trim()).filter(Boolean)
    const res = await fetch('/api/admin/ai-connector', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirectUris: uris }) }).catch(() => null)
    setBusy(null)
    const j = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {}
    if (!res || !res.ok) return toast.error(j.error || 'Could not save')
    toast.success('Saved')
    void load()
  }

  if (!data) return <p className="text-ui-base text-ink">Loading…</p>
  return (
    <div className="flex flex-col gap-4">
      {data.connectCard ? <ConnectAiCard {...data.connectCard} /> : null}
      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-ui-base font-semibold text-ink">{data.enabled ? 'On' : 'Off'} · {data.writesEnabled ? 'AI can propose changes' : 'Look-up only'}</p>
          <p className="mt-1 text-ui-base text-ink">
            When on, each person can connect their own AI app. It sees only what that person can see. Turning it off, or turning a person off, stops it on the next request.
          </p>
          <Button variant={data.enabled ? 'secondary' : 'primary'} className="mt-3 min-h-tap" loading={busy === 'switch'} aria-pressed={data.enabled} onClick={() => void toggleSwitch()}>
            {data.enabled ? 'Turn off' : 'Turn on'}
          </Button>
          <p className="mt-4 text-ui-base font-semibold text-ink">AI can make changes: {data.writesEnabled ? 'On' : 'Off'}</p>
          <p className="mt-1 text-ui-base text-ink">
            When on, a person who allows it when they connect lets their AI app propose a change: add a note, log a call, add a lead or customer, move a service visit, add a job cost, start a draft invoice or order. Each one waits in the CRM until that person opens it and taps Approve; the AI cannot approve. It can never send, pay, delete, approve payroll or change settings. Off stops it on the next request.
          </p>
          <Button variant={data.writesEnabled ? 'secondary' : 'primary'} className="mt-3 min-h-tap" disabled={!data.enabled} loading={busy === 'writes'} aria-pressed={data.writesEnabled} onClick={() => void toggleWrites()}>
            {data.writesEnabled ? 'Turn off changes' : 'Turn on changes'}
          </Button>
          <Link href="/admin#features" className="ml-4 mt-3 inline-flex min-h-tap items-center text-ui-sm text-ink underline">
            All feature switches
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Who is connected</CardTitle>
        </CardHeader>
        <CardContent>
          {data.connections.length === 0 ? <p className="text-ui-base text-ink">Nobody has connected an AI app.</p> : null}
          <ul className="divide-y divide-surface-line">
            {data.connections.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-ui-base font-semibold text-ink">{c.person} · {c.app}{c.canWrite ? ' · can propose changes' : ''}</p>
                  <p className="text-ui-sm text-ink">Connected {when(c.connectedAt)} · last used {when(c.lastUsedAt)}</p>
                </div>
                <Button variant="secondary" className="min-h-tap" loading={busy === c.id} onClick={() => void revoke({ grantId: c.id }, c.id)}>
                  Disconnect
                </Button>
                <Button variant="ghost" className="min-h-tap" loading={busy === `u${c.userId}`} onClick={() => void revoke({ userId: c.userId }, `u${c.userId}`)}>
                  Disconnect all of {c.person.split(' ')[0]}’s apps
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Changes made by AI</CardTitle>
        </CardHeader>
        <CardContent>
          {data.changes.length === 0 ? <p className="text-ui-base text-ink">No changes yet.</p> : null}
          <ul className="divide-y divide-surface-line">
            {data.changes.map((c) => (
              <li key={c.id} className="py-2 text-ui-sm text-ink">
                <span className="font-semibold">{when(c.when)}</span> · {c.person} · {c.tool} · {c.stuck ? 'STUCK while saving: open the record and check whether it was saved' : c.saving ? 'Saving now' : c.failed ? 'Not saved' : c.summary}
                {c.links.map((l) => (
                  <Link key={l.path} href={l.path} className="ml-2 underline">
                    {l.label}
                  </Link>
                ))}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {data.audit.length === 0 ? <p className="text-ui-base text-ink">Nothing yet.</p> : null}
          <ul className="divide-y divide-surface-line">
            {data.audit.map((a) => (
              <li key={a.id} className="py-2 text-ui-sm text-ink">
                <span className="font-semibold">{when(a.when)}</span> · {a.person ?? 'System'} · {a.tool} · {RESULT_WORDS[a.result] ?? a.result}
                {a.records > 0 ? ` · ${a.records} record${a.records === 1 ? '' : 's'}` : ''}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>More app addresses (advanced)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-2 text-ui-base text-ink">Claude and ChatGPT already work. Only add an address if an AI app’s own setup tells you to. One per line.</p>
          <textarea className="min-h-[96px] w-full rounded-ui border border-surface-line p-2 text-base text-ink" value={extra} onChange={(e) => setExtra(e.target.value)} aria-label="More app addresses" />
          <Button className="mt-2 min-h-tap" loading={busy === 'extra'} onClick={() => void saveExtra()}>
            Save
          </Button>
        </CardContent>
      </Card>

      <ConnectedAiApps />
    </div>
  )
}
