'use client'

import { useCallback, useEffect, useState } from 'react'

import { toast } from '@/components/ui/toast'
import { SELECTION_STATE_LABELS, SELECTION_STATE_TONE } from '@/lib/selections'
import type { SelectionView } from '@/lib/project-tools/selections-db'
import { typedSignatureDataUrl } from '@/lib/typed-signature'
import { api, btnGhost, btnPrimary, Card, inputCls, money, Pill } from './ui'

type Payload = { selections: SelectionView[]; ready: boolean; canEdit: boolean; repName: string }
type Draft = { id?: string; item: string; allowance: string; due_date: string; options: Array<{ id?: string; label: string; price: string }> }
const EMPTY: Draft = { item: '', allowance: '', due_date: '', options: [{ label: '', price: '' }, { label: '', price: '' }] }

/**
 * Selections & allowances. Add the item with its allowance and options, tap Send (the customer gets a link on the company's
 * own page; the office can also choose for them in person). Over the allowance, the difference becomes a change order the
 * customer signs; the card shows the plain state: not sent / waiting on customer / past due / waiting for signature / approved.
 */
/** The most the customer could be charged over the allowance: what a change order, carrying the sender's name, could be for. */
const maxOver = (s: SelectionView) => Math.max(0, ...s.options.map((o) => o.price - s.allowance))

export default function SelectionsCard({ jobId }: { jobId: string }) {
  const [p, setP] = useState<Payload | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await api<Payload>(`/api/ops/jobs/${jobId}/selections`)
    if (r.ok) setP(r.data)
  }, [jobId])
  useEffect(() => void load(), [load])
  if (!p) return null

  async function save() {
    if (!draft) return
    setBusy('save')
    const r = await api(`/api/ops/jobs/${jobId}/selections`, { method: 'POST', body: JSON.stringify({ id: draft.id, item: draft.item, allowance: draft.allowance || 0, due_date: draft.due_date || null, options: draft.options }) })
    setBusy(null)
    if (!r.ok) return toast.error(r.data.error || 'Could not save')
    setDraft(null)
    void load()
  }

  async function act(id: string, body: Record<string, unknown>, done: (d: Record<string, unknown>) => void) {
    setBusy(id)
    const r = await api<Record<string, unknown>>(`/api/ops/jobs/${jobId}/selections/${id}`, { method: 'POST', body: JSON.stringify(body) })
    setBusy(null)
    if (!r.ok) return toast.error(r.data.error || 'Something went wrong')
    done(r.data)
    void load()
  }

  const sig = () => typedSignatureDataUrl(p.repName || 'Office')

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link)
      toast.success('Link copied')
    } catch {
      toast(link)
    }
  }

  return (
    <Card
      testId="selections-card"
      title="Selections & allowances"
      subtitle="What the customer picks, against the allowance in the contract."
      action={p.canEdit ? <button type="button" className={btnGhost} onClick={() => setDraft({ ...EMPTY })}>+ Add a selection</button> : null}
    >
      {!p.ready ? <p className="text-base text-[#2c2c2a]">Selections need a database update first. Ask your admin to apply it.</p> : null}
      {p.ready && p.selections.length === 0 && !draft ? <p className="text-base text-[#2c2c2a]">No selections yet. Add one: the item, the allowance and the options.</p> : null}

      <ul className="divide-y divide-[#e5e3dc]">
        {p.selections.map((s) => (
          <li key={s.id} className="py-3" data-testid="selection-row">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-base font-semibold text-[#2c2c2a]">{s.item}</span>
              <Pill tone={SELECTION_STATE_TONE[s.state]}>{SELECTION_STATE_LABELS[s.state]}</Pill>
            </div>
            <p className="mt-1 text-base text-[#2c2c2a]">
              Allowance {money(s.allowance)}
              {s.chosen_label ? <> · Chose <strong>{s.chosen_label}</strong> {money(s.chosen_price ?? 0)}</> : null}
              {s.difference !== null && s.difference !== 0 ? <> · <strong>{s.difference > 0 ? `${money(s.difference)} over` : `${money(-s.difference)} under`}</strong></> : null}
              {s.due_date ? <> · Due {s.due_date}</> : null}
            </p>
            {s.change_order_number ? <p className="text-sm text-[#2c2c2a]">Change order {s.change_order_number}{s.state === 'waiting_signature' ? ' is waiting for the customer’s signature.' : ' is signed.'}</p> : null}
            {s.link ? (
              <div className="mt-2 flex items-center gap-2">
                <input readOnly aria-label="Customer link" className={inputCls} value={s.link} onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className={btnGhost} onClick={() => void copy(s.link as string)}>Copy</button>
              </div>
            ) : null}
            {s.change_order_url && s.state === 'waiting_signature' ? (
              <div className="mt-2 flex items-center gap-2">
                <input readOnly aria-label="Change order signing link" className={inputCls} value={s.change_order_url} onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className={btnGhost} onClick={() => void copy(s.change_order_url as string)}>Copy</button>
              </div>
            ) : null}
            {p.canEdit && s.needs_attention ? (
              <div className="mt-2 rounded-lg bg-[#fef3c7] p-3">
                <p className="text-base text-[#78350f]">{s.change_order_number ? 'The change order link ran out before it was signed.' : 'The change order was not made.'}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className={btnPrimary} disabled={busy === s.id} onClick={() => { const rep = sig(); if (!rep) return toast.error('Could not prepare your signature'); void act(s.id, { action: 'resend_change_order', repSignature: rep }, () => toast.success('A new change order was sent to the customer')) }}>Send change order again</button>
                  <button type="button" className={btnGhost} disabled={busy === s.id} onClick={() => void act(s.id, { action: 'cancel_chosen' }, () => toast.success('Cancelled'))}>Cancel this pick</button>
                </div>
              </div>
            ) : null}
            {p.canEdit && s.status !== 'chosen' ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={btnPrimary} disabled={busy === s.id} onClick={() => { const rep = sig(); if (!rep) return toast.error('Could not prepare your signature'); void act(s.id, { action: 'send', repSignature: rep, email: true }, (d) => toast.success(d.emailed ? 'Sent to the customer by email' : 'Link ready. Copy it to send.')) }}>
                  {s.status === 'sent' ? 'Send again' : 'Send to customer'}
                </button>
                {maxOver(s) > 0 ? <p className="w-full text-sm text-[#2c2c2a]">Sending puts your name on a change order of up to {money(maxOver(s))} if the customer picks the priciest option.</p> : null}
                <button type="button" className={btnGhost} onClick={() => setOpenId(openId === s.id ? null : s.id)} aria-expanded={openId === s.id}>Choose for them</button>
                <button type="button" className={btnGhost} onClick={() => setDraft({ id: s.id, item: s.item, allowance: String(s.allowance), due_date: s.due_date ?? '', options: s.options.map((o) => ({ id: o.id, label: o.label, price: String(o.price) })) })}>Edit</button>
                <button type="button" className={btnGhost} disabled={busy === s.id} onClick={() => void act(s.id, { action: 'cancel' }, () => undefined)}>Cancel</button>
              </div>
            ) : null}
            {openId === s.id ? (
              <div className="mt-2 space-y-2 rounded-lg bg-[#f1efe8] p-3" role="group" aria-label="Choose an option">
                {s.options.map((o) => (
                  <button key={o.id} type="button" className={`${btnGhost} w-full justify-between`} disabled={busy === s.id} onClick={() => { const rep = sig(); if (!rep) return toast.error('Could not prepare your signature'); void act(s.id, { action: 'choose', optionId: o.id, repSignature: rep }, (d) => { setOpenId(null); toast.success(d.state === 'needs_signature' ? 'Chosen. A change order is ready for the customer to sign.' : 'Chosen') }) }}>
                    <span>{o.label}</span><span className="tabular-nums">{money(o.price)}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {draft ? (
        <div className="mt-3 space-y-2 rounded-lg border border-[#d6d3ca] p-3" data-testid="selection-form">
          <label className="block text-sm font-semibold text-[#2c2c2a]">What are they choosing?
            <input className={`${inputCls} mt-1`} value={draft.item} onChange={(e) => setDraft({ ...draft, item: e.target.value })} placeholder="Kitchen faucet" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm font-semibold text-[#2c2c2a]">Allowance
              <input className={`${inputCls} mt-1`} inputMode="decimal" value={draft.allowance} onChange={(e) => setDraft({ ...draft, allowance: e.target.value })} placeholder="0.00" />
            </label>
            <label className="block text-sm font-semibold text-[#2c2c2a]">Choose by
              <input type="date" className={`${inputCls} mt-1`} value={draft.due_date} onChange={(e) => setDraft({ ...draft, due_date: e.target.value })} />
            </label>
          </div>
          <p className="text-sm font-semibold text-[#2c2c2a]">Options (name and price)</p>
          {draft.options.map((o, i) => (
            <div key={i} className="grid grid-cols-[1fr_7rem] gap-2">
              <input className={inputCls} aria-label={`Option ${i + 1} name`} value={o.label} onChange={(e) => setDraft({ ...draft, options: draft.options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} placeholder="Brushed nickel" />
              <input className={inputCls} aria-label={`Option ${i + 1} price`} inputMode="decimal" value={o.price} onChange={(e) => setDraft({ ...draft, options: draft.options.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)) })} placeholder="0.00" />
            </div>
          ))}
          <button type="button" className={btnGhost} onClick={() => setDraft({ ...draft, options: [...draft.options, { label: '', price: '' }] })}>+ Another option</button>
          <div className="flex gap-2">
            <button type="button" className={`${btnPrimary} flex-1`} disabled={busy === 'save'} onClick={() => void save()}>Save</button>
            <button type="button" className={btnGhost} onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      ) : null}
    </Card>
  )
}
