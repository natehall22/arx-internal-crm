'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { formatDateWeekday } from '@/lib/format'
import { RESULT_TONE_CLASS, SKIP_REASONS, SKIP_REASON_LABELS, type SkipReason, type StepResultOption } from '@/lib/service-plans'
import { uploadVisitPhotos } from '@/lib/visit-photo-upload'
import { FileDropZone } from '@/components/ui/file-drop-zone'
import { ClockHereButton, ClockPanel } from '@/components/time/ClockPanel'
import { useClock, usePresence, type ClockState } from '@/components/time/useClock'
import CrewScoreboardCard from '@/components/crew/CrewScoreboardCard'
import type { Scoreboard } from '@/lib/crew-incentives-db'

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
}

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
  scoreboard = null,
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
  /** This crew's bonuses this week (only when the company turned crew incentives on; never another crew's). */
  scoreboard?: Scoreboard | null
}) {
  const [visits, setVisits] = useState<Array<CrewDayVisit & { resultLabel?: string }>>(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [skipping, setSkipping] = useState<{ id: string; reason: SkipReason | ''; notes: string } | null>(null)
  const [finishing, setFinishing] = useState<string | null>(null)
  const [askPhoto, setAskPhoto] = useState<string | null>(null)
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
                        onClick={() => (v.resultOptions.length ? setFinishing(v.id) : void act(v.id, { action: 'done' }).then((ok) => ok && markDone(v, {})))}
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
        {scoreboard ? (
          <div className="mt-4">
            <CrewScoreboardCard data={scoreboard} />
          </div>
        ) : null}
      </div>
    </main>
  )
}
