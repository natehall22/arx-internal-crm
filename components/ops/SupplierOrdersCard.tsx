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

  const sentMyself = async (card: SupplierCard) => {
    if (!window.confirm(`Record that you sent this order to ${card.supplierName} yourself?`)) return
    const post = (confirmResend: boolean) =>
      fetch(`/api/ops/jobs/${jobId}/supplier-orders/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendorId: card.vendorId, kind: 'order', manual: true, deliveryDate: null, confirmResend }),
      })
    setBusy(true)
    try {
      let res = await post(false)
      let json = await res.json().catch(() => ({}))
      if (res.status === 409 && json.needsConfirm) {
        if (!window.confirm(json.confirmMessage)) return
        res = await post(true)
        json = await res.json().catch(() => ({}))
      }
      if (!res.ok) return setError(json.error || 'Could not record it. Try again.')
      setError(null)
      await load()
      onChanged?.()
    } finally {
      setBusy(false)
    }
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

  if (setupMissing) return <p className="text-[#2c2c2a]">{setupMissing}</p>
  if (!view) return error ? <p className="text-[#a32d2d]">{error}</p> : null

  const btn = 'inline-flex min-h-[44px] w-full sm:w-auto items-center justify-center rounded-lg border border-[#5f5e5a] bg-white px-4 py-2 text-sm font-semibold text-[#2c2c2a] disabled:opacity-50'
  const field = 'block w-full min-h-[44px] rounded-lg border border-[#8a877d] bg-white px-3 py-2 text-base text-[#2c2c2a]'

  return (
    <section className="rounded-lg border border-[#d3d1c7] bg-white p-4 text-[#2c2c2a]">
      <h3 className="m-0 text-base font-semibold">Supplier orders</h3>
      <p className="mb-3 mt-1 text-sm">{view.rollup.summary}</p>
      {view.blockers.map((b) => (
        <p key={b} className="text-sm text-[#a32d2d]">{b}</p>
      ))}
      {view.warnings.map((w) => (
        <p key={w} className="text-sm text-[#7a4b00]">{w}</p>
      ))}
      {view.cards.map((c) => (
        <div key={c.vendorId} className="border-t border-[#e6e4dc] py-3">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <strong className="text-base">{c.supplierName}</strong>
            <span className="text-sm">{c.poNumber} · {STATE_LABEL[c.state]}</span>
          </div>
          {c.lastSentAt && (
            <p className="mt-0.5 break-words text-sm">Last sent {new Date(c.lastSentAt).toLocaleString()} to {c.lastSentTo}</p>
          )}
          <ul className="my-2 ml-5 list-disc text-sm">
            {c.lines.map((l) => (
              <li key={l.key} className="break-words">{l.label}{l.qty ? ` — ${l.qty}` : ''}</li>
            ))}
          </ul>
          {c.blockers.map((b) => (
            <p key={b} className="my-1 text-sm text-[#a32d2d]">{b}</p>
          ))}
          {view.canSend && (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button type="button" className={btn} onClick={() => openPreview(c.vendorId, 'order')} disabled={view.jobCancelled}>
                Review &amp; send to {c.supplierName}
              </button>
              <button type="button" className={btn} disabled={busy || view.jobCancelled || c.state === 'sent'} onClick={() => sentMyself(c)}>
                I sent this to {c.supplierName} myself
              </button>
              {c.canCancel && (
                <button type="button" className={btn} onClick={() => openPreview(c.vendorId, 'cancellation')}>
                  Review cancellation
                </button>
              )}
            </div>
          )}
        </div>
      ))}
      {view.nonPo.map((g) => (
        <p key={`${g.source}-${g.trade}`} className="my-1.5 text-sm">{g.label} — not on a purchase order</p>
      ))}

      {open && (
        <div className="fixed inset-0 z-[100] flex items-end bg-black/50 sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true">
          <div className="flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white sm:max-w-xl sm:rounded-xl">
            <div className="flex-1 overflow-y-auto p-4">
              {!preview && !error && <p className="text-sm">Loading the preview…</p>}
              {!preview && error && <p className="text-sm text-[#a32d2d]">{error}</p>}
              {preview && (<>
              <h4 className="m-0 text-base font-semibold">{preview.sendButtonLabel}</h4>
              <p className="my-2 break-words text-sm">
                To: {preview.email.to}{preview.email.cc.length > 0 && <> · Cc: {preview.email.cc.join(', ')}</>}
                <br />
                Subject: {preview.email.subject}
              </p>
              {preview.changes.length > 0 && (
                <ul className="mb-2 ml-5 list-disc text-sm">
                  {preview.changes.map((ch) => <li key={ch}>{ch}</li>)}
                </ul>
              )}
              <label className="my-2 block text-sm font-medium">
                Delivery date
                <input
                  className={field}
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => {
                    setDeliveryDate(e.target.value)
                    void loadPreview(open.vendorId, open.kind, e.target.value, note)
                  }}
                />
              </label>
              <label className="my-2 block text-sm font-medium">
                Note to supplier
                <input
                  className={field}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onBlur={() => loadPreview(open.vendorId, open.kind, deliveryDate, note)}
                />
              </label>
              {preview.hasPdf && (
                <iframe
                  title="Purchase order preview"
                  src={`/api/ops/jobs/${jobId}/supplier-orders/preview?vendorId=${open.vendorId}&kind=${open.kind}&deliveryDate=${deliveryDate}&format=pdf`}
                  className="h-[50dvh] w-full rounded border border-[#d3d1c7]"
                />
              )}
              {preview.blockers.map((b) => (
                <p key={b} className="text-sm text-[#a32d2d]">{b}</p>
              ))}
              {confirm && <p className="text-sm font-semibold text-[#7a4b00]">{confirm}</p>}
              {error && <p className="text-sm text-[#a32d2d]">{error}</p>}
              </>)}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-[#e6e4dc] bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
              <button type="button" className={btn} onClick={() => { setOpen(null); setPreview(null); setConfirm(null) }}>Close</button>
              <button
                type="button"
                className="inline-flex min-h-[44px] w-full sm:w-auto items-center justify-center rounded-lg bg-[#2b0a3d] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                disabled={busy || !preview || preview.blockers.length > 0}
                onClick={() => send(!!confirm)}
              >
                {busy ? 'Sending…' : confirm ? 'Yes, send anyway' : preview?.sendButtonLabel ?? 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
      {error && !open && <p className="text-sm text-[#a32d2d]">{error}</p>}
    </section>
  )
}
