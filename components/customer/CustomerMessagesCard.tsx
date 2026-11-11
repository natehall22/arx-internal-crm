'use client'

import { useState } from 'react'

import { Button, Card, CardContent, CardHeader, CardTitle, confirmDialog, toast } from '@/components/ui'
import type { CustomerMessageState } from '@/lib/customer-messages-db'
import { formatDateShort } from '@/lib/format'

const KIND_LABEL: Record<string, string> = {
  visit_reminder: 'Visit reminder',
  visit_on_the_way: 'On the way',
  visit_done: 'Visit done',
  quote_follow_up: 'Quote follow-up',
  invoice_reminder: 'Invoice reminder',
}

const STATUS_LABEL: Record<string, string> = {
  sent: 'Sent',
  queued: 'Waiting',
  sending: 'Sending',
  failed: 'Not sent yet',
  skipped: 'Not sent',
  cancelled: 'Not needed',
}

const REASON_LABEL: Record<string, string> = {
  customer_opted_out: 'emails off',
  no_address: 'no email address',
  suppressed: 'unsubscribed or bounced',
  bounced: 'address bounced',
  daily_limit: 'too many today',
  expired: 'too late',
  too_late: 'too late',
}

const day = (iso: string): string => formatDateShort(iso)

/**
 * Customer File → Automatic emails. One switch the office flips ("don't email this customer"); shows when the customer
 * unsubscribed or their address bounced (turning those back on asks "did the customer ask?") and the last messages.
 * Talks to /api/customers/[id]/messages.
 */
export default function CustomerMessagesCard({ customerId, initial, canEdit }: { customerId: string; initial: CustomerMessageState; canEdit: boolean }) {
  const [state, setState] = useState(initial)
  const [saving, setSaving] = useState(false)
  const on = !state.off && !state.suppressed

  async function save(next: boolean) {
    let customerAsked = false
    if (next && (state.offBy === 'customer' || state.suppressed)) {
      customerAsked = await confirmDialog({
        title: 'Did the customer ask?',
        description:
          state.suppressed?.reason === 'bounced'
            ? 'This address bounced. Turn emails back on only after checking the address with the customer.'
            : 'This customer stopped these emails themselves. Turn them back on only if they asked you to.',
        confirmLabel: 'Yes, they asked',
      })
      if (!customerAsked) return
    }
    setSaving(true)
    const res = await fetch(`/api/customers/${customerId}/messages`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ on: next, customerAsked }),
    }).catch(() => null)
    setSaving(false)
    const data = (res ? await res.json().catch(() => ({})) : {}) as { error?: string; state?: CustomerMessageState }
    if (!res || !res.ok || !data.state) return toast.error(data.error || 'Could not save')
    setState(data.state)
    toast.success(next ? 'Automatic emails are on for this customer' : 'No more automatic emails to this customer')
  }

  const why = state.suppressed
    ? state.suppressed.reason === 'bounced'
      ? `Off — their email bounced (${day(state.suppressed.at)})`
      : `Off — the customer unsubscribed (${day(state.suppressed.at)})`
    : state.offBy === 'customer'
      ? `Off — the customer unsubscribed${state.offAt ? ` (${day(state.offAt)})` : ''}`
      : state.off
        ? `Off — turned off by the office${state.offAt ? ` (${day(state.offAt)})` : ''}`
        : state.email
          ? `On — sent to ${state.email}`
          : 'On — but there is no email address on file'

  return (
    <Card>
      <CardHeader>
        <CardTitle>Automatic emails</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-ui-base font-semibold text-ink">{why}</p>
        {canEdit ? (
          <Button className="min-h-tap self-start" variant={on ? 'secondary' : 'primary'} loading={saving} onClick={() => void save(!on)}>
            {on ? 'Don’t email this customer' : 'Turn emails back on'}
          </Button>
        ) : null}
        {state.recent.length > 0 ? (
          <ul className="divide-y divide-surface-line">
            {state.recent.map((m) => (
              <li key={m.id} className="flex flex-wrap justify-between gap-2 py-2 text-ui-base text-ink">
                <span>{KIND_LABEL[m.kind] ?? m.kind}</span>
                <span>
                  {STATUS_LABEL[m.status] ?? m.status}
                  {m.reason && m.status !== 'sent' ? ` (${REASON_LABEL[m.reason] ?? m.reason.replace(/_/g, ' ')})` : ''} · {day(m.at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ui-sm text-ink">Nothing sent yet.</p>
        )}
      </CardContent>
    </Card>
  )
}
