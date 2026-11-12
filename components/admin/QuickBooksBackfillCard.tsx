'use client'

import { useState } from 'react'

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, toast } from '@/components/ui'
import { confirmDialog } from '@/components/ui/confirm-dialog'
import type { BackfillPlan, MatchItem } from '@/lib/quickbooks/backfill'

type Phase = 'start' | 'review' | 'linked'

const KIND: Record<MatchItem['kind'], string> = { customer: 'Customer', job: 'Job', invoice: 'Invoice' }

/**
 * Settings → QuickBooks → "Match what is already in QuickBooks" (owners). 1) look (nothing changes), 2) settle the unclear ones with
 * one tap each, 3) link, 4) a separate, confirmed "Start sending" from the start date. /api/admin/quickbooks/backfill.
 */
export default function QuickBooksBackfillCard({ title = 'Match what is already in QuickBooks', done = false, onDone }: { title?: string; done?: boolean; onDone?: () => void }) {
  const [phase, setPhase] = useState<Phase>('start')
  const [plan, setPlan] = useState<BackfillPlan | null>(null)
  const [decisions, setDecisions] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<{ linked: number; skipped: number; left: number } | null>(null)

  async function call(body: Record<string, unknown>) {
    const res = await fetch('/api/admin/quickbooks/backfill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const data = res ? ((await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string }) : null
    if (!res || !res.ok || !data) {
      toast.error(data?.error ?? 'Something went wrong. Please try again.')
      return null
    }
    return data
  }

  async function look(next: Record<string, string> = decisions) {
    setBusy('look')
    const data = await call({ action: 'preview', decisions: next })
    setBusy(null)
    if (data) {
      setPlan(data as unknown as BackfillPlan)
      setPhase('review')
    }
  }

  async function choose(key: string, qbId: string) {
    const next = { ...decisions, [key]: qbId }
    setDecisions(next)
    await look(next)
  }

  async function link() {
    setBusy('apply')
    const data = await call({ action: 'apply', decisions })
    if (data) {
      setResult(data as unknown as { linked: number; skipped: number; left: number })
      setPhase('linked')
      onDone?.()
    }
    setBusy(null)
  }

  async function skipStep() {
    const ok = await confirmDialog({
      title: 'Skip matching?',
      description: 'If QuickBooks already has these customers or invoices, sending without matching can create duplicates that your bookkeeper must clean up. Only skip if QuickBooks is new or empty.',
      confirmLabel: 'Skip matching',
      destructive: true,
    })
    if (!ok) return
    setBusy('skip')
    const data = await call({ action: 'skip' })
    setBusy(null)
    if (data) {
      toast.success('Matching skipped.')
      onDone?.()
    }
  }

  const ambiguous = plan?.items.filter((i) => i.state === 'ambiguous') ?? []
  const certain = plan?.items.filter((i) => i.state === 'certain').length ?? 0
  const none = plan?.items.filter((i) => i.state === 'none').length ?? 0

  return (
    <Card id="quickbooks-backfill" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {ambiguous.length ? <Badge tone="warning">{ambiguous.length} to settle</Badge> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-ui-base text-ink">If your bookkeeper already has these customers and invoices in QuickBooks, match them first so nothing is entered twice. Looking changes nothing.</p>

        {phase === 'start' ? (
          <Button className="min-h-tap" loading={busy === 'look'} onClick={() => void look()}>Look at QuickBooks</Button>
        ) : null}

        {phase === 'review' && plan ? (
          <>
            <ul className="grid grid-cols-2 gap-2 text-ui-base text-ink">
              <li className="rounded-ui border border-surface-line bg-white p-3"><span className="block text-ui-sm">Already matched</span><b>{plan.counts.alreadyLinked}</b></li>
              <li className="rounded-ui border border-surface-line bg-white p-3"><span className="block text-ui-sm">Clear matches</span><b>{certain}</b></li>
              <li className="rounded-ui border border-surface-line bg-white p-3"><span className="block text-ui-sm">Need your say</span><b>{ambiguous.length}</b></li>
              <li className="rounded-ui border border-surface-line bg-white p-3"><span className="block text-ui-sm">Not in QuickBooks</span><b>{none}</b></li>
            </ul>
            {plan.truncated ? <p role="status" className="text-ui-base font-semibold text-ink">QuickBooks has more records than can be read in one pass. Ask whoever runs your CRM before linking.</p> : null}

            {ambiguous.map((it) => (
              <div key={it.key} className="flex flex-col gap-2 rounded-ui border border-surface-line bg-white p-3">
                <p className="text-ui-base font-semibold text-ink">{KIND[it.kind]}: {it.label}</p>
                {it.reason ? <p className="text-ui-base text-ink">{it.reason}</p> : null}
                {it.candidates.map((c) => (
                  <Button key={c.qbId} variant="secondary" className="min-h-tap h-auto justify-start whitespace-normal text-left" loading={busy === 'look'} onClick={() => void choose(it.key, c.qbId)}>
                    This one: {c.label} ({c.detail})
                  </Button>
                ))}
                <Button variant="secondary" className="min-h-tap" loading={busy === 'look'} onClick={() => void choose(it.key, 'none')}>None of these. Create a new one later.</Button>
              </div>
            ))}

            <div className="sticky bottom-0 flex flex-wrap gap-2 bg-white py-2">
              <Button className="min-h-tap" loading={busy === 'apply'} disabled={plan.truncated} onClick={() => void link()}>
                {ambiguous.length ? `Match ${certain} now, settle ${ambiguous.length} later` : `Match ${certain}`}
              </Button>
            </div>
            <p className="text-ui-sm text-ink">Matching only links records. Nothing is created or changed in QuickBooks.</p>
          </>
        ) : null}

        {phase === 'linked' && result ? (
          <>
            <p role="status" className="rounded-ui border border-surface-line bg-surface-subtle p-3 text-ui-base font-semibold text-ink">
              Matched {result.linked}{result.skipped ? `, ${result.skipped} already taken` : ''}{result.left ? `, ${result.left} still to settle` : ''}. Step 3 is done. Next is step 4.
            </p>
            <Button variant="secondary" className="min-h-tap" onClick={() => void look()}>Look again</Button>
          </>
        ) : null}

        {phase === 'start' && done ? <p role="status" className="rounded-ui border border-surface-line bg-surface-subtle p-3 text-ui-base font-semibold text-ink">Step 3 is done. You can look again any time.</p> : null}
        {phase !== 'linked' && !done ? (
          <Button variant="secondary" className="min-h-tap" loading={busy === 'skip'} onClick={() => void skipStep()}>My QuickBooks is new or empty. Skip this step.</Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
