'use client'

import { useRef, useState } from 'react'

import { SKIP_REASONS, SKIP_REASON_LABELS, type SkipReason } from '@/lib/service-plans'
import { uploadVisitPhotos } from '@/lib/visit-photo-upload'

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
}

function directionsHref(v: Pick<CrewDayVisit, 'lat' | 'lng' | 'address'>): string {
  const dest = v.lat != null && v.lng != null ? `${v.lat},${v.lng}` : v.address ?? ''
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`
}

const btn = 'inline-flex min-h-[48px] items-center justify-center rounded-lg px-4 text-base font-semibold'

/**
 * Field UI for one crew's day: big targets, dark text on a light ground (readable in sun), one visit per card in stop
 * order. Done can carry photos; Skip needs a reason. Talks only to /api/crew/day/<token>/…
 */
export default function CrewDayList({ token, crewName, companyName, today, visits: initial }: { token: string; crewName: string; companyName: string; today: string; visits: CrewDayVisit[] }) {
  const [visits, setVisits] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [skipping, setSkipping] = useState<{ id: string; reason: SkipReason | ''; notes: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const photoFor = useRef<string | null>(null)

  const base = (id: string) => `/api/crew/day/${token}/visits/${id}`
  const open = visits.filter((v) => v.status === 'scheduled').length
  const dateLabel = new Date(`${today}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })

  async function act(id: string, body: Record<string, unknown>): Promise<boolean> {
    setBusy(id)
    setError(null)
    const res = await fetch(base(id), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const out = (res ? await res.json().catch(() => ({})) : {}) as { error?: string }
    setBusy(null)
    if (!res || !res.ok) {
      setError(out.error || 'No signal? Try again in a moment.')
      return false
    }
    return true
  }

  async function onPhotos(files: FileList | null) {
    const id = photoFor.current
    if (!id || !files || files.length === 0) return
    setBusy(id)
    setError(null)
    const r = await uploadVisitPhotos(`${base(id)}/photos`, Array.from(files))
    setBusy(null)
    if (r.uploaded) setVisits((vs) => vs.map((v) => (v.id === id ? { ...v, photoCount: v.photoCount + r.uploaded } : v)))
    if (r.error) setError(`${r.uploaded ? `${r.uploaded} photo${r.uploaded === 1 ? '' : 's'} saved. ` : ''}${r.error}`)
    if (fileRef.current) fileRef.current.value = ''
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
        <input ref={fileRef} type="file" accept="image/*" multiple className="sr-only" aria-label="Add photos" onChange={(e) => void onPhotos(e.target.files)} />
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
                  <p className="mt-2 text-base font-bold">{v.status === 'completed' ? 'Done' : `Skipped — ${SKIP_REASON_LABELS[v.skipReason as SkipReason] ?? 'other'}`}{v.photoCount ? ` · ${v.photoCount} photo${v.photoCount === 1 ? '' : 's'}` : ''}</p>
                ) : null}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {v.address || (v.lat != null && v.lng != null) ? (
                    <a href={directionsHref(v)} target="_blank" rel="noopener noreferrer" className={`${btn} border-2 border-[#2c2c2a] bg-white`}>
                      Directions
                    </a>
                  ) : null}
                  <button
                    type="button"
                    className={`${btn} border-2 border-[#2c2c2a] bg-white`}
                    disabled={busy === v.id}
                    onClick={() => {
                      photoFor.current = v.id
                      fileRef.current?.click()
                    }}
                  >
                    {busy === v.id ? 'Saving…' : `Photos${v.photoCount ? ` (${v.photoCount})` : ''}`}
                  </button>
                  {!closed ? (
                    <>
                      <button type="button" className={`${btn} bg-green-800 text-white`} disabled={busy === v.id} onClick={() => void act(v.id, { action: 'done' }).then((ok) => ok && setVisits((vs) => vs.map((x) => (x.id === v.id ? { ...x, status: 'completed' } : x))))}>
                        Done
                      </button>
                      <button type="button" className={`${btn} border-2 border-[#2c2c2a] bg-white`} disabled={busy === v.id} onClick={() => setSkipping({ id: v.id, reason: '', notes: '' })}>
                        Skip
                      </button>
                    </>
                  ) : null}
                </div>
                {skipping?.id === v.id ? (
                  <form
                    className="mt-3 flex flex-col gap-2 border-t-2 border-[#e5e3dc] pt-3"
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (!skipping.reason) return
                      void act(v.id, { action: 'skip', reason: skipping.reason, notes: skipping.notes }).then((ok) => {
                        if (!ok) return
                        setVisits((vs) => vs.map((x) => (x.id === v.id ? { ...x, status: 'skipped', skipReason: skipping.reason || null } : x)))
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
