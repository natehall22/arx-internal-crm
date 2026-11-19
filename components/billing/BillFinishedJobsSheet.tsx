'use client'

import * as React from 'react'

import { Button, Dialog, DialogContent, DialogFooter, Field, Input, Select, toast } from '@/components/ui'
import { batchLineWhere, developmentOptions, filterByDevelopment } from '@/lib/invoice-batch'
import { formatCurrency } from '@/lib/job-payments'
import type { BillableJob } from '@/lib/invoice-batch-db'

type Customer = { id: string; name: string }

/**
 * "Bill finished jobs": pick one customer's finished, not-yet-billed jobs (all by default) and make ONE master invoice over
 * them. With developments on file a Development filter narrows the list (one master invoice per development, or all at once).
 * Makes drafts only (POST /api/invoice-batches); the card opens the result to review and send. Bottom sheet on a phone.
 */
export default function BillFinishedJobsSheet({ customerId: fixedCustomerId, onClose, onCreated }: { customerId?: string; onClose: () => void; onCreated: (batchId: string) => void }) {
  const [customer, setCustomer] = React.useState<Customer | null>(null)
  const [query, setQuery] = React.useState('')
  const [found, setFound] = React.useState<Customer[]>([])
  const [offer, setOffer] = React.useState<{ jobs: BillableJob[]; developmentsAvailable: boolean } | null>(null)
  const [development, setDevelopment] = React.useState('')
  const [picked, setPicked] = React.useState<Set<string>>(new Set())
  const [busy, setBusy] = React.useState(false)
  const customerId = fixedCustomerId ?? customer?.id ?? null

  React.useEffect(() => {
    if (fixedCustomerId || query.trim().length < 2) return setFound([])
    const t = setTimeout(() => {
      void fetch(`/api/customers/search?q=${encodeURIComponent(query.trim())}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : { customers: [] }))
        .then((d: { customers?: Array<{ id: string; name: string | null }> }) => setFound((d.customers ?? []).slice(0, 8).map((c) => ({ id: c.id, name: c.name || 'Customer' }))))
        .catch(() => setFound([]))
    }, 250)
    return () => clearTimeout(t)
  }, [query, fixedCustomerId])

  React.useEffect(() => {
    if (!customerId) return
    setOffer(null)
    void fetch(`/api/invoice-batches/billable?customerId=${customerId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { jobs: BillableJob[]; developmentsAvailable: boolean } | null) => {
        if (!d) return toast.error('Could not load the finished jobs')
        setOffer(d)
        setPicked(new Set(d.jobs.map((j) => j.jobId))) // default: all
      })
      .catch(() => toast.error('Could not load the finished jobs'))
  }, [customerId])

  const jobs = offer?.jobs ?? []
  const developments = developmentOptions(jobs)
  const shown = filterByDevelopment(jobs, development)
  const chosen = shown.filter((j) => picked.has(j.jobId))
  const total = chosen.reduce((s, j) => s + j.amountCents, 0)

  // Changing the development re-selects that development's houses (the office wants "all of Oak Ridge", not a leftover tick).
  const pickDevelopment = (name: string) => {
    setDevelopment(name)
    setPicked(new Set(filterByDevelopment(jobs, name).map((j) => j.jobId)))
  }
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })

  async function make() {
    if (!customerId || chosen.length === 0) return
    setBusy(true)
    try {
      const res = await fetch('/api/invoice-batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId, jobIds: chosen.map((j) => j.jobId) }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(body.error || 'Could not make the master invoice')
      toast.success(`Master invoice ${body.number} made — review it, then send it`)
      onCreated(String(body.batchId))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Bill finished jobs" description="One invoice for the houses you pick. Each house keeps its own invoice underneath.">
        <div className="flex max-h-[65dvh] flex-col gap-3 overflow-y-auto">
          {!fixedCustomerId ? (
            customer ? (
              <p className="text-ui-base font-semibold text-ink">
                {customer.name}{' '}
                <button type="button" className="min-h-tap text-ui-sm font-semibold underline" onClick={() => { setCustomer(null); setOffer(null) }}>Change</button>
              </p>
            ) : (
              <div>
                <Field label="Customer">{(p) => <Input {...p} value={query} placeholder="Search by name" onChange={(e) => setQuery(e.target.value)} />}</Field>
                <ul>
                  {found.map((c) => (
                    <li key={c.id}>
                      <button type="button" className="min-h-tap w-full text-left text-ui-base text-ink underline" onClick={() => setCustomer(c)}>{c.name}</button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          ) : null}

          {customerId && !offer ? <p className="text-ui-base text-ink">Loading…</p> : null}
          {offer && jobs.length === 0 ? <p className="text-ui-base text-ink">No finished jobs are waiting to be billed for this customer.</p> : null}

          {offer && developments.length > 0 ? (
            <Field label="Development">
              {(p) => (
                <Select {...p} value={development} onChange={(e) => pickDevelopment(e.target.value)}>
                  <option value="">All developments ({jobs.length})</option>
                  {developments.map((d) => (
                    <option key={d.name} value={d.name}>{d.name} ({d.count})</option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}

          {shown.length > 0 ? (
            <ul className="divide-y divide-surface-line rounded-ui border border-surface-line">
              {shown.map((j) => (
                <li key={j.jobId}>
                  <label className="flex min-h-tap items-start gap-3 px-3 py-2 text-ui-base text-ink">
                    <input type="checkbox" className="mt-1 h-5 w-5" checked={picked.has(j.jobId)} onChange={() => toggle(j.jobId)} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">Job {j.jobNumber}{j.customerPo ? ` · PO ${j.customerPo}` : ''}</span>
                      <span className="block break-words text-ui-sm">{batchLineWhere(j, !development) || '—'}</span>
                    </span>
                    <span className="font-semibold tabular-nums">{formatCurrency(j.amountCents)}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={chosen.length === 0} onClick={() => void make()}>
            {chosen.length > 0 ? `Make invoice · ${chosen.length} job${chosen.length === 1 ? '' : 's'} · ${formatCurrency(total)}` : 'Pick jobs'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
