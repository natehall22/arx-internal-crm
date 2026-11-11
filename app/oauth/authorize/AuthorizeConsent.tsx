'use client'

import * as React from 'react'

type Props = { ticket: string; companyName: string; appLabel: string | null; claimedName: string | null; returnHost: string }

export default function AuthorizeConsent({ ticket, companyName, appLabel, claimedName, returnHost }: Props) {
  const [busy, setBusy] = React.useState<'allow' | 'deny' | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const known = appLabel !== null
  const appName = appLabel ?? claimedName ?? 'An app'

  async function answer(decision: 'allow' | 'deny') {
    setBusy(decision)
    setError(null)
    try {
      const res = await fetch('/api/oauth/consent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket, decision }) })
      const j = (await res.json().catch(() => ({}))) as { redirect?: string; error?: string }
      if (res.ok && j.redirect) {
        window.location.href = j.redirect
        return
      }
      setError(j.error ?? 'Something went wrong. Start again from your AI app.')
    } catch {
      setError('No connection. Try again.')
    }
    setBusy(null)
  }

  return (
    <main className="mx-auto max-w-md px-4 py-8 text-ink">
      <h1 className="text-2xl font-semibold">{known ? `${appName} wants to connect to ${companyName}` : `Connect an app to ${companyName}?`}</h1>
      {!known ? (
        <p className="mt-3 rounded-lg border border-amber-500 bg-amber-50 p-3 text-base">
          We do not recognize this app{claimedName ? ` (it calls itself “${claimedName}”)` : ''}. It will send you back to <strong>{returnHost}</strong>. Only continue if you set this up yourself.
        </p>
      ) : null}
      <section className="mt-5">
        <h2 className="text-base font-semibold">If you allow it, {known ? appName : 'the app'} can, as you:</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-base">
          <li>Look up customers, jobs, visits, invoices and notes that you can already see</li>
          <li>Run the reports you can already run</li>
        </ul>
      </section>
      <section className="mt-5">
        <h2 className="text-base font-semibold">It cannot:</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-base">
          <li>Change, delete or send anything</li>
          <li>See anything you cannot see yourself</li>
        </ul>
      </section>
      <p className="mt-5 text-base">Every request is logged. You can disconnect it any time under Settings, Connected AI apps.</p>
      {error ? (
        <p role="alert" className="mt-4 rounded-lg border border-red-600 bg-red-50 p-3 text-base">
          {error}
        </p>
      ) : null}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
        <button type="button" disabled={busy !== null} onClick={() => answer('allow')} className="min-h-[48px] rounded-lg bg-black px-5 text-base font-semibold text-white disabled:opacity-60">
          {busy === 'allow' ? 'Connecting…' : 'Allow'}
        </button>
        <button type="button" disabled={busy !== null} onClick={() => answer('deny')} className="min-h-[48px] rounded-lg border border-black px-5 text-base font-semibold text-black disabled:opacity-60">
          Cancel
        </button>
      </div>
    </main>
  )
}
