'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/cn'
import { formatDateWeekday, formatMoney } from '@/lib/format'
import type { PayWeek, PayWeekLine, PayWeekNeed, PayWeekPerson } from '@/lib/payroll-pay-week'

const API = '/api/admin/payroll/pay-week'

/** One screen for payroll: Needs you → people → waiting → Approve. All numbers come from the server's single calculation. */
export default function PayWeekClient() {
  const params = useSearchParams()
  const periodParam = params.get('period')
  const [week, setWeek] = React.useState<PayWeek | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState<Record<string, boolean>>({})
  const [later, setLater] = React.useState<Record<string, boolean>>({})
  const [confirming, setConfirming] = React.useState(false)
  const [emailIt, setEmailIt] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [help, setHelp] = React.useState(false)
  const [fixing, setFixing] = React.useState(false)
  const [fixUser, setFixUser] = React.useState('')
  const [fixAmount, setFixAmount] = React.useState('')
  const [fixReason, setFixReason] = React.useState('')
  const [change, setChange] = React.useState<{ p: PayWeekPerson; l: PayWeekLine } | null>(null)
  const [changeAmount, setChangeAmount] = React.useState('')
  const [changeReason, setChangeReason] = React.useState('')
  const [done, setDone] = React.useState<{ total: number; people: number; mismatch: boolean; writtenTotal: number } | null>(null)
  const [emailing, setEmailing] = React.useState(false)
  const [emailed, setEmailed] = React.useState<{ sent: number; skipped: number; failed: number } | null>(null)
  const [bonusBusy, setBonusBusy] = React.useState(false)

  const load = React.useCallback(async () => {
    setError(null)
    try {
      const r = await fetch(`${API}${periodParam ? `?period=${encodeURIComponent(periodParam)}` : ''}`, { cache: 'no-store' })
      const body = await r.json().catch(() => null)
      if (!r.ok) throw new Error(body?.error || 'Could not load this week')
      setWeek(body as PayWeek)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [periodParam])
  React.useEffect(() => {
    setWeek(null)
    load()
  }, [load])

  const post = async (path: string, payload: unknown) => {
    const r = await fetch(`${API}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const body = await r.json().catch(() => ({}))
    if (!r.ok) throw Object.assign(new Error(body?.error || 'Something went wrong'), { code: body?.code })
    return body
  }

  const sendEmails = async (periodId: string) => {
    setEmailing(true)
    try {
      const r = await fetch(`${API}/email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ periodId }) })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.error || 'Could not send the statements')
      setEmailed({ sent: body.sent, skipped: body.skipped, failed: body.failed })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setEmailing(false)
    }
  }

  const approve = async () => {
    if (!week || busy) return
    setBusy(true)
    try {
      const res = await post('approve', { periodId: week.period.id, expectedTotal: week.totals.amount })
      setConfirming(false)
      setDone({ total: res.total, people: res.people, mismatch: !!res.mismatch, writtenTotal: res.writtenTotal })
      await load()
      if (emailIt) void sendEmails(week.period.id)
    } catch (e) {
      toast.error((e as Error).message)
      // Whatever went wrong, the screen may be stale (changed numbers, already approved by someone else): show the truth.
      setConfirming(false)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const saveChange = async () => {
    if (!change || !change.l.jobId || !change.l.participantRole) return
    setBusy(true)
    try {
      const r = await fetch('/api/admin/payroll/deal-commission-roles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: change.l.jobId, user_id: change.p.userId, role: change.l.participantRole, override_amount: Number(changeAmount), reason: changeReason.trim() }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.error || 'Could not save the change')
      setChange(null)
      toast.success('Saved')
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const saveFix = async () => {
    if (!week) return
    setBusy(true)
    try {
      const res = await post('adjustment', { periodId: week.period.id, userId: fixUser, amount: Number(fixAmount), reason: fixReason })
      setFixing(false)
      setFixUser('')
      setFixAmount('')
      setFixReason('')
      toast.success(res.nextWeek ? "Added to next week's check" : 'Added to this week')
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const removeFix = async (id: string) => {
    try {
      const r = await fetch(`${API}/adjustment?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || 'Could not remove it')
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  if (error) return <div className="rounded-ui border border-danger p-4 text-ink">{error} <Button variant="secondary" size="sm" onClick={load}>Try again</Button></div>
  if (!week) return <div className="flex flex-col gap-3"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-40" /><Skeleton className="h-64" /></div>

  const draft = week.state === 'draft'
  const openNeeds = week.needs.filter((n) => !(n.kind === 'bonus' && later[n.id]))
  const missingHours = week.needs.filter((n): n is Extract<PayWeekNeed, { kind: 'hours' }> => n.kind === 'hours')
  const csvHref = `${API}/csv?period=${week.period.id}`

  return (
    <div className="flex flex-col gap-4 pb-32">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-ui-xl font-bold text-ink">Pay this week</h1>
          <p className="text-ui-base text-ink-muted">
            Week ending {formatDateWeekday(week.period.weekEnding)} · Payday {formatDateWeekday(week.period.payDate)}
            {!draft ? <Badge tone="success" className="ml-2">Approved</Badge> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="secondary" size="sm"><a href={csvHref}>Download CSV</a></Button>
          <Button variant="ghost" size="sm" onClick={() => setHelp(true)}>How this is calculated</Button>
        </div>
      </header>

      {done ? (
        <div className={cn('rounded-ui border p-4 text-ink', done.mismatch ? 'border-danger bg-red-50' : 'border-emerald-300 bg-emerald-50')} role="status">
          <p className="text-ui-lg font-semibold">Approved: {formatMoney(done.total)} to {done.people} {done.people === 1 ? 'person' : 'people'}.</p>
          {done.mismatch ? <p className="text-ui-base">Heads up: what was written ({formatMoney(done.writtenTotal)}) differs from the {formatMoney(done.total)} you approved, because something changed while it was saving. Check the people below before paying anyone.</p> : null}
          {emailing ? <p className="text-ui-base">Emailing statements…</p> : emailed ? <p className="text-ui-base">Statements emailed: {emailed.sent}{emailed.skipped ? ` · not emailed (no address or inactive): ${emailed.skipped}` : ''}{emailed.failed ? ` · failed: ${emailed.failed}` : ''}.</p> : null}
        </div>
      ) : null}

      {!draft ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" loading={emailing} onClick={() => sendEmails(week.period.id)}>Email statements{emailed ? ' again' : ''}</Button>
        </div>
      ) : null}

      {draft && (openNeeds.length > 0 || week.warnings.length > 0) ? (
        <section className="rounded-ui border border-amber-400 bg-amber-50" aria-labelledby="needs-h">
          <h2 id="needs-h" className="px-4 pt-3 text-ui-lg font-semibold text-ink">{openNeeds.length ? `Needs you (${openNeeds.length})` : 'Check these'}</h2>
          <ul className="divide-y divide-amber-200">
            {openNeeds.map((n, i) => (
              <li key={i} className="px-4 py-3"><Need n={n} onHours={async (userId, hrs) => { try { await post('hours', { periodId: week.period.id, userId, regularHours: hrs }); toast.success('Hours added'); await load() } catch (e) { toast.error((e as Error).message) } }} onBonus={async (id) => { if (bonusBusy) return; setBonusBusy(true); try { await post('bonus', { id, periodId: week.period.id, action: 'approve' }); await load() } catch (e) { toast.error((e as Error).message) } finally { setBonusBusy(false) } }} onLater={(id) => setLater((l) => ({ ...l, [id]: true }))} /></li>
            ))}
            {week.warnings.map((w, i) => (
              <li key={`w${i}`} className="px-4 py-3 text-ui-base text-ink">{w.text}</li>
            ))}
          </ul>
          {Object.keys(later).length ? <p className="px-4 pb-3 text-ui-sm text-ink-muted">Skipped bonuses wait for next week.</p> : null}
        </section>
      ) : null}

      <Tabs defaultValue="people">
        <TabsList>
          <TabsTrigger value="people">By person ({week.totals.people})</TabsTrigger>
          <TabsTrigger value="jobs">By job ({week.jobs.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="people" className="pt-3">
          {week.people.length === 0 ? <EmptyState title="Nothing to pay this week" body="No job is ready to pay and no hours or bonuses are in." /> : (
            <div className="rounded-ui border border-surface-line bg-surface">
              {week.people.map((p) => <Person key={p.userId} p={p} open={!!open[p.userId]} toggle={() => setOpen((o) => ({ ...o, [p.userId]: !o[p.userId] }))} onRemove={draft ? removeFix : undefined} onChange={draft ? (pp, l) => { setChange({ p: pp, l }); setChangeAmount(String(l.amount)); setChangeReason('') } : undefined} />)}
            </div>
          )}
        </TabsContent>
        <TabsContent value="jobs" className="pt-3">
          {week.jobs.length === 0 ? <EmptyState title="No jobs in this week" /> : (
            <div className="rounded-ui border border-surface-line bg-surface">
              {week.jobs.map((j) => (
                <div key={j.jobId} className="border-b border-surface-line p-4 last:border-b-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <Link href={`/ops/jobs/${j.jobId}`} className="inline-flex min-h-tap items-center font-semibold text-ink underline underline-offset-2">Job {j.jobNumber}</Link>
                    <span className="tabular-nums font-semibold text-ink">{formatMoney(j.total)}</span>
                  </div>
                  <p className="text-ui-sm text-ink-muted">{j.address} · commission base {formatMoney(j.commissionBase)}</p>
                  <ul className="mt-2 flex flex-col gap-1">
                    {j.paid.map((x, i) => (
                      <li key={i} className="flex justify-between gap-3 text-ui-base">
                        <span className="min-w-0 text-ink">{x.name} <span className="text-ink-muted">· {x.roleLabel}</span><span className="block text-ui-sm text-ink-muted">{x.math}</span></span>
                        <span className="shrink-0 tabular-nums text-ink">{formatMoney(x.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {draft && week.waiting.length > 0 ? (
        <section aria-labelledby="wait-h">
          <h2 id="wait-h" className="mb-2 text-ui-lg font-semibold text-ink">Waiting — rolls to next week</h2>
          <div className="rounded-ui border border-surface-line bg-surface">
            {week.waiting.map((w) => (
              <div key={w.jobId} className="flex items-start justify-between gap-3 border-b border-surface-line p-4 last:border-b-0">
                <div className="min-w-0">
                  <Link href={`/ops/jobs/${w.jobId}`} className="inline-flex min-h-tap items-center font-semibold text-ink underline underline-offset-2">Job {w.jobNumber}</Link>
                  <span className="text-ink-muted"> · {w.address}</span>
                  <p className="text-ui-base text-ink">{w.reason}</p>
                  {w.who.length ? <p className="text-ui-sm text-ink-muted">{w.who.map((x) => `${x.name} ${formatMoney(x.estimate)}`).join(' · ')}</p> : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {week.nextWeek && week.nextWeek.fixes.length > 0 ? (
        <section aria-labelledby="nextfix-h">
          <h2 id="nextfix-h" className="mb-2 text-ui-lg font-semibold text-ink">Fixes on next week&apos;s check ({formatDateWeekday(week.nextWeek.payDate)})</h2>
          <div className="rounded-ui border border-surface-line bg-surface">
            {week.nextWeek.fixes.map((f) => (
              <div key={f.id} className="flex items-start justify-between gap-3 border-b border-surface-line p-4 last:border-b-0">
                <div className="min-w-0"><p className="font-semibold text-ink">{f.name}</p><p className="text-ui-base text-ink-muted">{f.reason}</p></div>
                <span className={cn('shrink-0 tabular-nums font-semibold text-ink', f.amount < 0 && 'text-danger')}>{f.amount > 0 ? '+' : ''}{formatMoney(f.amount)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div>
        <Button variant="secondary" onClick={() => setFixing(true)}>Fix a mistake</Button>
        {!draft ? <p className="mt-1 text-ui-sm text-ink-muted">This week is paid and stays as it is. A fix goes on next week&apos;s check.</p> : null}
      </div>

      {week.earlier.length > 0 ? (
        <section aria-labelledby="earlier-h">
          <h2 id="earlier-h" className="mb-2 text-ui-lg font-semibold text-ink">Earlier weeks</h2>
          <ul className="flex flex-wrap gap-2">
            {week.earlier.map((e) => (
              <li key={e.id}><Link href={`/admin/payroll?period=${e.id}`} className="inline-flex min-h-tap items-center rounded-ui border border-surface-line bg-surface px-3 text-ui-sm text-ink">{formatDateWeekday(e.weekEnding)} · {e.status === 'open' ? 'open' : e.status}</Link></li>
            ))}
          </ul>
        </section>
      ) : null}

      {draft ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-surface-line bg-surface md:left-60 print:hidden" style={{ bottom: 'var(--pay-footer-offset, 0px)' }}>
          <div className="mx-auto flex max-w-3xl flex-col gap-1 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <Button size="md" className="min-h-[3.5rem] w-full text-ui-lg" disabled={week.totals.amount <= 0} onClick={() => setConfirming(true)}>Approve {formatMoney(week.totals.amount)}</Button>
            <p className="text-center text-ui-sm text-ink-muted">{openNeeds.length ? `${openNeeds.length} item${openNeeds.length > 1 ? 's' : ''} above not done — they wait for next week. ` : ''}{week.totals.people} {week.totals.people === 1 ? 'person' : 'people'} · payday {formatDateWeekday(week.period.payDate)}</p>
          </div>
        </div>
      ) : null}

      <Dialog open={confirming} onOpenChange={(o) => { if (!busy) setConfirming(o) }}>
        <DialogContent title={`Approve ${formatMoney(week.totals.amount)}?`} description={`This pays ${week.totals.people} ${week.totals.people === 1 ? 'person' : 'people'} on ${formatDateWeekday(week.period.payDate)}. An approved week never reopens: a mistake is fixed on next week's check.`}>
          {week.backlog.jobs > 0 ? (
            <p className="rounded-ui border border-amber-400 bg-amber-50 p-3 text-ui-base text-ink"><b>Includes {formatMoney(week.backlog.amount)} for {week.backlog.jobs} job{week.backlog.jobs > 1 ? 's' : ''} that finished before {formatDateWeekday(week.backlog.since)}</b> — nothing has paid {week.backlog.jobs > 1 ? 'them' : 'it'} yet. Make sure that is right.</p>
          ) : null}
          {missingHours.length ? (
            <p className="rounded-ui border border-danger bg-red-50 p-3 text-ui-base text-ink"><b>No hours entered for {missingHours.map((n) => n.name).join(', ')}.</b> They are paid nothing for hours this week. Hours added later go on next week&apos;s check as a fix.</p>
          ) : null}
          <label className="flex min-h-tap items-center gap-3 text-ui-base text-ink">
            <input type="checkbox" checked={emailIt} onChange={(e) => setEmailIt(e.target.checked)} className="h-5 w-5" />
            Email each person their statement
          </label>
          {week.waiting.length ? <p className="text-ui-sm text-ink-muted">{week.waiting.length} job{week.waiting.length > 1 ? 's' : ''} wait for next week.</p> : null}
          <DialogFooter>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>Not yet</Button>
            <Button loading={busy} onClick={approve}>{missingHours.length ? 'Approve without those hours' : `Approve ${formatMoney(week.totals.amount)}`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={fixing} onOpenChange={setFixing}>
        <DialogContent title="Fix a mistake" description={draft ? "This adds a line to this week's check." : "This week is paid and never changes, so the fix goes on next week's check."}>
          <label className="flex flex-col gap-1.5 text-ui-sm font-semibold text-ink">Who
            <select value={fixUser} onChange={(e) => setFixUser(e.target.value)} className="min-h-tap w-full rounded-ui border border-surface-line bg-surface px-3 text-ui-base text-ink">
              <option value="">Choose a person</option>
              {week.directory.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-ui-sm font-semibold text-ink">Amount (+ pays them, − takes back)
            <Input type="number" inputMode="decimal" step="0.01" value={fixAmount} onChange={(e) => setFixAmount(e.target.value)} placeholder="e.g. 322 or -150" />
          </label>
          <label className="flex flex-col gap-1.5 text-ui-sm font-semibold text-ink">Why
            <Input value={fixReason} onChange={(e) => setFixReason(e.target.value)} placeholder="e.g. Closed 26-0129 alone — no split" maxLength={300} />
          </label>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setFixing(false)}>Cancel</Button>
            <Button loading={busy} disabled={!fixUser || !fixReason.trim() || !Number.isFinite(Number(fixAmount)) || Number(fixAmount) === 0 || fixAmount === ''} onClick={saveFix}>Add the fix</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!change} onOpenChange={(o) => !o && setChange(null)}>
        <DialogContent title={change ? `Change ${change.p.name}'s line` : 'Change'} description={change ? `${change.l.what}. This replaces what the plan would pay on this job; the reason goes in the audit trail.` : undefined}>
          <label className="flex flex-col gap-1.5 text-ui-sm font-semibold text-ink">New amount
            <Input type="number" inputMode="decimal" step="0.01" min={0} value={changeAmount} onChange={(e) => setChangeAmount(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5 text-ui-sm font-semibold text-ink">Why
            <Input value={changeReason} onChange={(e) => setChangeReason(e.target.value)} placeholder="e.g. Closed alone — no split" />
          </label>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setChange(null)}>Cancel</Button>
            <Button loading={busy} disabled={!changeReason.trim() || changeAmount === '' || !Number.isFinite(Number(changeAmount)) || Number(changeAmount) < 0} onClick={saveChange}>Save change</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent title="How this is calculated">
          <div className="flex flex-col gap-2 text-ui-base text-ink">
            <p>Each job pays once, in the first week it is installed, paid in full and has no cost under review.</p>
            <p>The base is the signed contract plus change orders, minus sales tax. Each person&apos;s percentage comes from their pay plan; inspection, self-generated and manager lines are added the same way.</p>
            <p>All sales commission on a job together can&apos;t go over 18% of the base. If it would, every line is reduced a little and the line says so.</p>
            <p>A job that isn&apos;t ready appears under &ldquo;Waiting&rdquo; with the reason, and pays in the week it clears.</p>
            <p>The total on the Approve button is exactly what Approve pays. An approved week is never reopened.</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Person({ p, open, toggle, onChange, onRemove }: { p: PayWeekPerson; open: boolean; toggle: () => void; onChange?: (p: PayWeekPerson, l: PayWeekLine) => void; onRemove?: (id: string) => void }) {
  return (
    <div className="border-b border-surface-line last:border-b-0">
      <button type="button" onClick={toggle} aria-expanded={open} className="flex min-h-[4rem] w-full items-center gap-3 px-4 py-3 text-left">
        <span aria-hidden className={cn('text-ink-muted transition-transform', open && 'rotate-90')}>›</span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-ink">{p.name}</span>
          <span className="block text-ui-sm text-ink-muted">{p.roleLabel}</span>
        </span>
        <span className="shrink-0 text-right text-ui-lg font-bold tabular-nums text-ink">{p.hoursMissing ? <><Badge tone="warning" className="mr-2">Hours missing</Badge>{p.total > 0 ? formatMoney(p.total) : null}</> : formatMoney(p.total)}</span>
      </button>
      {open ? (
        <ul className="px-4 pb-3 pl-10">
          {p.lines.length === 0 ? <li className="py-2 text-ui-base text-ink-muted">Nothing this week yet.</li> : null}
          {p.lines.map((l, i) => (
            <li key={i} className="flex items-start justify-between gap-3 border-t border-dashed border-surface-line py-2">
              <span className="min-w-0">
                <Badge tone="neutral" className="mr-1.5">{l.kind}</Badge>
                <span className="text-ui-base text-ink">{l.what}</span>
                <span className="block text-ui-sm text-ink-muted">{l.math}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className={cn('block tabular-nums text-ui-base font-semibold text-ink', l.amount < 0 && 'text-danger')}>{formatMoney(l.amount)}</span>
                {onRemove && l.kind === 'Adjustment' && l.adjustmentId ? <button type="button" onClick={() => onRemove(l.adjustmentId!)} className="min-h-tap text-ui-sm font-semibold text-brand-700 underline underline-offset-2">Remove</button> : null}
                {onChange && l.kind === 'Commission' && l.jobId && l.participantRole ? <button type="button" onClick={() => onChange(p, l)} className="min-h-tap text-ui-sm font-semibold text-brand-700 underline underline-offset-2">Change</button> : null}
              </span>
            </li>
          ))}
          {p.raw < 0 ? <li className="py-2 text-ui-sm text-ink-muted">The check can&apos;t go below $0. {formatMoney(-p.raw)} is carried to next week as a balance when you approve.</li> : null}
        </ul>
      ) : null}
    </div>
  )
}

function Need({ n, onHours, onBonus, onLater }: { n: PayWeekNeed; onHours: (userId: string, hours: number) => void; onBonus: (id: string) => void; onLater: (id: string) => void }) {
  const [hrs, setHrs] = React.useState('')
  if (n.kind === 'hours') {
    return (
      <div>
        <p className="font-semibold text-ink">Hours for {n.name}</p>
        <p className="text-ui-base text-ink-muted">No hours entered this week. {formatMoney(n.rate)}/hr.</p>
        <div className="mt-2 flex items-center gap-2">
          <Input type="number" inputMode="decimal" min={0} max={120} step="0.25" value={hrs} onChange={(e) => setHrs(e.target.value)} placeholder="Hours" aria-label={`Hours for ${n.name}`} className="w-28" />
          <Button disabled={hrs === '' || Number(hrs) < 0} onClick={() => onHours(n.userId, Number(hrs))}>Add</Button>
        </div>
      </div>
    )
  }
  if (n.kind === 'bonus') {
    return (
      <div>
        <p className="font-semibold text-ink">Bonus for {n.name}: {formatMoney(n.amount)}</p>
        <p className="text-ui-base text-ink-muted">{n.what}{n.fromWeek ? ` (earned the week ending ${formatDateWeekday(n.fromWeek)}; it can't be paid there, so it goes on this check)` : ''}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button onClick={() => onBonus(n.id)}>Yes, pay it</Button>
          <Button variant="secondary" onClick={() => onLater(n.id)}>Not now</Button>
        </div>
      </div>
    )
  }
  if (n.kind === 'plans') {
    return (
      <div>
        <p className="font-semibold text-ink">{n.text}</p>
        <p className="text-ui-base text-ink-muted">{n.names.join(', ')}</p>
        <Button asChild variant="secondary" size="sm" className="mt-2"><Link href={n.href}>Choose a plan</Link></Button>
      </div>
    )
  }
  return (
    <div>
      <p className="font-semibold text-ink">{n.text}</p>
      <p className="text-ui-base text-ink-muted">Job {n.jobNumbers.join(', ')}</p>
    </div>
  )
}
