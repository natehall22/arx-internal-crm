'use client'

import { useEffect, useState } from 'react'

import { Button, Card, CardContent, CardHeader, CardTitle, toast } from '@/components/ui'
import type { DepositMode, QuoteApprovalSettings } from '@/lib/quotes/settings'

/**
 * Settings → Quotes (owners, switch `quoteApproval`): the deposit a quote asks when it doesn't set its own (none, a percent,
 * or a fixed amount), how many days a quote link works, and the terms customers agree to when they approve.
 * Route /api/admin/quote-approval; rules lib/quotes/settings.ts.
 */
export default function QuoteApprovalCard() {
  const [s, setS] = useState<QuoteApprovalSettings | null>(null)
  const [mode, setMode] = useState<DepositMode>('none')
  const [percent, setPercent] = useState('')
  const [fixed, setFixed] = useState('')
  const [days, setDays] = useState('30')
  const [terms, setTerms] = useState('')
  const [busy, setBusy] = useState(false)

  function fill(v: QuoteApprovalSettings) {
    setS(v)
    setMode(v.depositMode)
    setPercent(v.depositPercent ? String(v.depositPercent) : '')
    setFixed(v.depositFixedCents ? (v.depositFixedCents / 100).toFixed(2) : '')
    setDays(String(v.linkDays))
    setTerms(v.terms)
  }

  useEffect(() => {
    void fetch('/api/admin/quote-approval', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { settings?: QuoteApprovalSettings } | null) => d?.settings && fill(d.settings))
      .catch(() => null)
  }, [])

  async function save() {
    const settings: Record<string, unknown> = { depositMode: mode, linkDays: Number(days), terms }
    if (mode === 'percent') settings.depositPercent = Number(percent)
    if (mode === 'fixed') {
      const c = Math.round(Number(fixed.replace(/[$,\s]/g, '')) * 100)
      if (!Number.isFinite(c)) return toast.error('Enter the deposit in dollars')
      settings.depositFixedCents = c
    }
    setBusy(true)
    const res = await fetch('/api/admin/quote-approval', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings }) }).catch(() => null)
    const data = res ? ((await res.json().catch(() => ({}))) as { settings?: QuoteApprovalSettings; error?: string }) : null
    setBusy(false)
    if (!res?.ok || !data?.settings) return toast.error(data?.error || 'Could not save')
    fill(data.settings)
    toast.success('Saved')
  }

  return (
    <Card id="quotes" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Quotes</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-ui-base text-ink">What customers see when you send a quote link. A single quote can change its own deposit.</p>
        {!s ? (
          <p className="text-ui-sm text-ink">Loading…</p>
        ) : (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-ui-base font-semibold text-ink">Deposit after approval</legend>
              {(['none', 'percent', 'fixed'] as const).map((m) => (
                <label key={m} className="flex min-h-tap items-center gap-3 text-ui-base text-ink">
                  <input type="radio" name="deposit-mode" className="h-5 w-5" checked={mode === m} onChange={() => setMode(m)} />
                  {m === 'none' ? 'No deposit' : m === 'percent' ? 'A percent of the total' : 'A fixed amount'}
                </label>
              ))}
              {mode === 'percent' ? (
                <input inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="25" aria-label="Deposit percent" className="min-h-tap w-40 rounded-ui border border-surface-line px-3 text-base text-ink" />
              ) : null}
              {mode === 'fixed' ? (
                <input inputMode="decimal" value={fixed} onChange={(e) => setFixed(e.target.value)} placeholder="500.00" aria-label="Deposit amount" className="min-h-tap w-40 rounded-ui border border-surface-line px-3 text-base text-ink" />
              ) : null}
              <p className="text-ui-sm text-ink">The customer pays it by card on their quote page (needs Online payments connected); otherwise it’s an invoice for you to collect.</p>
            </fieldset>
            <label className="flex flex-col gap-1">
              <span className="text-ui-base font-semibold text-ink">Quote link works for (days)</span>
              <input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} className="min-h-tap w-28 rounded-ui border border-surface-line px-3 text-base text-ink" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-ui-base font-semibold text-ink">Terms the customer agrees to</span>
              <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={6} maxLength={4000} className="rounded-ui border border-surface-line p-3 text-base text-ink" placeholder="Payment terms, cancellation, what is and isn’t included…" />
            </label>
            <Button className="min-h-tap self-start" loading={busy} onClick={() => void save()}>Save</Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
