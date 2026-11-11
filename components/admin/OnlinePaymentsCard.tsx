'use client'

import { useCallback, useEffect, useState } from 'react'

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, toast } from '@/components/ui'
import { confirmDialog } from '@/components/ui/confirm-dialog'

type View = {
  featureOn: boolean
  configured: boolean
  ready: boolean
  testMode: boolean
  settings: { allowPartial: boolean; bankPayments: boolean; autopay: boolean; retryDays: number[] }
  account: { status: 'onboarding' | 'active' | 'restricted' | 'disconnected'; chargesEnabled: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean; livemode: boolean; accountId: string } | null
}

const STATUS: Record<string, { label: string; tone: 'success' | 'warning' }> = {
  active: { label: 'Connected — taking payments', tone: 'success' },
  restricted: { label: 'Stripe needs more information', tone: 'warning' },
  onboarding: { label: 'Setup not finished', tone: 'warning' },
}

/**
 * Settings → Online payments (owners). Connect the company's OWN Stripe account (money goes straight to it; the company
 * pays Stripe's fees), see its status, disconnect, and the few choices: part payments, bank (ACH), automatic payments
 * and their retries. lib/online-payments/accounts.ts; route /api/admin/online-payments.
 */
export default function OnlinePaymentsCard({ initial = null }: { initial?: View | null }) {
  const [view, setView] = useState<View | null>(initial)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/online-payments', { cache: 'no-store' }).catch(() => null)
    if (res?.ok) setView((await res.json()) as View)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Back from Stripe: `?payments=resume` = the onboarding link expired (start a fresh one with the button below);
  // `?payments=return` = Stripe finished (the status above was just re-read from Stripe).
  const [resume, setResume] = useState(false)
  useEffect(() => {
    setResume(new URLSearchParams(window.location.search).get('payments') === 'resume')
  }, [])

  async function call(method: 'POST' | 'PATCH', body: unknown, tag: string) {
    setBusy(tag)
    const res = await fetch('/api/admin/online-payments', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const data = res ? ((await res.json().catch(() => ({}))) as View & { url?: string; error?: string }) : null
    setBusy(null)
    if (!res || !res.ok) {
      toast.error(data?.error || 'Could not save')
      return null
    }
    return data
  }

  async function connect() {
    const data = await call('POST', { action: 'connect' }, 'connect')
    if (data?.url) window.location.assign(data.url)
  }

  async function disconnect() {
    if (!(await confirmDialog({ title: 'Stop taking online payments?', description: 'Your Stripe account and its money stay yours; nothing is refunded. You can connect again later.', confirmLabel: 'Disconnect', destructive: true }))) return
    const data = await call('POST', { action: 'disconnect' }, 'disconnect')
    if (data) {
      setView(data)
      toast.success('Disconnected')
    }
  }

  async function save(patch: Partial<View['settings']>) {
    const data = await call('PATCH', { settings: patch }, 'save')
    if (data) {
      setView(data)
      toast.success('Saved')
    }
  }

  const s = view?.settings
  const acct = view?.account
  const st = acct ? STATUS[acct.status] : null

  return (
    <Card id="online-payments" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Online payments</CardTitle>
        {view?.testMode && view.configured ? <Badge tone="warning">Test mode</Badge> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-ui-base text-ink">
          Customers pay invoices and deposits by card or bank from a link, and can save a card for automatic payments. Money goes straight to your own
          Stripe account and Stripe’s fees come out of it; no card fee is added for the customer. Payments show on the invoice by themselves.
        </p>
        {!view ? (
          <p className="text-ui-sm text-ink">Loading…</p>
        ) : !view.featureOn ? (
          <p className="rounded-ui border border-surface-line bg-surface-subtle p-3 text-ui-sm text-ink">Turn on “Online payments (Stripe)” in the feature switches above first.</p>
        ) : !view.configured ? (
          <p className="rounded-ui border border-surface-line bg-surface-subtle p-3 text-ui-sm text-ink">This server isn’t set up for Stripe yet (keys). Ask whoever runs your CRM.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-ui-base font-semibold text-ink">Stripe account</p>
                {st ? <Badge tone={st.tone}>{st.label}</Badge> : <p className="text-ui-sm text-ink">Not connected</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {!acct || acct.status !== 'active' ? (
                  <Button className="min-h-tap" loading={busy === 'connect'} onClick={() => void connect()}>
                    {acct ? 'Finish setup in Stripe' : 'Connect Stripe'}
                  </Button>
                ) : null}
                {acct ? (
                  <Button variant="secondary" className="min-h-tap" loading={busy === 'disconnect'} onClick={() => void disconnect()}>
                    Disconnect
                  </Button>
                ) : null}
              </div>
            </div>
            {acct && acct.status === 'active' && !acct.payoutsEnabled ? (
              <p className="text-ui-sm text-ink">Payments work; Stripe still needs your bank details to send payouts (finish in your Stripe dashboard).</p>
            ) : null}
            {resume && acct && acct.status !== 'active' ? <p className="text-ui-base font-semibold text-ink">Stripe’s setup page timed out — tap “Finish setup in Stripe” to continue where you left off.</p> : null}
            {!acct ? <p className="text-ui-sm text-ink">You’ll sign in to Stripe (or create an account) and confirm your business. It takes about 5 minutes.</p> : null}

            {s ? (
              <ul className="divide-y divide-surface-line">
                <Toggle label="Customers can pay part of an invoice" hint="Off: the pay page charges the full balance." on={s.allowPartial} busy={busy === 'save'} onChange={(v) => void save({ allowPartial: v })} />
                <Toggle label="Bank payments (ACH)" hint="Lower fees; takes 3–5 business days to clear. Turn ACH on in your Stripe dashboard too." on={s.bankPayments} busy={busy === 'save'} onChange={(v) => void save({ bankPayments: v })} />
                <Toggle
                  label="Automatic payments for service plans"
                  hint={`Customers who save a card are charged when an invoice is sent. If a card fails we email them a pay link and try again ${s.retryDays.length ? `after ${s.retryDays.join(' and ')} days` : 'only when you send again'}.`}
                  on={s.autopay}
                  busy={busy === 'save'}
                  onChange={(v) => void save({ autopay: v })}
                />
              </ul>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Toggle({ label, hint, on, busy, onChange }: { label: string; hint: string; on: boolean; busy: boolean; onChange: (v: boolean) => void }) {
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-ui-base font-semibold text-ink">
          {label} <span className={on ? 'text-brand-700' : 'text-ink'}>· {on ? 'On' : 'Off'}</span>
        </p>
        <p className="text-ui-sm text-ink">{hint}</p>
      </div>
      <Button variant={on ? 'secondary' : 'primary'} className="min-h-tap min-w-[7rem]" aria-pressed={on} disabled={busy} onClick={() => onChange(!on)}>
        {on ? 'Turn off' : 'Turn on'}
      </Button>
    </li>
  )
}
