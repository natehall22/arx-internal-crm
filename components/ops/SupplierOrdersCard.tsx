'use client'

import { useCallback, useEffect, useState } from 'react'

import type { SupplierOrdersView, SupplierCard, SupplierOrderPreview } from '@/lib/supplier-orders'

type Preview = Omit<SupplierOrderPreview, 'pdf' | 'sheet'> & { hasPdf: boolean }

const STATE_LABEL: Record<SupplierCard['state'], string> = {
  not_sent: 'Not sent',
  sent: 'Sent',
  changed: 'Changed since sent',
  needs_cancellation: 'Needs cancellation',
  cancelled: 'Cancelled',
}

const INK = '#2c2c2a'

/**
 * Supplier orders: one card per supplier, a preview of exactly what would go out, and an explicit
 * "Send to <supplier>" button. Nothing here (or anywhere else) sends without that click.
 */
export default function SupplierOrdersCard({ jobId, onChanged }: { jobId: string; onChanged?: () => void }) {
  const [view, setView] = useState<(SupplierOrdersView & { canSend?: boolean }) | null>(null)
  const [setupMissing, setSetupMissing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<{ vendorId: string; kind: 'order' | 'cancellation' } | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [deliveryDate, setDeliveryDate] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/ops/jobs/${jobId}/supplier-orders`)
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return setError(json.error || 'Could not load supplier orders')
    if (json.setupMissing) return setSetupMissing(json.message)
    setView(json)
    setDeliveryDate((d) => d || json.defaultDeliveryDate || '')
  }, [jobId])

  useEffect(() => {
    void load()
  }, [load])

  const loadPreview = useCallback(
    async (vendorId: string, kind: 'order' | 'cancellation', date: string, noteText: string) => {
      const qs = new URLSearchParams({ vendorId, kind, deliveryDate: date, note: noteText })
      const res = await fetch(`/api/ops/jobs/${jobId}/supplier-orders/preview?${qs}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || 'Could not build the preview')
        setPreview(null)
        return
      }
      setError(null)
      setPreview(json.preview)
    },
    [jobId]
  )

  const openPreview = (vendorId: string, kind: 'order' | 'cancellation') => {
    setOpen({ vendorId, kind })
    setConfirm(null)
    void loadPreview(vendorId, kind, deliveryDate, note)
  }

  const send = async (confirmResend: boolean) => {
    if (!open || !preview) return
    setBusy(true)
    const res = await fetch(`/api/ops/jobs/${jobId}/supplier-orders/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vendorId: open.vendorId,
        kind: open.kind,
        deliveryDate: deliveryDate || null,
        note: note || null,
        previewToken: preview.previewToken,
        confirmResend,
      }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (res.status === 409 && json.needsConfirm) return setConfirm(json.confirmMessage)
    if (!res.ok) return setError(json.error || 'Not sent. Try again or download and email it yourself.')
    setOpen(null)
    setPreview(null)
    setConfirm(null)
    setError(null)
    await load()
    onChanged?.()
  }

  if (setupMissing) return <p style={{ color: INK }}>{setupMissing}</p>
  if (!view) return error ? <p style={{ color: '#a32d2d' }}>{error}</p> : null

  return (
    <section style={{ background: '#fff', color: INK, border: '1px solid #d3d1c7', borderRadius: 8, padding: 16 }}>
      <h3 style={{ margin: 0, fontSize: 16 }}>Supplier orders</h3>
      <p style={{ margin: '4px 0 12px' }}>{view.rollup.summary}</p>
      {view.blockers.map((b) => (
        <p key={b} style={{ color: '#a32d2d' }}>{b}</p>
      ))}
      {view.warnings.map((w) => (
        <p key={w} style={{ color: '#7a4b00' }}>{w}</p>
      ))}
      {view.cards.map((c) => (
        <div key={c.vendorId} style={{ borderTop: '1px solid #e6e4dc', padding: '10px 0' }}>
          <strong>{c.supplierName}</strong> · {c.poNumber} · {STATE_LABEL[c.state]}
          {c.lastSentAt && <span> (last sent {new Date(c.lastSentAt).toLocaleString()} to {c.lastSentTo})</span>}
          <ul style={{ margin: '6px 0 6px 18px' }}>
            {c.lines.map((l) => (
              <li key={l.key}>{l.label}{l.qty ? ` — ${l.qty}` : ''}</li>
            ))}
          </ul>
          {c.blockers.map((b) => (
            <p key={b} style={{ color: '#a32d2d', margin: '2px 0' }}>{b}</p>
          ))}
          {view.canSend && (
            <>
              <button type="button" onClick={() => openPreview(c.vendorId, 'order')} disabled={view.jobCancelled}>
                Review &amp; send to {c.supplierName}
              </button>{' '}
              {c.canCancel && (
                <button type="button" onClick={() => openPreview(c.vendorId, 'cancellation')}>
                  Review cancellation
                </button>
              )}
            </>
          )}
        </div>
      ))}
      {view.nonPo.map((g) => (
        <p key={`${g.source}-${g.trade}`} style={{ margin: '6px 0' }}>{g.label} — not on a purchase order</p>
      ))}

      {open && preview && (
        <div style={{ marginTop: 12, border: '2px solid #5f5e5a', borderRadius: 8, padding: 12 }}>
          <h4 style={{ margin: 0 }}>{preview.sendButtonLabel}</h4>
          <p style={{ margin: '6px 0' }}>
            To: {preview.email.to} {preview.email.cc.length > 0 && `· Cc: ${preview.email.cc.join(', ')}`}
            <br />
            Subject: {preview.email.subject}
          </p>
          {preview.changes.length > 0 && (
            <ul style={{ margin: '0 0 8px 18px' }}>
              {preview.changes.map((c) => <li key={c}>{c}</li>)}
            </ul>
          )}
          <label style={{ display: 'block', margin: '6px 0' }}>
            Delivery date{' '}
            <input
              type="date"
              value={deliveryDate}
              onChange={(e) => {
                setDeliveryDate(e.target.value)
                void loadPreview(open.vendorId, open.kind, e.target.value, note)
              }}
            />
          </label>
          <label style={{ display: 'block', margin: '6px 0' }}>
            Note to supplier{' '}
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => loadPreview(open.vendorId, open.kind, deliveryDate, note)}
              style={{ width: '70%' }}
            />
          </label>
          {preview.hasPdf && (
            <iframe
              title="Purchase order preview"
              src={`/api/ops/jobs/${jobId}/supplier-orders/preview?vendorId=${open.vendorId}&kind=${open.kind}&deliveryDate=${deliveryDate}&format=pdf`}
              style={{ width: '100%', height: 420, border: '1px solid #d3d1c7' }}
            />
          )}
          {preview.blockers.map((b) => (
            <p key={b} style={{ color: '#a32d2d' }}>{b}</p>
          ))}
          {confirm && <p style={{ color: '#7a4b00', fontWeight: 600 }}>{confirm}</p>}
          <button type="button" disabled={busy || preview.blockers.length > 0} onClick={() => send(!!confirm)}>
            {busy ? 'Sending…' : confirm ? 'Yes, send anyway' : preview.sendButtonLabel}
          </button>{' '}
          <button type="button" onClick={() => { setOpen(null); setPreview(null); setConfirm(null) }}>Close</button>
        </div>
      )}
      {error && <p style={{ color: '#a32d2d' }}>{error}</p>}
    </section>
  )
}
