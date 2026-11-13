'use client'

import * as React from 'react'

type Props = { ticket: string; companyName: string; appLabel: string | null; claimedName: string | null; returnHost: string; asksForWrites?: boolean; writesAvailable?: boolean }

export default function AuthorizeConsent({ ticket, companyName, appLabel, claimedName, returnHost, asksForWrites = false, writesAvailable = false }: Props) {
  const [allowWrites, setAllowWrites] = React.useState(false)
  const [busy, setBusy] = React.useState<'allow' | 'deny' | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const known = appLabel !== null
  const appName = appLabel ?? claimedName ?? 'An app'

  async function answer(decision: 'allow' | 'deny') {
    setBusy(decision)
    setError(null)
    try {
      const res = await fetch('/api/oauth/consent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket, decision, allowWrites: allowWrites && asksForWrites && writesAvailable }) })
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
    <main className="min-h-dvh bg-white"><div className="mx-auto max-w-md px-4 py-8 text-ink">
      <h1 className="text-2xl font-semibold">{`${appName} wants to connect to ${companyName}`}</h1>
      <p className="mt-3 rounded-lg border border-amber-500 bg-amber-50 p-3 text-base">
        <strong>Only continue if you started this yourself</strong>, by connecting {companyName} from inside your own AI app just now. If someone sent you here, or you did not ask for this, press Cancel.
      </p>
      <dl className="mt-4 rounded-lg border border-black p-3 text-base">
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-semibold">App:</dt>
          <dd>{claimedName && claimedName !== appLabel ? `${appName} (it calls itself “${claimedName}”)` : appName}{known ? '' : ' (not an app we recognize)'}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-semibold">Sends you back to:</dt>
          <dd className="break-all">{returnHost}</dd>
        </div>
      </dl>
      <section className="mt-5">
        <h2 className="text-base font-semibold">If you allow it, {known ? appName : 'the app'} can, as you:</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-base">
          <li>Look up customers, jobs, visits, invoices and notes that you can already see</li>
          <li>Run the reports you can already run</li>
        </ul>
      </section>
      {asksForWrites && writesAvailable ? (
        <section className="mt-5 rounded-lg border border-black p-3">
          <label className="flex min-h-[44px] items-start gap-3 text-base">
            <input type="checkbox" className="mt-1 h-6 w-6 shrink-0" checked={allowWrites} onChange={(e) => setAllowWrites(e.target.checked)} />
            <span>
              <strong>Also let it propose changes.</strong> It can add a note, log a call, add a lead or customer, move a service visit, add a job cost, or start a draft invoice or purchase order. Nothing is saved by the AI: each change waits in the CRM, and only you can approve it there after seeing exactly what will change. Leave this unticked to let it look things up only.
            </span>
          </label>
        </section>
      ) : asksForWrites ? (
        <p className="mt-5 text-base">This app also asked to make changes, but {companyName} has not turned that on, so it will only be able to look things up.</p>
      ) : null}
      <section className="mt-5">
        <h2 className="text-base font-semibold">It can never:</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-base">
          <li>Delete anything, or send an email, text, invoice or order</li>
          <li>Take a payment, approve payroll, or change anyone&apos;s access or settings</li>
          <li>{allowWrites ? 'Save a change unless you approve it yourself in the CRM' : 'Change anything'}</li>
          <li>See anything you cannot see yourself</li>
        </ul>
      </section>
      <p className="mt-5 text-base">Every request is logged. You can disconnect it any time under Settings, Connect your AI.</p>
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
    </div></main>
  )
}
