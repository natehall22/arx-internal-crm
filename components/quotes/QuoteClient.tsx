'use client'

import { useMemo, useState } from 'react'

import { priceQuote } from '@/lib/quotes/pricing'
import { depositCents } from '@/lib/quotes/settings'
import { legacyTaxLabel, taxLineLabel } from '@/lib/sales-tax'
import type { QuoteView } from '@/lib/quotes/load'

const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)

/**
 * The customer's quote page (`/q/<token>`, no login, the company's brand only). Tick the optional items and the total, tax
 * and deposit update at once (the SAME pricing function the server re-checks at approval); type your name, tick to agree,
 * Approve. After approval: a receipt and a Pay deposit button (the existing Stripe pay page). Phone first, black text,
 * 44px+ tap targets, inputs 16px+.
 */
export default function QuoteClient({ token, view }: { token: string; view: QuoteView | null }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(view?.options.filter((o) => o.defaultOn).map((o) => o.id) ?? []))
  const [name, setName] = useState('')
  const [agree, setAgree] = useState(false)
  const [termsOpen, setTermsOpen] = useState(false)
  const [busy, setBusy] = useState<'approve' | 'deposit' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const price = useMemo(
    () =>
      view
        ? priceQuote({ lines: view.lines, selectedOptionalIds: picked, discountPercent: view.discountPercent, discountAmount: view.discountAmount, tax: view.tax })
        : null,
    [view, picked]
  )
  if (!view || !price) return <Shell><h1 className="text-xl font-bold text-[#2c2c2a]">This link isn’t active</h1><p className="mt-2 text-base text-[#2c2c2a]">Please contact the company that sent it for a new link.</p></Shell>

  const contact = [view.company.phone, view.company.email].filter(Boolean).join(' · ')
  const dep = depositCents(price.totalCents, { mode: view.depositMode as 'none' | 'percent' | 'fixed', percent: view.depositPercent, fixedCents: view.depositFixedCents })

  if (view.state === 'expired' || view.state === 'unavailable') {
    return (
      <Shell company={view.company}>
        <h1 className="text-xl font-bold text-[#2c2c2a]">{view.state === 'expired' ? 'This quote has expired' : 'This quote is no longer open'}</h1>
        <p className="mt-2 text-base text-[#2c2c2a]">Please contact us and we’ll send you an updated one.</p>
        {contact ? <p className="mt-4 text-base text-[#2c2c2a]">{contact}</p> : null}
      </Shell>
    )
  }

  async function approve() {
    setError(null)
    if (name.trim().length < 2) return setError('Type your full name to approve')
    if (!agree) return setError('Please tick the box to agree')
    setBusy('approve')
    const res = await fetch(`/api/q/${token}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ typedName: name, selectedIds: Array.from(picked), fingerprint: view!.fingerprint, agreed: true }),
    }).catch(() => null)
    const data = res ? ((await res.json().catch(() => ({}))) as { error?: string; changed?: boolean }) : {}
    if (!res || !res.ok) {
      setBusy(null)
      if (data.changed) {
        setError(data.error ?? 'This quote was just updated.')
        window.setTimeout(() => window.location.reload(), 1500)
        return
      }
      return setError(data.error || 'Something went wrong. Please try again.')
    }
    setDone(true)
    window.location.reload()
  }

  async function payDeposit() {
    setError(null)
    setBusy('deposit')
    const res = await fetch(`/api/q/${token}/deposit`, { method: 'POST' }).catch(() => null)
    const data = res ? ((await res.json().catch(() => ({}))) as { url?: string; error?: string }) : {}
    if (!res || !res.ok || !data.url) {
      setBusy(null)
      return setError(data.error || 'Something went wrong. Please try again.')
    }
    window.location.assign(data.url)
  }

  const a = view.approval
  const taxRows = price.legacy
    ? [{ label: legacyTaxLabel(view.tax.kind === 'legacy' ? view.tax.percent : 0), cents: price.taxCents }]
    : price.exempt
      ? [{ label: 'Sales tax (exempt)', cents: 0 }]
      : price.taxLines.map((l) => ({ label: taxLineLabel(l), cents: l.amount_cents }))

  return (
    <Shell company={view.company} bottomBar={!a}>
      <p className="text-sm font-semibold uppercase tracking-wide text-[#2c2c2a]">{view.title}{view.number ? ` · ${view.number}` : ''}</p>
      <h1 className="mt-1 text-2xl font-bold text-[#2c2c2a]">{view.customerName ? `For ${view.customerName}` : 'Your quote'}</h1>
      {view.address ? <p className="mt-1 text-base text-[#2c2c2a]">{view.address}</p> : null}
      {view.scope ? <p className="mt-3 whitespace-pre-line text-base text-[#2c2c2a]">{view.scope}</p> : null}

      {a ? (
        <div className="mt-5 rounded-xl border border-[#1f7a3d] bg-[#e8f5ec] p-4">
          <h2 className="text-xl font-bold text-[#2c2c2a]">Approved — thank you!</h2>
          <p className="mt-1 text-base text-[#2c2c2a]">Approved by {a.typedName} on {new Date(a.approvedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.</p>
          {a.chosenNames.length > 0 ? <p className="mt-2 text-base text-[#2c2c2a]">Included: {a.chosenNames.join(', ')}</p> : null}
          <p className="mt-2 text-lg font-bold text-[#2c2c2a]">Total {money(a.totalCents)}</p>
          {a.depositState === 'paid' ? <p className="mt-1 text-base font-semibold text-[#2c2c2a]">Deposit {money(a.depositCents)} paid. Thank you!</p> : null}
          {a.depositState === 'due' ? (
            <>
              <p className="mt-1 text-base text-[#2c2c2a]">A deposit of {money(a.depositCents)} is due.</p>
              {a.canPayOnline ? (
                <button type="button" onClick={() => void payDeposit()} disabled={busy !== null} className="mt-3 min-h-[52px] w-full rounded-xl bg-[#1f2937] px-4 text-lg font-bold text-white disabled:opacity-60">
                  {busy === 'deposit' ? 'Opening…' : `Pay ${money(a.depositCents)} deposit`}
                </button>
              ) : (
                <p className="mt-1 text-base text-[#2c2c2a]">We’ll be in touch about paying it.</p>
              )}
            </>
          ) : null}
          {a.depositState === 'pending' ? <p className="mt-1 text-base text-[#2c2c2a]">We’re finishing setting this up. Please check back in a few minutes.</p> : null}
          {error ? <p role="alert" className="mt-2 text-base font-semibold text-[#9b1c1c]">{error}</p> : null}
        </div>
      ) : null}

      {view.required.length > 0 || view.hiddenRequiredCents > 0 ? (
        <section className="mt-6" aria-label="Included">
          <h2 className="text-lg font-bold text-[#2c2c2a]">Included</h2>
          <ul className="mt-2 divide-y divide-[#e5e3dc] rounded-xl border border-[#d6d3c9]">
            {view.required.map((l) => (
              <li key={l.id} className="flex items-start justify-between gap-3 p-3">
                <span className="text-base text-[#2c2c2a]"><span className="font-semibold">{l.name}</span>{l.description ? <span className="block text-sm">{l.description}</span> : null}</span>
                <span className="shrink-0 text-base font-semibold tabular-nums text-[#2c2c2a]">{money(l.cents)}</span>
              </li>
            ))}
            {view.hiddenRequiredCents > 0 ? (
              <li className="flex items-start justify-between gap-3 p-3">
                <span className="text-base font-semibold text-[#2c2c2a]">Other included work</span>
                <span className="shrink-0 text-base font-semibold tabular-nums text-[#2c2c2a]">{money(view.hiddenRequiredCents)}</span>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {view.options.length > 0 ? (
        <section className="mt-6" aria-label="Optional extras">
          <h2 className="text-lg font-bold text-[#2c2c2a]">{a ? 'Optional extras' : 'Optional extras — tick what you want'}</h2>
          <ul className="mt-2 space-y-2">
            {view.options.map((o) => {
              const on = a ? a.chosenNames.includes(o.name) : picked.has(o.id)
              return (
                <li key={o.id}>
                  <label className={`flex min-h-[56px] items-start gap-3 rounded-xl border p-3 ${on ? 'border-[#1f2937] bg-[#f1efe8]' : 'border-[#d6d3c9]'} ${a ? '' : 'cursor-pointer'}`}>
                    <input
                      type="checkbox"
                      className="mt-1 h-6 w-6 shrink-0"
                      checked={on}
                      disabled={!!a}
                      onChange={(e) =>
                        setPicked((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(o.id)
                          else next.delete(o.id)
                          return next
                        })
                      }
                    />
                    <span className="flex-1 text-base text-[#2c2c2a]"><span className="font-semibold">{o.name}</span>{o.description ? <span className="block text-sm">{o.description}</span> : null}</span>
                    <span className="shrink-0 text-base font-semibold tabular-nums text-[#2c2c2a]">{money(o.cents)}</span>
                  </label>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      <section className="mt-6 rounded-xl bg-[#f1efe8] p-4" aria-label="Total" aria-live="polite">
        {a ? null : (
          <>
            <Row label="Subtotal" value={money(price.subtotalCents)} />
            {price.discountCents > 0 ? <Row label="Discount" value={`-${money(price.discountCents)}`} /> : null}
            {taxRows.map((r) => <Row key={r.label} label={r.label} value={money(r.cents)} />)}
          </>
        )}
        <div className="flex items-baseline justify-between pt-1">
          <span className="text-lg font-bold text-[#2c2c2a]">Total</span>
          <span data-testid="quote-total" className="text-3xl font-bold tabular-nums text-[#2c2c2a]">{money(a ? a.totalCents : price.totalCents)}</span>
        </div>
        {!a && dep > 0 ? <Row label="Deposit due after you approve" value={money(dep)} bold /> : null}
      </section>

      {!a ? (
        <>
          {view.terms ? (
            <section className="mt-5">
              <button type="button" onClick={() => setTermsOpen(!termsOpen)} aria-expanded={termsOpen} className="min-h-[44px] text-base font-semibold text-[#1d4ed8] underline">
                {termsOpen ? 'Hide terms' : 'Read the terms'}
              </button>
              {termsOpen ? <p className="mt-2 whitespace-pre-line rounded-lg border border-[#d6d3c9] p-3 text-sm text-[#2c2c2a]">{view.terms}</p> : null}
            </section>
          ) : null}
          <section className="mt-5" aria-label="Approve">
            <label className="block">
              <span className="text-base font-semibold text-[#2c2c2a]">Type your full name to approve</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="mt-1 min-h-[48px] w-full rounded-lg border border-[#a8a69f] px-3 text-base text-[#2c2c2a]" />
            </label>
            <label className="mt-3 flex min-h-[44px] items-start gap-3 text-base text-[#2c2c2a]">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 h-6 w-6 shrink-0" />
              <span>I approve this quote for {money(price.totalCents)}{view.terms ? ' and agree to the terms' : ''}.</span>
            </label>
            {error ? <p role="alert" className="mt-3 text-base font-semibold text-[#9b1c1c]">{error}</p> : null}
          </section>
        </>
      ) : null}

      {contact ? <p className="mt-6 border-t border-[#e5e3dc] pt-4 text-center text-sm text-[#2c2c2a]">Questions? {contact}</p> : null}

      {!a ? (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-[#d6d3c9] bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-xl items-center gap-3">
            <div className="min-w-0 flex-1 text-[#2c2c2a]"><div className="text-sm font-semibold">Total</div><div className="text-xl font-bold tabular-nums">{money(price.totalCents)}</div></div>
            <button type="button" onClick={() => void approve()} disabled={busy !== null || done} className="min-h-[52px] flex-1 rounded-xl bg-[#1f2937] px-4 text-lg font-bold text-white disabled:opacity-60">
              {busy === 'approve' ? 'Approving…' : 'Approve'}
            </button>
          </div>
        </div>
      ) : null}
    </Shell>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between py-0.5 text-base text-[#2c2c2a]">
      <span className={bold ? 'font-semibold' : ''}>{label}</span>
      <span className={`tabular-nums ${bold ? 'font-bold' : ''}`}>{value}</span>
    </div>
  )
}

function Shell({ children, company, bottomBar }: { children: React.ReactNode; company?: QuoteView['company']; bottomBar?: boolean }) {
  return (
    <main className={`mx-auto min-h-screen max-w-xl bg-white px-4 py-5 text-[#2c2c2a] ${bottomBar ? 'pb-32' : 'pb-10'}`}>
      {company ? (
        <header className="mb-4 flex items-center gap-3">
          {company.logoHref ? <img src={company.logoHref} alt={company.name} className="max-h-12 max-w-[200px]" /> : <span className="text-xl font-bold text-[#2c2c2a]">{company.name}</span>}
        </header>
      ) : null}
      {children}
    </main>
  )
}
