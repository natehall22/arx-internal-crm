'use client'

/**
 * Job catch-up on screen: the one-line summary (board card + list) and the "Where this stands" box (job page).
 * Everything shown is derived in lib/job-catch-up.ts — this file only renders it. No dollar amounts, ever.
 */
import Link from 'next/link'

import { formatDateTime } from '@/lib/format'
import type { CatchUpUpdate, JobCatchUpResult } from '@/lib/job-catch-up'

const INK = 'text-[#2c2c2a]'

/** "Steve · Waiting on permit · 2d" — amber with a "Stuck" tag when it needs someone. */
export function JobCatchUpLine({ catchUp, className = '' }: { catchUp: JobCatchUpResult; className?: string }) {
  return (
    <p
      data-testid="catch-up-line"
      data-stuck={catchUp.stuck ? 'true' : 'false'}
      title={catchUp.stuck ? catchUp.reasons.join(' ') : undefined}
      className={`text-sm leading-snug break-words ${catchUp.stuck ? 'rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-amber-950' : INK} ${className}`}
    >
      {catchUp.stuck && <span className="mr-1 font-semibold">Stuck ·</span>}
      {catchUp.line}
    </p>
  )
}

function UpdateRow({ u }: { u: CatchUpUpdate }) {
  return (
    <li className={`text-sm ${INK}`}>
      <span className="font-medium">{u.who ?? (u.kind === 'event' ? 'System' : 'Automated')}</span>
      <span> · {formatDateTime(u.at)}</span>
      <span className="block break-words">{u.what}</span>
    </li>
  )
}

/** The box at the top of the job page. Same derivation as the board line. */
export function JobCatchUpBox({ catchUp }: { catchUp: JobCatchUpResult }) {
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
        <div><dt className="inline font-semibold">Owner: </dt><dd className="inline break-words">{catchUp.owner}</dd></div>
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
