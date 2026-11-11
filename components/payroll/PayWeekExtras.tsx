'use client'

import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/field'
import { toast } from '@/components/ui/toast'
import { formatMoney } from '@/lib/format'
import type { PayWeekAdvance } from '@/lib/payroll-pay-week'

const API = '/api/admin/payroll/pay-week'
const send = async (path: string, method: string, payload: unknown) => {
  const r = await fetch(`${API}/${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body?.error || 'Something went wrong')
  return body
}
const selectCls = 'min-h-tap w-full rounded-ui border border-surface-line bg-surface px-3 text-ui-base text-ink'

/** Advances still being repaid, with Record / Stop (owners). Taking money back is a pay line; nothing here is a loan ledger. */
export function AdvancesSection({ advances, directory, canEdit, draft, onChanged }: { advances: PayWeekAdvance[]; directory: Array<{ id: string; name: string }>; canEdit: boolean; draft: boolean; onChanged: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [f, setF] = React.useState({ userId: '', amount: '', mode: 'full', value: '', note: '', startWeek: 'this', payOnCheck: false, belowMinimumOk: false })
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }))
  const save = async () => {
    setBusy(true)
    try {
      await send('advance', 'POST', { ...f, amount: Number(f.amount), value: f.value === '' ? null : Number(f.value) })
      toast.success(f.payOnCheck ? 'Added to this week’s check' : 'Advance recorded')
      setOpen(false)
      setF({ userId: '', amount: '', mode: 'full', value: '', note: '', startWeek: 'this', payOnCheck: false, belowMinimumOk: false })
      onChanged()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const act = async (id: string, action: string, ask?: string) => {
    if (ask && !window.confirm(ask)) return
    try {
      await send('advance', 'PATCH', { id, action })
      onChanged()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  if (advances.length === 0 && !canEdit) return null
  return (
    <section aria-labelledby="adv-h">
      <h2 id="adv-h" className="mb-2 text-ui-lg font-semibold text-ink">Advances</h2>
      {advances.length > 0 ? (
        <div className="rounded-ui border border-surface-line bg-surface">
          {advances.map((a) => (
            <div key={a.id} className="border-b border-surface-line p-4 last:border-b-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold text-ink">{a.name}</span>
                <span className="tabular-nums font-semibold text-ink">{formatMoney(a.outstanding)} still owed</span>
              </div>
              <p className="text-ui-sm text-ink-muted">{formatMoney(a.amount)} given {a.givenOn}{a.note ? ` · ${a.note}` : ''} · {a.rule}</p>
              {a.thisWeek > 0 ? <p className="text-ui-base text-ink">{draft ? 'Comes out of this check' : 'Came out of this check'}: {formatMoney(a.thisWeek)}</p> : null}
              {a.limited ? <p className="text-ui-base font-semibold text-ink">Not all of it can come out this week.</p> : null}
              {canEdit ? (
                <div className="mt-1 flex flex-wrap gap-3">
                  {a.limited && !a.belowMinimumOk ? <button type="button" onClick={() => act(a.id, 'allow_below_minimum', 'Allow this advance to take their check below the weekly minimum?')} className="min-h-tap text-ui-base font-semibold text-brand-700 underline underline-offset-2">Allow below the minimum</button> : null}
                  {a.belowMinimumOk ? <button type="button" onClick={() => act(a.id, 'block_below_minimum')} className="min-h-tap text-ui-base font-semibold text-brand-700 underline underline-offset-2">Protect the minimum again</button> : null}
                  <button type="button" onClick={() => act(a.id, 'cancel', `Stop taking this back? ${formatMoney(a.outstanding)} will be written off.`)} className="min-h-tap text-ui-base font-semibold text-brand-700 underline underline-offset-2">Stop recovering</button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {canEdit ? <Button className="mt-2" variant="secondary" onClick={() => setOpen(true)}>Record an advance</Button> : null}
      <Dialog open={open} onOpenChange={(o) => { if (!busy) setOpen(o) }}>
        <DialogContent title="Record an advance" description="Money given ahead of pay. It comes back out of future checks by the rule you pick, as a line on the check.">
          <label className="flex flex-col gap-1.5 text-ui-sm font-semibold text-ink">Who
            <select value={f.userId} onChange={(e) => set('userId', e.target.value)} className={selectCls}>
              <option value="">Choose a person</option>
              {directory.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-ui-sm font-semibold text-ink">Amount
            <Input type="number" inputMode="decimal" step="0.01" value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder="e.g. 500" />
          </label>
          <label className="flex flex-col gap-1.5 text-ui-sm font-semibold text-ink">Take it back
            <select value={f.mode} onChange={(e) => set('mode', e.target.value)} className={selectCls}>
              <option value="full">All of it, as soon as the check allows</option>
              <option value="fixed">A fixed amount each week</option>
              <option value="percent">A percent of each check</option>
            </select>
          </label>
          {f.mode !== 'full' ? (
            <label className="flex flex-col gap-1.5 text-ui-sm font-semibold text-ink">{f.mode === 'fixed' ? 'Dollars each week' : 'Percent of each check'}
              <Input type="number" inputMode="decimal" step="0.01" value={f.value} onChange={(e) => set('value', e.target.value)} />
            </label>
          ) : null}
          <label className="flex flex-col gap-1.5 text-ui-sm font-semibold text-ink">Why (optional)
            <Input value={f.note} onChange={(e) => set('note', e.target.value)} maxLength={300} />
          </label>
          <label className="flex flex-col gap-1.5 text-ui-sm font-semibold text-ink">Starts coming out
            <select value={f.startWeek} disabled={f.payOnCheck} onChange={(e) => set('startWeek', e.target.value)} className={selectCls}>
              <option value="this">This pay run</option>
              <option value="next">Next pay run</option>
            </select>
          </label>
          <label className="flex min-h-tap items-center gap-3 text-ui-base text-ink"><input type="checkbox" className="h-5 w-5" checked={f.payOnCheck} onChange={(e) => set('payOnCheck', e.target.checked)} />Pay it on this week&apos;s check (otherwise it was paid outside payroll)</label>
          <label className="flex min-h-tap items-center gap-3 text-ui-base text-ink"><input type="checkbox" className="h-5 w-5" checked={f.belowMinimumOk} onChange={(e) => set('belowMinimumOk', e.target.checked)} />OK to take their check below the weekly minimum</label>
          <DialogFooter>
            <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={busy} disabled={!f.userId || !(Number(f.amount) > 0) || (f.mode !== 'full' && !(Number(f.value) > 0))} onClick={save}>Save advance</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

type Check = { people: number; total: number; missing: Array<{ userId: string; name: string; why: string }>; adp: { coCode: string; codes: Record<string, string>; advance: { onCheck: string; offCheck: string } } }

/** Downloads for an approved week: Gusto CSV, ADP CSV (asks for the file numbers / company code first), pay sheets. */
export function ExportButtons({ periodId, canEditCodes }: { periodId: string; canEditCodes: boolean }) {
  const [open, setOpen] = React.useState(false)
  const [check, setCheck] = React.useState<Check | null>(null)
  const [ids, setIds] = React.useState<Record<string, string>>({})
  const [co, setCo] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [tax, setTax] = React.useState<{ onCheck: string; offCheck: string } | null>(null)
  const base = `${API}/export?period=${periodId}`
  const openTax = async () => {
    const r = await fetch(`${base}&format=gusto&check=1`, { cache: 'no-store' })
    const body = await r.json().catch(() => ({}))
    if (!r.ok) return toast.error(body?.error || 'Could not load the settings')
    setCheck(body)
    setTax(body.adp.advance)
  }
  const saveTax = async () => {
    if (!check || !tax) return
    setBusy(true)
    try {
      await send('export', 'POST', { coCode: check.adp.coCode, codes: check.adp.codes, advance: tax })
      toast.success('Saved')
      setTax(null)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const openAdp = async () => {
    const r = await fetch(`${base}&format=adp&check=1`, { cache: 'no-store' })
    const body = await r.json().catch(() => ({}))
    if (!r.ok) return toast.error(body?.error || 'Could not check the file')
    setCheck(body)
    setCo(body.adp.coCode)
    if (body.missing.length === 0) window.location.href = `${base}&format=adp`
    else setOpen(true)
  }
  const saveAndDownload = async () => {
    setBusy(true)
    try {
      for (const [userId, employeeId] of Object.entries(ids)) if (employeeId.trim()) await send('people', 'PATCH', { userId, employeeId })
      if (canEditCodes && co.trim() !== check?.adp.coCode) await send('export', 'POST', { coCode: co, codes: check?.adp.codes, advance: check?.adp.advance })
      setOpen(false)
      window.location.href = `${base}&format=adp`
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button asChild variant="secondary" size="sm"><a href={`${base}&format=gusto`}>Gusto CSV</a></Button>
      <Button variant="secondary" size="sm" onClick={openAdp}>ADP CSV</Button>
      {canEditCodes ? <Button variant="secondary" size="sm" onClick={openTax}>Advance export settings</Button> : null}
      <Dialog open={tax !== null} onOpenChange={(o) => { if (!o) setTax(null) }}>
        <DialogContent title="Advances in the provider file" description="How the file shows money taken back for an advance. Confirm with your accountant before the first live run.">
          {tax ? (
            <>
              <label className="flex flex-col gap-1.5 text-ui-sm font-semibold text-ink">Advance paid on a check (taken back later)
                <select value={tax.onCheck} onChange={(e) => setTax({ ...tax, onCheck: e.target.value })} className={selectCls}>
                  <option value="reduce_earnings">Reduce that week's earnings (not taxed twice)</option>
                  <option value="deduction">After-tax deduction</option>
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-ui-sm font-semibold text-ink">Advance paid outside payroll
                <select value={tax.offCheck} onChange={(e) => setTax({ ...tax, offCheck: e.target.value })} className={selectCls}>
                  <option value="deduction">After-tax deduction</option>
                  <option value="reduce_earnings">Reduce that week's earnings</option>
                </select>
              </label>
            </>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setTax(null)}>Cancel</Button>
            <Button loading={busy} onClick={saveTax}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Before the ADP file" description="ADP needs each person's file number and your company code. Fill what is missing; it is remembered.">
          {check?.missing.some((m) => !m.userId) ? (
            <label className="flex flex-col gap-1.5 text-ui-sm font-semibold text-ink">ADP company code
              <Input value={co} disabled={!canEditCodes} onChange={(e) => setCo(e.target.value)} maxLength={12} />
              {!canEditCodes ? <span className="text-ui-sm font-normal text-ink-muted">An owner sets this.</span> : null}
            </label>
          ) : null}
          {check?.missing.filter((m) => m.userId).map((m) => (
            <label key={m.userId} className="flex flex-col gap-1.5 text-ui-sm font-semibold text-ink">{m.name} · file number
              <Input value={ids[m.userId] ?? ''} onChange={(e) => setIds((x) => ({ ...x, [m.userId]: e.target.value }))} maxLength={40} />
            </label>
          ))}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={busy} onClick={saveAndDownload}>Save and download</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Pay sheets: an approved week's real ones, or a PREVIEW of the open week. One zip with everyone's PDF. */
export function PaySheetButton({ periodId, draft }: { periodId: string; draft: boolean }) {
  return (
    <Button asChild variant="secondary" size="sm">
      <a href={`${API}/pay-sheet?period=${periodId}${draft ? '&preview=1' : ''}`}>{draft ? 'Preview pay sheets' : 'Pay sheets (PDF)'}</a>
    </Button>
  )
}
