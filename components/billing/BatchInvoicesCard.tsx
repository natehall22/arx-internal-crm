'use client'

import * as React from 'react'

import BatchDetailDialog from '@/components/billing/BatchDetailDialog'
import BillFinishedJobsSheet from '@/components/billing/BillFinishedJobsSheet'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import { formatDate } from '@/lib/format'
import { formatCurrency } from '@/lib/job-payments'
import type { BatchSummary } from '@/lib/invoice-batch-db'

/**
 * Customer File → Money: this customer's master invoices and "Bill finished jobs". For builders; it renders NOTHING for a
 * customer with no master invoice and no finished job waiting to be billed (a homeowner roofing job), and for people who may
 * not record money (the APIs answer 403).
 */
export default function BatchInvoicesCard({ customerId }: { customerId: string }) {
  const [batches, setBatches] = React.useState<BatchSummary[] | null>(null)
  const [waiting, setWaiting] = React.useState(0)
  const [hidden, setHidden] = React.useState(false)
  const [sheet, setSheet] = React.useState(false)
  const [openId, setOpenId] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    const [a, b] = await Promise.all([
      fetch(`/api/invoice-batches?customerId=${customerId}`, { cache: 'no-store' }).catch(() => null),
      fetch(`/api/invoice-batches/billable?customerId=${customerId}`, { cache: 'no-store' }).catch(() => null),
    ])
    if (!a?.ok || !b?.ok) return setHidden(true)
    setBatches(((await a.json()) as { batches: BatchSummary[] }).batches)
    setWaiting(((await b.json()) as { jobs: unknown[] }).jobs.length)
  }, [customerId])
  React.useEffect(() => {
    void load()
  }, [load])

  if (hidden || !batches || (batches.length === 0 && waiting === 0)) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Master invoices</CardTitle>
        {waiting > 0 ? <Badge tone="warning">{waiting} finished job{waiting === 1 ? '' : 's'} to bill</Badge> : null}
      </CardHeader>
      <div className="border-b border-surface-line px-4 py-3">
        <Button size="sm" disabled={waiting === 0} onClick={() => setSheet(true)}>Bill finished jobs</Button>
      </div>
      <CardContent className="p-0">
        <ul>
          {batches.map((b) => (
            <li key={b.id} className="border-b border-surface-line last:border-b-0">
              <button type="button" className="flex min-h-tap w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left" onClick={() => setOpenId(b.id)}>
                <span>
                  <span className="block text-ui-base font-semibold text-ink underline">{b.number}</span>
                  <span className="block text-ui-sm text-ink">{formatDate(b.createdAt)} · {b.jobCount} job{b.jobCount === 1 ? '' : 's'}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={b.balanceCents <= 0 ? 'success' : b.sentAt ? 'info' : 'neutral'}>{b.balanceCents <= 0 ? 'Paid' : b.sentAt ? 'Sent' : 'Draft'}</Badge>
                  <span className="text-ui-base font-semibold tabular-nums text-ink">{formatCurrency(b.balanceCents > 0 ? b.balanceCents : b.totalCents)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
      {sheet ? (
        <BillFinishedJobsSheet
          customerId={customerId}
          onClose={() => setSheet(false)}
          onCreated={(id) => {
            setSheet(false)
            setOpenId(id)
            void load()
          }}
        />
      ) : null}
      {openId ? (
        <BatchDetailDialog
          batchId={openId}
          onClose={() => {
            setOpenId(null)
            void load()
          }}
        />
      ) : null}
    </Card>
  )
}
