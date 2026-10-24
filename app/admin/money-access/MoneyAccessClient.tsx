'use client'

import { useCallback, useEffect, useState } from 'react'

import { Card, CardContent, EmptyState, toast } from '@/components/ui'
import type { MoneyAccessRow, MoneyMode, MoneyPermission } from '@/lib/money-access'

const MODE_LABEL: Record<MoneyMode, string> = { default: 'By role', grant: 'On', deny: 'Off' }

function Switch({ person, permission, value, onChange, busy }: { person: MoneyAccessRow; permission: MoneyPermission; value: { effective: boolean; mode: MoneyMode }; onChange: (mode: MoneyMode) => void; busy: boolean }) {
  return (
    <label className="flex flex-col gap-1 text-ui-sm text-ink">
      <span className="font-semibold">{permission === 'reports:financials' ? 'Company financials' : 'Record job money'}</span>
      <span className={value.effective ? 'text-success' : 'text-ink-muted'}>{value.effective ? 'Has it now' : 'Does not have it'}</span>
      <select
        aria-label={`${person.name}: ${permission}`}
        className="min-h-tap rounded-ui border border-surface-line bg-surface px-3 text-base text-ink"
        value={value.mode}
        disabled={busy}
        onChange={(e) => onChange(e.target.value as MoneyMode)}
      >
        {(['default', 'grant', 'deny'] as MoneyMode[]).map((m) => (
          <option key={m} value={m} disabled={m === 'deny' && person.isOwner}>{MODE_LABEL[m]}</option>
        ))}
      </select>
    </label>
  )
}

export default function MoneyAccessClient() {
  const [people, setPeople] = useState<MoneyAccessRow[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const load = useCallback(async () => {
    const res = await fetch('/api/admin/money-access', { cache: 'no-store' })
    if (!res.ok) return toast.error('Could not load')
    setPeople((await res.json()).people)
  }, [])
  useEffect(() => { void load() }, [load])

  async function change(person: MoneyAccessRow, permission: MoneyPermission, mode: MoneyMode) {
    setBusy(person.id + permission)
    const res = await fetch('/api/admin/money-access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: person.id, permission, mode }) })
    setBusy(null)
    if (!res.ok) return toast.error((await res.json().catch(() => ({}))).error || 'Could not save')
    toast.success(`${person.name} updated`)
    void load()
  }

  if (!people) return <p className="text-ui-base text-ink-muted">Loading…</p>
  if (people.length === 0) return <EmptyState title="No people" body="Nobody to show." />
  return (
    <div className="flex flex-col gap-3">
      {people.map((p) => (
        <Card key={p.id}>
          <CardContent>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-ui-lg font-semibold text-ink">{p.name}</h2>
              <span className="text-ui-sm text-ink-muted">{p.role}{p.isOwner ? ' · owner' : ''}</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Switch person={p} permission="reports:financials" value={p.financials} busy={busy === p.id + 'reports:financials'} onChange={(m) => change(p, 'reports:financials', m)} />
              <Switch person={p} permission="money:record" value={p.moneyRecord} busy={busy === p.id + 'money:record'} onChange={(m) => change(p, 'money:record', m)} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
