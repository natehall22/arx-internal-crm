'use client'

import { useState } from 'react'

import type { PublicSelectionView } from '@/lib/project-tools/selections-public'

const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

/** How an option compares with the allowance, in plain words. */
function diffText(price: number, allowance: number): { text: string; tone: 'over' | 'ok' } {
  const d = Math.round((price - allowance) * 100) / 100
  if (d > 0) return { text: `${money(d)} over your allowance`, tone: 'over' }
  if (d < 0) return { text: `${money(-d)} under your allowance`, tone: 'ok' }
  return { text: 'Right on your allowance', tone: 'ok' }
}

/**
 * Customer selection page body. Pick an option, type your name, tap Approve (3 taps). Over the allowance, the next screen
 * is the company's change order to sign; within it, you are done. Plain, high-contrast, phone-first, company brand only.
 */
export default function SelectionClient({ token, view }: { token: string; view: PublicSelectionView | null }) {
  const [optionId, setOptionId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<null | 'approved'>(null)

  if (!view) {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-[#2c2c2a]">This link isn’t active</h1>
        <p className="mt-2 text-base text-[#2c2c2a]">Please contact the company that sent it for a new link.</p>
      </Shell>
    )
  }
  const contact = [view.company.phone, view.company.email].filter(Boolean).join(' · ')
  const picked = view.options.find((o) => o.id === optionId) ?? null

  async function approve() {
    if (!picked) return setError('Pick one first')
    if (!name.trim()) return setError('Please type your name')
    setError(null)
    setBusy(true)
    const res = await fetch(`/api/public/selections/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ optionId: picked.id, name }) }).catch(() => null)
    const data = res ? ((await res.json().catch(() => ({}))) as { error?: string; signingUrl?: string | null }) : {}
    if (!res || !res.ok) {
      setBusy(false)
      return setError(data.error || 'Something went wrong. Please try again.')
    }
    if (data.signingUrl) {
      window.location.assign(data.signingUrl)
      return
    }
    setBusy(false)
    setDone('approved')
  }

  return (
    <Shell logo={view.company.logoHref} name={view.company.name}>
      {view.state === 'chosen' || done ? (
        <div className="text-center">
          <div aria-hidden className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#dcfce7] text-3xl text-[#166534]">✓</div>
          <h1 className="text-2xl font-bold text-[#2c2c2a]">{done ? 'Thank you!' : 'Already chosen'}</h1>
          <p className="mt-2 text-base text-[#2c2c2a]">{view.item}{picked ? `: ${picked.label}` : view.chosenLabel ? `: ${view.chosenLabel}` : ''}</p>
          {view.signingUrl && !done ? (
            <>
              <p className="mt-3 text-base text-[#2c2c2a]">One more step: sign the change order for the difference.</p>
              <a href={view.signingUrl} className="mt-3 inline-flex min-h-[52px] w-full items-center justify-center rounded-xl bg-[#1f2937] px-4 text-lg font-bold text-white">Sign the change order</a>
            </>
          ) : null}
        </div>
      ) : (
        <>
          <p className="text-sm font-semibold uppercase tracking-wide text-[#2c2c2a]">Your selection</p>
          <h1 className="text-2xl font-bold text-[#2c2c2a]">{view.item}</h1>
          <p className="mt-1 text-base text-[#2c2c2a]">Your allowance: <strong>{money(view.allowance)}</strong>{view.dueDate ? ` · please choose by ${view.dueDate}` : ''}</p>
          <div role="radiogroup" aria-label="Options" className="mt-4 space-y-3">
            {view.options.map((o) => {
              const d = diffText(o.price, view.allowance)
              const on = o.id === optionId
              return (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setOptionId(o.id)}
                  className={`min-h-[64px] w-full rounded-xl border-2 px-4 py-3 text-left ${on ? 'border-[#1f2937] bg-[#f1efe8]' : 'border-[#a8a69f] bg-white'}`}
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="text-lg font-bold text-[#2c2c2a]">{o.label}</span>
                    <span className="text-lg font-bold tabular-nums text-[#2c2c2a]">{money(o.price)}</span>
                  </span>
                  <span className={`block text-base font-semibold ${d.tone === 'over' ? 'text-[#9b1c1c]' : 'text-[#166534]'}`}>{d.text}</span>
                </button>
              )
            })}
          </div>
          {picked && picked.price > view.allowance ? (
            <p className="mt-3 rounded-lg bg-[#fef3c7] p-3 text-base text-[#2c2c2a]">
              The {money(Math.round((picked.price - view.allowance) * 100) / 100)} difference is added to your contract. After you approve, you will sign a short change order.
            </p>
          ) : null}
          <label className="mt-4 block">
            <span className="text-base font-semibold text-[#2c2c2a]">Your name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="mt-1 min-h-[48px] w-full rounded-lg border border-[#a8a69f] px-3 text-base text-[#2c2c2a]" />
          </label>
          {error ? <p role="alert" className="mt-3 text-base font-semibold text-[#9b1c1c]">{error}</p> : null}
          <button type="button" onClick={() => void approve()} disabled={busy || !picked} className="mt-5 min-h-[52px] w-full rounded-xl bg-[#1f2937] px-4 text-lg font-bold text-white disabled:opacity-60">
            {busy ? 'Saving…' : picked ? `Approve ${picked.label}` : 'Pick an option'}
          </button>
        </>
      )}
      {contact ? <p className="mt-6 border-t border-[#e5e3dc] pt-4 text-center text-sm text-[#2c2c2a]">Questions? {contact}</p> : null}
    </Shell>
  )
}

function Shell({ children, logo, name }: { children: React.ReactNode; logo?: string | null; name?: string }) {
  return (
    <main className="min-h-[100dvh] bg-[#f7f6f2] px-4 py-8">
      <div className="mx-auto max-w-md">
        {logo || name ? (
          <div className="mb-4 flex items-center gap-3">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" className="h-12 w-auto max-w-[160px] object-contain" />
            ) : null}
            {name ? <span className="text-lg font-bold text-[#2c2c2a]">{name}</span> : null}
          </div>
        ) : null}
        <div className="rounded-2xl border border-[#e5e3dc] bg-white p-5 shadow-sm">{children}</div>
      </div>
    </main>
  )
}
