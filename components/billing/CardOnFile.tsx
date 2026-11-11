'use client'

import { useCallback, useEffect, useState } from 'react'

import { Badge, Button, toast } from '@/components/ui'
import { confirmDialog } from '@/components/ui/confirm-dialog'

type CardView = { available: boolean; featureOn: boolean; card: { label: string; autopay: boolean; expired: boolean; expires: string | null } | null }

/**
 * Customer File → Invoices → card on file (online payments). The office never types a card: it sends the customer a
 * save-card link (they agree and enter it on Stripe's page). The office can stop automatic payments or remove the card.
 */
export default function CardOnFile({ customerId }: { customerId: string }) {
  const [view, setView] = useState<CardView | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/customers/${customerId}/card`, { cache: 'no-store' }).catch(() => null)
    setView(res?.ok ? ((await res.json()) as CardView) : null)
  }, [customerId])

  useEffect(() => {
    void load()
  }, [load])

  if (!view?.featureOn) return null

  async function call(method: 'POST' | 'PATCH' | 'DELETE', body: unknown, tag: string) {
    setBusy(tag)
    const res = await fetch(`/api/customers/${customerId}/card`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).catch(() => null)
    const data = res ? ((await res.json().catch(() => ({}))) as CardView & { url?: string; error?: string; emailedTo?: string }) : null
    setBusy(null)
    if (!res || !res.ok) {
      toast.error(data?.error || 'Something went wrong')
      return null
    }
    return data
  }

  async function sendLink(email: boolean) {
    const data = await call('POST', { email }, email ? 'email' : 'copy')
    if (!data?.url) return
    if (email) return toast.success(`Link emailed to ${data.emailedTo}`)
    const copied = await navigator.clipboard?.writeText(data.url).then(() => true).catch(() => false)
    toast.success(copied ? 'Link copied — paste it in a text' : data.url)
  }

  async function autopayOff() {
    const data = await call('PATCH', { autopay: false }, 'off')
    if (data) setView(data)
  }

  async function remove() {
    if (!(await confirmDialog({ title: 'Remove this card?', description: 'Automatic payments stop. The customer can save a new card from a link.', confirmLabel: 'Remove card', destructive: true }))) return
    const data = await call('DELETE', null, 'remove')
    if (data) setView(data)
  }

  const c = view.card
  return (
    <div className="border-b border-surface-line px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-ui-base font-semibold text-ink">{c ? c.label : 'No card on file'}</span>
        {c ? <Badge tone={c.expired ? 'danger' : c.autopay ? 'success' : 'neutral'}>{c.expired ? 'Expired' : c.autopay ? 'Automatic payments on' : 'Automatic payments off'}</Badge> : null}
      </div>
      {view.available ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" loading={busy === 'email'} onClick={() => void sendLink(true)}>
            {c ? 'Email link for a new card' : 'Email save-card link'}
          </Button>
          <Button size="sm" variant="secondary" loading={busy === 'copy'} onClick={() => void sendLink(false)}>
            Copy link
          </Button>
          {c?.autopay ? (
            <Button size="sm" variant="secondary" loading={busy === 'off'} onClick={() => void autopayOff()}>
              Stop automatic payments
            </Button>
          ) : null}
          {c ? (
            <Button size="sm" variant="secondary" loading={busy === 'remove'} onClick={() => void remove()}>
              Remove card
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="mt-1 text-ui-sm text-ink">Automatic payments are off for the company (Settings → Online payments).</p>
      )}
    </div>
  )
}
