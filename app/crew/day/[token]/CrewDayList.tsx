'use client'

import { useCallback, useEffect, useState } from 'react'

import { formatDateWeekday } from '@/lib/format'
import { RESULT_TONE_CLASS, SKIP_REASONS, SKIP_REASON_LABELS, type SkipReason, type StepResultOption } from '@/lib/service-plans'
import { uploadVisitPhotos } from '@/lib/visit-photo-upload'
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
}

/** How often an open page re-checks that its link still works (and wipes itself if not). */
const RECHECK_MS = 5 * 60_000

function directionsHref(v: Pick<CrewDayVisit, 'lat' | 'lng' | 'address'>): string {
  const dest = v.lat != null && v.lng != null ? `${v.lat},${v.lng}` : v.address ?? ''
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
}: {
  token: string
  crewName: string
  companyName: string
  today: string
  visits: CrewDayVisit[]
  /** The crew's time clock (only when the company uses it AND this crew clocks in; subs never get one). */
  clock?: ClockState | null
}) {
  const [visits, setVisits] = useState<Array<CrewDayVisit & { resultLabel?: string }>>(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [skipping, setSkipping] = useState<{ id: string; reason: SkipReason | ''; notes: string } | null>(null)
  const [finishing, setFinishing] = useState<string | null>(null)
  const [dead, setDead] = useState(false)
  const [askClockOut, setAskClockOut] = useState<string | null>(null)
  // Hooks run either way; with no clock the endpoint is never called (initial state stays null and nothing renders).
  const clock = useClock(`/api/crew/day/${token}/clock`, { tapperKey: token.slice(0, 12), initial: initialClock ?? { ready: true, people: [], equipment: [], equipmentChoices: [], finishQuestions: [], captureLocation: false, timeZone: 'UTC' } })
  const [present, setPresent] = usePresence(clock)
  const clockOn = !!initialClock && initialClock.people.length > 0
  const crewHere = (visitId: string) => clockOn && (clock.state?.people ?? []).some((p) => p.open?.workOrderId === visitId)
  const stopLabel = (workOrderId: string | null) => {
    const i = visits.findIndex((v) => v.id === workOrderId)
    if (i < 0) return null
    const v = visits[i]
    return `Stop ${v.routePosition ?? i + 1}${v.address ? ` — ${v.address}` : ''}`
  }
  const markDone = (id: string, extra: Partial<CrewDayVisit> & { resultLabel?: string } = {}) => {
    setVisits((vs) => vs.map((x) => (x.id === id ? { ...x, status: 'completed', accessNotes: null, ...extra } : x)))
    if (crewHere(id)) setAskClockOut(id)
  }

  // A replaced or expired link must not keep showing addresses and gate codes on a phone that still has the page open:
  // re-check on focus, on return to the tab / back-forward cache, and every few minutes; wipe everything when it's dead.
  const recheck = useCallback(async () => {
    const res = await fetch(`/api/crew/day/${token}/status`, { cache: 'no-store' }).catch(() => null)
    if (!res) return // no signal: keep what is on screen until we know
    const out = (await res.json().catch(() => ({}))) as { active?: boolean }
    if (res.ok && out.active === true) return
    setVisits([])
    setSkipping(null)
    setFinishing(null)
    setAskClockOut(null)
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

  const base = (id: string) => `/api/crew/day/${token}/visits/${id}`
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
          <h1 className="text-2xl font-bold">{crewName} — {dateLabel}</h1>
          <p className="text-base">{visits.length === 0 ? 'No visits today.' : open === 0 ? 'All visits finished. Nice work.' : `${open} of ${visits.length} visit${visits.length === 1 ? '' : 's'} left`}</p>
        </header>
        {error ? <p role="alert" className="rounded-lg border-2 border-red-700 bg-white p-3 text-base font-semibold text-red-800">{error}</p> : null}
        {clockOn ? <ClockPanel clock={clock} selected={present} setSelected={setPresent} placeLabel={(o) => stopLabel(o.workOrderId)} title="Crew time" /> : null}
        <ol className="flex flex-col gap-3">
          {visits.map((v, i) => {
            const closed = v.status !== 'scheduled'
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
                  <p className="mt-2 text-base font-bold">{v.status === 'completed' ? `Done${v.resultLabel ? ` — ${v.resultLabel}` : ''}` : `Skipped — ${SKIP_REASON_LABELS[v.skipReason as SkipReason] ?? 'other'}`}{v.photoCount ? ` · ${v.photoCount} photo${v.photoCount === 1 ? '' : 's'}` : ''}</p>
                ) : null}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {clockOn && !closed ? <ClockHereButton clock={clock} where={{ workOrderId: v.id }} selected={present} /> : null}
                  {v.address || (v.lat != null && v.lng != null) ? (
                    <a href={directionsHref(v)} target="_blank" rel="noopener noreferrer" className={`${btn} border-2 border-[#2c2c2a] bg-white`}>
                      Directions
                    </a>
                  ) : null}
                  <FileDropZone
                    compact
                    accept="image/*"
                    disabled={busy === v.id}
                    label={busy === v.id ? 'Saving…' : `Add photos${v.photoCount ? ` (${v.photoCount} saved)` : ''}`}
                    className="w-full"
                    onFiles={(files) => void onPhotos(v.id, files)}
                  />
                  {!closed ? (
                    <>
                      <button
                        type="button"
                        className={`${btn} bg-green-800 text-white`}
                        disabled={busy === v.id}
                        onClick={() =>
                          v.resultOptions.length
                            ? setFinishing(v.id)
                            : void act(v.id, { action: 'done' }).then((ok) => ok && markDone(v.id))
                        }
                      >
                        Done
                      </button>
                      <button type="button" className={`${btn} border-2 border-[#2c2c2a] bg-white`} disabled={busy === v.id} onClick={() => setSkipping({ id: v.id, reason: '', notes: '' })}>
                        Skip
                      </button>
                    </>
                  ) : null}
                </div>
                {askClockOut === v.id && crewHere(v.id) ? (
                  <div className="mt-3 flex flex-col gap-2 border-t-2 border-[#e5e3dc] pt-3">
                    <p className="text-base font-bold">Clock out the crew?</p>
                    <button
                      type="button"
                      className={`${btn} bg-[#2c2c2a] text-white`}
                      onClick={() => {
                        setAskClockOut(null)
                        void clock.tap('clock_out', { userIds: (clock.state?.people ?? []).filter((p) => p.open?.workOrderId === v.id).map((p) => p.userId) })
                      }}
                    >
                      Yes — done for the day
                    </button>
                    <button
                      type="button"
                      className={`${btn} border-2 border-[#2c2c2a] bg-white`}
                      onClick={() => {
                        setAskClockOut(null)
                        void clock.tap('clock_out', { userIds: (clock.state?.people ?? []).filter((p) => p.open?.workOrderId === v.id).map((p) => p.userId), forTravel: true })
                      }}
                    >
                      No — driving to the next stop
                    </button>
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
                            markDone(v.id, { resultLabel: r.label })
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
                      if (!skipping.reason) return
                      void act(v.id, { action: 'skip', reason: skipping.reason, notes: skipping.notes }).then((ok) => {
                        if (!ok) return
                        setVisits((vs) => vs.map((x) => (x.id === v.id ? { ...x, status: 'skipped', skipReason: skipping.reason || null, accessNotes: null } : x)))
                        setSkipping(null)
                      })
                    }}
                  >
                    <p className="text-base font-bold">Why skip?</p>
                    <div className="grid grid-cols-2 gap-2">
                      {SKIP_REASONS.map((r) => (
                        <button key={r} type="button" aria-pressed={skipping.reason === r} className={`${btn} border-2 ${skipping.reason === r ? 'border-[#2c2c2a] bg-[#2c2c2a] text-white' : 'border-[#2c2c2a] bg-white'}`} onClick={() => setSkipping({ ...skipping, reason: r })}>
                          {SKIP_REASON_LABELS[r]}
                        </button>
                      ))}
                    </div>
                    <label className="flex flex-col gap-1 text-base font-semibold">
                      Note {skipping.reason === 'other' ? '(required)' : '(optional)'}
                      <textarea className="min-h-[5rem] rounded-lg border-2 border-[#2c2c2a] bg-white p-2 text-base font-normal" maxLength={2000} value={skipping.notes} onChange={(e) => setSkipping({ ...skipping, notes: e.target.value })} />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" className={`${btn} border-2 border-[#2c2c2a] bg-white`} onClick={() => setSkipping(null)}>
                        Cancel
                      </button>
                      <button type="submit" className={`${btn} bg-[#2c2c2a] text-white disabled:opacity-50`} disabled={!skipping.reason || (skipping.reason === 'other' && !skipping.notes.trim()) || busy === v.id}>
                        Skip visit
                      </button>
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
