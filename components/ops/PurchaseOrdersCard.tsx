'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { FileDropZone } from '@/components/ui/file-drop-zone'
import { JOB_COST_TYPE_LABELS, JOB_COST_TYPES } from '@/lib/job-cost-ledger'
import { PO_STATUS_LABELS, formatMoney, formatQuantity, poTotalCents, type PoStatus } from '@/lib/purchase-orders'
import type { DirectoryVendor, PurchaseOrder } from '@/lib/purchase-orders-db'

type Line = { id?: string | null; description: string; quantity: string; unit: string; unitCost: string; costType: string; costCode: string; pricebookItemId?: string | null }
type Draft = { id: string | null; vendorId: string; lines: Line[]; date: string; dateKind: 'delivery' | 'start'; address: string; note: string }
type Preview = { vendorName: string; kind: string; poLabel: string; to: string; cc: string[]; subject: string; body: string; changes: string[]; totalCents: number; lineCount: number; confirmMessage: string | null; blockers: string[]; previewToken: string; sendButtonLabel: string; hasPdf: boolean }
type Loaded = { orders: PurchaseOrder[]; vendors: DirectoryVendor[]; canEdit: boolean; canBill: boolean; showMoney: boolean; target: { reference: string; address: string | null; scheduledDate: string | null; cancelled: boolean; jobId: string | null; workOrderId: string | null } }

const ctl = 'block w-full min-h-[44px] rounded-lg border border-[#8a877d] bg-white px-3 py-2 text-base text-[#2c2c2a]'
const btn = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[#5f5e5a] bg-white px-4 py-2 text-sm font-semibold text-[#2c2c2a] disabled:opacity-50'
const primary = 'inline-flex min-h-[48px] items-center justify-center rounded-lg bg-[#2b0a3d] px-4 py-2 text-base font-semibold text-white disabled:opacity-50'
const sheet = 'fixed inset-0 z-[100] flex items-end bg-black/50 sm:items-center sm:justify-center sm:p-4'
const panel = 'flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white sm:max-w-lg sm:rounded-xl'

const STATUS_STYLE: Record<PoStatus, string> = {
  draft: 'bg-gray-200 text-gray-900',
  sent: 'bg-blue-100 text-blue-900',
  acknowledged: 'bg-indigo-100 text-indigo-900',
  partially_received: 'bg-amber-100 text-amber-900',
  received: 'bg-green-100 text-green-900',
  billed: 'bg-emerald-200 text-emerald-950',
  cancelled: 'bg-red-100 text-red-900',
}

const blankLine = (): Line => ({ description: '', quantity: '1', unit: '', unitCost: '', costType: 'material', costCode: '' })

function dayBefore(ymd: string | null): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ''
  const [y, m, d] = ymd.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
  return t >= new Date().toISOString().slice(0, 10) ? t : ''
}

const fmtDate = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : 'no date')

/**
 * Purchase orders on a job (or a service visit): one card per vendor, a draft editor, a preview of exactly what would go out,
 * and an explicit "Send to <vendor>" button. Nothing here sends without that click. Roofing material orders appear in the
 * list too (read-only): they are managed in Supplier orders, on the same tables.
 */
export default function PurchaseOrdersCard({ jobId, workOrderId, onChanged }: { jobId?: string; workOrderId?: string; onChanged?: () => void }) {
  const scopeQs = jobId ? `jobId=${jobId}` : `workOrderId=${workOrderId}`
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ id: string; p: Preview; kind: 'order' | 'cancellation' } | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [receiving, setReceiving] = useState<{ po: PurchaseOrder; qty: Record<string, string> } | null>(null)
  const [billing, setBilling] = useState<{ po: PurchaseOrder; amount: string; number: string; date: string; credit: boolean; file: File | null; confirm: string | null; confirmKind: 'over' | 'duplicate' | null; doneOver: boolean; doneDup: boolean; error: string | null; key: string } | null>(null)
  const [suggest, setSuggest] = useState<{ index: number; items: { id: string; name: string; unit: string | null; unitCost: number }[] } | null>(null)
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/ops/purchase-orders?${scopeQs}`)
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return setError(json.error || 'Could not load purchase orders')
    setError(null)
    setData(json)
  }, [scopeQs])
  useEffect(() => {
    void load()
  }, [load])

  const changed = async () => {
    await load()
    onChanged?.()
  }

  const vendorsByRecent = useMemo(
    () => [...(data?.vendors ?? [])].sort((a, b) => (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '') || a.name.localeCompare(b.name)),
    [data?.vendors]
  )

  const defaultsFor = (vendorId: string): Pick<Draft, 'date' | 'dateKind'> => {
    const v = data?.vendors.find((x) => x.id === vendorId)
    const sched = data?.target.scheduledDate ?? null
    return v?.vendorType === 'sub' ? { dateKind: 'start', date: sched && sched >= new Date().toISOString().slice(0, 10) ? sched : '' } : { dateKind: 'delivery', date: dayBefore(sched) }
  }

  const startNew = () => {
    if (!data) return
    const only = data.vendors.length === 1 ? data.vendors[0].id : ''
    setDraftError(null)
    setDraft({ id: null, vendorId: only, lines: [blankLine()], address: data.target.address ?? '', note: '', ...(only ? defaultsFor(only) : { date: '', dateKind: 'delivery' as const }) })
  }

  const editOrder = (po: PurchaseOrder) => {
    setDraftError(null)
    setDraft({
      id: po.id,
      vendorId: po.vendorId,
      lines: po.lines.map((l) => ({ id: l.id, description: l.description, quantity: formatQuantity(l.quantity), unit: l.unit ?? '', unitCost: l.unitCostCents ? (l.unitCostCents / 100).toFixed(2) : '', costType: l.costType, costCode: l.costCode ?? '', pricebookItemId: l.pricebookItemId })),
      date: po.date ?? '',
      dateKind: po.dateKind,
      address: po.address ?? '',
      note: po.note ?? '',
    })
  }

  const pickVendor = (vendorId: string) => {
    if (!draft) return
    // A new order takes the vendor's usual date kind; an order being edited keeps what was typed.
    setDraft({ ...draft, vendorId, ...(draft.id ? {} : defaultsFor(vendorId)) })
  }

  const setLine = (i: number, patch: Partial<Line>) => draft && setDraft({ ...draft, lines: draft.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) })

  const searchItems = (i: number, q: string) => {
    if (suggestTimer.current) clearTimeout(suggestTimer.current)
    if (q.trim().length < 2) return setSuggest(null)
    suggestTimer.current = setTimeout(async () => {
      const res = await fetch(`/api/ops/purchase-orders/items?q=${encodeURIComponent(q.trim())}`)
      const json = await res.json().catch(() => ({ items: [] }))
      setSuggest({ index: i, items: json.items ?? [] })
    }, 250)
  }

  const saveDraft = async (): Promise<string | null> => {
    if (!draft) return null
    if (!draft.vendorId) {
      setDraftError('Pick who this order is for.')
      return null
    }
    const res = await fetch('/api/ops/purchase-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(jobId ? { jobId } : { workOrderId }), id: draft.id, vendorId: draft.vendorId, date: draft.date || null, dateKind: draft.dateKind, address: draft.address, note: draft.note, lines: draft.lines.filter((l) => l.description.trim()).map((l) => ({ id: l.id, description: l.description, quantity: l.quantity, unit: l.unit, unitCost: l.unitCost, costType: l.costType, costCode: l.costCode, pricebookItemId: l.pricebookItemId })) }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setDraftError(json.error || 'Could not save')
      return null
    }
    return json.id as string
  }

  const openPreview = async (id: string, kind: 'order' | 'cancellation') => {
    const res = await fetch(`/api/ops/purchase-orders/${id}/preview?kind=${kind}`)
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setMessage(json.error || 'Could not build the preview')
      return false
    }
    setConfirmed(false)
    setPreview({ id, p: json.preview, kind })
    return true
  }

  const reviewAndSend = async () => {
    setBusy(true)
    setDraftError(null)
    const id = await saveDraft()
    if (id) {
      await load()
      if (await openPreview(id, 'order')) setDraft(null)
    }
    setBusy(false)
  }

  const send = async (manual: boolean) => {
    if (!preview) return
    setBusy(true)
    const res = await fetch(`/api/ops/purchase-orders/${preview.id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: preview.kind, previewToken: preview.p.previewToken, confirmResend: confirmed, manual }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      if (json.needsConfirm) {
        setConfirmed(true)
        setMessage(null)
        setPreview({ ...preview, p: { ...preview.p, confirmMessage: json.confirmMessage } })
        return
      }
      setMessage(json.error || 'Not sent')
      return
    }
    setPreview(null)
    setMessage(manual ? 'Recorded as sent by hand.' : `Sent to ${preview.p.vendorName}.${json.warning ? ` ${json.warning}` : ''}`)
    await changed()
  }

  const discard = async (po: PurchaseOrder) => {
    if (!window.confirm(`Delete the draft order to ${po.vendorName}?`)) return
    const res = await fetch(`/api/ops/purchase-orders/${po.id}`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    setMessage(res.ok ? 'Draft deleted.' : json.error || 'Could not delete')
    await changed()
  }

  const confirmedByPhone = async (po: PurchaseOrder) => {
    const res = await fetch(`/api/ops/purchase-orders/${po.id}/acknowledge`, { method: 'POST' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) setMessage(json.error || 'Could not save')
    await changed()
  }

  const saveReceived = async (all: boolean) => {
    if (!receiving) return
    setBusy(true)
    const body = all ? { all: true } : { lines: receiving.po.lines.map((l) => ({ lineId: l.id, quantity: Number(receiving.qty[l.id] ?? l.receivedQuantity) || 0 })) }
    const res = await fetch(`/api/ops/purchase-orders/${receiving.po.id}/receive`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return setMessage(json.error || 'Could not save')
    setReceiving(null)
    await changed()
  }

  const recordBill = async (over: boolean, dup: boolean) => {
    if (!billing) return
    setBusy(true)
    const res = await fetch(`/api/ops/purchase-orders/${billing.po.id}/bills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: billing.amount, billNumber: billing.number, billDate: billing.date || null, isCredit: billing.credit, confirmOver: over, confirmDuplicate: dup, clientKey: billing.key }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setBusy(false)
      if (json.needsConfirm) return setBilling({ ...billing, confirm: json.message, confirmKind: json.confirmKind, doneOver: over, doneDup: dup, error: null })
      return setBilling({ ...billing, error: json.error || 'Could not record the bill', confirm: null, confirmKind: null })
    }
    // The bill's file rides on the job's existing cost-attachment upload (drag and drop).
    let fileNote = ''
    if (billing.file && json.costLineId && billing.po.jobId) {
      const fd = new FormData()
      fd.append('file', billing.file)
      fd.append('job_cost_line_id', json.costLineId)
      const up = await fetch(`/api/ops/jobs/${billing.po.jobId}/cost-attachments`, { method: 'POST', body: fd })
      if (!up.ok) fileNote = ' The bill is recorded but its file did not upload — add it from the job costs.'
    }
    setBusy(false)
    setBilling(null)
    setMessage(`Bill recorded.${json.warning ? ` ${json.warning}` : ''}${fileNote}`)
    await changed()
  }

  const voidBill = async (po: PurchaseOrder, billId: string) => {
    if (!window.confirm('Void this bill? Its cost comes off the job.')) return
    const res = await fetch(`/api/ops/purchase-orders/${po.id}/bills/${billId}`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    setMessage(res.ok ? 'Bill voided.' : json.error || 'Could not void the bill')
    await changed()
  }

  if (error) return <p role="alert" className="text-sm font-semibold text-[#a32d2d]">{error}</p>
  if (!data) return null

  const general = data.orders.filter((o) => o.kind === 'general')
  const materials = data.orders.filter((o) => o.kind !== 'general')
  const draftTotal = draft ? poTotalCents(draft.lines.map((l) => ({ quantity: Number(l.quantity) || 0, unitCostCents: Math.round((Number(l.unitCost.replace(/[$,]/g, '')) || 0) * 100) }))) : 0

  return (
    <section aria-label="Purchase orders" className="mt-4 rounded-lg border border-[#d3d1c7] bg-white p-4 text-[#2c2c2a]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-lg font-bold">Purchase orders</h3>
        {data.canEdit && !data.target.cancelled && (
          <button type="button" className={primary} onClick={startNew}>+ Purchase order</button>
        )}
      </div>
      {message && <p role="status" className="mb-0 mt-3 rounded-lg border border-[#d3d1c7] bg-[#f7f6f2] p-3 text-sm">{message}</p>}
      {general.length === 0 && materials.length === 0 && <p className="mb-0 mt-3 text-sm">No purchase orders on this {jobId ? 'job' : 'visit'} yet.</p>}

      <ul className="m-0 mt-3 list-none space-y-3 p-0">
        {general.map((po) => {
          const money = data.showMoney
          return (
            <li key={po.id} className="rounded-lg border border-[#d3d1c7] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-base">{po.vendorName} · PO {po.label}</strong>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[po.status]}`}>{PO_STATUS_LABELS[po.status]}</span>
              </div>
              <p className="mb-0 mt-1 text-sm">
                {po.lines.length} item{po.lines.length === 1 ? '' : 's'}
                {money ? ` · ${formatMoney(po.totalCents)}` : ''}
                {po.date ? ` · ${po.dateKind === 'start' ? 'starts' : 'deliver'} ${fmtDate(po.date)}` : ''}
                {money && po.billedCents !== 0 ? ` · billed ${formatMoney(po.billedCents)}` : ''}
              </p>
              {po.changedSinceSent && <p className="mb-0 mt-1 text-sm font-semibold text-[#8a4b00]">Changed since it was sent. Send a revised order to update the vendor.</p>}
              {po.lastSentTo && po.status !== 'draft' && <p className="mb-0 mt-1 break-words text-sm">Sent to {po.lastSentTo}{po.acknowledgedAt ? ` · confirmed ${fmtDate(po.acknowledgedAt.slice(0, 10))}${po.acknowledgedBy === 'staff' ? ' (by phone)' : ''}` : ''}</p>}
              {po.bills.filter((b) => b.status === 'active').length > 0 && (
                <ul className="m-0 mt-2 list-none space-y-1 p-0 text-sm">
                  {po.bills.filter((b) => b.status === 'active').map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-2">
                      <span>Bill {b.billNumber ? `#${b.billNumber} ` : ''}{money ? formatMoney(b.isCredit ? -b.amountCents : b.amountCents) : ''}</span>
                      {data.canBill && <button type="button" className={`${btn} !min-h-[44px]`} onClick={() => void voidBill(po, b.id)}>Void</button>}
                    </li>
                  ))}
                </ul>
              )}
              {data.canEdit && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {po.status === 'draft' && <button type="button" className={primary} onClick={() => void openPreview(po.id, 'order')}>Review &amp; send</button>}
                  {po.status !== 'cancelled' && <button type="button" className={btn} onClick={() => editOrder(po)}>{po.status === 'draft' ? 'Edit' : 'Change order'}</button>}
                  {po.changedSinceSent && <button type="button" className={primary} onClick={() => void openPreview(po.id, 'order')}>Send revised order</button>}
                  {po.status === 'sent' && <button type="button" className={btn} onClick={() => void confirmedByPhone(po)}>Vendor confirmed</button>}
                  {(po.status === 'sent' || po.status === 'acknowledged' || po.status === 'partially_received') && (
                    <button type="button" className={btn} onClick={() => setReceiving({ po, qty: Object.fromEntries(po.lines.map((l) => [l.id, String(l.receivedQuantity)])) })}>Mark received</button>
                  )}
                  {po.status !== 'draft' && po.status !== 'cancelled' && <button type="button" className={btn} onClick={() => void openPreview(po.id, 'cancellation')}>Cancel order</button>}
                  {po.status === 'draft' && <button type="button" className={btn} onClick={() => void discard(po)}>Delete draft</button>}
                </div>
              )}
              {data.canBill && po.status !== 'draft' && po.status !== 'cancelled' && (
                <div className="mt-2">
                  <button type="button" className={btn} onClick={() => setBilling({ po, amount: '', number: '', date: '', credit: false, file: null, confirm: null, confirmKind: null, doneOver: false, doneDup: false, error: null, key: crypto.randomUUID() })}>Add vendor bill</button>
                </div>
              )}
            </li>
          )
        })}
        {materials.map((po) => (
          <li key={po.id} className="rounded-lg border border-[#e6e4dc] p-3 text-sm">
            <strong>{po.vendorName} · PO {po.label}</strong> · materials order · {po.status === 'cancelled' ? 'Cancelled' : po.receivedAt ? 'Received' : po.status === 'sent' ? 'Sent' : 'Draft'}
            <span className="block">Managed in Supplier orders on this page.</span>
          </li>
        ))}
      </ul>

      {/* Editor */}
      {draft && (
        <div className={sheet} role="dialog" aria-modal="true" aria-label={draft.id ? 'Change purchase order' : 'New purchase order'}>
          <div className={panel}>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <h2 className="m-0 text-lg font-bold">{draft.id ? 'Change purchase order' : 'New purchase order'}</h2>
              <div>
                <p className="m-0 mb-1 text-sm font-medium">Who is it for?</p>
                {vendorsByRecent.length === 0 ? (
                  <p className="m-0 text-sm">No vendors yet. An owner adds them in Settings → Vendors.</p>
                ) : (
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Vendor">
                    {vendorsByRecent.map((v) => (
                      <button key={v.id} type="button" role="radio" aria-checked={draft.vendorId === v.id} disabled={!!draft.id && draft.vendorId !== v.id} onClick={() => pickVendor(v.id)} className={`${btn} ${draft.vendorId === v.id ? '!bg-[#2b0a3d] !text-white' : ''}`}>
                        {v.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                {draft.lines.map((l, i) => (
                  <div key={i} className="rounded-lg border border-[#d3d1c7] p-3">
                    <label className="block text-sm font-medium">Item
                      <input className={ctl} value={l.description} onChange={(e) => { setLine(i, { description: e.target.value, pricebookItemId: null }); searchItems(i, e.target.value) }} autoComplete="off" placeholder="What are you ordering?" />
                    </label>
                    {suggest?.index === i && suggest.items.length > 0 && (
                      <ul className="m-0 mt-1 list-none rounded-lg border border-[#d3d1c7] p-0">
                        {suggest.items.map((it) => (
                          <li key={it.id}>
                            <button type="button" className="block min-h-[44px] w-full px-3 py-2 text-left text-base" onClick={() => { setLine(i, { description: it.name, unit: it.unit ?? '', unitCost: it.unitCost ? it.unitCost.toFixed(2) : '', pricebookItemId: it.id }); setSuggest(null) }}>
                              {it.name}{it.unitCost ? ` · ${formatMoney(Math.round(it.unitCost * 100))}` : ''}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <label className="block text-sm font-medium">Qty
                        <input className={ctl} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                      </label>
                      <label className="block text-sm font-medium">Unit
                        <input className={ctl} value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} placeholder="ea, hr, sq" />
                      </label>
                      <label className="block text-sm font-medium">Each $
                        <input className={ctl} inputMode="decimal" value={l.unitCost} onChange={(e) => setLine(i, { unitCost: e.target.value })} />
                      </label>
                    </div>
                    <details className="mt-1">
                      <summary className="flex min-h-[44px] cursor-pointer items-center text-sm font-semibold">More</summary>
                      <label className="block text-sm font-medium">Cost type (where the bill lands)
                        <select className={ctl} value={l.costType} onChange={(e) => setLine(i, { costType: e.target.value })}>
                          {JOB_COST_TYPES.map((t) => <option key={t} value={t}>{JOB_COST_TYPE_LABELS[t]}</option>)}
                        </select>
                      </label>
                      <label className="mt-2 block text-sm font-medium">Cost code (optional)
                        <input className={ctl} value={l.costCode} onChange={(e) => setLine(i, { costCode: e.target.value })} />
                      </label>
                    </details>
                    {draft.lines.length > 1 && <button type="button" className={`${btn} mt-1`} onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, idx) => idx !== i) })}>Remove item</button>}
                  </div>
                ))}
                <button type="button" className={`${btn} w-full`} onClick={() => setDraft({ ...draft, lines: [...draft.lines, blankLine()] })}>+ Add item</button>
              </div>

              <div className="grid grid-cols-1 gap-3">
                <label className="block text-sm font-medium">{draft.dateKind === 'start' ? 'Start date' : 'Delivery date'}
                  <input className={ctl} type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
                </label>
                <details>
                  <summary className="flex min-h-[44px] cursor-pointer items-center text-sm font-semibold">More (address, note)</summary>
                  <label className="block text-sm font-medium">Date is a
                    <select className={ctl} value={draft.dateKind} onChange={(e) => setDraft({ ...draft, dateKind: e.target.value as 'delivery' | 'start' })}>
                      <option value="delivery">Delivery date</option>
                      <option value="start">Start date</option>
                    </select>
                  </label>
                  <label className="mt-2 block text-sm font-medium">Address
                    <input className={ctl} value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
                  </label>
                  <label className="mt-2 block text-sm font-medium">Note to the vendor
                    <textarea className={ctl} rows={3} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
                  </label>
                </details>
              </div>
              {draftTotal > 0 && <p className="m-0 text-base font-bold">Total {formatMoney(draftTotal)}</p>}
              {draftError && <p role="alert" className="m-0 text-sm font-semibold text-[#a32d2d]">{draftError}</p>}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-[#e6e4dc] bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
              <button type="button" className={`${btn} w-full sm:w-auto`} onClick={() => setDraft(null)}>Close</button>
              <button type="button" className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg border border-[#5f5e5a] bg-white px-4 py-2 text-sm font-semibold sm:w-auto" disabled={busy} onClick={async () => { setBusy(true); const id = await saveDraft(); setBusy(false); if (id) { setDraft(null); setMessage('Saved as a draft. Nothing was sent.'); await changed() } }}>Save draft</button>
              <button type="button" className={`${primary} w-full sm:w-auto`} disabled={busy} onClick={() => void reviewAndSend()}>{busy ? 'Saving…' : 'Review & send'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Preview + the explicit send */}
      {preview && (
        <div className={sheet} role="dialog" aria-modal="true" aria-label="Review before sending">
          <div className={panel}>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <h2 className="m-0 text-lg font-bold">{preview.kind === 'cancellation' ? 'Cancel' : 'Review'} PO {preview.p.poLabel}</h2>
              <p className="m-0 break-words text-sm"><strong>To:</strong> {preview.p.to || preview.p.vendorName}{preview.p.cc.length ? ` · cc ${preview.p.cc.join(', ')}` : ''}</p>
              <p className="m-0 break-words text-sm"><strong>Subject:</strong> {preview.p.subject}</p>
              {preview.p.changes.length > 0 && (
                <ul className="m-0 list-disc pl-5 text-sm">{preview.p.changes.map((c) => <li key={c}>{c}</li>)}</ul>
              )}
              <pre className="m-0 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[#d3d1c7] bg-[#f7f6f2] p-3 text-sm text-[#2c2c2a]">{preview.p.body}</pre>
              {preview.p.hasPdf && <a className={`${btn} w-full`} href={`/api/ops/purchase-orders/${preview.id}/preview?kind=${preview.kind}&format=pdf`} target="_blank" rel="noreferrer">View the PDF that will be attached</a>}
              {preview.p.blockers.map((b) => <p key={b} role="alert" className="m-0 text-sm font-semibold text-[#a32d2d]">{b}</p>)}
              {preview.p.confirmMessage && (
                <label className="flex min-h-[44px] items-start gap-3 rounded-lg border border-[#8a4b00] p-3 text-sm font-medium">
                  <input type="checkbox" className="mt-0.5 h-5 w-5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                  {preview.p.confirmMessage}
                </label>
              )}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-[#e6e4dc] bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
              <button type="button" className={`${btn} w-full sm:w-auto`} onClick={() => setPreview(null)}>Back</button>
              {preview.kind === 'order' && <button type="button" className={`${btn} w-full sm:w-auto`} disabled={busy || (!!preview.p.confirmMessage && !confirmed)} onClick={() => void send(true)}>I sent this myself</button>}
              <button type="button" className={`${primary} w-full sm:w-auto`} disabled={busy || preview.p.blockers.length > 0 || (!!preview.p.confirmMessage && !confirmed)} onClick={() => void send(false)}>
                {busy ? 'Sending…' : preview.p.sendButtonLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receive */}
      {receiving && (
        <div className={sheet} role="dialog" aria-modal="true" aria-label="Mark received">
          <div className={panel}>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <h2 className="m-0 text-lg font-bold">What arrived? · PO {receiving.po.label}</h2>
              {receiving.po.lines.map((l) => (
                <label key={l.id} className="block text-sm font-medium">
                  {l.description} (ordered {formatQuantity(l.quantity)}{l.unit ? ` ${l.unit}` : ''})
                  <input className={ctl} inputMode="decimal" value={receiving.qty[l.id] ?? ''} onChange={(e) => setReceiving({ ...receiving, qty: { ...receiving.qty, [l.id]: e.target.value } })} />
                </label>
              ))}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-[#e6e4dc] bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
              <button type="button" className={`${btn} w-full sm:w-auto`} onClick={() => setReceiving(null)}>Close</button>
              <button type="button" className={`${btn} w-full sm:w-auto`} disabled={busy} onClick={() => void saveReceived(false)}>Save what arrived</button>
              <button type="button" className={`${primary} w-full sm:w-auto`} disabled={busy} onClick={() => void saveReceived(true)}>Everything arrived</button>
            </div>
          </div>
        </div>
      )}

      {/* Vendor bill */}
      {billing && (
        <div className={sheet} role="dialog" aria-modal="true" aria-label="Add vendor bill">
          <div className={panel}>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <h2 className="m-0 text-lg font-bold">Vendor bill · PO {billing.po.label}</h2>
              <label className="block text-sm font-medium">Amount $
                <input className={ctl} inputMode="decimal" value={billing.amount} onChange={(e) => setBilling({ ...billing, amount: e.target.value, confirm: null })} />
              </label>
              <label className="block text-sm font-medium">Their invoice number (optional)
                <input className={ctl} value={billing.number} onChange={(e) => setBilling({ ...billing, number: e.target.value })} />
              </label>
              <label className="block text-sm font-medium">Bill date (optional)
                <input className={ctl} type="date" value={billing.date} onChange={(e) => setBilling({ ...billing, date: e.target.value })} />
              </label>
              <label className="flex min-h-[44px] items-center gap-3 text-sm font-medium">
                <input type="checkbox" className="h-5 w-5" checked={billing.credit} onChange={(e) => setBilling({ ...billing, credit: e.target.checked })} />
                This is a credit / refund
              </label>
              {billing.po.jobId ? (
                <div>
                  <FileDropZone multiple={false} onFiles={(files) => setBilling({ ...billing, file: files[0] ?? null })} label={billing.file ? `Attached: ${billing.file.name}` : 'Drop the bill here or tap to choose a file'} />
                </div>
              ) : <p className="m-0 text-sm">This visit is not on a job, so the bill is recorded on the order only.</p>}
              {billing.confirm && <p role="alert" className="m-0 text-sm font-semibold text-[#8a4b00]">{billing.confirm}</p>}
              {billing.error && <p role="alert" className="m-0 text-sm font-semibold text-[#a32d2d]">{billing.error}</p>}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-[#e6e4dc] bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
              <button type="button" className={`${btn} w-full sm:w-auto`} onClick={() => setBilling(null)}>Close</button>
              <button type="button" className={`${primary} w-full sm:w-auto`} disabled={busy || !billing.amount.trim()} onClick={() => void recordBill(billing.doneOver || billing.confirmKind === 'over', billing.doneDup || billing.confirmKind === 'duplicate')}>
                {busy ? 'Saving…' : billing.confirm ? 'Record it anyway' : 'Record bill'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

