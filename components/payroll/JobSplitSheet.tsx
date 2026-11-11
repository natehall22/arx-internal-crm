'use client'

import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Input, Select } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast'
import { formatMoney } from '@/lib/format'
import type { JobSplit } from '@/lib/payroll-job-split'

const API = '/api/admin/payroll/pay-week/job-split'

type Row = { key: string; percent: string; removed: boolean; backToPlan: boolean }

/**
 * "Change" for one job: every person on it with their share, edit the %, take someone off, add someone, one reason, one Save.
 * The amounts shown are recalculated by the server after saving (the 18% pool rule still applies).
 */
export default function JobSplitSheet({ periodId, jobId, onClose, onSaved }: { periodId: string; jobId: string | null; onClose: () => void; onSaved: () => void }) {
  const [split, setSplit] = React.useState<JobSplit | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [rows, setRows] = React.useState<Row[]>([])
  const [added, setAdded] = React.useState<Array<{ userId: string; percent: string }>>([])
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const reset = (s: JobSplit) => {
    setSplit(s)
    setRows(s.lines.map((l) => ({ key: l.key, percent: String(l.percent), removed: false, backToPlan: false })))
    setAdded([])
  }

  React.useEffect(() => {
    if (!jobId) return
    setSplit(null)
    setError(null)
    setReason('')
    fetch(`${API}?periodId=${encodeURIComponent(periodId)}&jobId=${encodeURIComponent(jobId)}`, { cache: 'no-store' })
      .then(async (r) => {
        const body = await r.json().catch(() => null)
        if (!r.ok) throw new Error(body?.error || 'Could not load this job')
        reset(body as JobSplit)
      })
      .catch((e) => setError((e as Error).message))
  }, [jobId, periodId])

  const pct = (v: string) => (v.trim() === '' ? NaN : Number(v))
  const base = split?.job.base ?? 0
  const total =
    rows.reduce((s, r) => {
      const line = split?.lines.find((l) => l.key === r.key)
      if (r.removed) return s
      if (r.backToPlan) return s + (line?.percent ?? 0)
      return s + (Number.isFinite(pct(r.percent)) ? pct(r.percent) : 0)
    }, 0) + added.reduce((s, a) => s + (Number.isFinite(pct(a.percent)) ? pct(a.percent) : 0), 0)
  const totalRounded = Math.round(total * 100) / 100
  const overCap = split?.capPercent != null && totalRounded > split.capPercent + 0.001
  const changed =
    added.length > 0 ||
    rows.some((r) => {
      const line = split?.lines.find((l) => l.key === r.key)
      return r.removed || r.backToPlan || (line && Math.abs(pct(r.percent) - line.percent) >= 0.005)
    })
  const invalid = rows.some((r) => !r.removed && !r.backToPlan && (!Number.isFinite(pct(r.percent)) || pct(r.percent) < 0 || pct(r.percent) > 100)) || added.some((a) => !a.userId || !(pct(a.percent) > 0) || pct(a.percent) > 100) || totalRounded > 100

  const save = async () => {
    if (!split) return
    setBusy(true)
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          periodId,
          jobId: split.job.id,
          reason: reason.trim(),
          lines: rows.map((x) => ({ key: x.key, percent: x.removed ? null : pct(x.percent), backToPlan: x.backToPlan })),
          added: added.map((a) => ({ userId: a.userId, percent: pct(a.percent) })),
        }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.error || 'Could not save the change')
      toast.success(body.changed ? 'Saved' : 'Nothing changed')
      onSaved()
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const onJob = new Set(split?.lines.map((l) => l.userId) ?? [])
  return (
    <Dialog open={!!jobId} onOpenChange={(o) => { if (!o && !busy) onClose() }}>
      <DialogContent title={split ? `Change job ${split.job.number}` : 'Change'} description={split ? `${split.job.address ? `${split.job.address} · ` : ''}commission base ${formatMoney(base)} · ${split.status}` : undefined}>
        {error ? <p className="rounded-ui border border-danger p-3 text-ui-base text-ink">{error}</p> : null}
        {!split && !error ? <div className="flex flex-col gap-2"><Skeleton className="h-12" /><Skeleton className="h-12" /></div> : null}
        {split ? (
          <div className="flex flex-col gap-3">
            <ul className="flex flex-col divide-y divide-surface-line rounded-ui border border-surface-line">
              {split.lines.map((l, i) => {
                const r = rows[i]
                if (!r) return null
                const share = r.removed ? 0 : r.backToPlan ? l.percent : pct(r.percent)
                return (
                  <li key={l.key} className="flex flex-col gap-2 p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 font-semibold text-ink">{l.name} <span className="font-normal text-ink-muted">· {l.word}</span></span>
                      <span className="shrink-0 tabular-nums text-ui-sm text-ink-muted">now {formatMoney(l.amount)}</span>
                    </div>
                    {r.removed ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-ui-base text-ink">Taken off this job ($0)</span>
                        <Button variant="secondary" size="sm" onClick={() => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, removed: false } : x)))}>Undo</Button>
                      </div>
                    ) : r.backToPlan ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-ui-base text-ink">Back to their pay plan</span>
                        <Button variant="secondary" size="sm" onClick={() => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, backToPlan: false } : x)))}>Undo</Button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-2 text-ui-base text-ink">
                          <Input type="number" inputMode="decimal" step="0.01" min={0} max={100} value={r.percent} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))} aria-label={`${l.name} share in percent`} className="w-24" />
                          %
                        </label>
                        <span className="tabular-nums text-ui-sm text-ink-muted">≈ {formatMoney(Math.round(base * (Number.isFinite(share) ? share : 0)) / 100)}</span>
                        <span className="ml-auto flex gap-2">
                          {l.setByOffice ? <Button variant="ghost" size="sm" onClick={() => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, backToPlan: true } : x)))}>Back to plan</Button> : null}
                          <Button variant="ghost" size="sm" onClick={() => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, removed: true } : x)))}>Take off</Button>
                        </span>
                      </div>
                    )}
                  </li>
                )
              })}
              {added.map((a, i) => (
                <li key={`add-${i}`} className="flex flex-col gap-2 p-3">
                  <Select value={a.userId} onChange={(e) => setAdded((xs) => xs.map((x, j) => (j === i ? { ...x, userId: e.target.value } : x)))} aria-label="Who to add">
                    <option value="">Choose a person</option>
                    {split.people.filter((p) => !onJob.has(p.id) || p.id === a.userId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-ui-base text-ink">
                      <Input type="number" inputMode="decimal" step="0.01" min={0} max={100} value={a.percent} onChange={(e) => setAdded((xs) => xs.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))} aria-label="Their share in percent" className="w-24" />
                      %
                    </label>
                    <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setAdded((xs) => xs.filter((_, j) => j !== i))}>Remove</Button>
                  </div>
                </li>
              ))}
            </ul>
            <Button variant="secondary" onClick={() => setAdded((xs) => [...xs, { userId: '', percent: '' }])}>+ Add someone</Button>
            <p className={overCap ? 'rounded-ui border border-amber-400 bg-amber-50 p-3 text-ui-base text-ink' : 'text-ui-base text-ink'}>
              Total {totalRounded}% of the base{split.capPercent != null ? ` · the most is ${split.capPercent}%` : ''}.
              {overCap ? ' Above that, every line is reduced a little to fit.' : ''}
            </p>
            <label className="flex flex-col gap-1.5 text-ui-sm font-semibold text-ink">Why
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Closed with Nathan, no setter" maxLength={300} />
            </label>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={!split || !changed || invalid || !reason.trim()} onClick={save}>Save change</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
