'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Button, Dialog, DialogContent, DialogFooter, toast } from '@/components/ui'

export type EditableCustomer = { id: string; name: string | null; phone: string | null; email: string | null; address_text: string | null }

/** The deal the person is editing from (the Customer File header). Its address is what the file shows first, so an address edit offers to move it too. */
export type EditDeal = { id: string; address_text: string | null; lead_id: string | null }

const norm = (v: string | null | undefined) => (v ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

const INPUT = 'mt-1 block min-h-tap w-full rounded-lg border border-gray-300 px-3 py-2 text-base text-[#2c2c2a]'

/**
 * THE customer edit: one sheet (bottom sheet on a phone) for name, phone, email and address, saved through
 * PATCH /api/customers/[id] — the route decides who may (customer-edit permission; reps only on their own customers).
 * Used by the Customer File header and by the contact card (and so the older account page).
 */
export default function EditCustomerButton({ customer, deal, className, label = 'Edit' }: { customer: EditableCustomer; deal?: EditDeal | null; className?: string; label?: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  // "Also update this deal's address": on by default only when the deal still carries the customer's old address.
  const [alsoDeal, setAlsoDeal] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', phone: '', address_text: '' })
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const start = () => {
    setForm({ name: customer.name || '', email: customer.email || '', phone: customer.phone || '', address_text: customer.address_text || '' })
    setAlsoDeal(!!deal && norm(deal.address_text) === norm(customer.address_text))
    setOpen(true)
  }

  const addressChanged = norm(form.address_text) !== norm(customer.address_text) && !!form.address_text.trim()
  const offerDeal = !!deal && addressChanged

  const save = async () => {
    setSaving(true)
    try {
      const moveDeal = offerDeal && alsoDeal && !!deal
      const body = { ...form, ...(moveDeal && deal?.lead_id && customer.address_text ? { also_lead: { lead_id: deal.lead_id, old_address: customer.address_text } } : {}) }
      const res = await fetch(`/api/customers/${customer.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(data.error || 'Could not save the customer')
      if (moveDeal && deal) {
        // The deal's own update path (org-scoped, permission-checked); the customer is already saved either way.
        const r2 = await fetch(`/api/opportunities/${deal.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address_text: form.address_text }) }).catch(() => null)
        if (!r2 || !r2.ok) toast.error('Customer saved, but the deal address could not be changed')
      }
      toast.success('Customer saved')
      setOpen(false)
      router.refresh()
    } catch {
      toast.error('Could not save the customer')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button type="button" onClick={start} className={className ?? 'inline-flex min-h-tap items-center rounded-ui border border-surface-line px-4 text-ui-sm font-semibold text-ink'}>
        {label}
      </button>
      <Dialog open={open} onOpenChange={(o) => !saving && setOpen(o)}>
        {open && (
          <DialogContent title="Edit customer" description="Name, phone, email and address.">
            <label className="block text-sm font-medium text-[#2c2c2a]">Name<input className={INPUT} value={form.name} onChange={set('name')} autoComplete="off" maxLength={200} /></label>
            <label className="block text-sm font-medium text-[#2c2c2a]">Phone<input className={INPUT} type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} maxLength={40} /></label>
            <label className="block text-sm font-medium text-[#2c2c2a]">Email<input className={INPUT} type="email" inputMode="email" value={form.email} onChange={set('email')} maxLength={200} /></label>
            <label className="block text-sm font-medium text-[#2c2c2a]">Address<input className={INPUT} value={form.address_text} onChange={set('address_text')} maxLength={300} /></label>
            {offerDeal && (
              <label className="flex min-h-tap items-center gap-3 text-base text-[#2c2c2a]">
                <input type="checkbox" className="h-5 w-5 shrink-0" checked={alsoDeal} onChange={(e) => setAlsoDeal(e.target.checked)} />
                Also update this deal’s address
              </label>
            )}
            <DialogFooter>
              <Button type="button" variant="secondary" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="button" loading={saving} onClick={() => void save()}>Save</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}
