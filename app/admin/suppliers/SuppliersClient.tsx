'use client'

import { useCallback, useEffect, useState } from 'react'

type LogEntry = { at: string; by: string | null; action: string; lines: string[] }
type Supplier = {
  id?: string
  updated_at?: string
  name: string
  active: boolean
  order_email: string | null
  order_cc_emails: string[] | null
  account_number: string | null
  default_branch: string | null
  default_delivery_notes: string | null
  default_for_trades: string[] | null
  connection_type: 'email' | 'api' | null
  last_order?: { to: string; at: string | null; po: string } | null
  log?: LogEntry[]
}

const EMPTY: Supplier = {
  name: '', active: true, order_email: '', order_cc_emails: [], account_number: '', default_branch: '',
  default_delivery_notes: '', default_for_trades: [], connection_type: 'email',
}

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/
const ctl = 'block w-full min-h-[44px] rounded-lg border border-[#8a877d] bg-white px-3 py-2 text-base text-[#2c2c2a]'
const btn = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[#5f5e5a] bg-white px-4 py-2 text-sm font-semibold text-[#2c2c2a] disabled:opacity-50'

const splitList = (v: string) => v.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '')

export default function SuppliersClient() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loaded, setLoaded] = useState(false)
  const [draft, setDraft] = useState<Supplier | null>(null)
  const [ccText, setCcText] = useState('')
  const [tradesText, setTradesText] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/suppliers')
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setMessage(json.error || 'Could not load suppliers')
      return setLoaded(true)
    }
    setSuppliers(json.suppliers)
    setLoaded(true)
  }, [])
  useEffect(() => { void load() }, [load])

  const openEditor = (s: Supplier) => {
    setDraft({ ...s })
    setCcText((s.order_cc_emails ?? []).join(', '))
    setTradesText((s.default_for_trades ?? []).join(', '))
    setFormError(null)
  }

  const validate = (d: Supplier): string | null => {
    if (!d.name.trim()) return 'Name is required.'
    const email = (d.order_email ?? '').trim()
    if (email && !EMAIL_RE.test(email)) return 'Order email must be one valid address like orders@supplier.com.'
    const bad = splitList(ccText).find((e) => !EMAIL_RE.test(e))
    if (bad) return `CC address "${bad}" is not a valid email.`
    return null
  }

  const save = async () => {
    if (!draft) return
    const problem = validate(draft)
    if (problem) return setFormError(problem)
    setSaving(true)
    setFormError(null)
    const res = await fetch('/api/admin/suppliers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...draft, order_cc_emails: splitList(ccText), default_for_trades: splitList(tradesText) }),
    })
    const json = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) return setFormError(json.error || 'Could not save')
    setMessage(json.unchanged ? 'No changes to save.' : 'Saved.')
    setDraft(null)
    await load()
  }

  return (
    <main className="mx-auto max-w-3xl p-4 pb-24 text-[#2c2c2a]">
      <h1 className="mb-1 mt-0 text-2xl font-bold">Suppliers</h1>
      <p className="mb-4 text-sm">Where purchase orders are emailed. Only owners can change this; every change is logged.</p>
      {message && <p role="status" className="mb-3 rounded-lg border border-[#d3d1c7] bg-white p-3 text-sm">{message}</p>}
      {!loaded && <p>Loading…</p>}

      <ul className="m-0 list-none space-y-3 p-0">
        {suppliers.map((s) => (
          <li key={s.id} className="rounded-lg border border-[#d3d1c7] bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-base">{s.name}</strong>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.active ? 'bg-green-100 text-green-900' : 'bg-gray-200 text-gray-900'}`}>
                {s.active ? 'Active' : 'Inactive'}
              </span>
            </div>
            <p className="mb-0 mt-2 break-words text-sm">
              Order email: {s.order_email ? s.order_email : <span className="font-semibold text-[#a32d2d]">none yet — orders can&apos;t be emailed</span>}
            </p>
            <p className="mb-0 mt-1 break-words text-sm">
              Last order sent to this address:{' '}
              {s.last_order ? <>{s.last_order.to} on {when(s.last_order.at)} ({s.last_order.po})</> : <span>no order sent yet</span>}
            </p>
            <p className="mb-0 mt-1 text-sm">Default for: {(s.default_for_trades ?? []).join(', ') || 'no trades'} · Sent by {s.connection_type === 'api' ? 'supplier API' : 'email'}</p>
            {(s.log ?? []).length > 0 && (
              <details className="mt-2">
                <summary className="flex min-h-[44px] cursor-pointer items-center text-sm font-semibold">Change history ({s.log!.length})</summary>
                <ul className="m-0 list-none space-y-2 p-0 text-sm">
                  {s.log!.map((l, i) => (
                    <li key={i} className="rounded border border-[#e6e4dc] p-2">
                      <div className="font-semibold">{l.action} · {new Date(l.at).toLocaleString()} · {l.by ?? 'someone'}</div>
                      {l.lines.map((line) => <div key={line} className="break-words">{line}</div>)}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="mt-3">
              <button type="button" className={`${btn} w-full sm:w-auto`} onClick={() => openEditor(s)}>Edit {s.name}</button>
            </div>
          </li>
        ))}
      </ul>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#d3d1c7] bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:static sm:mt-4 sm:border-0 sm:p-0">
        <button type="button" className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-[#2b0a3d] px-4 py-2 text-sm font-semibold text-white sm:w-auto" onClick={() => openEditor({ ...EMPTY })}>
          Add supplier
        </button>
      </div>

      {draft && (
        <div className="fixed inset-0 z-[100] flex items-end bg-black/50 sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true" aria-label={draft.id ? 'Edit supplier' : 'Add supplier'}>
          <div className="flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white sm:max-w-lg sm:rounded-xl">
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <h2 className="m-0 text-lg font-bold">{draft.id ? 'Edit supplier' : 'Add supplier'}</h2>
              <label className="block text-sm font-medium">Name
                <input className={ctl} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoComplete="off" />
              </label>
              <label className="block text-sm font-medium">Order email
                <input className={ctl} type="email" inputMode="email" autoCapitalize="none" value={draft.order_email ?? ''} onChange={(e) => setDraft({ ...draft, order_email: e.target.value })} placeholder="orders@supplier.com" />
              </label>
              <label className="block text-sm font-medium">CC emails (comma separated)
                <input className={ctl} inputMode="email" autoCapitalize="none" value={ccText} onChange={(e) => setCcText(e.target.value)} />
              </label>
              <label className="block text-sm font-medium">Account number
                <input className={ctl} value={draft.account_number ?? ''} onChange={(e) => setDraft({ ...draft, account_number: e.target.value })} />
              </label>
              <label className="block text-sm font-medium">Default branch
                <input className={ctl} value={draft.default_branch ?? ''} onChange={(e) => setDraft({ ...draft, default_branch: e.target.value })} />
              </label>
              <label className="block text-sm font-medium">Delivery notes (added to every order)
                <textarea className={ctl} rows={3} value={draft.default_delivery_notes ?? ''} onChange={(e) => setDraft({ ...draft, default_delivery_notes: e.target.value })} />
              </label>
              <label className="block text-sm font-medium">Default for trades (e.g. roofing, gutters)
                <input className={ctl} value={tradesText} onChange={(e) => setTradesText(e.target.value)} />
              </label>
              <label className="block text-sm font-medium">How orders are sent
                <select className={ctl} value={draft.connection_type ?? 'email'} onChange={(e) => setDraft({ ...draft, connection_type: e.target.value as 'email' | 'api' })}>
                  <option value="email">Email the order sheet</option>
                  <option value="api">Supplier API (only works once a connection is installed)</option>
                </select>
              </label>
              <label className="flex min-h-[44px] items-center gap-3 text-sm font-medium">
                <input type="checkbox" className="h-5 w-5" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
                Active
              </label>
              {formError && <p role="alert" className="m-0 text-sm font-semibold text-[#a32d2d]">{formError}</p>}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-[#e6e4dc] bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
              <button type="button" className={`${btn} w-full sm:w-auto`} onClick={() => setDraft(null)}>Cancel</button>
              <button type="button" className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-[#2b0a3d] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto" disabled={saving} onClick={save}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
