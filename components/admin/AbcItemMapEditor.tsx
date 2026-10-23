'use client'

import { useEffect, useMemo, useState } from 'react'

import { STANDARD_LINES } from '@/lib/suppliers/abc/standard-lines'
import { parseOrderQuantity } from '@/lib/suppliers/abc/quantity'

type Row = { lineKey: string; label: string; itemNumber: string; uom: string; qtyUnitWord: string; price: string; exampleQty: string; caveat?: string; custom?: boolean; saved: boolean }
type ApiMapRow = { line_key: string; item_number: string; uom: string; qty_unit_word: string; est_unit_price_cents: number | null }

const ctl = 'block w-full min-h-[44px] rounded-lg border border-[#8a877d] bg-white px-3 py-2 text-base text-[#2c2c2a]'
const btn = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[#5f5e5a] bg-white px-4 py-2 text-sm font-semibold text-[#2c2c2a] disabled:opacity-50'

const dollarsToCents = (v: string): number | null | 'bad' => {
  const t = v.trim().replace(/^\$/, '')
  if (!t) return null
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return 'bad'
  return Math.round(Number(t) * 100)
}

/** Owner-only: attach an ABC item number to each order line. A line with no item number keeps the whole order on email. */
export default function AbcItemMapEditor({ vendorId, onClose }: { vendorId: string; onClose: (mappedCount?: number) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [newKey, setNewKey] = useState('')

  useEffect(() => {
    let live = true
    fetch(`/api/admin/suppliers/${vendorId}/api`, { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'Could not load the item numbers')
        const byKey = new Map<string, ApiMapRow>(((j.itemMap ?? []) as ApiMapRow[]).map((m) => [m.line_key, m]))
        const std: Row[] = STANDARD_LINES.map((s) => {
          const m = byKey.get(s.key)
          byKey.delete(s.key)
          return { lineKey: s.key, label: s.label, itemNumber: m?.item_number ?? '', uom: m?.uom ?? '', qtyUnitWord: m?.qty_unit_word ?? s.qtyUnitWord, price: m?.est_unit_price_cents != null ? (m.est_unit_price_cents / 100).toFixed(2) : '', exampleQty: s.exampleQty, caveat: s.caveat, saved: !!m }
        })
        const extra: Row[] = Array.from(byKey.values()).map((m) => ({ lineKey: m.line_key, label: m.line_key, itemNumber: m.item_number, uom: m.uom, qtyUnitWord: m.qty_unit_word, price: m.est_unit_price_cents != null ? (m.est_unit_price_cents / 100).toFixed(2) : '', exampleQty: '', custom: true, saved: true }))
        if (live) setRows([...std, ...extra])
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load the item numbers'))
    return () => { live = false }
  }, [vendorId])

  const mapped = useMemo(() => (rows ?? []).filter((r) => r.itemNumber.trim()).length, [rows])
  const patch = (key: string, p: Partial<Row>) => setRows((rs) => (rs ?? []).map((r) => (r.lineKey === key ? { ...r, ...p } : r)))

  async function save() {
    if (!rows) return
    setError(null)
    setSavedMsg(null)
    const itemMap: Array<Record<string, unknown>> = []
    const remove: string[] = []
    for (const r of rows) {
      // An empty item number means "no mapping for this line": remove a saved one, skip an unsaved one.
      if (!r.itemNumber.trim()) {
        if (r.saved) remove.push(r.lineKey)
        continue
      }
      if (!r.uom.trim() || !r.qtyUnitWord.trim()) return setError(`"${r.label}" needs a unit code and a quantity word (or clear the item number to remove the line).`)
      const price = dollarsToCents(r.price)
      if (price === 'bad') return setError(`"${r.label}": the price must be dollars and cents, like 38.00.`)
      itemMap.push({ lineKey: r.lineKey, itemNumber: r.itemNumber.trim(), uom: r.uom.trim(), qtyUnitWord: r.qtyUnitWord.trim(), estUnitPriceCents: price })
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/suppliers/${vendorId}/api`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemMap, itemMapRemove: remove }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Could not save')
      setRows((rs) => (rs ?? []).map((r) => ({ ...r, saved: !!r.itemNumber.trim() })))
      setSavedMsg(`Saved. ${itemMap.length} line${itemMap.length === 1 ? '' : 's'} mapped.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end bg-black/50 sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true" aria-label="ABC item numbers">
      <div className="flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white sm:max-w-2xl sm:rounded-xl">
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div>
            <h2 className="m-0 text-lg font-bold">ABC item numbers</h2>
            <p className="m-0 mt-1 text-sm text-[#2c2c2a]">
              Each order line needs an ABC item number before an order can go by the API. A line left blank keeps the whole order on email.
              Prices are only an estimate that decides when a second owner must approve — they are never compared against another supplier.
            </p>
            {rows && <p className="m-0 mt-2 text-sm font-semibold">{mapped} of {rows.length} lines mapped</p>}
          </div>
          {!rows && !error && <p className="text-sm">Loading…</p>}
          {rows?.map((r) => {
            const reads = r.exampleQty && r.qtyUnitWord ? parseOrderQuantity(r.exampleQty, r.qtyUnitWord) : null
            return (
              <fieldset key={r.lineKey} className="space-y-2 rounded-lg border border-[#d3d1c7] p-3">
                <legend className="px-1 text-sm font-bold">{r.label}</legend>
                <label className="block text-sm font-medium">ABC item number
                  <input className={ctl} value={r.itemNumber} onChange={(e) => patch(r.lineKey, { itemNumber: e.target.value })} autoComplete="off" inputMode="text" />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-sm font-medium">Unit code
                    <input className={ctl} value={r.uom} onChange={(e) => patch(r.lineKey, { uom: e.target.value.toUpperCase() })} placeholder="BD" autoCapitalize="characters" maxLength={10} />
                  </label>
                  <label className="block text-sm font-medium">Word in our quantity
                    <input className={ctl} value={r.qtyUnitWord} onChange={(e) => patch(r.lineKey, { qtyUnitWord: e.target.value })} autoCapitalize="none" maxLength={30} />
                  </label>
                </div>
                <label className="block text-sm font-medium">Estimated price each, in dollars (optional)
                  <input className={ctl} value={r.price} onChange={(e) => patch(r.lineKey, { price: e.target.value })} inputMode="decimal" placeholder="38.00" />
                </label>
                {r.exampleQty && (
                  <p className="m-0 text-sm">
                    Example: “{r.exampleQty}” {reads !== null ? <>reads as <strong>{reads} {r.uom || 'units'}</strong>.</> : <strong>is not read automatically.</strong>}
                  </p>
                )}
                {r.caveat && <p className="m-0 text-sm">{r.caveat}</p>}
              </fieldset>
            )
          })}
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="new-line-key">Another line key</label>
            <input id="new-line-key" className={ctl} value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="Another line key from an order sheet" autoCapitalize="none" />
            <button type="button" className={btn} onClick={() => {
              const k = newKey.trim()
              if (!k || (rows ?? []).some((r) => r.lineKey === k)) return
              setRows([...(rows ?? []), { lineKey: k, label: k, itemNumber: '', uom: '', qtyUnitWord: '', price: '', exampleQty: '', custom: true, saved: false }])
              setNewKey('')
            }}>Add</button>
          </div>
          {error && <p role="alert" className="m-0 text-sm font-semibold text-[#a32d2d]">{error}</p>}
          {savedMsg && <p role="status" className="m-0 text-sm font-semibold text-[#1d5e2a]">{savedMsg}</p>}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-[#e6e4dc] bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
          <button type="button" className={`${btn} w-full sm:w-auto`} onClick={() => onClose(mapped)}>Close</button>
          <button type="button" className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-[#2b0a3d] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto" disabled={saving || !rows} onClick={save}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
