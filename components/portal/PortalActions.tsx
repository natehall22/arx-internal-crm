'use client'

import { useEffect, useState } from 'react'

import { consentText } from '@/lib/sms/consent-text'

async function post(url: string, body: unknown): Promise<{ ok: boolean; data: { url?: string; error?: string } }> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
  const data = res ? ((await res.json().catch(() => ({}))) as { url?: string; error?: string }) : {}
  return { ok: !!res?.ok, data: res ? data : { error: 'Something went wrong. Please try again.' } }
}

/** One big Pay button: asks for the company's existing pay page for this invoice, then goes there. */
export function PayButton({ invoiceId, label }: { invoiceId: string; label: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function go() {
    setBusy(true)
    setError(null)
    const r = await post(`/api/portal/invoices/${invoiceId}/pay`, {})
    if (!r.ok || !r.data.url) {
      setBusy(false)
      return setError(r.data.error || 'Something went wrong. Please try again.')
    }
    window.location.assign(r.data.url)
  }
  return (
    <div>
      <button type="button" onClick={() => void go()} disabled={busy} className="min-h-[48px] rounded-xl bg-[#1f2937] px-5 text-base font-bold text-white disabled:opacity-60">
        {busy ? 'Opening…' : label}
      </button>
      {error ? <p role="alert" className="mt-1 text-base font-semibold text-[#9b1c1c]">{error}</p> : null}
    </div>
  )
}

/** Saved card: turn automatic payments off, remove the card, or add one (on Stripe's page — turning it ON needs the customer's own consent there). */
export function CardControls({ card }: { card: { available: boolean; label: string | null; autopay: boolean; expired: boolean } }) {
  const [state, setState] = useState(card)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function act(action: 'autopay_off' | 'remove' | 'save') {
    setBusy(true)
    setError(null)
    const r = await post('/api/portal/card', { action })
    if (!r.ok) {
      setBusy(false)
      return setError(r.data.error || 'Something went wrong. Please try again.')
    }
    if (action === 'save' && r.data.url) return window.location.assign(r.data.url)
    setBusy(false)
    setState((s) => (action === 'remove' ? { ...s, label: null, autopay: false } : { ...s, autopay: false }))
  }
  const btn = 'min-h-[48px] rounded-xl border border-[#a8a69f] bg-white px-4 text-base font-bold text-[#2c2c2a] disabled:opacity-60'
  return (
    <div>
      {state.label ? (
        <>
          <p className="text-lg font-semibold">{state.label}{state.expired ? ' (expired)' : ''}</p>
          <p className="mt-1 text-base">{state.autopay ? 'Automatic payments are ON: your invoices are paid with this card when we send them.' : 'Automatic payments are off.'}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {state.autopay ? <button type="button" className={btn} disabled={busy} onClick={() => void act('autopay_off')}>Turn off automatic payments</button> : null}
            {state.available ? <button type="button" className={btn} disabled={busy} onClick={() => void act('save')}>{state.autopay ? 'Use a different card' : 'Turn on with a card'}</button> : null}
            <button type="button" className={btn} disabled={busy} onClick={() => void act('remove')}>Remove card</button>
          </div>
        </>
      ) : state.available ? (
        <>
          <p className="text-base">Save a card and we will pay your invoices for you when we send them. You can turn it off any time.</p>
          <button type="button" className={`${btn} mt-3`} disabled={busy} onClick={() => void act('save')}>Add a card</button>
        </>
      ) : (
        <p className="text-base">No card on file.</p>
      )}
      {error ? <p role="alert" className="mt-2 text-base font-semibold text-[#9b1c1c]">{error}</p> : null}
    </div>
  )
}

/** Write to the company. */
export function MessageBox({ onSent }: { onSent: (body: string) => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return setError('Write your message first.')
    setBusy(true)
    setError(null)
    const r = await post('/api/portal/messages', { body: text })
    setBusy(false)
    if (!r.ok) return setError(r.data.error || 'Something went wrong. Please try again.')
    onSent(text.trim())
    setText('')
  }
  return (
    <form onSubmit={send} className="mt-3">
      <label htmlFor="portal-msg" className="block text-base font-semibold">Write to us</label>
      <textarea id="portal-msg" value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={2000} className="mt-1 w-full rounded-lg border border-[#a8a69f] p-3 text-base text-[#2c2c2a]" />
      {error ? <p role="alert" className="mt-1 text-base font-semibold text-[#9b1c1c]">{error}</p> : null}
      <button type="submit" disabled={busy} className="mt-2 min-h-[48px] w-full rounded-xl bg-[#1f2937] px-4 text-base font-bold text-white disabled:opacity-60">
        {busy ? 'Sending…' : 'Send message'}
      </button>
    </form>
  )
}

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="min-h-[48px] rounded-xl border border-[#a8a69f] bg-white px-4 text-base font-bold text-[#2c2c2a] print:hidden">
      Print or save as PDF
    </button>
  )
}

/** "Text me" box: one checkbox with the exact consent words next to it. Only rendered when the company has texting on. */
export function TextsToggle({ companyName }: { companyName: string }) {
  const [state, setState] = useState<{ available: boolean; on: boolean; stopped: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void fetch('/api/portal/texting').then((r) => r.json()).then((d) => setState({ available: !!d.available, on: !!d.on, stopped: !!d.stopped })).catch(() => setState({ available: false, on: false, stopped: false }))
  }, [])
  if (!state?.available) return null
  async function change(on: boolean) {
    setBusy(true)
    setError(null)
    const r = await post('/api/portal/texting', { on })
    setBusy(false)
    if (!r.ok) return setError(r.data.error || 'Something went wrong. Please try again.')
    setState((s) => (s ? { ...s, on } : s))
  }
  return (
    <label className="flex min-h-[44px] items-start gap-3 text-base text-[#2c2c2a]">
      <input type="checkbox" className="mt-1 h-6 w-6 shrink-0" checked={state.on} disabled={busy} onChange={(e) => void change(e.target.checked)} />
      <span>
        {consentText(companyName)}
        {error ? <span role="alert" className="mt-1 block font-semibold text-[#9b1c1c]">{error}</span> : null}
      </span>
    </label>
  )
}
