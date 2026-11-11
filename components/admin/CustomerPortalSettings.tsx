'use client'

import { useState } from 'react'

import { Button, Card, CardContent, Input, toast } from '@/components/ui'

type Settings = { exactDateDays: number; inviteOnly: boolean }

/** Settings → Customer portal (owners): invite only, and how many days before an install the exact day replaces "Week of". */
export default function CustomerPortalSettings({ initial }: { initial: Settings }) {
  const [s, setS] = useState(initial)
  const [days, setDays] = useState(String(initial.exactDateDays))
  const [busy, setBusy] = useState(false)

  async function save(set: Partial<Settings>) {
    setBusy(true)
    const res = await fetch('/api/admin/customer-portal', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(set) }).catch(() => null)
    setBusy(false)
    const body = (await res?.json().catch(() => null)) as (Settings & { error?: string }) | null
    if (res?.ok && body) {
      setS(body)
      setDays(String(body.exactDateDays))
      toast.success('Saved')
    } else toast.error(body?.error || 'Could not save. Please try again.')
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent>
          <label className="flex min-h-tap items-center gap-3 text-ui-base text-ink">
            <input type="checkbox" className="h-5 w-5" checked={s.inviteOnly} disabled={busy} onChange={(e) => void save({ inviteOnly: e.target.checked })} />
            Only customers I invite can sign in
          </label>
          <p className="mt-2 text-ui-base text-ink">
            {s.inviteOnly ? 'You invite each customer from their Customer File with one tap. Everyone else is treated like a stranger.' : 'Any customer with an email on file can ask for a sign-in link.'}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <label className="block text-ui-base font-semibold text-ink" htmlFor="portal-days">Show the exact install day this many days ahead</label>
          <p className="mt-1 text-ui-base text-ink">Before that, customers see “Week of Mon, Nov 17”. It updates by itself when you move the install.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input id="portal-days" inputMode="numeric" className="w-24 text-base" value={days} onChange={(e) => setDays(e.target.value)} />
            <Button type="button" className="min-h-tap" disabled={busy || days === String(s.exactDateDays)} onClick={() => void save({ exactDateDays: Number(days) })}>{busy ? 'Saving…' : 'Save'}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
