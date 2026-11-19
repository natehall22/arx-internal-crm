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
    // ONE request: this customer's master invoices and how many finished jobs wait (the server reads them in a fixed number of queries).
    const res = await fetch(`/api/invoice-batches?customerId=${customerId}&waiting=1`, { cache: 'no-store' }).catch(() => null)
    if (!res?.ok) return setHidden(true) // feature off (403), no billing access, or not set up yet
    const body = (await res.json()) as { batches: BatchSummary[]; waiting?: number }
    setBatches(body.batches)
    setWaiting(body.waiting ?? 0)
  }, [customerId])
  React.useEffect(() => {
    void load()
  }, [load])

  // Offered only where it pays off: a customer with master invoices already, or 2+ finished jobs waiting (a single house is billed on its job).
  if (hidden || !batches || (batches.length === 0 && waiting < 2)) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Master invoices</CardTitle>
        {waiting > 0 ? <Badge tone="warning">{waiting} finished job{waiting === 1 ? '' : 's'} to bill</Badge> : null}
      </CardHeader>
      <div className="border-b border-surface-line px-4 py-3">
        <Button size="sm" disabled={waiting < 2} onClick={() => setSheet(true)}>Bill finished jobs</Button>
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
