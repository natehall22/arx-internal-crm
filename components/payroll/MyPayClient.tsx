'use client'

import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/field'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/cn'
import { formatDateWeekday, formatMoney } from '@/lib/format'
import type { MyPay, MyPayJob } from '@/lib/my-pay'

const STATUS_TEXT: Record<string, string> = {
  open: 'Open — the office will reply within 1 business day',
  answered: 'Answered',
  fixed: 'Fixed',
  rejected: 'Closed',
}

/** The rep's own pay, on a phone: one big number, then This week / Coming / Paid, each line with its math. */
export default function MyPayClient() {
  const [data, setData] = React.useState<MyPay | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState<Record<string, boolean>>({})
  const [asking, setAsking] = React.useState<{ row: MyPayJob; periodId?: string } | null>(null)
  const [message, setMessage] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const load = React.useCallback(async () => {
    setError(null)
    try {
      const r = await fetch('/api/me/pay', { cache: 'no-store' })
      const body = await r.json().catch(() => null)
      if (!r.ok) throw new Error(body?.error || 'Could not load your pay')
      setData(body as MyPay)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  React.useEffect(() => {
    load()
  }, [load])

  const send = async () => {
    if (!asking) return
    setBusy(true)
    try {
      const r = await fetch('/api/me/pay/dispute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: asking.row.title, message, jobId: asking.row.jobId, periodId: asking.periodId }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.error || 'Could not send that')
      toast.success('Sent. The office will reply within 1 business day.')
      setAsking(null)
      setMessage('')
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (error) return <div className="rounded-ui border border-danger p-4 text-ink">{error} <Button variant="secondary" size="sm" onClick={load}>Try again</Button></div>
  if (!data) return <div className="flex flex-col gap-3"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-16 w-2/3" /><Skeleton className="h-40" /></div>

  const disputeFor = (title: string) => data.disputes.find((d) => d.label === title)
  const row = (j: MyPayJob, periodId?: string) => {
    const note = disputeFor(j.title)
    const isOpen = !!open[j.key]
    return (
      <div key={j.key} className="border-b border-surface-line last:border-b-0">
        <button type="button" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [j.key]: !o[j.key] }))} className="flex min-h-[4rem] w-full items-start gap-3 px-4 py-3 text-left">
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-ink">{j.lineKind !== 'Commission' ? `${j.lineKind} · ` : ''}{j.title}</span>
            <span className="block text-ui-sm text-ink-muted">{j.why}</span>
          </span>
          <span className={cn('shrink-0 text-right text-ui-lg font-bold tabular-nums text-ink', j.amount < 0 && 'text-danger')}>{formatMoney(j.amount)}</span>
        </button>
        {isOpen ? (
          <div className="px-4 pb-3">
            <p className="text-ui-base text-ink">{j.math}</p>
            {note ? (
              <p className="mt-2 rounded-ui bg-surface-subtle p-3 text-ui-base text-ink"><b>You asked:</b> {note.message}<br />{STATUS_TEXT[note.status] ?? note.status}{note.reply ? ` — “${note.reply}”` : ''}</p>
            ) : (
              <button type="button" onClick={() => { setAsking({ row: j, periodId }); setMessage('') }} className="mt-2 min-h-tap text-ui-base font-semibold text-brand-700 underline underline-offset-2">Something&apos;s wrong?</button>
            )}
          </div>
        ) : null}
      </div>
    )
  }
  const group = (title: string, sub: string, rows: React.ReactNode[], emptyText: string) => (
    <section className="flex flex-col gap-2">
      <h2 className="text-ui-lg font-semibold text-ink">{title} <span className="text-ui-base font-normal text-ink-muted">{sub}</span></h2>
      <div className="rounded-ui border border-surface-line bg-surface">{rows.length ? rows : <p className="p-4 text-ui-base text-ink-muted">{emptyText}</p>}</div>
    </section>
  )

  const h = data.headline
  return (
    <div className="flex flex-col gap-5">
      <header>
        <p className="text-ui-base text-ink-muted">{data.name} · My pay</p>
        <p className="text-[2.5rem] font-extrabold leading-tight tabular-nums text-ink">{formatMoney(h.amount)}</p>
        <p className="text-ui-base text-ink-muted">{h.state === 'approved' ? `Approved · paid ${formatDateWeekday(h.payDate)}` : `This week so far · paid ${formatDateWeekday(h.payDate)}`}</p>
      </header>

      {data.nextWeekFixes.length ? (
        <p className="rounded-ui border border-surface-line bg-surface p-3 text-ui-base text-ink">
          <b>Fixes on your next check:</b> {data.nextWeekFixes.map((f) => `${f.amount > 0 ? '+' : ''}${formatMoney(f.amount)} (${f.reason})`).join('; ')}
        </p>
      ) : null}

      {group('This week', formatMoney(h.amount), data.thisWeek.map((j) => row(j)), 'Nothing on this week’s check yet.')}
      {group('Coming', data.comingTotal ? `about ${formatMoney(data.comingTotal)}` : '', data.coming.map((j) => row(j)), 'Nothing waiting.')}
      {data.paid.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-ui-lg font-semibold text-ink">Paid</h2>
          {data.paid.map((p) => (
            <div key={p.periodId} className="rounded-ui border border-surface-line bg-surface">
              <p className="flex justify-between border-b border-surface-line px-4 py-3 font-semibold text-ink"><span>{formatDateWeekday(p.payDate)}</span><span className="tabular-nums">{formatMoney(p.total)}</span></p>
              {p.lines.map((j) => row(j, p.periodId))}
            </div>
          ))}
        </section>
      ) : <EmptyState title="No paid checks yet" body="Your approved checks will show here, line by line." />}

      <Dialog open={!!asking} onOpenChange={(o) => !o && setAsking(null)}>
        <DialogContent title="Something's wrong?" description={asking?.row.title}>
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What looks wrong? e.g. I closed this one alone." maxLength={1000} aria-label="What looks wrong" />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setAsking(null)}>Cancel</Button>
            <Button loading={busy} disabled={!message.trim()} onClick={send}>Send to the office</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
