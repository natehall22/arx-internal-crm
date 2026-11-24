'use client'

import * as React from 'react'

import { Button, Card } from '@/components/ui'

/** Owners: make a draft invoice automatically when a per-visit plan visit is marked done (Settings → Payments & tax). */
export default function AutoDraftInvoiceCard() {
  const [on, setOn] = React.useState<boolean | null>(null)
  const [msg, setMsg] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    void fetch('/api/admin/service-billing', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { autoDraftOnDone?: boolean } | null) => d && setOn(d.autoDraftOnDone === true))
  }, [])
  if (on === null) return null

  async function save() {
    setBusy(true)
    setMsg(null)
    const res = await fetch('/api/admin/service-billing', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoDraftOnDone: on }) }).catch(() => null)
    const out = (res ? await res.json().catch(() => ({})) : {}) as { error?: string }
    setBusy(false)
    setMsg(res?.ok ? 'Saved' : out.error || 'Couldn’t save')
  }

  return (
    <Card className="flex flex-col gap-3 p-4 text-[#2c2c2a]">
      <h2 className="text-lg font-bold">Draft invoice when a visit is done</h2>
      <p className="text-base">When a crew marks a per-visit plan visit done, each finished visit gets its own draft invoice (one invoice per visit). Nothing is sent or charged: you review and send it from All invoices. Monthly, yearly and hourly plans still bill from Ready to bill and Hours to bill.</p>
      <label className="flex min-h-[44px] items-center gap-3 text-base">
        <input type="checkbox" className="h-5 w-5" checked={on} onChange={(e) => setOn(e.target.checked)} />
        Make a draft invoice when a visit is done
      </label>
      <div className="flex items-center gap-3">
        <Button onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        {msg ? <span role="status" className="text-base">{msg}</span> : null}
      </div>
    </Card>
  )
}
