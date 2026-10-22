'use client'

import { useCallback, useEffect, useState } from 'react'

type Supplier = {
  id?: string
  name: string
  active: boolean
  order_email: string | null
  order_cc_emails: string[] | null
  account_number: string | null
  default_branch: string | null
  default_delivery_notes: string | null
  default_for_trades: string[] | null
  connection_type?: 'email' | 'api' | null
}

const EMPTY: Supplier = {
  name: '', active: true, order_email: '', order_cc_emails: [], account_number: '',
  default_branch: '', default_delivery_notes: '', default_for_trades: [],
}
const INK = '#2c2c2a'

export default function SuppliersClient() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [draft, setDraft] = useState<Supplier | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/suppliers')
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return setMessage(json.error || 'Could not load suppliers')
    setSuppliers(json.suppliers)
    setCanEdit(json.canEdit)
  }, [])
  useEffect(() => { void load() }, [load])

  const save = async () => {
    if (!draft) return
    const res = await fetch('/api/admin/suppliers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return setMessage(json.error || 'Could not save')
    setMessage('Saved')
    setDraft(null)
    await load()
  }

  const field = (label: string, value: string, onChange: (v: string) => void, hint?: string) => (
    <label style={{ display: 'block', margin: '8px 0', color: INK }}>
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} style={{ display: 'block', width: '100%', padding: 6, color: INK }} />
      {hint && <small>{hint}</small>}
    </label>
  )

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 16, color: INK, background: '#fff' }}>
      <h1>Suppliers</h1>
      <p>Where purchase orders are emailed, and which trades each supplier is the default for.</p>
      {message && <p>{message}</p>}
      {suppliers.map((s) => (
        <div key={s.id} style={{ borderTop: '1px solid #d3d1c7', padding: '8px 0' }}>
          <strong>{s.name}</strong> {s.active ? '' : '(inactive)'} — {s.order_email || 'no order email yet'}
          <br />Default for: {(s.default_for_trades ?? []).join(', ') || 'no trades'}
          {canEdit && <> <button type="button" onClick={() => setDraft(s)}>Edit</button></>}
        </div>
      ))}
      {canEdit && !draft && <button type="button" onClick={() => setDraft({ ...EMPTY })}>Add supplier</button>}
      {draft && (
        <div style={{ marginTop: 16, border: '1px solid #5f5e5a', padding: 12, borderRadius: 8 }}>
          {field('Name', draft.name, (v) => setDraft({ ...draft, name: v }))}
          {field('Order email', draft.order_email ?? '', (v) => setDraft({ ...draft, order_email: v }))}
          {field('Also cc (comma separated)', (draft.order_cc_emails ?? []).join(', '), (v) =>
            setDraft({ ...draft, order_cc_emails: v.split(',').map((x) => x.trim()).filter(Boolean) }))}
          {field('Account number', draft.account_number ?? '', (v) => setDraft({ ...draft, account_number: v }))}
          {field('Branch', draft.default_branch ?? '', (v) => setDraft({ ...draft, default_branch: v }))}
          {field('Delivery notes on every order', draft.default_delivery_notes ?? '', (v) => setDraft({ ...draft, default_delivery_notes: v }))}
          {field('Default for trades (comma separated, e.g. roofing, gutters)', (draft.default_for_trades ?? []).join(', '), (v) =>
            setDraft({ ...draft, default_for_trades: v.split(',').map((x) => x.trim()).filter(Boolean) }))}
          <label style={{ color: INK }}>
            <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Active
          </label>
          <div style={{ marginTop: 8 }}>
            <button type="button" onClick={save}>Save</button>{' '}
            <button type="button" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      )}
    </main>
  )
}
