'use client'

import { useCallback, useEffect, useState } from 'react'

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, toast } from '@/components/ui'
import type { MappingScreen } from '@/lib/quickbooks/mapping-screen'

import QuickBooksBackfillCard from './QuickBooksBackfillCard'
import QuickBooksCard from './QuickBooksCard'
import QuickBooksMappingCard from './QuickBooksMappingCard'

type Status = Pick<MappingScreen, 'settings' | 'problems' | 'backfillDone' | 'connected'> | null

/**
 * Settings → QuickBooks: ONE setup page, four numbered steps. 1 Connect, 2 Pick accounts, 3 Match what is already in QuickBooks,
 * 4 Start sending — the only "Start sending" button, disabled until steps 1-3 are done (step 3 may be skipped after a warning).
 */
export default function QuickBooksSetup() {
  const [status, setStatus] = useState<Status>(null)
  const [why, setWhy] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/quickbooks/mapping', { cache: 'no-store' }).catch(() => null)
    const data = res ? ((await res.json().catch(() => ({}))) as Status & { error?: string }) : null
    if (!res || !res.ok || !data) {
      setStatus(null)
      setWhy(data?.error ?? 'Connect QuickBooks (step 1) first.')
      return
    }
    setWhy(null)
    setStatus(data)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const live = !!status?.settings.confirmedAt
  const ready = !!status && status.problems.length === 0 && status.backfillDone
  const blocker = why ?? (status && status.problems.length ? 'Finish step 2 first.' : status && !status.backfillDone ? 'Finish step 3 first (or skip it).' : null)

  async function start() {
    if (!status) return
    setBusy(true)
    const res = await fetch('/api/admin/quickbooks/mapping', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...status.settings, confirm: true }) }).catch(() => null)
    const body = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : null
    setBusy(false)
    if (!res || !res.ok) toast.error(body?.error ?? 'Could not start sending.')
    else toast.success(`Sending to QuickBooks from ${status.settings.startDate ?? 'your start date'}.`)
    await load()
  }

  return (
    <div className="flex flex-col gap-4" id="quickbooks-setup">
      <QuickBooksCard title="1. Connect QuickBooks" />
      <QuickBooksMappingCard title="2. Pick accounts" onSaved={() => void load()} />
      <QuickBooksBackfillCard title="3. Match what is already in QuickBooks" done={!!status?.backfillDone} onDone={() => void load()} />
      <Card id="quickbooks-start" className="scroll-mt-4">
        <CardHeader>
          <CardTitle>4. Start sending</CardTitle>
          {live ? <Badge tone="success">Sending</Badge> : <Badge tone="warning">Not sending yet</Badge>}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-ui-base text-ink">
            {live
              ? `QuickBooks is getting your sales, payments and bills from ${status?.settings.startDate ?? 'your start date'}. If you change your choices in step 2, sending pauses until you press this again.`
              : 'This turns sending on. Only things dated on or after your start date are sent.'}
          </p>
          {blocker && !live ? <p role="status" className="text-ui-base font-semibold text-ink">{blocker}</p> : null}
          <div className="sticky bottom-0 bg-white py-2">
            <Button className="min-h-tap" disabled={!ready || live} loading={busy} onClick={() => void start()}>
              {live ? 'Sending' : status?.settings.startDate ? `Start sending from ${status.settings.startDate}` : 'Start sending'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
