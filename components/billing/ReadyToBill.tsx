'use client'

import * as React from 'react'

import { Badge, Button, Card, CardContent, Dialog, DialogContent, DialogFooter, toast } from '@/components/ui'
import { formatCurrency } from '@/lib/job-payments'
import {
  draftInvoiceTotals,
  groupDraftInvoices,
  monthLabel,
  unitWaits,
  visitDateLabel,
  type BillingGrouping,
  type BillingUnit,
  type DraftInvoice,
  type NotBillable,
} from '@/lib/service-billing'
import type { SalesTaxSettings } from '@/lib/sales-tax'
import { lineTotalCents } from '@/lib/invoice-lines'

type Customer = { name: string; email: string | null; exempt: boolean }
type Load = {
  today: string
  currentMonth: string
  lookbackDays: number
  units: BillingUnit[]
  notBillable: NotBillable[]
  customers: Record<string, Customer>
  addresses: Record<string, string>
  salesTax: SalesTaxSettings | null
  maxPerRequest: number
}
type Created = { key: string; invoiceId: string; invoiceNumber: string; customerName: string; totalCents: number; sent: boolean; sendError: string | null }
type Outcome = { created: Created[]; alreadyBilled: number; failed: Array<{ key: string; customerName: string; error: string }> }

const GROUPING_KEY = 'billing.grouping'
const LONG_LOOKBACK = 365

/**
 * Jobs → Schedule → Ready to bill: every done service visit not yet on an invoice, already grouped into the invoices it
 * would make — one per customer per month (default) or one per visit. The office's whole job is one button: "Bill N"
 * (every invoice ticked; untick to hold one back), with "Email them now" on. Totals include sales tax exactly as the
 * invoice will (lib/sales-tax.ts). Safe to press twice: anything already billed is skipped.
 */
export default function ReadyToBill() {
  const [data, setData] = React.useState<Load | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [lookback, setLookback] = React.useState<number | null>(null)
  const [grouping, setGrouping] = React.useState<BillingGrouping>('month')
  const [includeThisMonth, setIncludeThisMonth] = React.useState(false)
  const [send, setSend] = React.useState(true)
  const [unticked, setUnticked] = React.useState<Set<string>>(new Set())
  const [open, setOpen] = React.useState<string | null>(null)
  const [confirming, setConfirming] = React.useState(false)
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null)
  const [outcome, setOutcome] = React.useState<Outcome | null>(null)

  React.useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(GROUPING_KEY) : null
    if (saved === 'visit' || saved === 'month') setGrouping(saved)
  }, [])

  const load = React.useCallback(async (days: number | null) => {
    setError(null)
    try {
      const res = await fetch(`/api/ops/billing${days ? `?lookback=${days}` : ''}`, { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error || 'Could not load visits to bill')
        return
      }
      setData(body as Load)
    } catch {
      setError('Could not load visits to bill — check your connection')
    }
  }, [])

  React.useEffect(() => {
    void load(lookback)
  }, [load, lookback])

  const address = React.useCallback((id: string | null) => (id && data ? data.addresses[id] ?? null : null), [data])
  const { drafts, waiting } = React.useMemo(() => {
    if (!data) return { drafts: [] as DraftInvoice[], waiting: [] as BillingUnit[] }
    const ready: BillingUnit[] = []
    const wait: BillingUnit[] = []
    for (const u of data.units) (unitWaits(u, grouping, data.currentMonth, includeThisMonth) ? wait : ready).push(u)
    const list = groupDraftInvoices(ready, grouping, address)
    const name = (d: DraftInvoice) => data.customers[d.customerId]?.name ?? ''
    list.sort((a, b) => name(a).localeCompare(name(b)) || (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
    return { drafts: list, waiting: wait }
  }, [data, grouping, includeThisMonth, address])

  const totals = React.useMemo(() => {
    const m = new Map<string, { subtotalCents: number; taxCents: number; totalCents: number }>()
    if (!data) return m
    for (const d of drafts) m.set(d.key, draftInvoiceTotals(d, data.salesTax, data.customers[d.customerId]?.exempt === true))
    return m
  }, [drafts, data])

  const chosen = drafts.filter((d) => !unticked.has(d.key))
  const chosenTotal = chosen.reduce((s, d) => s + (totals.get(d.key)?.totalCents ?? 0), 0)
  const noEmail = send ? chosen.filter((d) => !data?.customers[d.customerId]?.email).length : 0

  const setGroupingSaved = (g: BillingGrouping) => {
    setGrouping(g)
    setUnticked(new Set())
    try {
      window.localStorage.setItem(GROUPING_KEY, g)
    } catch {
      /* private mode */
    }
  }

  const toggle = (key: string) =>
    setUnticked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  async function bill() {
    if (!data || chosen.length === 0) return
    setConfirming(false)
    const keys = chosen.map((d) => d.key)
    const result: Outcome = { created: [], alreadyBilled: 0, failed: [] }
    setProgress({ done: 0, total: keys.length })
    for (let i = 0; i < keys.length; i += data.maxPerRequest) {
      const part = keys.slice(i, i + data.maxPerRequest)
      // Exactly what this screen shows for these invoices: the server bills these units / visits and nothing newer.
      const shown = drafts.filter((d) => part.includes(d.key)).flatMap((d) => d.units)
      const unitKeys = shown.map((u) => u.key)
      const visitIds = shown.flatMap((u) => u.visits.map((v) => v.visitId))
      try {
        const res = await fetch('/api/ops/billing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keys: part, unitKeys, visitIds, grouping, includeCurrentMonth: includeThisMonth, lookbackDays: data.lookbackDays, send }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          for (const k of part) result.failed.push({ key: k, customerName: data.customers[drafts.find((d) => d.key === k)?.customerId ?? '']?.name ?? 'Customer', error: body.error || 'Could not make this invoice' })
        } else {
          result.created.push(...(body.created as Created[]))
          result.alreadyBilled += (body.alreadyBilled as string[]).length
          result.failed.push(...(body.failed as Outcome['failed']))
        }
      } catch {
        for (const k of part) result.failed.push({ key: k, customerName: 'Customer', error: 'Connection lost — press Bill again; nothing is billed twice' })
      }
      setProgress({ done: Math.min(i + part.length, keys.length), total: keys.length })
    }
    setProgress(null)
    setOutcome(result)
    setUnticked(new Set())
    if (result.created.length) toast.success(`Made ${result.created.length} invoice${result.created.length === 1 ? '' : 's'}`)
    await load(lookback)
  }

  if (error && !data) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <Card>
          <CardContent className="p-4 text-ui-base text-ink">{error}</CardContent>
        </Card>
      </div>
    )
  }
  if (!data) return <p className="mx-auto max-w-3xl p-4 text-ui-base text-ink">Loading visits to bill…</p>

  const seg = (active: boolean) => `min-h-tap flex-1 rounded-ui px-3 text-ui-sm font-semibold ${active ? 'bg-brand-700 text-white' : 'border border-surface-line bg-surface text-ink'}`
  const sentCount = outcome?.created.filter((c) => c.sent).length ?? 0
  const draftsLeft = outcome?.created.filter((c) => !c.sent) ?? []

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-32">
      <header>
        <h1 className="text-ui-xl font-semibold text-ink">Ready to bill</h1>
        <p className="text-ui-base text-ink">Done visits not on an invoice yet{data.lookbackDays < LONG_LOOKBACK ? ` (last ${data.lookbackDays} days)` : ''}.</p>
      </header>

      {outcome ? (
        <Card>
          <CardContent className="space-y-2 p-4 text-ui-base text-ink">
            <p className="font-semibold">
              Made {outcome.created.length} invoice{outcome.created.length === 1 ? '' : 's'}
              {send ? ` · ${sentCount} emailed` : ''}
              {outcome.alreadyBilled ? ` · ${outcome.alreadyBilled} already billed` : ''}
            </p>
            {draftsLeft.length > 0 && send ? (
              <div>
                <p>Not emailed (still drafts — open the customer to send or print):</p>
                <ul className="mt-1 space-y-1">
                  {draftsLeft.map((c) => (
                    <li key={c.invoiceId} className="flex flex-wrap items-center gap-2">
                      <a className="inline-flex min-h-tap items-center font-semibold text-brand-800 underline" href={`/invoices/${c.invoiceId}/print`} target="_blank" rel="noreferrer">
                        {c.invoiceNumber}
                      </a>
                      <span>{c.customerName}</span>
                      <span>— {c.sendError}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {outcome.failed.length > 0 ? (
              <p className="font-semibold text-danger">
                {outcome.failed.length} not made: {outcome.failed.map((f) => f.customerName).join(', ')}. Press Bill again — nothing is billed twice.
              </p>
            ) : null}
            <Button variant="secondary" size="sm" onClick={() => setOutcome(null)}>
              OK
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex gap-2" role="group" aria-label="How to group invoices">
        <button type="button" className={seg(grouping === 'month')} aria-pressed={grouping === 'month'} onClick={() => setGroupingSaved('month')}>
          One per customer a month
        </button>
        <button type="button" className={seg(grouping === 'visit')} aria-pressed={grouping === 'visit'} onClick={() => setGroupingSaved('visit')}>
          One per visit
        </button>
      </div>

      {drafts.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-ui-base text-ink">Nothing to bill right now.{waiting.length ? ' This month’s visits are below.' : ''}</CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b border-surface-line px-4 py-2">
              <span className="text-ui-sm font-semibold text-ink">
                {drafts.length} invoice{drafts.length === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                className="min-h-tap px-2 text-ui-sm font-semibold text-brand-800 underline"
                onClick={() => setUnticked(unticked.size ? new Set() : new Set(drafts.map((d) => d.key)))}
              >
                {unticked.size ? 'Tick all' : 'Untick all'}
              </button>
            </div>
            <ul>
              {drafts.map((d) => {
                const c = data.customers[d.customerId]
                const t = totals.get(d.key)
                const visits = d.units.reduce((n, u) => n + u.visits.length, 0)
                const isOpen = open === d.key
                return (
                  <li key={d.key} className="border-b border-surface-line last:border-b-0">
                    <div className="flex items-center gap-3 px-4 py-2">
                      <input
                        type="checkbox"
                        className="h-6 w-6 shrink-0"
                        aria-label={`Bill ${c?.name ?? 'customer'}`}
                        checked={!unticked.has(d.key)}
                        onChange={() => toggle(d.key)}
                      />
                      <button type="button" className="flex min-h-tap flex-1 items-center justify-between gap-2 text-left" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : d.key)}>
                        <span>
                          <span className="block text-ui-base font-semibold text-ink">{c?.name ?? 'Customer'}</span>
                          <span className="block text-ui-sm text-ink">
                            {grouping === 'month' ? `${monthLabel(d.month)} · ` : ''}
                            {visits === 0 ? 'monthly fee' : `${visits} visit${visits === 1 ? '' : 's'}`}
                            {send && !c?.email ? ' · no email' : ''}
                          </span>
                        </span>
                        <span className="text-ui-base font-semibold tabular-nums text-ink">{formatCurrency(t?.totalCents ?? d.subtotalCents)}</span>
                      </button>
                    </div>
                    {isOpen ? (
                      <ul className="space-y-1 bg-surface-subtle px-4 py-2 text-ui-sm text-ink">
                        {d.lines.map((l, i) => (
                          <li key={i} className="flex justify-between gap-2">
                            <span>
                              {l.description}
                              {l.service_date ? ` — ${visitDateLabel(l.service_date)}` : ''}
                            </span>
                            <span className="tabular-nums">{formatCurrency(lineTotalCents(l.qty, l.unit_price_cents))}</span>
                          </li>
                        ))}
                        {t && t.taxCents > 0 ? (
                          <li className="flex justify-between gap-2 font-semibold">
                            <span>Sales tax</span>
                            <span className="tabular-nums">{formatCurrency(t.taxCents)}</span>
                          </li>
                        ) : null}
                      </ul>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {waiting.length > 0 ? (
        <Card>
          <CardContent className="space-y-2 p-4 text-ui-base text-ink">
            <p>
              <span className="font-semibold">{monthLabel(data.currentMonth)} so far:</span> {waiting.length} {waiting.length === 1 ? 'item waits' : 'items wait'} for the month to end.
            </p>
            <Button variant="secondary" size="sm" onClick={() => setIncludeThisMonth(true)}>
              Bill this month now too
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {data.notBillable.length > 0 ? (
        <details className="rounded-ui border border-surface-line bg-surface p-4 text-ui-base text-ink">
          <summary className="min-h-tap cursor-pointer font-semibold">
            {data.notBillable.length} done visit{data.notBillable.length === 1 ? '' : 's'} can’t be billed here
          </summary>
          <ul className="mt-2 space-y-1 text-ui-sm">
            {data.notBillable.slice(0, 100).map((n) => (
              <li key={n.visitId}>
                {data.customers[n.customerId ?? '']?.name ?? 'Customer'} · {n.planName} · {visitDateLabel(n.date)} —{' '}
                {n.reason === 'yearly' ? 'yearly plan (bill it from the customer)' : n.reason === 'hourly' ? 'billed by the hour (Hours to bill)' : 'no price on the plan (set one, then it shows here)'}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {data.lookbackDays < LONG_LOOKBACK ? (
        <button type="button" className="min-h-tap text-ui-sm font-semibold text-brand-800 underline" onClick={() => setLookback(LONG_LOOKBACK)}>
          Look back a full year
        </button>
      ) : null}

      {drafts.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-surface-line bg-surface px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 shadow-lg">
          <div className="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex min-h-tap items-center gap-2 text-ui-base text-ink">
              <input type="checkbox" className="h-6 w-6" checked={send} onChange={(e) => setSend(e.target.checked)} />
              Email them to customers now
            </label>
            <Button disabled={chosen.length === 0 || progress != null} loading={progress != null} onClick={() => setConfirming(true)}>
              {progress ? `Billing ${progress.done} of ${progress.total}…` : `Bill ${chosen.length} · ${formatCurrency(chosenTotal)}`}
            </Button>
          </div>
        </div>
      ) : null}

      {confirming ? (
        <Dialog open onOpenChange={(o) => !o && setConfirming(false)}>
          <DialogContent
            title={`Make ${chosen.length} invoice${chosen.length === 1 ? '' : 's'}?`}
            description={send ? `They are emailed to customers now.${noEmail ? ` ${noEmail} without an email stay as drafts.` : ''}` : 'They are saved as drafts — nothing is emailed.'}
          >
            <p className="text-ui-base text-ink">
              Total <span className="font-semibold">{formatCurrency(chosenTotal)}</span>
              {noEmail && send ? (
                <Badge tone="warning" className="ml-2">
                  {noEmail} no email
                </Badge>
              ) : null}
            </p>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button onClick={() => void bill()}>{send ? 'Make and email' : 'Make drafts'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}
