'use client'

import { useState } from 'react'

import { Button, Card, CardContent, CardHeader, CardTitle, Select, toast } from '@/components/ui'

/**
 * Customer File → Price list (billing staff; the server refuses anyone else). One dropdown: which price list this
 * customer's new quotes use (e.g. Builder). "Standard" = the company's default list. Quotes already made keep their prices.
 */
export default function PriceListCard({
  customerId,
  lists,
  initialListId,
  proposalWord = 'Quote',
}: {
  customerId: string
  lists: Array<{ id: string; name: string; is_default: boolean }>
  /** The customer's own list; '' = follows the default. */
  initialListId: string
  proposalWord?: string
}) {
  const [listId, setListId] = useState(initialListId)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    const res = await fetch(`/api/customers/${customerId}/price-list`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pricebook_id: listId || null }),
    }).catch(() => null)
    setSaving(false)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (!res || !res.ok) return toast.error((data as { error?: string }).error || 'Could not save')
    toast.success('Price list saved')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Price list</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <label htmlFor="customer-price-list" className="text-ui-base text-ink">New {proposalWord.toLowerCase()}s for this customer use</label>
        <Select id="customer-price-list" value={listId} onChange={(e) => setListId(e.target.value)}>
          <option value="">{lists.find((l) => l.is_default)?.name ?? 'Standard'} (standard)</option>
          {lists.filter((l) => !l.is_default).map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </Select>
        <p className="text-ui-sm text-ink">{proposalWord}s already made keep the prices they were made with.</p>
        <Button className="min-h-tap self-start" loading={saving} onClick={() => void save()}>Save</Button>
      </CardContent>
    </Card>
  )
}
