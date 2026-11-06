'use client'

/**
 * Job catch-up on screen: the one-line summary (board card + list) and the "Where this stands" box (job page).
 * Everything shown is derived in lib/job-catch-up.ts — this file only renders it. No dollar amounts, ever.
 */
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { formatDateTime } from '@/lib/format'
import type { CatchUpUpdate, JobCatchUpResult } from '@/lib/job-catch-up'

const INK = 'text-[#2c2c2a]'

/** "Steve · Waiting on permit · 2d" — amber with a "Stuck" tag when it needs someone; "No owner" in red. */
export function JobCatchUpLine({ catchUp, className = '' }: { catchUp: JobCatchUpResult; className?: string }) {
  const rest = catchUp.ownerKind === 'unassigned' ? catchUp.line.slice(catchUp.owner.length) : catchUp.line
  return (
    <p
      data-testid="catch-up-line"
      data-stuck={catchUp.stuck ? 'true' : 'false'}
      title={catchUp.stuck ? catchUp.reasons.join(' ') : undefined}
      className={`text-sm leading-snug break-words ${catchUp.stuck ? 'rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-amber-950' : INK} ${className}`}
    >
      {catchUp.stuck && <span className="mr-1 font-semibold">Stuck ·</span>}
      {catchUp.ownerKind === 'unassigned' && <span data-testid="catch-up-no-owner" className="font-semibold text-red-800">{catchUp.owner}</span>}
      {rest}
    </p>
  )
}

function UpdateRow({ u }: { u: CatchUpUpdate }) {
  return (
    <li className={`text-sm ${INK}`}>
      <span className="font-medium">{u.who ?? 'System'}</span>
      <span> · {formatDateTime(u.at)}</span>
      <span className="block break-words">{u.what}</span>
    </li>
  )
}

type Candidate = { id: string; name: string }

/**
 * Pick (or clear) a job's owner — the one write path, PUT /api/ops/jobs/[id]/owner (jobs:edit). Only rendered for
 * people who can edit the job. Saves, then refreshes the page so the box, banner and line all re-derive.
 */
/** Banner and box each show the owner; one save tells both (same page, no reload). */
const OWNER_EVENT = 'job-owner-changed'
type OwnerEventDetail = { jobId: string; name: string | null }
function announceOwner(detail: OwnerEventDetail) {
  window.dispatchEvent(new CustomEvent<OwnerEventDetail>(OWNER_EVENT, { detail }))
}
function useOwnerChanges(jobId: string, onChange: (name: string | null) => void) {
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<OwnerEventDetail>).detail
      if (d?.jobId === jobId) onChange(d.name)
    }
    window.addEventListener(OWNER_EVENT, handler)
    return () => window.removeEventListener(OWNER_EVENT, handler)
  }, [jobId, onChange])
}

export function JobOwnerPicker({ jobId, currentOwnerId, onSaved, onCancel, tone = 'light' }: { jobId: string; currentOwnerId: string | null; onSaved: (name: string | null) => void; onCancel?: () => void; tone?: 'light' | 'alert' }) {
  const router = useRouter()
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [choice, setChoice] = useState(currentOwnerId ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      const res = await fetch(`/api/ops/jobs/${jobId}/owner`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!live) return
      if (!res.ok) return setError(data.error || 'Could not load people')
      setCandidates(data.candidates as Candidate[])
    })()
    return () => { live = false }
  }, [jobId])

  async function save() {
    setSaving(true)
    setError(null)
    const res = await fetch(`/api/ops/jobs/${jobId}/owner`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: choice || null }) })
    const data = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) return setError(data.error || 'Could not save')
    const picked = candidates?.find((c) => c.id === choice)
    onSaved(picked ? picked.name.split(/\s+/)[0] : null)
    router.refresh()
  }

  const label = tone === 'alert' ? 'text-white' : INK
  return (
    <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
      <label htmlFor={`owner-${jobId}`} className={`sr-only ${label}`}>Job owner</label>
      <select
        id={`owner-${jobId}`}
        data-testid="owner-select"
        value={choice}
        disabled={!candidates || saving}
        onChange={(e) => setChoice(e.target.value)}
        className="min-h-[44px] w-full rounded-md border border-gray-500 bg-white px-3 text-base text-[#2c2c2a] sm:w-64"
      >
        <option value="">{candidates ? 'Pick an owner…' : 'Loading…'}</option>
        {(candidates ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving || !candidates || choice === (currentOwnerId ?? '')}
          onClick={() => void save()}
          className={`min-h-[44px] flex-1 rounded-md px-4 text-base font-semibold disabled:opacity-60 ${tone === 'alert' ? 'bg-white text-red-900' : 'bg-[#2c2c2a] text-white'}`}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={`min-h-[44px] flex-1 rounded-md border px-4 text-base font-semibold ${tone === 'alert' ? 'border-white text-white' : 'border-gray-500 text-[#2c2c2a]'}`}>
            Cancel
          </button>
        )}
      </div>
      {error && <p role="alert" className={`text-sm font-semibold ${tone === 'alert' ? 'text-white' : 'text-red-800'}`}>{error}</p>}
    </div>
  )
}

/**
 * Red banner at the very top of the job page while the job has no owner (catch-up on, owner column present). People
 * who can edit the job pick the owner right here; everyone else just sees the banner. Gone once an owner is set.
 */
export function JobOwnerBanner({ catchUp, canSetOwner }: { catchUp: JobCatchUpResult; canSetOwner: boolean }) {
  const [ownerName, setOwnerName] = useState<string | null>(null)
  useOwnerChanges(catchUp.jobId, setOwnerName)
  if (catchUp.ownerKind !== 'unassigned' || ownerName) return null
  return (
    <div role="alert" data-testid="no-owner-banner" className="mb-4 flex flex-col gap-2 rounded-xl bg-red-800 p-4 text-white shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <p className="text-base font-semibold">No owner — assign one</p>
      {canSetOwner && <JobOwnerPicker jobId={catchUp.jobId} currentOwnerId={null} tone="alert" onSaved={(name) => announceOwner({ jobId: catchUp.jobId, name })} />}
    </div>
  )
}

/** Owner inside the box: the name (tap to change, for people who can edit the job) or "No owner" in red. */
export function JobOwnerField({ catchUp, canSetOwner }: { catchUp: JobCatchUpResult; canSetOwner: boolean }) {
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState<{ owner: string; kind: JobCatchUpResult['ownerKind'] }>({ owner: catchUp.owner, kind: catchUp.ownerKind })
  useOwnerChanges(catchUp.jobId, setShownFromName)
  function setShownFromName(name: string | null) {
    setShown(name ? { owner: name, kind: 'assigned' } : { owner: 'No owner', kind: 'unassigned' })
  }
  if (shown.kind === 'unknown') return null
  const text = <span className={shown.kind === 'unassigned' ? 'font-semibold text-red-800' : undefined}>{shown.owner}</span>
  return (
    <div>
      <dt className="inline font-semibold">Owner: </dt>
      <dd className="inline break-words">
        {canSetOwner && shown.kind !== 'none' ? (
          <button
            type="button"
            data-testid="catch-up-owner"
            onClick={() => setOpen(true)}
            className="inline-flex min-h-[44px] items-center underline decoration-dotted underline-offset-4"
            aria-label={`Owner: ${shown.owner}. Change owner`}
          >
            {text}
          </button>
        ) : (
          <span data-testid="catch-up-owner">{text}</span>
        )}
      </dd>
      {open && (
        <div className="mt-2 rounded-lg border border-gray-300 bg-white p-3">
          <JobOwnerPicker
            jobId={catchUp.jobId}
            currentOwnerId={catchUp.ownerUserId}
            onCancel={() => setOpen(false)}
            onSaved={(name) => {
              announceOwner({ jobId: catchUp.jobId, name })
              setOpen(false)
            }}
          />
        </div>
      )}
    </div>
  )
}

/** The box at the top of the job page. Same derivation as the board line. */
export function JobCatchUpBox({ catchUp, canSetOwner = false }: { catchUp: JobCatchUpResult; canSetOwner?: boolean }) {
  return (
    <section
      aria-labelledby="catch-up-heading"
      data-testid="catch-up-box"
      className={`mb-4 rounded-xl border p-4 shadow-sm sm:px-6 ${catchUp.stuck ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="catch-up-heading" className={`text-base font-semibold ${INK}`}>Where this stands</h2>
        <span className={`text-sm ${INK}`}>Last update {catchUp.ageLabel === 'today' ? 'today' : `${catchUp.ageLabel} ago`}</span>
      </div>

      <dl className={`mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-3 ${INK}`}>
        <JobOwnerField catchUp={catchUp} canSetOwner={canSetOwner} />
        <div><dt className="inline font-semibold">Stage: </dt><dd className="inline">{catchUp.stage}</dd></div>
        <div><dt className="inline font-semibold">Next: </dt><dd className="inline break-words">{catchUp.nextStep}</dd></div>
      </dl>

      {catchUp.stuck && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-white p-3">
          <p className="text-sm font-semibold text-amber-950">Stuck — why</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-amber-950">
            {catchUp.reasons.map((r) => <li key={r} className="break-words">{r}</li>)}
          </ul>
        </div>
      )}

      <div className="mt-3">
        <p className={`text-sm font-semibold ${INK}`}>
          {catchUp.contactIsNote ? 'Last customer contact: none logged (calls, texts, emails) — latest note:' : 'Last customer contact'}
        </p>
        {catchUp.lastContact ? (
          <ul className="mt-1"><UpdateRow u={catchUp.lastContact} /></ul>
        ) : (
          <p className={`text-sm ${INK}`}>Nothing logged yet.</p>
        )}
      </div>

      <div className="mt-3">
        <p className={`text-sm font-semibold ${INK}`}>Latest updates</p>
        {catchUp.recent.length > 0 ? (
          <ul className="mt-1 space-y-2">
            {catchUp.recent.map((u, i) => <UpdateRow key={`${u.at}-${i}`} u={u} />)}
          </ul>
        ) : (
          <p className={`text-sm ${INK}`}>Nothing recorded yet.</p>
        )}
        {catchUp.threadHref && (
          <Link href={catchUp.threadHref} className={`mt-2 inline-flex min-h-[44px] items-center text-sm font-semibold underline ${INK}`}>
            Open the full thread →
          </Link>
        )}
      </div>
    </section>
  )
}
