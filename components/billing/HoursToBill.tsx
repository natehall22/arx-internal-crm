'use client'

import * as React from 'react'

import { Badge, Button, Card, CardContent, Dialog, DialogContent, DialogFooter, Field, Input, Select, Textarea, toast } from '@/components/ui'
import { formatCurrency } from '@/lib/job-payments'
import {
  dayBillableHours,
  hoursLabel,
  invoiceLinesForDay,
  lineAmountCents,
  lineDescription,
  linesFromEdit,
  type BillContext,
  type BillLine,
  type EditLine,
  type HourlyBillingSettings,
  type Rate,
} from '@/lib/hourly-billing'
import { invoiceItemDateLabel } from '@/lib/invoice-lines'
import { draftInvoiceTotals } from '@/lib/service-billing'
import type { SalesTaxSettings } from '@/lib/sales-tax'
import { formatDuration } from '@/lib/time-tracking'

type Approval = { id: string; date: string; source: 'clock' | 'typed' | 'edited'; editReason: string | null; billableHours: number; invoiceId: string | null; invoiceNumber: string | null; invoiceStatus: string | null }
type Day = { date: string; status: 'ready' | 'open' | 'no_time' | 'approved' | 'voided'; clockedSeconds: number; lines: BillLine[]; needsReview: boolean; approval: Approval | null }
type Target = {
  key: string
  kind: 'job' | 'visit'
  id: string
  title: string
  customerId: string | null
  customerName: string
  address: string | null
  labor: Rate | null
  estimatedHours: number | null
  billedHours: number
  days: Day[]
}
type Load = {
  today: string
  lookbackDays: number
  settings: HourlyBillingSettings
  targets: Target[]
  customers: Record<string, { name: string; email: string | null; exempt: boolean }>
  equipment: Rate[]
  trip: Rate | null
  salesTax: SalesTaxSettings | null
  maxDaysPerApproval: number
}
type Made = { invoiceId: string; invoiceNumber: string; totalCents: number; isJobInvoice: boolean; sent: boolean; sendError: string | null }

const dayKey = (t: Target, date: string) => `${t.key}|${date}`
const waiting = (d: Day) => d.status === 'ready' || d.status === 'open' || d.status === 'no_time'
const LONG_LOOKBACK = 180

function summary(lines: readonly BillLine[]): string {
  if (!lines.length) return 'No hours yet'
  return lines.map((l) => (l.kind === 'trip' ? l.name : `${lineDescription(l)}: ${hoursLabel(l.hours)} h`)).join(' · ')
}

function totalFor(lines: readonly BillLine[], date: string, data: Load, t: Target): number {
  const inv = invoiceLinesForDay(date, lines)
  return draftInvoiceTotals({ lines: inv.map((l) => ({ ...l })) }, data.salesTax, t.customerId ? data.customers[t.customerId]?.exempt === true : false).totalCents
}

/**
 * Jobs → Schedule → Hours to bill (office): every job / visit billed by the hour, one row per day with what the clock
 * says it bills after the company's rules — and why. The usual job is one button per customer: "Bill 2 days · $1,240".
 * Tap a day to change the hours (with a reason) or type hours when nobody clocked (subs, a forgotten clock).
 */
export default function HoursToBill() {
  const [data, setData] = React.useState<Load | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [lookback, setLookback] = React.useState<number | null>(null)
  const [unticked, setUnticked] = React.useState<Set<string>>(new Set())
  const [busy, setBusy] = React.useState<string | null>(null)
  const [made, setMade] = React.useState<Record<string, Made>>({})
  const [sheet, setSheet] = React.useState<{ target: Target; day: Day | null } | null>(null)
  const [unapprove, setUnapprove] = React.useState<{ approval: Approval } | null>(null)

  const load = React.useCallback(async (days: number | null) => {
    setError(null)
    try {
      const res = await fetch(`/api/ops/hours-to-bill${days ? `?lookback=${days}` : ''}`, { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return setError(body.error || 'Could not load hours to bill')
      setData(body as Load)
    } catch {
      setError('Could not load hours to bill — check your connection')
    }
  }, [])
  React.useEffect(() => {
    void load(lookback)
  }, [load, lookback])

  async function approve(t: Target, days: Array<{ date: string; edit?: unknown }>, send = false): Promise<boolean> {
    setBusy(t.key)
    try {
      const res = await fetch('/api/ops/hours-to-bill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: { kind: t.kind, id: t.id }, days, send }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error || 'Could not bill these hours')
        await load(lookback)
        return false
      }
      setMade((m) => ({ ...m, [t.key]: body as Made }))
      toast.success(`Invoice ${(body as Made).invoiceNumber} made`)
      await load(lookback)
      return true
    } catch {
      toast.error('Connection lost — try again; nothing is billed twice')
      return false
    } finally {
      setBusy(null)
    }
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
  if (!data) return <p className="mx-auto max-w-3xl p-4 text-ui-base text-ink">Loading hours to bill…</p>

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-24">
      <header>
        <h1 className="text-ui-xl font-semibold text-ink">Hours to bill</h1>
        <p className="text-ui-base text-ink">Work billed by the hour, day by day (last {data.lookbackDays} days). Pay is never changed here.</p>
      </header>

      {data.targets.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-ui-base text-ink">
            Nothing billed by the hour yet. Open a job and set “Billed: by the hour”, or bill a service plan “per hour”.
          </CardContent>
        </Card>
      ) : null}

      {data.targets.map((t) => {
        const open = t.days.filter(waiting)
        const done = t.days.filter((d) => !waiting(d))
        const chosen = open.filter((d) => d.status === 'ready' && !unticked.has(dayKey(t, d.date)))
        const chosenTotal = chosen.reduce((n, d) => n + totalFor(d.lines, d.date, data, t), 0)
        const result = made[t.key]
        return (
          <Card key={t.key}>
            <CardContent className="space-y-3 p-4 text-ink">
              <div>
                <p className="text-ui-lg font-semibold">{t.customerName}</p>
                <p className="text-ui-sm">
                  {t.title}
                  {t.address ? ` · ${t.address}` : ''}
                </p>
                {t.kind === 'job' ? (
                  <p className="text-ui-sm">
                    {t.estimatedHours != null ? `Estimate ${hoursLabel(t.estimatedHours)} h · ` : ''}billed {hoursLabel(t.billedHours)} h
                    {t.estimatedHours != null && t.billedHours > t.estimatedHours ? (
                      <Badge tone="warning" className="ml-2">
                        over estimate
                      </Badge>
                    ) : null}
                  </p>
                ) : null}
                {!t.labor ? <p className="mt-1 text-ui-sm font-semibold text-danger">{t.kind === 'job' ? 'No labor rate on this job — set it on the job page.' : 'This plan has no hourly rate — set its price.'}</p> : null}
              </div>

              {result ? (
                <p className="rounded-ui bg-surface-subtle p-2 text-ui-base">
                  Made{' '}
                  <a className="font-semibold text-brand-800 underline" href={`/invoices/${result.invoiceId}/print`} target="_blank" rel="noreferrer">
                    {result.invoiceNumber}
                  </a>{' '}
                  · {formatCurrency(result.totalCents)}
                  {result.sent ? ' · emailed' : result.isJobInvoice ? ' · a draft on the job — send it from the job' : ` · draft${result.sendError ? ` (${result.sendError})` : ''}`}
                </p>
              ) : null}

              {open.length > 0 ? (
                <ul className="divide-y divide-surface-line rounded-ui border border-surface-line">
                  {open.map((d) => {
                    const key = dayKey(t, d.date)
                    const amount = totalFor(d.lines, d.date, data, t)
                    return (
                      <li key={key} className="flex items-center gap-3 px-3 py-2">
                        {d.status === 'ready' ? (
                          <input
                            type="checkbox"
                            className="h-6 w-6 shrink-0"
                            aria-label={`Bill ${invoiceItemDateLabel(d.date)}`}
                            checked={!unticked.has(key)}
                            onChange={() =>
                              setUnticked((prev) => {
                                const next = new Set(prev)
                                if (next.has(key)) next.delete(key)
                                else next.add(key)
                                return next
                              })
                            }
                          />
                        ) : (
                          <span className="h-6 w-6 shrink-0" aria-hidden />
                        )}
                        <button type="button" className="flex min-h-tap flex-1 items-center justify-between gap-2 text-left" onClick={() => setSheet({ target: t, day: d })}>
                          <span>
                            <span className="block text-ui-base font-semibold">{invoiceItemDateLabel(d.date)}</span>
                            <span className="block text-ui-sm">
                              {d.status === 'no_time' ? 'No clock time — tap to type the hours' : d.status === 'open' && d.lines.length === 0 ? 'Bill it once everyone clocks out' : summary(d.lines)}
                            </span>
                            {d.status === 'open' ? <Badge tone="warning">Still clocked in</Badge> : null}
                            {d.needsReview ? <Badge tone="warning" className="ml-1">Check: a clock was stopped automatically</Badge> : null}
                          </span>
                          <span className="text-ui-base font-semibold tabular-nums">{d.status === 'no_time' ? 'Type' : d.status === 'open' && d.lines.length === 0 ? '—' : formatCurrency(amount)}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="text-ui-base">Nothing waiting.</p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {chosen.length > 0 ? (
                  <Button
                    loading={busy === t.key}
                    disabled={!t.labor && chosen.some((d) => d.lines.some((l) => l.rateCents == null))}
                    onClick={() => void approve(t, chosen.slice(0, data.maxDaysPerApproval).map((d) => ({ date: d.date })))}
                  >
                    Bill {chosen.length} day{chosen.length === 1 ? '' : 's'} · {formatCurrency(chosenTotal)}
                  </Button>
                ) : null}
                {t.kind === 'job' ? (
                  <Button variant="secondary" onClick={() => setSheet({ target: t, day: null })}>
                    Type hours for a day
                  </Button>
                ) : null}
              </div>

              {done.length > 0 ? (
                <details className="text-ui-base">
                  <summary className="min-h-tap cursor-pointer font-semibold">Billed ({done.length})</summary>
                  <ul className="mt-1 space-y-1 text-ui-sm">
                    {done.map((d) => (
                      <li key={d.date} className="flex flex-wrap items-center gap-2">
                        <span>{invoiceItemDateLabel(d.date)}</span>
                        <span>· {hoursLabel(d.approval?.billableHours ?? dayBillableHours(d.lines))} h</span>
                        {d.approval?.source === 'typed' ? <Badge tone="info">Typed — no clock</Badge> : null}
                        {d.approval?.source === 'edited' ? <Badge tone="info">Changed: {d.approval.editReason}</Badge> : null}
                        {d.approval?.invoiceId ? (
                          <a className="inline-flex min-h-tap items-center font-semibold text-brand-800 underline" href={`/invoices/${d.approval.invoiceId}/print`} target="_blank" rel="noreferrer">
                            {d.approval.invoiceNumber}
                          </a>
                        ) : null}
                        {d.status === 'voided' && d.approval ? (
                          <>
                            <Badge tone="warning">invoice void</Badge>
                            <Button size="sm" variant="secondary" onClick={() => setUnapprove({ approval: d.approval! })}>
                              Un-approve to bill again
                            </Button>
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </CardContent>
          </Card>
        )
      })}

      {data.lookbackDays < LONG_LOOKBACK ? (
        <button type="button" className="min-h-tap text-ui-sm font-semibold text-brand-800 underline" onClick={() => setLookback(LONG_LOOKBACK)}>
          Look back further
        </button>
      ) : null}

      {sheet ? (
        <DaySheet
          data={data}
          target={sheet.target}
          day={sheet.day}
          busy={busy === sheet.target.key}
          onClose={() => setSheet(null)}
          onApprove={async (date, edit, send) => {
            if (await approve(sheet.target, [edit ? { date, edit } : { date }], send)) setSheet(null)
          }}
        />
      ) : null}

      {unapprove ? (
        <UnapproveDialog
          approval={unapprove.approval}
          onClose={() => setUnapprove(null)}
          onDone={async () => {
            setUnapprove(null)
            await load(lookback)
          }}
        />
      ) : null}
    </div>
  )
}

type Form = { date: string; people: string; each: string; crewHours: string; travel: string; machines: Array<{ itemId: string; hours: string }>; trip: boolean; reason: string; send: boolean }

function formFrom(day: Day | null, today: string, basis: HourlyBillingSettings['basis']): Form {
  const lines = day?.lines ?? []
  const labor = lines.find((l) => l.kind === 'labor')
  const people = labor?.people ?? 1
  return {
    date: day?.date ?? today,
    people: labor ? String(people) : '1',
    each: labor ? hoursLabel(Math.round((labor.hours / Math.max(1, people)) * 100) / 100) : '',
    crewHours: labor && basis === 'crew' ? hoursLabel(labor.hours) : '',
    travel: hoursLabel(lines.find((l) => l.kind === 'travel')?.hours ?? 0).replace(/^0$/, ''),
    machines: lines.filter((l) => l.kind === 'equipment' && l.itemId).map((l) => ({ itemId: l.itemId as string, hours: hoursLabel(l.hours) })),
    trip: lines.some((l) => l.kind === 'trip'),
    reason: '',
    send: false,
  }
}

function editFrom(f: Form, basis: HourlyBillingSettings['basis']): EditLine[] {
  const out: EditLine[] = []
  const people = Math.max(1, Math.round(Number(f.people) || 1))
  const labor = basis === 'crew' ? Number(f.crewHours) : Math.round(people * Number(f.each) * 100) / 100
  if (labor > 0) out.push({ kind: 'labor', people, hours: labor })
  const travel = Number(f.travel)
  if (travel > 0) out.push({ kind: 'travel', people, hours: Math.round(travel * 100) / 100 })
  for (const m of f.machines) if (Number(m.hours) > 0) out.push({ kind: 'equipment', itemId: m.itemId, hours: Number(m.hours) })
  if (f.trip) out.push({ kind: 'trip', hours: 1 })
  return out
}

function DaySheet({ data, target, day, busy, onClose, onApprove }: { data: Load; target: Target; day: Day | null; busy: boolean; onClose: () => void; onApprove: (date: string, edit: unknown | null, send: boolean) => void | Promise<void> }) {
  const basis = data.settings.basis
  const initial = React.useMemo(() => formFrom(day, data.today, basis), [day, data.today, basis])
  const [f, setF] = React.useState<Form>(initial)
  const [addMachine, setAddMachine] = React.useState('')
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }))
  const typed = !day || day.status === 'no_time'
  const changed = JSON.stringify({ ...f, reason: '', send: false }) !== JSON.stringify({ ...initial, reason: '', send: false })
  const needEdit = typed || changed || day?.status === 'open'

  // Prices come from the price book on the server; the preview uses the same rates.
  const ctx: BillContext = React.useMemo(() => {
    const equipment = new Map<string, Rate>(data.equipment.map((r) => [r.itemId as string, r]))
    for (const l of day?.lines ?? []) if (l.kind === 'equipment' && l.itemId && l.rateCents != null && !equipment.has(l.itemId)) equipment.set(l.itemId, { itemId: l.itemId, name: l.name, rateCents: l.rateCents, taxable: l.taxable })
    return { settings: data.settings, labor: target.labor, equipment, trip: data.trip }
  }, [data, target.labor, day])
  const editLines = editFrom(f, basis)
  const built = needEdit ? linesFromEdit({ lines: editLines, reason: f.reason }, ctx) : { lines: day?.lines ?? [] }
  const lines = 'lines' in built ? built.lines : []
  const total = lines.length ? totalFor(lines, f.date, data, target) : 0
  const reasonMissing = !typed && needEdit && !f.reason.trim()
  const future = f.date > data.today
  const blocked = 'error' in built ? built.error : lines.length === 0 ? 'Add hours to bill' : future ? 'That day hasn’t happened yet' : reasonMissing ? 'Say why the hours changed' : null
  const machineChoices = data.equipment.filter((r) => !f.machines.some((m) => m.itemId === r.itemId))

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={day ? `${target.customerName} — ${invoiceItemDateLabel(day.date)}` : `${target.customerName} — type hours`} description={target.title}>
        <div className="max-h-[65dvh] space-y-3 overflow-y-auto text-ink">
          {day && day.lines.length > 0 ? (
            <div className="rounded-ui bg-surface-subtle p-2 text-ui-sm">
              <p className="font-semibold">From the clock{day.clockedSeconds ? ` (${formatDuration(day.clockedSeconds)} worked)` : ''}:</p>
              <ul className="mt-1 space-y-1">
                {day.lines.map((l, i) => (
                  <li key={i}>
                    <span className="font-semibold">
                      {lineDescription(l)}
                      {l.kind === 'trip' ? '' : ` — ${hoursLabel(l.hours)} h`}
                    </span>
                    {l.reasons.length ? <span className="block">{l.reasons.join('; ')}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {typed ? <Badge tone="info">Typed — no clock time</Badge> : null}
          {!day ? (
            <Field label="Day worked">{(a) => <Input {...a} type="date" className="text-base" max={data.today} value={f.date} onChange={(e) => set({ date: e.target.value })} />}</Field>
          ) : null}
          {basis === 'crew' ? (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Crew size">{(a) => <Input {...a} inputMode="numeric" className="text-base" value={f.people} onChange={(e) => set({ people: e.target.value })} />}</Field>
              <Field label="Crew hours">{(a) => <Input {...a} inputMode="decimal" className="text-base" placeholder="6.5" value={f.crewHours} onChange={(e) => set({ crewHours: e.target.value })} />}</Field>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Field label="People">{(a) => <Input {...a} inputMode="numeric" className="text-base" value={f.people} onChange={(e) => set({ people: e.target.value })} />}</Field>
              <Field label="Hours each">{(a) => <Input {...a} inputMode="decimal" className="text-base" placeholder="6.5" value={f.each} onChange={(e) => set({ each: e.target.value })} />}</Field>
            </div>
          )}
          {data.settings.travel === 'yes' || Number(f.travel) > 0 ? (
            <Field label={basis === 'crew' ? 'Drive hours (crew)' : 'Drive hours (all people together)'}>
              {(a) => <Input {...a} inputMode="decimal" className="text-base" value={f.travel} onChange={(e) => set({ travel: e.target.value })} />}
            </Field>
          ) : null}
          {f.machines.map((m, i) => (
            <div key={m.itemId} className="flex items-end gap-2">
              <Field label={`${ctx.equipment.get(m.itemId)?.name ?? 'Machine'} hours`} className="flex-1">
                {(a) => <Input {...a} inputMode="decimal" className="text-base" value={m.hours} onChange={(e) => set({ machines: f.machines.map((x, j) => (j === i ? { ...x, hours: e.target.value } : x)) })} />}
              </Field>
              <Button variant="secondary" onClick={() => set({ machines: f.machines.filter((_, j) => j !== i) })}>
                Remove
              </Button>
            </div>
          ))}
          {machineChoices.length > 0 ? (
            <Field label="Add a machine">
              {(a) => (
                <Select
                  {...a}
                  className="text-base"
                  value={addMachine}
                  onChange={(e) => {
                    if (e.target.value) set({ machines: [...f.machines, { itemId: e.target.value, hours: f.each || f.crewHours || '' }] })
                    setAddMachine('')
                  }}
                >
                  <option value="">Pick a machine…</option>
                  {machineChoices.map((r) => (
                    <option key={r.itemId} value={r.itemId as string}>
                      {r.name} — {formatCurrency(r.rateCents)}/hr
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          {data.trip ? (
            <label className="flex min-h-tap items-center gap-3 text-ui-base">
              <input type="checkbox" className="h-6 w-6" checked={f.trip} onChange={(e) => set({ trip: e.target.checked })} />
              {data.trip.name} ({formatCurrency(data.trip.rateCents)})
            </label>
          ) : null}
          {!typed && needEdit ? (
            <Field label="Why did the hours change?">{(a) => <Textarea {...a} className="text-base" maxLength={500} value={f.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="e.g. Clock left running over lunch" />}</Field>
          ) : null}
          {typed ? (
            <Field label="Note (optional)">{(a) => <Input {...a} className="text-base" maxLength={500} value={f.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="e.g. Sub crew, hours from their sheet" />}</Field>
          ) : null}
          {target.kind === 'visit' ? (
            <label className="flex min-h-tap items-center gap-3 text-ui-base">
              <input type="checkbox" className="h-6 w-6" checked={f.send} onChange={(e) => set({ send: e.target.checked })} />
              Email the invoice to the customer now
            </label>
          ) : null}
          {lines.length > 0 ? (
            <ul className="space-y-1 text-ui-sm">
              {lines.map((l, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span>
                    {lineDescription(l)}
                    {l.kind === 'trip' ? '' : ` · ${hoursLabel(l.hours)} h × ${l.rateCents == null ? '—' : formatCurrency(l.rateCents)}`}
                  </span>
                  <span className="tabular-nums">{formatCurrency(lineAmountCents(l))}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {blocked ? <p className="text-ui-sm font-semibold text-danger">{blocked}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={!!blocked}
            onClick={() => void onApprove(f.date, needEdit ? { lines: editLines, reason: f.reason.trim() } : null, f.send)}
          >
            Approve & bill · {formatCurrency(total)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function UnapproveDialog({ approval, onClose, onDone }: { approval: Approval; onClose: () => void; onDone: () => void | Promise<void> }) {
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Un-approve these hours?" description={`${invoiceItemDateLabel(approval.date)} — invoice ${approval.invoiceNumber ?? ''} is void. The day goes back to “waiting” so it can be billed again.`}>
        <Field label="Why?">{(a) => <Textarea {...a} className="text-base" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={!reason.trim()}
            onClick={async () => {
              setBusy(true)
              const res = await fetch(`/api/ops/hours-to-bill/${approval.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) }).catch(() => null)
              const body = res ? await res.json().catch(() => ({})) : {}
              setBusy(false)
              if (!res || !res.ok) return void toast.error((body as { error?: string }).error || 'Could not un-approve')
              toast.success('Back to waiting')
              await onDone()
            }}
          >
            Un-approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
