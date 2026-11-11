'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { formatDateWeekday, formatMoney } from '@/lib/format'

type Info = { weekStart: string; weekEnding: string; payDate: string; state: string; total: number; people: number; notifiedTotal: number; canApprove: boolean; needsCount: number; warnings: string[]; list: Array<{ name: string; total: number }> }

/** The page behind the "Approve $X for N people" notification: the live total and one big button. */
export default function ApproveLinkClient({ token }: { token: string }) {
  const router = useRouter()
  const [info, setInfo] = React.useState<Info | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [done, setDone] = React.useState<{ total: number; people: number } | null>(null)

  const load = React.useCallback(async () => {
    const r = await fetch(`/api/payroll/approve-link?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
    const body = await r.json().catch(() => ({}))
    if (r.status === 401) return router.push('/login')
    if (!r.ok) return setError(body?.error || 'Could not load this week')
    setInfo(body as Info)
  }, [token, router])
  React.useEffect(() => { void load() }, [load])

  const approve = async () => {
    if (!info || busy) return
    setBusy(true)
    try {
      const r = await fetch('/api/payroll/approve-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, expectedTotal: info.total }) })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(body?.error || 'Could not approve')
        if (body?.code === 'changed') await load()
        return
      }
      setDone({ total: body.total, people: body.people })
    } finally {
      setBusy(false)
    }
  }

  if (done) return <main className="mx-auto max-w-md p-6 text-ink"><p className="text-ui-xl font-bold">Approved: {formatMoney(done.total)} to {done.people} {done.people === 1 ? 'person' : 'people'}.</p><p className="mt-2 text-ui-base">Payday statements go out from Pay this week.</p></main>
  if (!info) return <main className="mx-auto max-w-md p-6 text-ink">{error ? <p className="text-ui-lg font-semibold">{error}</p> : <p>Loading…</p>}</main>
  const changed = Math.round(info.total * 100) !== Math.round(info.notifiedTotal * 100)
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-4 pb-32 text-ink">
      <header>
        <h1 className="text-ui-xl font-bold">Approve {formatMoney(info.total)} for {info.people} {info.people === 1 ? 'person' : 'people'}</h1>
        <p className="text-ui-base">{formatDateWeekday(info.weekStart)} – {formatDateWeekday(info.weekEnding)} · Payday {formatDateWeekday(info.payDate)}</p>
      </header>
      {changed ? <p className="rounded-ui border border-amber-400 bg-amber-50 p-3 text-ui-base font-semibold">The total changed since the message ({formatMoney(info.notifiedTotal)}). Check it, then approve.</p> : null}
      {info.state !== 'draft' ? <p className="rounded-ui border border-surface-line p-3 text-ui-base font-semibold">This week is already approved.</p> : null}
      {info.needsCount > 0 || !info.canApprove ? <p className="rounded-ui border border-amber-400 bg-amber-50 p-3 text-ui-base font-semibold">Something needs the office first. Open Pay this week.</p> : null}
      {info.warnings.map((w, i) => <p key={i} className="rounded-ui border border-amber-400 bg-amber-50 p-3 text-ui-base">{w}</p>)}
      <ul className="rounded-ui border border-surface-line bg-surface">
        {info.list.map((p, i) => <li key={i} className="flex justify-between gap-3 border-b border-surface-line px-4 py-3 last:border-b-0"><span className="font-semibold">{p.name}</span><span className="tabular-nums font-semibold">{formatMoney(p.total)}</span></li>)}
      </ul>
      {error ? <p className="text-ui-base font-semibold text-danger" role="alert">{error}</p> : null}
      {info.state === 'draft' && info.canApprove ? (
        <div className="fixed inset-x-0 bottom-0 border-t border-surface-line bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <Button size="md" className="min-h-[3.5rem] w-full text-ui-lg" loading={busy} onClick={approve}>Approve {formatMoney(info.total)}</Button>
        </div>
      ) : null}
    </main>
  )
}
