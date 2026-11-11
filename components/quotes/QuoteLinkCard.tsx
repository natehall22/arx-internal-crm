'use client'

import { useCallback, useEffect, useState } from 'react'

import { Button, Card, CardContent, CardHeader, CardTitle, toast } from '@/components/ui'

type Status = {
  opportunityId: string | null
  customerEmail: string | null
  status: string
  optionalCount: number
  totalCents: number
  deposit: { mode: string; percent: number; fixedCents: number; overridden: boolean; cents: number }
  company: { depositMode: string; depositPercent: number; depositFixedCents: number }
  problems: string[]
  link: { active: boolean; expiresAt: string; revoked: boolean; firstOpenedAt: string | null; lastOpenedAt: string | null; sentTo: string | null; sentAt: string | null } | null
  approval: { typedName: string; approvedAt: string; ip: string | null; totalCents: number; depositCents: number; finalized: boolean; error: string | null; jobId: string | null; chosen: string[]; declined: string[] } | null
}

const money = (c: number) => (c / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/**
 * Staff side of quote approval, on the proposal page (switch `quoteApproval`): send the customer's link, copy it, stop it,
 * set this quote's own deposit, and see the approval. Route /api/proposals/[id]/quote-link; rules lib/quotes/*.
 */
export default function QuoteLinkCard({ proposalId }: { proposalId: string }) {
  const [s, setS] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [mode, setMode] = useState('default')
  const [value, setValue] = useState('')
  const [url, setUrl] = useState('')
  const [credit, setCredit] = useState<{ closerUserId: string; setterUserId: string; isSelfGenerated: boolean } | null>(null)
  const [canChange, setCanChange] = useState(true)
  const [users, setUsers] = useState<Array<{ id: string; full_name: string | null }>>([])

  const base = `/api/proposals/${proposalId}/quote-link`
  const apply = useCallback((d: Status) => {
    setS(d)
    setEmail((e) => e || d.customerEmail || '')
    setMode(d.deposit.overridden ? d.deposit.mode : 'default')
    setValue(d.deposit.overridden ? String(d.deposit.mode === 'percent' ? d.deposit.percent : (d.deposit.fixedCents / 100).toFixed(2)) : '')
  }, [])

  const oppId = s?.opportunityId ?? null
  useEffect(() => {
    if (!oppId) return
    void Promise.all([
      fetch(`/api/opportunities/${oppId}/sale-credit`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
      fetch('/api/users').then((r) => (r.ok ? r.json() : { users: [] })),
    ])
      .then(([c, u]) => {
        if (c) {
          setCredit({ closerUserId: c.closerUserId || '', setterUserId: c.setterUserId || '', isSelfGenerated: c.isSelfGenerated === true })
          setCanChange(c.canChange !== false)
        }
        setUsers(u?.users ?? [])
      })
      .catch(() => null)
  }, [oppId])

  useEffect(() => {
    void fetch(base, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((d) => d && apply(d)).catch(() => null)
  }, [base, apply])

  async function act(body: Record<string, unknown>, ok?: string) {
    if ((body.action === 'send' || body.action === 'link')) {
      if (!credit?.closerUserId) return toast.error('Pick who closed this sale.')
      body = { ...body, saleCredit: { closerUserId: credit.closerUserId, setterUserId: credit.isSelfGenerated ? null : credit.setterUserId || null, isSelfGenerated: credit.isSelfGenerated } }
    }
    setBusy(true)
    const res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const d = res ? ((await res.json().catch(() => ({}))) as Status & { url?: string; emailed?: boolean; error?: string }) : null
    setBusy(false)
    if (!res?.ok || !d) return toast.error(d?.error || 'Something went wrong')
    if (d.url) setUrl(d.url)
    apply(d)
    if (ok) toast.success(body.action === 'send' && d.emailed === false ? 'Link made, but the email did not send. Copy the link instead.' : ok)
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link copied')
    } catch {
      toast.error('Could not copy. Select the link and copy it.')
    }
  }

  function saveDeposit() {
    if (mode === 'default') return void act({ action: 'deposit', mode: null }, 'Deposit saved')
    void act({ action: 'deposit', mode, value: mode === 'none' ? 0 : Number(value.replace(/[$,\s]/g, '')) }, 'Deposit saved')
  }

  if (!s) return null
  const a = s.approval

  return (
    <Card id="quote-link" className="mt-8">
      <CardHeader>
        <CardTitle>Customer approval link</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-ui-base text-ink">
        {a ? (
          <div className="flex flex-col gap-1">
            <p className="font-semibold">Approved by {a.typedName}</p>
            <p>{when(a.approvedAt)}{a.ip ? ` · ${a.ip}` : ''}</p>
            <p>Total {money(a.totalCents)}{a.depositCents > 0 ? ` · deposit ${money(a.depositCents)}` : ''}</p>
            {a.chosen.length ? <p>Chose: {a.chosen.join(', ')}</p> : null}
            {a.declined.length ? <p>Left out: {a.declined.join(', ')}</p> : null}
            {!a.finalized ? (
              <div className="flex flex-col gap-2">
                <p className="font-semibold">{a.error ? `Setup stopped: ${a.error}` : 'Setting up the job…'}</p>
                <Button className="min-h-tap self-start" loading={busy} onClick={() => void act({ action: 'finish' }, 'Finished')}>Finish setup</Button>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            {s.problems.length ? (
              <ul className="list-disc pl-5">{s.problems.map((p) => <li key={p}>{p}</li>)}</ul>
            ) : null}
            <p>
              Total {money(s.totalCents)}{s.optionalCount ? ` with the default choices (${s.optionalCount} optional ${s.optionalCount === 1 ? 'item' : 'items'})` : ''}
              {s.deposit.cents > 0 ? ` · deposit ${money(s.deposit.cents)}` : ' · no deposit'}
            </p>
            <fieldset className="flex flex-col gap-2">
              <legend className="font-semibold">Deposit for this quote</legend>
              <select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Deposit for this quote" className="min-h-tap rounded-ui border border-surface-line px-3 text-base text-ink">
                <option value="default">Company default</option>
                <option value="none">No deposit</option>
                <option value="percent">Percent of total</option>
                <option value="fixed">Fixed amount</option>
              </select>
              {mode === 'percent' || mode === 'fixed' ? (
                <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Deposit value" placeholder={mode === 'percent' ? '25' : '500.00'} className="min-h-tap w-40 rounded-ui border border-surface-line px-3 text-base text-ink" />
              ) : null}
              <Button className="min-h-tap self-start" variant="secondary" loading={busy} onClick={saveDeposit}>Save deposit</Button>
            </fieldset>
            {credit ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="font-semibold">Sale credit (what commission is paid on)</legend>
                <select value={credit.closerUserId} disabled={!canChange} onChange={(e) => setCredit({ ...credit, closerUserId: e.target.value })} aria-label="Closer" className="min-h-tap rounded-ui border border-surface-line px-3 text-base text-ink disabled:bg-gray-100">
                  <option value="">Pick the closer</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || 'Unnamed'}</option>)}
                </select>
                <select value={credit.isSelfGenerated ? '' : credit.setterUserId} disabled={!canChange || credit.isSelfGenerated} onChange={(e) => setCredit({ ...credit, setterUserId: e.target.value })} aria-label="Setter" className="min-h-tap rounded-ui border border-surface-line px-3 text-base text-ink disabled:bg-gray-100">
                  <option value="">No setter</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || 'Unnamed'}</option>)}
                </select>
                <label className="flex min-h-tap items-center gap-3">
                  <input type="checkbox" className="h-5 w-5" checked={credit.isSelfGenerated} disabled={!canChange} onChange={(e) => setCredit({ ...credit, isSelfGenerated: e.target.checked })} />
                  <span>The closer found this customer themselves</span>
                </label>
              </fieldset>
            ) : null}
            <label className="flex flex-col gap-1">
              <span className="font-semibold">Send to</span>
              <input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} className="min-h-tap rounded-ui border border-surface-line px-3 text-base text-ink" />
            </label>
            <div className="flex flex-wrap gap-3">
              <Button className="min-h-tap" loading={busy} disabled={s.problems.length > 0 || !email.trim()} onClick={() => void act({ action: 'send', email: email.trim() }, 'Quote sent')}>Email quote link</Button>
              <Button className="min-h-tap" variant="secondary" loading={busy} disabled={s.problems.length > 0} onClick={() => void act({ action: 'link' }, 'Link ready')}>Get link to text</Button>
              {s.link?.active ? <Button className="min-h-tap" variant="secondary" loading={busy} onClick={() => void act({ action: 'revoke' }, 'Link stopped')}>Stop link</Button> : null}
            </div>
            {url ? (
              <div className="flex flex-col gap-2">
                <input readOnly value={url} aria-label="Quote link" onFocus={(e) => e.currentTarget.select()} className="min-h-tap rounded-ui border border-surface-line px-3 text-base text-ink" />
                <Button className="min-h-tap self-start" variant="secondary" onClick={() => void copy()}>Copy link</Button>
              </div>
            ) : null}
            {s.link ? (
              <p>
                {s.link.revoked ? 'Link stopped.' : s.link.active ? `Link works until ${when(s.link.expiresAt)}.` : 'Link expired.'}
                {s.link.sentTo ? ` Sent to ${s.link.sentTo}.` : ''}
                {s.link.firstOpenedAt ? ` Opened ${when(s.link.lastOpenedAt ?? s.link.firstOpenedAt)}.` : ' Not opened yet.'}
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}
