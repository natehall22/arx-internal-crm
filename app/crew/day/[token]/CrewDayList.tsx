'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { formatDateWeekday } from '@/lib/format'
import { RESULT_TONE_CLASS, SKIP_REASONS, SKIP_REASON_LABELS, type SkipReason, type StepResultOption } from '@/lib/service-plans'
import { uploadVisitPhotos } from '@/lib/visit-photo-upload'
import { checklistSummary, unchecked, type ChecklistItem } from '@/lib/visit-checklist'
import { formatCents } from '@/lib/format'
import { QrCode } from '@/components/ui/QrCode'
import type { CrewMoney } from '@/lib/visit-collections'
import { FileDropZone } from '@/components/ui/file-drop-zone'
import { ClockHereButton, ClockPanel } from '@/components/time/ClockPanel'
import { useClock, usePresence, type ClockState } from '@/components/time/useClock'

export type CrewDayVisit = {
  id: string
  planName: string
  address: string | null
  lat: number | null
  lng: number | null
  accessNotes: string | null
  status: string
  skipReason: string | null
  photoCount: number
  routePosition: number | null
  /** A follow-on step's result options (empty = just "done"). */
  resultOptions: StepResultOption[]
  /** What the office wrote for the crew about this visit. */
  officeNotes: string | null
  /** The services sold, with what has been checked (empty = nothing to check). */
  checklist: ChecklistItem[]
  /** What the customer still owes, when anything (never a price line). */
  money: CrewMoney | null
}

/** Money tap state for the visit whose panel is open. */
type MoneyPanel = { id: string; kind: 'collect' | 'qr'; method: 'cash' | 'check'; amount: string; checkNumber: string; qrUrl: string | null; tapId: string }

const newTapId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '') : `${Date.now()}${Math.random().toString(36).slice(2)}`)

/** How long a one-tap skip waits (with Undo) before it is sent. */
const UNDO_MS = 6000

/** How often an open page re-checks that its link still works (and wipes itself if not). */
const RECHECK_MS = 5 * 60_000

function directionsHref(v: Pick<CrewDayVisit, 'lat' | 'lng' | 'address'>): string {
  const dest = v.lat != null && v.lng != null ? `${v.lat},${v.lng}` : (v.address ?? '')
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`
}

const btn = 'inline-flex min-h-[48px] items-center justify-center rounded-lg px-4 text-base font-semibold'

/**
 * Field UI for one crew's day: big targets, dark text on a light ground (readable in sun), one visit per card in stop
 * order. Done can carry photos; Skip needs a reason. Talks only to /api/crew/day/<token>/…
 */
export default function CrewDayList({
  token,
  crewName,
  companyName,
  today,
  visits: initial,
  clock: initialClock = null,
  onTheWay = false,
}: {
  token: string
  crewName: string
  companyName: string
  today: string
  visits: CrewDayVisit[]
  /** The crew's time clock (only when the company uses it AND this crew clocks in; subs never get one). */
  clock?: ClockState | null
  /** The company emails the customer when the crew taps "On my way" (Settings → Customer messages). */
  onTheWay?: boolean
}) {
  const [visits, setVisits] = useState<Array<CrewDayVisit & { resultLabel?: string }>>(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [skipping, setSkipping] = useState<{ id: string; reason: SkipReason | ''; notes: string } | null>(null)
  const [finishing, setFinishing] = useState<string | null>(null)
  const [askPhoto, setAskPhoto] = useState<string | null>(null)
  // "Mark done anyway?" when services are still unchecked (it never blocks: the crew decides).
  const [confirmDone, setConfirmDone] = useState<string | null>(null)
  const [panel, setPanel] = useState<MoneyPanel | null>(null)
  const [payNote, setPayNote] = useState<Record<string, string>>({})
  const [dead, setDead] = useState(false)
  // A skip waits a few seconds so a wrong tap can be undone; it is sent at once if the page is closed or hidden.
  const pendingSkip = useRef<{ id: string; body: Record<string, unknown>; before: CrewDayVisit; timer: number } | null>(null)
  const [undoFor, setUndoFor] = useState<string | null>(null)
  // "On my way" answers per visit (what the customer was told).
  const [told, setTold] = useState<Record<string, string>>({})
  // Hooks run either way; with no clock the endpoint is never called (the empty state renders nothing).
  const clock = useClock(`/api/crew/day/${token}/clock`, {
    tapperKey: token.slice(0, 12),
    initial: initialClock ?? { ready: true, people: [], equipment: [], equipmentChoices: [], finishQuestions: [], captureLocation: false, timeZone: 'UTC' },
  })
  const [present, setPresent] = usePresence(clock)
  const clockOn = !!initialClock && initialClock.people.length > 0
  const crewAt = (visitId: string) => (clockOn ? (clock.state?.people ?? []).filter((p) => p.open?.workOrderId === visitId).map((p) => p.userId) : [])
  const stopLabel = (workOrderId: string | null) => {
    const i = visits.findIndex((x) => x.id === workOrderId)
    if (i < 0) return null
    const x = visits[i]
    return `Stop ${x.routePosition ?? i + 1}${x.address ? ` — ${x.address}` : ''}`
  }

  // A replaced or expired link must not keep showing addresses and gate codes on a phone that still has the page open:
  // re-check on focus, on return to the tab / back-forward cache, and every few minutes; wipe everything when it's dead.
  const recheck = useCallback(async () => {
    const res = await fetch(`/api/crew/day/${token}/status`, { cache: 'no-store' }).catch(() => null)
    if (!res) return // no signal: keep what is on screen until we know
    const out = (await res.json().catch(() => ({}))) as { active?: boolean }
    if (res.ok && out.active === true) return
    if (pendingSkip.current) window.clearTimeout(pendingSkip.current.timer)
    pendingSkip.current = null
    setVisits([])
    setSkipping(null)
    setFinishing(null)
    setAskPhoto(null)
    setConfirmDone(null)
    setPanel(null)
    setUndoFor(null)
    setDead(true)
  }, [token])
  useEffect(() => {
    const onShow = () => void recheck()
    const onVisible = () => document.visibilityState === 'visible' && void recheck()
    window.addEventListener('focus', onShow)
    window.addEventListener('pageshow', onShow)
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(onShow, RECHECK_MS)
    return () => {
      window.removeEventListener('focus', onShow)
      window.removeEventListener('pageshow', onShow)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [recheck])

  const base = useCallback((id: string) => `/api/crew/day/${token}/visits/${id}`, [token])

  /** Send the waiting skip now; on failure put the visit back as it was and say so. */
  const flushSkip = useCallback(
    async (keepalive = false) => {
      const p = pendingSkip.current
      if (!p) return
      pendingSkip.current = null
      window.clearTimeout(p.timer)
      setUndoFor((u) => (u === p.id ? null : u))
      const res = await fetch(base(p.id), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p.body), keepalive }).catch(
        () => null,
      )
      if (keepalive) return
      if (!res || !res.ok) {
        const out = (res ? await res.json().catch(() => ({})) : {}) as { error?: string }
        setVisits((vs) => vs.map((x) => (x.id === p.id ? p.before : x)))
        setError(out.error || 'That skip didn’t save — no signal? Try again.')
      }
    },
    [base],
  )
  useEffect(() => {
    const onHide = () => void flushSkip(true)
    const onVisibility = () => document.visibilityState === 'hidden' && onHide()
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [flushSkip])

  function skipNow(v: CrewDayVisit, reason: SkipReason, notes: string) {
    void flushSkip() // one waiting skip at a time
    setSkipping(null)
    setError(null)
    setVisits((vs) => vs.map((x) => (x.id === v.id ? { ...x, status: 'skipped', skipReason: reason, accessNotes: null } : x)))
    pendingSkip.current = { id: v.id, body: { action: 'skip', reason, notes }, before: v, timer: window.setTimeout(() => void flushSkip(), UNDO_MS) }
    setUndoFor(v.id)
  }

  function undoSkip() {
    const p = pendingSkip.current
    if (!p) return
    window.clearTimeout(p.timer)
    pendingSkip.current = null
    setVisits((vs) => vs.map((x) => (x.id === p.id ? p.before : x)))
    setUndoFor(null)
  }

  const markDone = (v: CrewDayVisit, patch: Partial<CrewDayVisit & { resultLabel?: string }>) => {
    setVisits((vs) => vs.map((x) => (x.id === v.id ? { ...x, status: 'completed', accessNotes: null, ...patch } : x)))
    setAskPhoto(v.id)
  }
  const open = visits.filter((v) => v.status === 'scheduled').length
  const dateLabel = formatDateWeekday(today)

  if (dead) {
    return (
      <main className="min-h-dvh bg-[#f7f6f2] px-4 py-10 text-[#2c2c2a]">
        <div className="mx-auto max-w-md rounded-xl border border-[#e5e3dc] bg-white p-6 text-center">
          <h1 className="text-xl font-bold">This link isn’t active</h1>
          <p className="mt-2 text-base">{`Ask ${companyName} for a new link.`}</p>
        </div>
      </main>
    )
  }

  async function act(id: string, body: Record<string, unknown>): Promise<boolean> {
    setBusy(id)
    setError(null)
    const res = await fetch(base(id), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const out = (res ? await res.json().catch(() => ({})) : {}) as { error?: string }
    setBusy(null)
    if (!res || !res.ok) {
      if (res && res.status === 404) void recheck()
      setError(out.error || 'No signal? Try again in a moment.')
      return false
    }
    return true
  }

  /** One tap on a service: shows at once, saves in the background, puts it back (and says so) if it didn't save. */
  async function toggleLine(v: CrewDayVisit, label: string, done: boolean) {
    setError(null)
    const set = (list: ChecklistItem[]) => setVisits((vs) => vs.map((x) => (x.id === v.id ? { ...x, checklist: list } : x)))
    set(v.checklist.map((c) => (c.label === label ? { ...c, done } : c)))
    const res = await fetch(`${base(v.id)}/checklist`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label, done }) }).catch(() => null)
    const out = (res ? await res.json().catch(() => ({})) : {}) as { error?: string; checklist?: ChecklistItem[] }
    if (!res || !res.ok) {
      if (res && res.status === 404) void recheck()
      set(v.checklist)
      setError(out.error || 'That tap didn’t save — no signal? Try again.')
    } else if (out.checklist) set(out.checklist)
  }

  function startDone(v: CrewDayVisit) {
    if (unchecked(v.checklist).length > 0 && confirmDone !== v.id) return setConfirmDone(v.id)
    setConfirmDone(null)
    if (v.resultOptions.length) return setFinishing(v.id)
    void act(v.id, { action: 'done' }).then((ok) => ok && markDone(v, {}))
  }

  async function payLink(v: CrewDayVisit, mode: 'text' | 'qr') {
    setBusy(v.id)
    setError(null)
    const res = await fetch(`${base(v.id)}/pay-link`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) }).catch(() => null)
    const out = (res ? await res.json().catch(() => ({})) : {}) as { error?: string; message?: string; url?: string; status?: string }
    setBusy(null)
    if (res && res.status === 404) return void recheck()
    if (mode === 'qr') {
      if (!res || !res.ok || !out.url) return setError(out.error || 'No signal? Try again in a moment.')
      return setPanel({ id: v.id, kind: 'qr', method: 'cash', amount: '', checkNumber: '', qrUrl: out.url, tapId: '' })
    }
    if (!res) return setError('No signal? Try again in a moment.')
    if (res.ok) return setPayNote((n) => ({ ...n, [v.id]: out.message || 'Pay link texted to the customer.' }))
    // The text could not go (no OK to text, texting hours, …): say why and hand over the QR code instead.
    setPayNote((n) => ({ ...n, [v.id]: `${out.message || out.error || 'The text could not be sent.'} Use the QR code instead.` }))
    void payLink(v, 'qr')
  }

  async function saveCollection(v: CrewDayVisit, p: MoneyPanel) {
    setBusy(v.id)
    setError(null)
    const body = { amount: p.amount, method: p.method, checkNumber: p.method === 'check' ? p.checkNumber : undefined, tapId: p.tapId }
    const res = await fetch(`${base(v.id)}/collect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const out = (res ? await res.json().catch(() => ({})) : {}) as { error?: string; money?: CrewMoney }
    setBusy(null)
    if (!res || !res.ok) {
      if (res && res.status === 404) void recheck()
      return setError(out.error || 'No signal? Try again in a moment.')
    }
    setVisits((vs) => vs.map((x) => (x.id === v.id ? { ...x, money: out.money ?? null } : x)))
    setPanel(null)
    setPayNote((n) => ({ ...n, [v.id]: 'Saved. The office will confirm it.' }))
  }

  async function onMyWay(id: string) {
    setBusy(id)
    setError(null)
    const res = await fetch(`${base(id)}/on-the-way`, { method: 'POST' }).catch(() => null)
    const out = (res ? await res.json().catch(() => ({})) : {}) as { message?: string; error?: string }
    setBusy(null)
    if (!res || !res.ok) {
      if (res && res.status === 404) void recheck()
      setError(out.message || out.error || 'No signal? Try again in a moment.')
      return
    }
    setTold((t) => ({ ...t, [id]: out.message || 'Customer told you’re on the way' }))
  }

  async function onPhotos(id: string, files: File[]) {
    if (files.length === 0) return
    setBusy(id)
    setError(null)
    const r = await uploadVisitPhotos(`${base(id)}/photos`, files)
    setBusy(null)
    if (r.uploaded) setVisits((vs) => vs.map((v) => (v.id === id ? { ...v, photoCount: v.photoCount + r.uploaded } : v)))
    if (r.error) setError(`${r.uploaded ? `${r.uploaded} photo${r.uploaded === 1 ? '' : 's'} saved. ` : ''}${r.error}`)
  }

  return (
    <main className="min-h-dvh bg-[#f7f6f2] px-4 pb-10 pt-5 text-[#2c2c2a]">
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <header>
          <p className="text-base font-semibold">{companyName}</p>
          <h1 className="text-2xl font-bold">
            {crewName} — {dateLabel}
          </h1>
          <p className="text-base">
            {visits.length === 0
              ? 'No visits today.'
              : open === 0
                ? 'All visits finished. Nice work.'
                : `${open} of ${visits.length} visit${visits.length === 1 ? '' : 's'} left`}
          </p>
          {visits.length > 0 ? (
            <a href={`/api/crew/day/${token}/sheet`} target="_blank" rel="noopener noreferrer" className={`${btn} mt-2 w-full border-2 border-[#2c2c2a] bg-white`}>
              Print today’s sheet
            </a>
          ) : null}
        </header>
        {error ? (
          <p role="alert" className="rounded-lg border-2 border-red-700 bg-white p-3 text-base font-semibold text-red-800">
            {error}
          </p>
        ) : null}
        {clockOn ? <ClockPanel clock={clock} selected={present} setSelected={setPresent} placeLabel={(o) => stopLabel(o.workOrderId)} title="Crew time" /> : null}
        <ol className="flex flex-col gap-3">
          {visits.map((v, i) => {
            const closed = v.status !== 'scheduled'
            const crewHere = crewAt(v.id)
            return (
              <li key={v.id} className={`rounded-xl border-2 bg-white p-4 ${closed ? 'border-[#e5e3dc]' : 'border-[#2c2c2a]'}`}>
                <p className="text-sm font-semibold uppercase tracking-wide">Stop {v.routePosition ?? i + 1}</p>
                <p className="text-lg font-bold break-words">{v.address ?? 'No address on file'}</p>
                <p className="text-base">{v.planName}</p>
                {v.accessNotes ? (
                  <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-[#fff4cc] px-3 py-2 text-base">
                    <span className="font-bold">Gate / access: </span>
                    {v.accessNotes}
                  </p>
                ) : null}
                {v.officeNotes ? (
                  <p className="mt-2 whitespace-pre-wrap break-words text-base">
                    <span className="font-bold">Notes: </span>
                    {v.officeNotes}
                  </p>
                ) : null}
                {!closed && v.checklist.length > 0 ? (
                  <ul className="mt-3 flex flex-col gap-2" aria-label="Services to do">
                    {v.checklist.map((c) => (
                      <li key={c.label}>
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={c.done}
                          className={`flex min-h-[52px] w-full items-center gap-3 rounded-lg border-2 px-3 text-left text-lg font-semibold ${c.done ? 'border-green-800 bg-green-50' : 'border-[#2c2c2a] bg-white'}`}
                          onClick={() => void toggleLine(v, c.label, !c.done)}
                        >
                          <span aria-hidden className={`flex h-7 w-7 shrink-0 items-center justify-center rounded border-2 text-xl leading-none ${c.done ? 'border-green-800 bg-green-800 text-white' : 'border-[#2c2c2a] bg-white'}`}>
                            {c.done ? '✓' : ''}
                          </span>
                          <span className="min-w-0 break-words">{c.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {closed && v.status === 'completed' && v.checklist.length > 0 ? <p className="mt-1 text-base">{checklistSummary(v.checklist)}</p> : null}
                {closed ? (
                  <p className="mt-2 text-base font-bold">
                    {v.status === 'completed'
                      ? `Done${v.resultLabel ? ` — ${v.resultLabel}` : ''}`
                      : `Skipped — ${SKIP_REASON_LABELS[v.skipReason as SkipReason] ?? 'other'}`}
                    {v.photoCount ? ` · ${v.photoCount} photo${v.photoCount === 1 ? '' : 's'}` : ''}
                  </p>
                ) : null}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {clockOn && !closed ? <ClockHereButton clock={clock} where={{ workOrderId: v.id }} selected={present} /> : null}
                  {v.address || (v.lat != null && v.lng != null) ? (
                    <a href={directionsHref(v)} target="_blank" rel="noopener noreferrer" className={`${btn} border-2 border-[#2c2c2a] bg-white`}>
                      Directions
                    </a>
                  ) : null}
                  {onTheWay && !closed && !told[v.id] ? (
                    <button type="button" className={`${btn} border-2 border-[#2c2c2a] bg-white`} disabled={busy === v.id} onClick={() => void onMyWay(v.id)}>
                      On my way
                    </button>
                  ) : null}
                  {askPhoto !== v.id ? (
                    <FileDropZone
                      compact
                      accept="image/*"
                      disabled={busy === v.id}
                      label={busy === v.id ? 'Saving…' : `Add photos${v.photoCount ? ` (${v.photoCount} saved)` : ''}`}
                      className="w-full"
                      onFiles={(files) => void onPhotos(v.id, files)}
                    />
                  ) : null}
                  {!closed ? (
                    <>
                      <button
                        type="button"
                        className={`${btn} bg-green-800 text-white`}
                        disabled={busy === v.id}
                        onClick={() => startDone(v)}
                      >
                        Done
                      </button>
                      <button
                        type="button"
                        className={`${btn} border-2 border-[#2c2c2a] bg-white`}
                        disabled={busy === v.id}
                        onClick={() => setSkipping({ id: v.id, reason: '', notes: '' })}
                      >
                        Skip
                      </button>
                    </>
                  ) : null}
                </div>
                {told[v.id] && !closed ? (
                  <p role="status" className="mt-2 text-base font-semibold">
                    {told[v.id]}
                  </p>
                ) : null}
                {confirmDone === v.id ? (
                  <div className="mt-3 flex flex-col gap-2 border-t-2 border-[#e5e3dc] pt-3" role="alertdialog" aria-label="Mark done anyway?">
                    <p className="text-base font-bold">Mark done anyway?</p>
                    <p className="text-base">Not checked: {unchecked(v.checklist).map((c) => c.label).join(', ')}</p>
                    <button type="button" className={`${btn} bg-green-800 text-white`} onClick={() => startDone(v)}>
                      Yes, mark done
                    </button>
                    <button type="button" className={`${btn} border-2 border-[#2c2c2a] bg-white`} onClick={() => setConfirmDone(null)}>
                      Go back
                    </button>
                  </div>
                ) : null}
                {v.status !== 'skipped' && (v.money || payNote[v.id]) ? (
                  <div className="mt-3 flex flex-col gap-2 border-t-2 border-[#e5e3dc] pt-3">
                    {v.money && v.money.dueCents > 0 ? <p className="text-lg font-bold">Customer owes {formatCents(v.money.dueCents)}</p> : null}
                    {v.money && v.money.pendingCents > 0 ? (
                      <p className="text-base font-semibold">{formatCents(v.money.pendingCents)} collected — waiting for the office to confirm</p>
                    ) : null}
                    {payNote[v.id] ? (
                      <p role="status" className="text-base font-semibold">
                        {payNote[v.id]}
                      </p>
                    ) : null}
                    {v.money && v.money.dueCents > 0 && panel?.id !== v.id ? (
                      <div className="grid grid-cols-1 gap-2">
                        {v.money.canPayOnline ? (
                          <button type="button" className={`${btn} bg-[#2c2c2a] text-white`} disabled={busy === v.id} onClick={() => void payLink(v, 'text')}>
                            Text pay link
                          </button>
                        ) : null}
                        {v.money.canPayOnline ? (
                          <button type="button" className={`${btn} border-2 border-[#2c2c2a] bg-white`} disabled={busy === v.id} onClick={() => void payLink(v, 'qr')}>
                            Show QR code
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={`${btn} border-2 border-[#2c2c2a] bg-white`}
                          onClick={() => setPanel({ id: v.id, kind: 'collect', method: 'cash', amount: ((v.money?.dueCents ?? 0) / 100).toFixed(2), checkNumber: '', qrUrl: null, tapId: newTapId() })}
                        >
                          Collected cash / check
                        </button>
                      </div>
                    ) : null}
                    {panel?.id === v.id && panel.kind === 'qr' && panel.qrUrl ? (
                      <div className="flex flex-col items-center gap-2">
                        <p className="text-base font-bold">Customer scans this to pay {v.money ? formatCents(v.money.dueCents) : ''}</p>
                        <QrCode value={panel.qrUrl} size={260} label="Pay link QR code" />
                        <button type="button" className={`${btn} w-full border-2 border-[#2c2c2a] bg-white`} onClick={() => setPanel(null)}>
                          Close
                        </button>
                      </div>
                    ) : null}
                    {panel?.id === v.id && panel.kind === 'collect' ? (
                      <form
                        className="flex flex-col gap-2"
                        onSubmit={(e) => {
                          e.preventDefault()
                          void saveCollection(v, panel)
                        }}
                      >
                        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="How was it paid?">
                          {(['cash', 'check'] as const).map((m) => (
                            <button
                              key={m}
                              type="button"
                              role="radio"
                              aria-checked={panel.method === m}
                              className={`${btn} border-2 ${panel.method === m ? 'border-[#2c2c2a] bg-[#2c2c2a] text-white' : 'border-[#2c2c2a] bg-white'}`}
                              onClick={() => setPanel({ ...panel, method: m })}
                            >
                              {m === 'cash' ? 'Cash' : 'Check'}
                            </button>
                          ))}
                        </div>
                        <label className="flex flex-col gap-1 text-base font-semibold">
                          Amount ($)
                          <input
                            className="min-h-[48px] rounded-lg border-2 border-[#2c2c2a] bg-white px-3 text-base font-normal"
                            inputMode="decimal"
                            autoComplete="off"
                            value={panel.amount}
                            onChange={(e) => setPanel({ ...panel, amount: e.target.value })}
                          />
                        </label>
                        {panel.method === 'check' ? (
                          <label className="flex flex-col gap-1 text-base font-semibold">
                            Check number (optional)
                            <input
                              className="min-h-[48px] rounded-lg border-2 border-[#2c2c2a] bg-white px-3 text-base font-normal"
                              inputMode="numeric"
                              autoComplete="off"
                              maxLength={40}
                              value={panel.checkNumber}
                              onChange={(e) => setPanel({ ...panel, checkNumber: e.target.value })}
                            />
                            <span className="text-base font-normal">Tip: tap “Add photos” to take a picture of the check.</span>
                          </label>
                        ) : null}
                        <div className="grid grid-cols-2 gap-2">
                          <button type="button" className={`${btn} border-2 border-[#2c2c2a] bg-white`} onClick={() => setPanel(null)}>
                            Cancel
                          </button>
                          <button type="submit" className={`${btn} bg-green-800 text-white disabled:opacity-50`} disabled={busy === v.id || !panel.amount.trim()}>
                            Save
                          </button>
                        </div>
                        <p className="text-base">The office confirms it before it counts as paid.</p>
                      </form>
                    ) : null}
                  </div>
                ) : null}
                {undoFor === v.id ? (
                  <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-[#2c2c2a] px-3 py-2 text-white" role="status">
                    <span className="text-base font-semibold">Skipped.</span>
                    <button type="button" className={`${btn} bg-white text-[#2c2c2a]`} onClick={undoSkip}>
                      Undo
                    </button>
                  </div>
                ) : null}
                {askPhoto === v.id ? (
                  <div className="mt-3 flex flex-col gap-2 border-t-2 border-[#e5e3dc] pt-3">
                    <p className="text-base font-bold">{crewHere.length ? 'Done. Add a photo, then clock the crew out' : 'Done. Add a photo?'}</p>
                    <FileDropZone
                      accept="image/*"
                      disabled={busy === v.id}
                      label={busy === v.id ? 'Saving…' : v.photoCount ? `Add another photo (${v.photoCount} saved)` : 'Take or add a photo'}
                      // With the crew clocked in here the panel stays for the clock choice; otherwise a photo closes it.
                      onFiles={(files) => void onPhotos(v.id, files).then(() => !crewHere.length && setAskPhoto(null))}
                    />
                    {crewHere.length ? (
                      <>
                        <button
                          type="button"
                          className={`${btn} bg-[#2c2c2a] text-white`}
                          onClick={() => {
                            setAskPhoto(null)
                            // Fresh list of who is clocked in here (not the list painted when Done was tapped).
                            void clock.latestOpen(v.id).then((ids) => { if (ids.length) void clock.tap('clock_out', { userIds: ids }) })
                          }}
                        >
                          Clock out crew — done for the day
                        </button>
                        <button
                          type="button"
                          className={`${btn} border-2 border-[#2c2c2a] bg-white`}
                          onClick={() => {
                            setAskPhoto(null)
                            void clock.latestOpen(v.id).then((ids) => { if (ids.length) void clock.tap('clock_out', { userIds: ids, forTravel: true }) })
                          }}
                        >
                          Driving to the next stop
                        </button>
                        <button type="button" className={`${btn} border-2 border-[#2c2c2a] bg-white`} onClick={() => setAskPhoto(null)}>
                          Stay clocked in here
                        </button>
                      </>
                    ) : (
                      <button type="button" className={`${btn} border-2 border-[#2c2c2a] bg-white`} onClick={() => setAskPhoto(null)}>
                        No thanks
                      </button>
                    )}
                  </div>
                ) : null}
                {finishing === v.id ? (
                  <div className="mt-3 flex flex-col gap-2 border-t-2 border-[#e5e3dc] pt-3">
                    <p className="text-base font-bold">How did it go?</p>
                    {v.resultOptions.map((r) => (
                      <button
                        key={r.key}
                        type="button"
                        className={`${btn} ${RESULT_TONE_CLASS[r.tone]}`}
                        disabled={busy === v.id}
                        onClick={() =>
                          void act(v.id, { action: 'done', result: r.key }).then((ok) => {
                            if (!ok) return
                            markDone(v, { resultLabel: r.label })
                            setFinishing(null)
                          })
                        }
                      >
                        {r.label}
                      </button>
                    ))}
                    <button type="button" className={`${btn} border-2 border-[#2c2c2a] bg-white`} onClick={() => setFinishing(null)}>
                      Cancel
                    </button>
                  </div>
                ) : null}
                {skipping?.id === v.id ? (
                  <form
                    className="mt-3 flex flex-col gap-2 border-t-2 border-[#e5e3dc] pt-3"
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (skipping.reason === 'other' && skipping.notes.trim()) skipNow(v, 'other', skipping.notes)
                    }}
                  >
                    <p className="text-base font-bold">Why skip? (one tap)</p>
                    <div className="grid grid-cols-2 gap-2">
                      {SKIP_REASONS.map((r) => (
                        <button
                          key={r}
                          type="button"
                          aria-pressed={skipping.reason === r}
                          className={`${btn} border-2 ${skipping.reason === r ? 'border-[#2c2c2a] bg-[#2c2c2a] text-white' : 'border-[#2c2c2a] bg-white'}`}
                          onClick={() => (r === 'other' ? setSkipping({ ...skipping, reason: r }) : skipNow(v, r, ''))}
                        >
                          {SKIP_REASON_LABELS[r]}
                        </button>
                      ))}
                    </div>
                    {skipping.reason === 'other' ? (
                      <label className="flex flex-col gap-1 text-base font-semibold">
                        What happened?
                        <textarea
                          className="min-h-[5rem] rounded-lg border-2 border-[#2c2c2a] bg-white p-2 text-base font-normal"
                          maxLength={2000}
                          value={skipping.notes}
                          onChange={(e) => setSkipping({ ...skipping, notes: e.target.value })}
                        />
                      </label>
                    ) : null}
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" className={`${btn} border-2 border-[#2c2c2a] bg-white`} onClick={() => setSkipping(null)}>
                        Cancel
                      </button>
                      {skipping.reason === 'other' ? (
                        <button type="submit" className={`${btn} bg-[#2c2c2a] text-white disabled:opacity-50`} disabled={!skipping.notes.trim()}>
                          Skip visit
                        </button>
                      ) : null}
                    </div>
                  </form>
                ) : null}
              </li>
            )
          })}
        </ol>
      </div>
    </main>
  )
}
