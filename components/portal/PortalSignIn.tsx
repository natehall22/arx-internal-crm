'use client'

import { useState } from 'react'

import PortalShell, { Panel, type PortalCompany } from '@/components/portal/PortalShell'

/** Sign-in: type your email or phone, we email a link. The answer is always the same words. */
export default function PortalSignIn({ company, problem }: { company: PortalCompany; problem?: 'link' | 'wait' | null }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!value.trim()) return setError('Type your email or phone number.')
    setBusy(true)
    const res = await fetch('/api/portal/request-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: value }) }).catch(() => null)
    setBusy(false)
    if (!res?.ok) return setError('Something went wrong. Please try again.')
    setSent(true)
  }

  return (
    <PortalShell company={company}>
      <Panel>
        {sent ? (
          <div>
            <h1 className="text-2xl font-bold">Check your email</h1>
            <p className="mt-2 text-lg">If we have you on file, we just emailed a sign-in link to the address we have for you. It works once and lasts 20 minutes.</p>
            <p className="mt-2 text-base">Nothing came? Check spam, or call us.</p>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h1 className="text-2xl font-bold">Your account</h1>
            <p className="mt-1 text-lg">See your visits, invoices and papers, pay, and message us.</p>
            {problem === 'link' ? <p role="alert" className="mt-3 rounded-lg bg-[#fef3c7] p-3 text-base font-semibold">That link has been used or has expired. Get a new one below.</p> : null}
            {problem === 'wait' ? <p role="alert" className="mt-3 rounded-lg bg-[#fef3c7] p-3 text-base font-semibold">Too many tries. Please wait a few minutes.</p> : null}
            <label htmlFor="portal-id" className="mt-4 block text-lg font-semibold">
              Your email or phone number
            </label>
            <input id="portal-id" name="identifier" autoComplete="email" inputMode="email" value={value} onChange={(e) => setValue(e.target.value)} className="mt-1 min-h-[52px] w-full rounded-lg border border-[#a8a69f] px-3 text-base text-[#2c2c2a]" />
            {error ? <p role="alert" className="mt-2 text-base font-semibold text-[#9b1c1c]">{error}</p> : null}
            <button type="submit" disabled={busy} className="mt-4 min-h-[52px] w-full rounded-xl bg-[#1f2937] px-4 text-lg font-bold text-white disabled:opacity-60">
              {busy ? 'Sending…' : 'Email me a link'}
            </button>
          </form>
        )}
      </Panel>
    </PortalShell>
  )
}
