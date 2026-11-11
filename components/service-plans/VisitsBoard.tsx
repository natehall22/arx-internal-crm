'use client'

import * as React from 'react'
import Link from 'next/link'

import { Badge, Button, Card, CardContent, Dialog, DialogContent, DialogFooter, Field, Input, Select, Textarea, toast } from '@/components/ui'
import { formatDateWeekday } from '@/lib/format'
import { HEALTH_RESULTS, HEALTH_RESULT_STYLE, type HealthResult } from '@/lib/health-result'
import { SKIP_REASONS, SKIP_REASON_LABELS, VISIT_STATUS_LABELS, addDaysYmd, type SkipReason, type VisitStatus } from '@/lib/service-plans'
import type { VisitView } from '@/lib/service-plans-db'
import { uploadVisitPhotos } from '@/lib/visit-photo-upload'

type Crew = { id: string; name: string; hasPhoneLink: boolean }
type Load = { today: string; from: string; to: string; visits: VisitView[]; canEdit: boolean; crews: Crew[] }
type Sheet =
  | { kind: 'done'; visit: VisitView; result: HealthResult | null; notes: string }
  | { kind: 'skip'; visit: VisitView; reason: SkipReason | ''; notes: string }
  | { kind: 'move'; visit: VisitView; date: string }
  | { kind: 'shift'; from: string; to: string; days: string; crew: string }
  | { kind: 'links' }
  | { kind: 'photos'; visit: VisitView; photos: Array<{ id: string; filename: string; created_at: string }> | null }

const STATUS_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'info'> = { scheduled: 'info', completed: 'success', skipped: 'warning', cancelled: 'neutral' }

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
  const [failed, setFailed] = React.useState(false)
  const [sheet, setSheet] = React.useState<Sheet | null>(null)
  const [busy, setBusy] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const photoFor = React.useRef<string | null>(null)

  const load = React.useCallback(async () => {
    const q = new URLSearchParams()
    if (from) {
      q.set('from', from)
      q.set('to', addDaysYmd(from, 6))
    }
    if (crew) q.set('crew', crew)
    const res = await fetch(`/api/ops/visits?${q}`, { cache: 'no-store' }).catch(() => null)
    if (!res || !res.ok) return setFailed(true)
    setFailed(false)
    setData((await res.json()) as Load)
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

  async function makeLink(c: Crew) {
    setBusy(true)
    const res = await fetch(`/api/ops/subs/${c.id}/crew-day-link`, { method: 'POST' }).catch(() => null)
    const out = (res ? await res.json().catch(() => ({})) : {}) as { error?: string; path?: string }
    setBusy(false)
    if (!res || !res.ok || !out.path) return toast.error(out.error || 'Could not make the link')
    const url = `${window.location.origin}${out.path}`
    try {
      await navigator.clipboard.writeText(url)
      toast.success(`Link for ${c.name} copied — text it to the crew. Any older link stopped working.`)
    } catch {
      window.prompt(`Link for ${c.name} (copy it):`, url)
    }
    await load()
  }

  async function onPhotos(files: FileList | null) {
    const id = photoFor.current
    if (!id || !files || files.length === 0) return
    setBusy(true)
    const r = await uploadVisitPhotos(`/api/ops/visits/${id}/photos`, Array.from(files))
    setBusy(false)
    if (r.uploaded) toast.success(`${r.uploaded} photo${r.uploaded === 1 ? '' : 's'} added`)
    if (r.error) toast.error(r.error)
    if (fileRef.current) fileRef.current.value = ''
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
            <Button size="sm" onClick={() => setSheet({ kind: 'shift', from: d.today, to: d.today, days: '1', crew: crew && crew !== 'mine' ? crew : 'all' })}>Move a day’s visits</Button>
            <Button size="sm" variant="secondary" onClick={() => setSheet({ kind: 'links' })}>Crew phone links</Button>
          </>
        ) : null}
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple className="sr-only" aria-label="Add photos" onChange={(e) => void onPhotos(e.target.files)} />

      {days.map((day) => {
        const list = byDay.get(day) ?? []
        return (
          <section key={day} aria-label={formatDateWeekday(day)}>
            <h2 className="mb-2 text-ui-lg font-semibold text-ink">
              {formatDateWeekday(day)}
              {day === d.today ? ' · Today' : ''} <span className="text-ui-base font-normal">({list.length})</span>
            </h2>
            {list.length === 0 ? (
              <p className="text-ui-base text-ink">No visits.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {list.map((v) => (
                  <li key={v.id}>
                    <Card>
                      <CardContent className="flex flex-col gap-1.5 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-ui-base font-semibold text-ink">
                            {v.routePosition ? `${v.routePosition}. ` : ''}
                            {v.step === 'inspection' ? `Inspection — ${v.planName}` : v.planName}
                          </p>
                          <Badge tone={STATUS_TONE[v.status] ?? 'neutral'}>{VISIT_STATUS_LABELS[v.status as VisitStatus] ?? v.status}</Badge>
                          {v.healthResult ? <span className={`rounded-full px-2.5 py-0.5 text-ui-sm font-semibold ${HEALTH_RESULT_STYLE[v.healthResult as HealthResult]?.cls ?? ''}`}>{HEALTH_RESULT_STYLE[v.healthResult as HealthResult]?.short ?? v.healthResult}</span> : null}
                          {v.moved ? <Badge tone="warning">Moved from {formatDateWeekday(v.plannedDate)}</Badge> : null}
                        </div>
                        <p className="break-words text-ui-base text-ink">
                          {v.customerId ? (
                            <Link href={`/c/${v.customerId}`} className="font-semibold underline">{v.customerName ?? 'Customer'}</Link>
                          ) : null}
                          {v.address ? ` · ${v.address}` : ''}{' '}
                          {v.address || v.lat != null ? (
                            <a href={mapHref(v)} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-800 underline">Map</a>
                          ) : null}
                        </p>
                        {v.accessNotes ? <p className="whitespace-pre-wrap break-words rounded-ui bg-brand-50 px-3 py-1.5 text-ui-base text-brand-900"><span className="font-semibold">Access: </span>{v.accessNotes}</p> : null}
                        <p className="text-ui-sm text-ink">
                          {v.subName ?? v.userName ?? 'No crew'}
                          {v.skipReason ? ` · ${SKIP_REASON_LABELS[v.skipReason as SkipReason] ?? v.skipReason}` : ''}
                          {v.notes ? ` · ${v.notes}` : ''}
                          {v.photoCount ? ` · ${v.photoCount} photo${v.photoCount === 1 ? '' : 's'}` : ''}
                        </p>
                        {d.canEdit ? (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {v.status === 'scheduled' ? (
                              <>
                                <Button size="sm" onClick={() => setSheet({ kind: 'done', visit: v, result: null, notes: '' })}>Done</Button>
                                <Button size="sm" variant="secondary" onClick={() => setSheet({ kind: 'skip', visit: v, reason: '', notes: '' })}>Skip</Button>
                                <Button size="sm" variant="secondary" onClick={() => setSheet({ kind: 'move', visit: v, date: v.scheduledDate })}>Move</Button>
                                {v.step === 'service' ? (
                                  <Select aria-label="Crew for this visit" className="min-h-tap max-w-[12rem] text-base" value={v.subId ?? ''} disabled={busy} onChange={(e) => void post(`/api/ops/visits/${v.id}`, { action: 'assign', subId: e.target.value || null }, 'Crew changed')}>
                                    <option value="">No crew</option>
                                    {d.crews.map((c) => (
                                      <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                  </Select>
                                ) : null}
                              </>
                            ) : v.status !== 'cancelled' ? (
                              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void post(`/api/ops/visits/${v.id}`, { action: 'reopen' }, 'Visit reopened')}>Reopen</Button>
                            ) : null}
                            <Button size="sm" variant="secondary" disabled={busy} onClick={() => { photoFor.current = v.id; fileRef.current?.click() }}>Add photos</Button>
                            {v.photoCount ? (
                              <Button size="sm" variant="ghost" className="underline" onClick={() => void openPhotos(v)}>
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
            title={sheet.kind === 'done' ? (sheet.visit.step === 'inspection' ? 'How did it look?' : 'Mark done') : sheet.kind === 'skip' ? 'Skip this visit' : sheet.kind === 'move' ? 'Move this visit' : 'Move visits'}
            description={sheet.kind === 'shift' ? 'Every visit still scheduled on those days moves by the same number of days. Done and skipped visits stay.' : undefined}
          >
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                const close = (ok: boolean) => ok && setSheet(null)
                if (sheet.kind === 'done') void post(`/api/ops/visits/${sheet.visit.id}`, { action: 'done', result: sheet.result ?? undefined, notes: sheet.notes }, 'Visit done').then(close)
                if (sheet.kind === 'skip' && sheet.reason) void post(`/api/ops/visits/${sheet.visit.id}`, { action: 'skip', reason: sheet.reason, notes: sheet.notes }, 'Visit skipped').then(close)
                if (sheet.kind === 'move') void post(`/api/ops/visits/${sheet.visit.id}`, { action: 'move', date: sheet.date }, 'Visit moved').then(close)
                if (sheet.kind === 'shift') void post('/api/ops/visits/shift', { from: sheet.from, to: sheet.to, days: Number(sheet.days), subId: sheet.crew }, '').then(close)
              }}
            >
              {sheet.kind === 'done' && sheet.visit.step === 'inspection' ? (
                <div className="grid grid-cols-1 gap-2">
                  {HEALTH_RESULTS.map((r) => (
                    <button key={r} type="button" aria-pressed={sheet.result === r} className={`min-h-tap rounded-ui px-3 text-left text-ui-base font-semibold ${HEALTH_RESULT_STYLE[r].cls} ${sheet.result === r ? 'ring-4 ring-brand-600' : ''}`} onClick={() => setSheet({ ...sheet, result: r })}>
                      {HEALTH_RESULT_STYLE[r].label}
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
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="From day">{(a) => <Input {...a} type="date" className="text-base" value={sheet.from} onChange={(e) => setSheet({ ...sheet, from: e.target.value, to: sheet.to < e.target.value ? e.target.value : sheet.to })} />}</Field>
                    <Field label="Through day">{(a) => <Input {...a} type="date" className="text-base" value={sheet.to} min={sheet.from} onChange={(e) => setSheet({ ...sheet, to: e.target.value })} />}</Field>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Move by (days)" hint="1 = the next day. Use a minus to move earlier.">{(a) => <Input {...a} type="number" inputMode="numeric" min={-30} max={30} className="text-base" value={sheet.days} onChange={(e) => setSheet({ ...sheet, days: e.target.value })} />}</Field>
                    <Field label="Which visits">
                      {(a) => (
                        <Select {...a} className="text-base" value={sheet.crew} onChange={(e) => setSheet({ ...sheet, crew: e.target.value })}>
                          <option value="all">All crews</option>
                          <option value="none">No crew</option>
                          {d.crews.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </Select>
                      )}
                    </Field>
                  </div>
                </>
              ) : null}
              <DialogFooter className="sticky bottom-0 bg-surface pt-2">
                <Button type="button" variant="secondary" disabled={busy} onClick={() => setSheet(null)}>Cancel</Button>
                <Button
                  type="submit"
                  loading={busy}
                  disabled={
                    (sheet.kind === 'done' && sheet.visit.step === 'inspection' && !sheet.result) ||
                    (sheet.kind === 'skip' && (!sheet.reason || (sheet.reason === 'other' && !sheet.notes.trim()))) ||
                    (sheet.kind === 'shift' && (!Number(sheet.days) || !sheet.from))
                  }
                >
                  {sheet.kind === 'done' ? 'Save' : sheet.kind === 'skip' ? 'Skip visit' : 'Move'}
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
              {d.crews.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-line pb-2">
                  <span className="text-ui-base font-semibold text-ink">{c.name}</span>
                  <Button size="sm" variant={c.hasPhoneLink ? 'secondary' : 'primary'} loading={busy} onClick={() => void makeLink(c)}>
                    {c.hasPhoneLink ? 'New link (old one stops)' : 'Make link'}
                  </Button>
                </li>
              ))}
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
