'use client'

import { useState } from 'react'

import type { PayPageView } from '@/lib/online-payments/public'

const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)

/** Dollars typed by a customer → whole cents, or null when it isn't a money amount. */
export function parseDollarsToCents(v: string): number | null {
  const t = v.replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  return Math.round(Number(t) * 100)
}

/**
 * Customer pay page body: one big Pay button (→ Stripe's own page: card, Apple Pay / Google Pay, or bank), so paying is
 * two taps. Optional: pay part (when the company allows it) and "save this card for automatic payments" (service
 * invoices). Plain, high-contrast, phone-first; no product name anywhere.
 */
export default function PayClient({ token, view, returned }: { token: string; view: PayPageView | null; returned: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [partOpen, setPartOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [saveCard, setSaveCard] = useState(false)

  if (!view) {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-[#2c2c2a]">This link isn’t active</h1>
        <p className="mt-2 text-base text-[#2c2c2a]">Please contact the company that sent it for a new link.</p>
      </Shell>
    )
  }

  async function go() {
    setError(null)
    let amountCents: number | null = null
    if (partOpen && amount.trim()) {
      amountCents = parseDollarsToCents(amount)
      if (amountCents === null) return setError('Enter an amount like 150 or 150.00')
    }
    setBusy(true)
    const res = await fetch(`/api/pay/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountCents, saveCard }),
    }).catch(() => null)
    const data = res ? ((await res.json().catch(() => ({}))) as { url?: string; error?: string }) : {}
    if (!res || !res.ok || !data.url) {
      setBusy(false)
      return setError(data.error || 'Something went wrong. Please try again.')
    }
    window.location.assign(data.url)
  }

  const { company, invoice } = view
  const contact = [company.phone, company.email].filter(Boolean).join(' · ')

  return (
    <Shell logo={company.logoHref} name={company.name}>
      {view.kind === 'save_card' ? (
        view.cardOnFile && returned ? (
          <Done title="Card saved" text={`${view.cardOnFile} will be charged automatically when an invoice is sent. Thank you!`} />
        ) : view.state === 'unavailable' ? (
          <Unavailable contact={contact} />
        ) : (
          <>
            <h1 className="text-xl font-bold text-[#2c2c2a]">Save a card for automatic payments</h1>
            {view.customerName ? <p className="mt-1 text-base text-[#2c2c2a]">{view.customerName}</p> : null}
            {view.cardOnFile ? <p className="mt-3 text-base text-[#2c2c2a]">On file now: {view.cardOnFile}. A new card replaces it.</p> : null}
            <p className="mt-4 rounded-lg bg-[#f1efe8] p-3 text-sm text-[#2c2c2a]">{view.consentText}</p>
            {error ? <p role="alert" className="mt-3 text-base font-semibold text-[#9b1c1c]">{error}</p> : null}
            <button type="button" onClick={() => void go()} disabled={busy} className="mt-5 min-h-[52px] w-full rounded-xl bg-[#1f2937] px-4 text-lg font-bold text-white disabled:opacity-60">
              {busy ? 'Opening…' : 'Agree and add card'}
            </button>
            <p className="mt-3 text-center text-sm text-[#2c2c2a]">Your card is entered on Stripe’s secure page — we never see the number.</p>
          </>
        )
      ) : view.state === 'paid' ? (
        <Done title="Paid — thank you!" text={invoice ? `Invoice ${invoice.number} is paid in full.` : ''} />
      ) : view.state === 'processing' ? (
        <Done title="Payment on its way" text="Your bank payment is processing. It usually takes 3–5 business days; you don’t need to do anything." />
      ) : view.state === 'void' ? (
        <Done title="Nothing to pay" text="This invoice was cancelled." />
      ) : view.state === 'unavailable' || !invoice ? (
        <Unavailable contact={contact} />
      ) : (
        <>
          {returned ? <p className="mb-3 rounded-lg bg-[#fef3c7] p-3 text-base text-[#2c2c2a]">The payment wasn’t finished. You can try again below.</p> : null}
          <p className="text-base text-[#2c2c2a]">Invoice {invoice.number}{view.customerName ? ` · ${view.customerName}` : ''}</p>
          <p className="mt-1 text-sm font-semibold uppercase tracking-wide text-[#2c2c2a]">Amount due</p>
          <p className="text-4xl font-bold tabular-nums text-[#2c2c2a]">{money(invoice.payableCents)}</p>
          {invoice.processingCents > 0 ? <p className="mt-1 text-sm text-[#2c2c2a]">{money(invoice.processingCents)} is already on its way from your bank.</p> : null}

          {view.allowPartial ? (
            partOpen ? (
              <label className="mt-4 block">
                <span className="text-base font-semibold text-[#2c2c2a]">Amount to pay now</span>
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={(invoice.payableCents / 100).toFixed(2)}
                  className="mt-1 min-h-[48px] w-full rounded-lg border border-[#a8a69f] px-3 text-base text-[#2c2c2a]"
                />
              </label>
            ) : (
              <button type="button" onClick={() => setPartOpen(true)} className="mt-3 min-h-[44px] text-base font-semibold text-[#1d4ed8] underline">
                Pay a different amount
              </button>
            )
          ) : null}

          {view.canSaveCard ? (
            <label className="mt-4 flex min-h-[44px] items-start gap-3 text-base text-[#2c2c2a]">
              <input type="checkbox" checked={saveCard} onChange={(e) => setSaveCard(e.target.checked)} className="mt-1 h-6 w-6 shrink-0" />
              <span>
                Save my card for automatic payments
                {saveCard ? <span className="mt-1 block text-sm">{view.consentText}</span> : null}
              </span>
            </label>
          ) : null}

          {error ? <p role="alert" className="mt-3 text-base font-semibold text-[#9b1c1c]">{error}</p> : null}
          <button type="button" onClick={() => void go()} disabled={busy} className="mt-5 min-h-[52px] w-full rounded-xl bg-[#1f2937] px-4 text-lg font-bold text-white disabled:opacity-60">
            {busy ? 'Opening…' : `Pay ${partOpen && amount ? `$${amount.replace(/^\$/, '')}` : money(invoice.payableCents)}`}
          </button>
          <p className="mt-3 text-center text-sm text-[#2c2c2a]">
            {view.bankPayments && !saveCard ? 'Card, Apple Pay / Google Pay or bank account' : 'Card, Apple Pay or Google Pay'} on Stripe’s secure page.
          </p>
        </>
      )}
      {view.portalOpen ? (
        <form method="post" action="/api/portal/open" className="mt-6 border-t border-[#e5e3dc] pt-4 text-center">
          <input type="hidden" name="source" value="pay" />
          <input type="hidden" name="token" value={token} />
          <button type="submit" className="min-h-[44px] text-base font-bold text-[#1d4ed8] underline">See everything on my account</button>
        </form>
      ) : null}
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

function Done({ title, text }: { title: string; text: string }) {
  return (
    <div className="text-center">
      <div aria-hidden className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#dcfce7] text-3xl text-[#166534]">✓</div>
      <h1 className="text-2xl font-bold text-[#2c2c2a]">{title}</h1>
      {text ? <p className="mt-2 text-base text-[#2c2c2a]">{text}</p> : null}
    </div>
  )
}

function Unavailable({ contact }: { contact: string }) {
  return (
    <>
      <h1 className="text-xl font-bold text-[#2c2c2a]">Online payment isn’t available right now</h1>
      <p className="mt-2 text-base text-[#2c2c2a]">{contact ? `Please contact us: ${contact}` : 'Please contact the company that sent this link.'}</p>
    </>
  )
}
