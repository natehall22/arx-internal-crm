'use client'

import { useCallback, useEffect, useState } from 'react'

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, toast } from '@/components/ui'
import { confirmDialog } from '@/components/ui/confirm-dialog'

type View = {
  featureOn: boolean
  configured: boolean
  status: 'not_connected' | 'connected' | 'needs_reconnect' | 'disconnected'
  companyName: string | null
  environment: 'sandbox' | 'production' | null
  reason: string | null
  expiresSoon: boolean
}

const OUTCOME: Record<string, { text: string }> = {
  connected: { text: 'QuickBooks is connected.' },
  denied: { text: 'You cancelled in QuickBooks, so nothing was connected.' },
  invalid_state: { text: 'That connection link expired or was started somewhere else. Tap Connect QuickBooks again.' },
  owner_only: { text: 'Only an owner can connect QuickBooks.' },
  intuit_refused: { text: 'QuickBooks did not accept the connection. Please try again.' },
  different_company: { text: 'This is a different QuickBooks company than the one this CRM was already linked to, and its records are already matched. Reconnect the original company.' },
  failed: { text: 'Could not finish connecting. Please try again in a minute.' },
  off: { text: 'Turn on QuickBooks in the feature switches first.' },
}

/**
 * Settings → QuickBooks (owners). Connect this company's OWN QuickBooks Online company, see that it is connected (and
 * which company), reconnect, disconnect. Connecting sends nothing to QuickBooks. lib/quickbooks/connection.ts;
 * route /api/admin/quickbooks.
 */
export default function QuickBooksCard({ initial = null }: { initial?: View | null }) {
  const [view, setView] = useState<View | null>(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/quickbooks', { cache: 'no-store' }).catch(() => null)
    if (res?.ok) setView((await res.json()) as View)
  }, [])

  useEffect(() => {
    void load()
    setOutcome(new URLSearchParams(window.location.search).get('quickbooks'))
  }, [load])

  async function post(action: 'connect' | 'disconnect') {
    setBusy(action)
    const res = await fetch('/api/admin/quickbooks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }).catch(() => null)
    const data = res ? ((await res.json().catch(() => ({}))) as View & { url?: string; error?: string }) : null
    setBusy(null)
    if (!res || !res.ok) {
      toast.error(data?.error || 'Something went wrong. Please try again.')
      return null
    }
    return data
  }

  async function connect() {
    const data = await post('connect')
    if (data?.url) window.location.assign(data.url)
  }

  async function disconnect() {
    if (!(await confirmDialog({ title: 'Disconnect QuickBooks?', description: 'Nothing in QuickBooks is deleted. This CRM stops talking to it until you connect again.', confirmLabel: 'Disconnect', destructive: true }))) return
    const data = await post('disconnect')
    if (data) {
      setView(data)
      setOutcome(null)
      toast.success('Disconnected')
    }
  }

  const msg = outcome ? OUTCOME[outcome] : null
  const connected = view?.status === 'connected'
  const needsReconnect = view?.status === 'needs_reconnect'

  return (
    <Card id="quickbooks" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>QuickBooks</CardTitle>
        {view?.environment === 'sandbox' && view.configured ? <Badge tone="warning">Test company</Badge> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-ui-base text-ink">
          Connect your own QuickBooks Online company so your bookkeeper gets sales, payments and bills without retyping. Connecting only links the two; nothing is sent to QuickBooks yet.
        </p>
        {msg ? <p role="status" className="rounded-ui border border-surface-line bg-surface-subtle p-3 text-ui-base font-semibold text-ink">{msg.text}</p> : null}
        {!view ? (
          <p className="text-ui-sm text-ink">Loading…</p>
        ) : !view.featureOn ? (
          <p className="rounded-ui border border-surface-line bg-surface-subtle p-3 text-ui-sm text-ink">Turn on “QuickBooks” in the feature switches above first.</p>
        ) : !view.configured ? (
          <p className="rounded-ui border border-surface-line bg-surface-subtle p-3 text-ui-sm text-ink">This server isn’t set up for QuickBooks yet. Ask whoever runs your CRM.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-ui-base font-semibold text-ink">QuickBooks company</p>
                {connected ? (
                  <>
                    <Badge tone="success">Connected</Badge>
                    {view.companyName ? <p className="text-ui-sm text-ink">{view.companyName}</p> : null}
                  </>
                ) : needsReconnect ? (
                  <Badge tone="warning">Needs to be reconnected</Badge>
                ) : (
                  <p className="text-ui-sm text-ink">Not connected</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {!connected || view.expiresSoon ? (
                  <Button className="min-h-tap" loading={busy === 'connect'} onClick={() => void connect()}>
                    {needsReconnect || view.expiresSoon ? 'Reconnect QuickBooks' : 'Connect QuickBooks'}
                  </Button>
                ) : null}
                {connected || needsReconnect ? (
                  <Button variant="secondary" className="min-h-tap" loading={busy === 'disconnect'} onClick={() => void disconnect()}>
                    Disconnect
                  </Button>
                ) : null}
              </div>
            </div>
            {needsReconnect ? <p className="text-ui-base font-semibold text-ink">{view.reason ?? 'QuickBooks stopped accepting this connection.'} Sign in with the QuickBooks owner or admin login.</p> : null}
            {connected && view.expiresSoon ? <p className="text-ui-sm text-ink">QuickBooks ends this connection within 30 days. Reconnecting takes about a minute.</p> : null}
            {!connected && !needsReconnect ? <p className="text-ui-sm text-ink">You’ll sign in to QuickBooks and choose the company to connect. Use the QuickBooks owner or admin login.</p> : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}
