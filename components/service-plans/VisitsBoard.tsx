'use client'

import * as React from 'react'
import Link from 'next/link'

import { Badge, Button, Card, CardContent, Dialog, DialogContent, DialogFooter, Field, Input, Select, Textarea, toast } from '@/components/ui'
import { formatDateWeekday } from '@/lib/format'
import { RESULT_TONE_CLASS, SERVICE_STEP, SKIP_REASONS, SKIP_REASON_LABELS, VISIT_STATUS_LABELS, addDaysYmd, type SkipReason, type VisitStatus } from '@/lib/service-plans'
import type { ShiftPreview, VisitView } from '@/lib/service-plans-db'
import { FileDropZone } from '@/components/ui/file-drop-zone'
import NewCustomerPlan from '@/components/service-plans/NewCustomerPlan'
import { uploadVisitPhotos } from '@/lib/visit-photo-upload'
import VisitIncentiveMarks from '@/components/service-plans/VisitIncentiveMarks'
import { checklistSummary } from '@/lib/visit-checklist'

type Crew = { id: string; name: string; hasPhoneLink: boolean; phone: string | null }
type Load = { today: string; from: string; to: string; visits: VisitView[]; total: number; hasMore: boolean; canEdit: boolean; crews: Crew[]; incentiveMarks?: Record<string, { review: boolean; callback: boolean }> }
type Sheet =
  | { kind: 'done'; visit: VisitView; result: string | null; notes: string }
  | { kind: 'skip'; visit: VisitView; reason: SkipReason | ''; notes: string }
  | { kind: 'move'; visit: VisitView; date: string }
  | { kind: 'shift'; from: string; to: string; move: 'next' | 'after' | 'pick'; date: string; crew: string; preview: ShiftPreview | null }
  | { kind: 'links'; made: Record<string, string> }
  | { kind: 'photos'; visit: VisitView; photos: Array<{ id: string; filename: string; created_at: string }> | null }

const STATUS_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'info'> = { scheduled: 'info', completed: 'success', skipped: 'warning', cancelled: 'neutral' }

/** Days between two calendar days (b − a). */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)
}

function shiftDays(sh: Extract<Sheet, { kind: 'shift' }>): number {
  return sh.move === 'next' ? 1 : sh.move === 'after' ? 2 : sh.date ? daysBetween(sh.from, sh.date) : 0
}

function smsHref(phone: string | null, body: string): string {
  const to = (phone ?? '').replace(/[^\d+]/g, '')
  // iOS and Android both read "?&body=" / "?body="; "&" keeps iOS happy when there is a number.
  return `sms:${to}${to ? '?&' : '?'}body=${encodeURIComponent(body)}`
}

function mapHref(v: Pick<VisitView, 'lat' | 'lng' | 'address'>): string {
  const q = v.lat != null && v.lng != null ? `${v.lat},${v.lng}` : v.address ?? ''
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
}

/**
 * Jobs → Schedule → Visits: every service-plan visit for a week, by day, in each crew's stop order. Mark done (an
 * inspection needs green / yellow / red), skip with a reason, move one visit, change its crew, or move a whole day (or
 * days) at once — the rain / hurricane button. Crew phone links are made here too. Data: /api/ops/visits.
 */
export default function VisitsBoard() {
  const [from, setFrom] = React.useState<string | null>(null)
  const [crew, setCrew] = React.useState('')
  const [data, setData] = React.useState<Load | null>(null)
  const dataRef = React.useRef<Load | null>(null)
  dataRef.current = data
  const [failed, setFailed] = React.useState(false)
  const [sheet, setSheet] = React.useState<Sheet | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [open, setOpen] = React.useState<Set<string>>(new Set())
  const toggle = (id: string) => setOpen((o) => {
    const n = new Set(o)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })

  const load = React.useCallback(async (more = false) => {
    const q = new URLSearchParams()
    if (from) {
      q.set('from', from)
      q.set('to', addDaysYmd(from, 6))
    }
    if (crew) q.set('crew', crew)
    if (more && dataRef.current) q.set('offset', String(dataRef.current.visits.length))
    const res = await fetch(`/api/ops/visits?${q}`, { cache: 'no-store' }).catch(() => null)
    if (!res || !res.ok) return setFailed(true)
    setFailed(false)
    const next = (await res.json()) as Load
    // "Load more" appends the next page; anything else (refresh after a save, filters) starts over.
    setData((prev) => (more && prev ? { ...next, visits: [...prev.visits, ...next.visits.filter((v) => !prev.visits.some((p) => p.id === v.id))] } : next))
  }, [from, crew])
  React.useEffect(() => {
    void load()
  }, [load])

  async function post(url: string, body: unknown, done: string): Promise<boolean> {
    setBusy(true)
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const out = (res ? await res.json().catch(() => ({})) : {}) as { error?: string; moved?: number; path?: string }
    setBusy(false)
    if (!res || !res.ok) {
      toast.error(out.error || 'Could not save')
      return false
    }
    toast.success(out.moved !== undefined ? `${out.moved} visit${out.moved === 1 ? '' : 's'} moved` : done)
    await load()
    return true
  }

  async function previewShift(body: { from: string; to: string; days: number; subId: string }, sheet: Extract<Sheet, { kind: 'shift' }>) {
    setBusy(true)
    const res = await fetch('/api/ops/visits/shift', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, preview: true }) }).catch(() => null)
    const out = (res ? await res.json().catch(() => ({})) : {}) as { error?: string; preview?: ShiftPreview }
    setBusy(false)
    if (!res || !res.ok || !out.preview) return toast.error(out.error || 'Could not check those visits')
    const preview = out.preview
    setSheet((cur) => (cur && cur.kind === 'shift' && cur.from === sheet.from && cur.to === sheet.to && cur.move === sheet.move && cur.date === sheet.date && cur.crew === sheet.crew ? { ...cur, preview } : cur))
  }

  async function makeLink(c: Crew) {
    setBusy(true)
    const res = await fetch(`/api/ops/subs/${c.id}/crew-day-link`, { method: 'POST' }).catch(() => null)
    const out = (res ? await res.json().catch(() => ({})) : {}) as { error?: string; path?: string }
    setBusy(false)
    if (!res || !res.ok || !out.path) return toast.error(out.error || 'Could not make the link')
    const url = `${window.location.origin}${out.path}`
    setSheet((s) => (s && s.kind === 'links' ? { ...s, made: { ...s.made, [c.id]: url } } : s))
    await load()
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link copied')
    } catch {
      toast.error('Couldn’t copy — press and hold the link to copy it')
    }
  }

  async function onPhotos(id: string, files: File[]) {
    if (files.length === 0) return
    setBusy(true)
    const r = await uploadVisitPhotos(`/api/ops/visits/${id}/photos`, files)
    setBusy(false)
    if (r.uploaded) toast.success(`${r.uploaded} photo${r.uploaded === 1 ? '' : 's'} added`)
    if (r.error) toast.error(r.error)
    await load()
  }

  async function openPhotos(v: VisitView) {
    setSheet({ kind: 'photos', visit: v, photos: null })
    const res = await fetch(`/api/ops/visits/${v.id}/photos`, { cache: 'no-store' }).catch(() => null)
    const out = (res && res.ok ? await res.json().catch(() => ({})) : {}) as { photos?: Array<{ id: string; filename: string; created_at: string }> }
    setSheet((s) => (s && s.kind === 'photos' && s.visit.id === v.id ? { ...s, photos: out.photos ?? [] } : s))
  }

  if (failed) return <p className="px-4 py-6 text-ui-base text-ink">Visits couldn’t load. Refresh to try again.</p>
  if (!data) return <p className="px-4 py-6 text-ui-base text-ink">Loading visits…</p>
  const d = data
  const days = Array.from({ length: 7 }, (_, i) => addDaysYmd(d.from, i))
  const byDay = new Map(days.map((day) => [day, d.visits.filter((v) => v.scheduledDate === day)]))

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-4">
      <div className="flex flex-wrap items-end gap-2">
        <Button variant="secondary" size="sm" onClick={() => setFrom(addDaysYmd(d.from, -7))}>← Week before</Button>
        <Button variant="secondary" size="sm" onClick={() => setFrom(null)}>This week</Button>
        <Button variant="secondary" size="sm" onClick={() => setFrom(addDaysYmd(d.from, 7))}>Week after →</Button>
        <Select aria-label="Crew" className="max-w-[14rem] text-base" value={crew} onChange={(e) => setCrew(e.target.value)}>
          <option value="">All crews</option>
          <option value="mine">My visits</option>
          <option value="none">No crew</option>
          {d.crews.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
        {d.canEdit ? (
          <>
            <Button size="sm" onClick={() => setSheet({ kind: 'shift', from: addDaysYmd(d.today, 1), to: addDaysYmd(d.today, 1), move: 'next', date: '', crew: crew && crew !== 'mine' ? crew : 'all', preview: null })}>Rain day — move visits</Button>
            <Button size="sm" variant="secondary" onClick={() => setSheet({ kind: 'links', made: {} })}>Crew phone links</Button>
            <NewCustomerPlan onCreated={() => void load()} />
          </>
        ) : null}
      </div>

      {d.total > d.visits.length ? (
        <p className="text-ui-base font-semibold text-ink">
          Showing {d.visits.length} of {d.total} visits this week.{' '}
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void load(true)}>Load more</Button>
        </p>
      ) : null}
      {days.map((day) => {
        const list = byDay.get(day) ?? []
        return (
          <section key={day} aria-label={formatDateWeekday(day)}>
            <h2 className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-ui-lg font-semibold text-ink">
              <span>
                {formatDateWeekday(day)}
                {day === d.today ? ' · Today' : ''} <span className="text-ui-base font-normal">({list.length})</span>
              </span>
              {/* The same paper a crew prints from its phone link: one crew, one day (pick a crew above first). */}
              {crew && crew !== 'mine' && crew !== 'none' && list.some((v) => v.status === 'scheduled') ? (
                <a href={`/api/ops/visits/sheet?crew=${encodeURIComponent(crew)}&day=${day}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-tap items-center text-ui-base font-semibold text-brand-800 underline">
                  Print sheet
                </a>
              ) : null}
            </h2>
            {list.length === 0 ? (
              <p className="text-ui-base text-ink">No visits.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {list.map((v) => (
                  <li key={v.id}>
                    <Card>
                      <CardContent className="flex flex-col gap-1 p-3">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <p className="text-ui-base font-semibold text-ink">
                            {v.routePosition ? `${v.routePosition}. ` : ''}
                            {v.customerId ? (
                              <Link href={`/c/${v.customerId}`} className="underline">{v.customerName ?? 'Customer'}</Link>
                            ) : (
                              v.customerName ?? ''
                            )}
                          </p>
                          <Badge tone={STATUS_TONE[v.status] ?? 'neutral'}>{VISIT_STATUS_LABELS[v.status as VisitStatus] ?? v.status}</Badge>
                          {v.result ? <span className={`rounded-full px-2.5 py-0.5 text-ui-sm font-semibold ${RESULT_TONE_CLASS[v.result.tone]}`}>{v.result.label}</span> : null}
                          {v.moved ? <Badge tone="warning">Moved from {formatDateWeekday(v.plannedDate)}</Badge> : null}
                        </div>
                        <p className="break-words text-ui-sm text-ink">
                          {[v.step !== SERVICE_STEP ? `${v.stepLabel ?? 'Follow-on'} — ${v.planName}` : v.planName, v.address, v.subName ?? v.userName ?? 'No crew'].filter(Boolean).join(' · ')}
                          {v.skipReason ? ` · ${SKIP_REASON_LABELS[v.skipReason as SkipReason] ?? v.skipReason}` : ''}
                          {v.photoCount ? ` · ${v.photoCount} photo${v.photoCount === 1 ? '' : 's'}` : ''}
                          {v.address || v.lat != null ? (
                            <>
                              {' '}
                              <a href={mapHref(v)} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-800 underline">Map</a>
                            </>
                          ) : null}
                        </p>
                        {v.accessNotes && v.status === 'scheduled' ? <p className="whitespace-pre-wrap break-words rounded-ui bg-brand-50 px-3 py-1 text-ui-sm text-brand-900"><span className="font-semibold">Access: </span>{v.accessNotes}</p> : null}
                        {v.notes ? <p className="break-words text-ui-sm text-ink">Note: {v.notes}</p> : null}
                        {v.checklist.length > 0 && (v.status !== 'scheduled' || v.checklist.some((c) => c.done)) ? (
                          <p className="break-words text-ui-sm text-ink">
                            <span className="font-semibold">{v.status === 'scheduled' ? 'Checked so far: ' : 'Services: '}</span>
                            {checklistSummary(v.checklist)}
                          </p>
                        ) : null}
                        {d.canEdit ? (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {v.status === 'scheduled' ? (
                              <>
                                <Button size="sm" onClick={() => setSheet({ kind: 'done', visit: v, result: null, notes: '' })}>Done</Button>
                                <Button size="sm" variant="secondary" onClick={() => setSheet({ kind: 'skip', visit: v, reason: '', notes: '' })}>Skip</Button>
                                <Button size="sm" variant="secondary" onClick={() => setSheet({ kind: 'move', visit: v, date: v.scheduledDate })}>Move</Button>
                              </>
                            ) : v.status !== 'cancelled' ? (
                              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void post(`/api/ops/visits/${v.id}`, { action: 'reopen' }, 'Visit reopened')}>Reopen</Button>
                            ) : null}
                            <Button size="sm" variant="ghost" className="underline" aria-expanded={open.has(v.id)} onClick={() => toggle(v.id)}>
                              {open.has(v.id) ? 'Less' : 'More'}
                            </Button>
                          </div>
                        ) : null}
                        {d.canEdit && open.has(v.id) ? (
                          <div className="flex flex-col gap-2 border-t border-surface-line pt-2">
                            {v.status === 'scheduled' && v.step === SERVICE_STEP ? (
                              <Select aria-label="Crew for this visit" className="min-h-tap text-base" value={v.subId ?? ''} disabled={busy} onChange={(e) => void post(`/api/ops/visits/${v.id}`, { action: 'assign', subId: e.target.value || null }, 'Crew changed')}>
                                <option value="">No crew</option>
                                {d.crews.map((c) => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                              </Select>
                            ) : null}
                            {d.incentiveMarks && v.status === 'completed' ? (
                              <VisitIncentiveMarks workOrderId={v.id} initial={d.incentiveMarks[v.id] ?? { review: false, callback: false }} onChanged={() => void load()} />
                            ) : null}
                            <FileDropZone compact accept="image/*" disabled={busy} label="Add photos (drop or tap)" onFiles={(files) => void onPhotos(v.id, files)} />
                            {v.photoCount ? (
                              <Button size="sm" variant="ghost" className="self-start underline" onClick={() => void openPhotos(v)}>
                                See photos ({v.photoCount})
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}

      {sheet?.kind === 'photos' ? (
        <Dialog open onOpenChange={(o) => !o && setSheet(null)}>
          <DialogContent title={`Photos — ${sheet.visit.planName}`}>
            {sheet.photos === null ? (
              <p className="text-ui-base text-ink">Loading…</p>
            ) : sheet.photos.length === 0 ? (
              <p className="text-ui-base text-ink">No photos.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {sheet.photos.map((ph, i) => (
                  <li key={ph.id}>
                    <a className="inline-flex min-h-tap items-center text-ui-base font-semibold text-brand-800 underline" href={`/api/ops/visits/${sheet.visit.id}/photos/${ph.id}`} target="_blank" rel="noopener noreferrer">
                      Photo {i + 1} — {ph.filename}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button variant="secondary" onClick={() => setSheet(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {sheet && sheet.kind !== 'links' && sheet.kind !== 'photos' ? (
        <Dialog open onOpenChange={(o) => !o && !busy && setSheet(null)}>
          <DialogContent
            title={sheet.kind === 'done' ? (sheet.visit.resultOptions.length ? 'How did it go?' : 'Mark done') : sheet.kind === 'skip' ? 'Skip this visit' : sheet.kind === 'move' ? 'Move this visit' : 'Move visits'}
            description={sheet.kind === 'shift' ? 'Every visit still scheduled on those days moves by the same number of days. You see the list before anything moves. Done, skipped and billed visits stay.' : undefined}
          >
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                const close = (ok: boolean) => ok && setSheet(null)
                if (sheet.kind === 'done') void post(`/api/ops/visits/${sheet.visit.id}`, { action: 'done', result: sheet.result ?? undefined, notes: sheet.notes }, 'Visit done').then(close)
                if (sheet.kind === 'skip' && sheet.reason) void post(`/api/ops/visits/${sheet.visit.id}`, { action: 'skip', reason: sheet.reason, notes: sheet.notes }, 'Visit skipped').then(close)
                if (sheet.kind === 'move') void post(`/api/ops/visits/${sheet.visit.id}`, { action: 'move', date: sheet.date }, 'Visit moved').then(close)
                if (sheet.kind === 'shift') {
                  const body = { from: sheet.from, to: sheet.to, days: shiftDays(sheet), subId: sheet.crew }
                  // Step 1 shows what WOULD move (nothing is written); step 2 moves exactly that many.
                  if (!sheet.preview) void previewShift(body, sheet)
                  else void post('/api/ops/visits/shift', { ...body, expectKey: sheet.preview.selectionKey }, '').then(close)
                }
              }}
            >
              {sheet.kind === 'done' && sheet.visit.resultOptions.length ? (
                <div className="grid grid-cols-1 gap-2">
                  {sheet.visit.resultOptions.map((r) => (
                    <button key={r.key} type="button" aria-pressed={sheet.result === r.key} className={`min-h-tap rounded-ui px-3 text-left text-ui-base font-semibold ${RESULT_TONE_CLASS[r.tone]} ${sheet.result === r.key ? 'ring-4 ring-brand-600' : ''}`} onClick={() => setSheet({ ...sheet, result: r.key })}>
                      {r.label}
                    </button>
                  ))}
                </div>
              ) : null}
              {sheet.kind === 'skip' ? (
                <Field label="Why?">
                  {(a) => (
                    <Select {...a} className="text-base" value={sheet.reason} onChange={(e) => setSheet({ ...sheet, reason: e.target.value as SkipReason })}>
                      <option value="">Pick a reason</option>
                      {SKIP_REASONS.map((r) => (
                        <option key={r} value={r}>{SKIP_REASON_LABELS[r]}</option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : null}
              {sheet.kind === 'done' || sheet.kind === 'skip' ? (
                <Field label={sheet.kind === 'skip' && sheet.reason === 'other' ? 'Note (required)' : 'Note (optional)'}>{(a) => <Textarea {...a} className="text-base" maxLength={2000} value={sheet.notes} onChange={(e) => setSheet({ ...sheet, notes: e.target.value })} />}</Field>
              ) : null}
              {sheet.kind === 'move' ? <Field label="New day">{(a) => <Input {...a} type="date" className="text-base" value={sheet.date} onChange={(e) => setSheet({ ...sheet, date: e.target.value })} />}</Field> : null}
              {sheet.kind === 'shift' ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="From">{(a) => <Input {...a} type="date" className="text-base" value={sheet.from} onChange={(e) => setSheet({ ...sheet, from: e.target.value, to: sheet.to < e.target.value ? e.target.value : sheet.to, preview: null })} />}</Field>
                    <Field label="Through">{(a) => <Input {...a} type="date" className="text-base" value={sheet.to} min={sheet.from} onChange={(e) => setSheet({ ...sheet, to: e.target.value, preview: null })} />}</Field>
                  </div>
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-1 text-ui-sm font-semibold text-ink">Move them to</legend>
                    <div className="grid grid-cols-3 gap-2">
                      {([['next', 'Next day'], ['after', 'Day after'], ['pick', 'Pick a day']] as const).map(([k, label]) => (
                        <button key={k} type="button" aria-pressed={sheet.move === k} className={`min-h-tap rounded-ui border-2 px-2 text-ui-base font-semibold ${sheet.move === k ? 'border-ink bg-ink text-white' : 'border-surface-line bg-surface text-ink'}`} onClick={() => setSheet({ ...sheet, move: k, preview: null })}>
                          {label}
                        </button>
                      ))}
                    </div>
                    {sheet.move === 'pick' ? <Field label="New day for the first one">{(a) => <Input {...a} type="date" className="text-base" value={sheet.date} onChange={(e) => setSheet({ ...sheet, date: e.target.value, preview: null })} />}</Field> : null}
                    <p className="text-ui-sm text-ink">
                      {shiftDays(sheet) ? `Every visit moves ${Math.abs(shiftDays(sheet))} day${Math.abs(shiftDays(sheet)) === 1 ? '' : 's'} ${shiftDays(sheet) > 0 ? 'later' : 'earlier'}.` : 'Pick the new day.'}
                    </p>
                  </fieldset>
                  <Field label="Which crew">
                    {(a) => (
                      <Select {...a} className="text-base" value={sheet.crew} onChange={(e) => setSheet({ ...sheet, crew: e.target.value, preview: null })}>
                        <option value="all">All crews</option>
                        <option value="none">No crew</option>
                        {d.crews.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  {sheet.preview ? (
                    <div className="flex flex-col gap-2 rounded-ui border-2 border-ink bg-surface p-3 text-ui-base text-ink" role="status" aria-live="polite">
                      <p className="font-semibold">
                        {sheet.preview.count === 0 ? 'No scheduled visits on those days.' : `${sheet.preview.count} visit${sheet.preview.count === 1 ? '' : 's'} will move.`}
                      </p>
                      {sheet.preview.landing.length ? (
                        <p>
                          Landing: {sheet.preview.landing.map((l) => `${formatDateWeekday(l.day)} (${l.count})`).join(', ')}
                        </p>
                      ) : null}
                      {sheet.preview.sample.length ? (
                        <ul className="flex flex-col gap-1">
                          {sheet.preview.sample.map((v) => (
                            <li key={v.id}>
                              {v.customer ?? v.what} · {formatDateWeekday(v.from)} → {formatDateWeekday(v.to)}
                              {v.crew ? ` · ${v.crew}` : ''}
                            </li>
                          ))}
                          {sheet.preview.count > sheet.preview.sample.length ? <li>…and {sheet.preview.count - sheet.preview.sample.length} more</li> : null}
                        </ul>
                      ) : null}
                      {sheet.preview.staying.done + sheet.preview.staying.skipped > 0 ? (
                        <p>
                          Staying put: {sheet.preview.staying.done} done, {sheet.preview.staying.skipped} skipped (finished and billed visits never move).
                        </p>
                      ) : null}
                      {sheet.preview.intoPast > 0 ? <p className="font-semibold">That would put {sheet.preview.intoPast} visit{sheet.preview.intoPast === 1 ? '' : 's'} on a day that already passed. Pick a later day.</p> : null}
                    </div>
                  ) : null}
                </>
              ) : null}
              <DialogFooter className="sticky bottom-0 bg-surface pt-2">
                <Button type="button" variant="secondary" disabled={busy} onClick={() => setSheet(null)}>Cancel</Button>
                <Button
                  type="submit"
                  loading={busy}
                  disabled={
                    (sheet.kind === 'done' && sheet.visit.resultOptions.length > 0 && !sheet.result) ||
                    (sheet.kind === 'skip' && (!sheet.reason || (sheet.reason === 'other' && !sheet.notes.trim()))) ||
                    (sheet.kind === 'shift' && (!shiftDays(sheet) || Math.abs(shiftDays(sheet)) > 30 || !sheet.from || (sheet.preview !== null && (sheet.preview.count === 0 || sheet.preview.intoPast > 0))))
                  }
                >
                  {sheet.kind === 'done' ? 'Save' : sheet.kind === 'skip' ? 'Skip visit' : sheet.kind === 'shift' ? (sheet.preview ? `Move ${sheet.preview.count} visit${sheet.preview.count === 1 ? '' : 's'}` : 'Preview') : 'Move'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}

      {sheet?.kind === 'links' ? (
        <Dialog open onOpenChange={(o) => !o && !busy && setSheet(null)}>
          <DialogContent title="Crew phone links" description="Each crew gets one link that shows only their visits for today, with addresses, gate codes, Done, Skip and photos. Making a new link turns the old one off.">
            <ul className="flex flex-col gap-2">
              {d.crews.map((c) => {
                const url = sheet.made[c.id]
                return (
                  <li key={c.id} className="flex flex-col gap-2 border-b border-surface-line pb-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-ui-base font-semibold text-ink">{c.name}</span>
                      {!url ? (
                        <Button size="sm" variant={c.hasPhoneLink ? 'secondary' : 'primary'} loading={busy} onClick={() => void makeLink(c)}>
                          {c.hasPhoneLink ? 'New link (old one stops)' : 'Make link'}
                        </Button>
                      ) : null}
                    </div>
                    {url ? (
                      <>
                        <p className="break-all rounded-ui bg-surface-subtle px-3 py-2 text-ui-sm text-ink">{url}</p>
                        <div className="grid grid-cols-2 gap-2">
                          <Button size="sm" variant="secondary" onClick={() => void copy(url)}>Copy</Button>
                          <a className="inline-flex min-h-tap items-center justify-center rounded-ui bg-brand-700 px-3 text-ui-base font-semibold text-white" href={smsHref(c.phone, `Your visits for today: ${url}`)}>
                            Text{c.phone ? ' the crew' : ''}
                          </a>
                        </div>
                      </>
                    ) : null}
                  </li>
                )
              })}
            </ul>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setSheet(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}
