'use client'

import Link from 'next/link'
import * as React from 'react'

type Props = {
  id: string
  appName: string
  title: string
  lines: Array<{ label: string; value: string }>
  links: Array<{ label: string; path: string }>
  warnings: string[]
  status: string
  result: { summary: string; links: Array<{ label: string; path: string }> } | null
  writesOn: boolean
}

const DONE: Record<string, string> = {
  declined: 'You declined this change. Nothing was saved.',
  expired: 'This change expired (10 minutes). Nothing was saved. Ask the AI app for it again.',
  cancelled: 'This change was not saved (something changed, or the AI app was disconnected). Ask the AI app for it again.',
  failed: 'This change could not be saved. Nothing was added.',
  applying: 'This change is being saved. Check the record in a minute.',
}

/** Plain text only: React escapes every value, nothing here is rendered as HTML. */
export default function ReviewClient({ id, appName, title, lines, links, warnings, status, result, writesOn }: Props) {
  const [state, setState] = React.useState(status)
  const [saved, setSaved] = React.useState(result)
  const [busy, setBusy] = React.useState<'approve' | 'decline' | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function decide(decision: 'approve' | 'decline') {
    setBusy(decision)
    setError(null)
    try {
      const res = await fetch(`/api/ai-changes/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision }) })
      const j = (await res.json().catch(() => ({}))) as { error?: string; summary?: string; records?: Array<{ label: string; path: string }> }
      if (res.ok) {
        if (decision === 'decline') setState('declined')
        else {
          setState('applied')
          setSaved({ summary: j.summary ?? 'Saved.', links: j.records ?? [] })
        }
      } else setError(j.error ?? 'Something went wrong. Nothing was saved.')
    } catch {
      setError('No connection. Nothing was saved. Try again.')
    }
    setBusy(null)
  }

  return (
    <div className="pb-24">
      <h1 className="text-2xl font-semibold">{state === 'applied' ? 'Saved' : 'Approve this change?'}</h1>
      <p className="mt-2 text-base">{appName} prepared this for you. Nothing is saved until you approve it here.</p>
      <section className="mt-4 rounded-lg border border-black bg-white p-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <dl className="mt-3 space-y-2 text-base">
          {lines.map((l, i) => (
            <div key={i}>
              <dt className="font-semibold">{l.label}</dt>
              <dd className="whitespace-pre-wrap break-words">{l.value}</dd>
            </div>
          ))}
        </dl>
        {warnings.length > 0 ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-base">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        ) : null}
        {links.length > 0 ? (
          <p className="mt-3 flex flex-wrap gap-3 text-base">
            {links.map((l) => (
              <Link key={l.path} href={l.path} className="min-h-[44px] underline">
                {l.label}
              </Link>
            ))}
          </p>
        ) : null}
      </section>
      {state === 'applied' && saved ? (
        <section className="mt-4 rounded-lg border border-black bg-white p-4 text-base" role="status">
          <p className="font-semibold">{saved.summary}</p>
          <p className="mt-2 flex flex-wrap gap-3">
            {saved.links.map((l) => (
              <Link key={l.path} href={l.path} className="min-h-[44px] underline">
                {l.label}
              </Link>
            ))}
          </p>
        </section>
      ) : state !== 'pending' ? (
        <p className="mt-4 rounded-lg border border-black bg-white p-4 text-base" role="status">
          {DONE[state] ?? 'This change was not saved.'}
        </p>
      ) : !writesOn ? (
        <p className="mt-4 rounded-lg border border-black bg-white p-4 text-base">AI changes are turned off for your company right now, so this cannot be approved.</p>
      ) : (
        <div className="fixed inset-x-0 bottom-0 flex gap-3 border-t border-black bg-white p-3">
          <button type="button" disabled={busy !== null} onClick={() => decide('decline')} className="min-h-[48px] flex-1 rounded-lg border border-black bg-white px-4 text-base font-semibold text-ink">
            {busy === 'decline' ? 'Declining…' : 'Decline'}
          </button>
          <button type="button" disabled={busy !== null} onClick={() => decide('approve')} className="min-h-[48px] flex-1 rounded-lg bg-black px-4 text-base font-semibold text-white">
            {busy === 'approve' ? 'Saving…' : 'Approve'}
          </button>
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-4 rounded-lg border border-red-600 bg-red-50 p-3 text-base">
          {error}
        </p>
      ) : null}
    </div>
  )
}
