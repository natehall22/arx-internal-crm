'use client'

import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Select } from '@/components/ui/field'
import { toast } from '@/components/ui/toast'
import { formatDateWeekday } from '@/lib/format'
import { clockWords, cutoffWeekday, WEEKDAY_NAMES, type StoredPayWeek } from '@/lib/payroll-week-schedule'
import type { PayWeekChangeCheck } from '@/lib/payroll-week-schedule-server'

const API = '/api/admin/payroll/pay-week/schedule'
const TIMES = ['17:00', '18:00', '20:00', '21:00', '23:59']

/** Owners: change the company's pay week. The exact dates of the next weeks are shown before Save. */
export default function PayWeekScheduleSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = React.useState<StoredPayWeek | null>(null)
  const [check, setCheck] = React.useState<PayWeekChangeCheck | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setCheck(null)
    setError(null)
    fetch(API, { cache: 'no-store' })
      .then(async (r) => {
        const body = await r.json().catch(() => null)
        if (!r.ok) throw new Error(body?.error || 'Could not load the pay week')
        setForm(body.schedule as StoredPayWeek)
      })
      .catch((e) => setError((e as Error).message))
  }, [open])

  React.useEffect(() => {
    if (!open || !form) return
    const t = setTimeout(async () => {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schedule: form, preview: true }) })
      const body = await r.json().catch(() => null)
      if (!r.ok) {
        setCheck(null)
        setError(body?.error || 'Could not check those dates')
        return
      }
      setError(null)
      setCheck(body as PayWeekChangeCheck)
    }, 250)
    return () => clearTimeout(t)
  }, [open, form])

  const save = async () => {
    if (!form) return
    setBusy(true)
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schedule: form }) })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.error || 'Could not save the pay week')
      toast.success('Pay week saved')
      onSaved()
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const set = (patch: Partial<StoredPayWeek>) => setForm((f) => (f ? { ...f, ...patch } : f))
  const day = (v: string) => Number(v) as StoredPayWeek['weekStartDay']
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose() }}>
      <DialogContent title="Pay week" description="When a week starts and closes, and payday. Weeks already made keep their dates.">
        {form ? (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-ui-sm font-semibold text-ink">Week starts on
              <Select value={form.weekStartDay} onChange={(e) => set({ weekStartDay: day(e.target.value) })}>
                {WEEKDAY_NAMES.map((n, i) => <option key={n} value={i}>{n} (closes {WEEKDAY_NAMES[(i + 6) % 7]})</option>)}
              </Select>
            </label>
            <label className="flex flex-col gap-1.5 text-ui-sm font-semibold text-ink">Closes at
              <Select value={form.cutoffTime} onChange={(e) => set({ cutoffTime: e.target.value })}>
                {Array.from(new Set([...TIMES, form.cutoffTime])).map((t) => <option key={t} value={t}>{WEEKDAY_NAMES[cutoffWeekday(form)]} {clockWords(t)}</option>)}
              </Select>
            </label>
            <label className="flex flex-col gap-1.5 text-ui-sm font-semibold text-ink">Payday
              <Select value={form.paydayWeekday} onChange={(e) => set({ paydayWeekday: day(e.target.value) })}>
                {WEEKDAY_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
              </Select>
            </label>
            <label className="flex min-h-tap items-center gap-3 text-ui-base text-ink">
              <input type="checkbox" className="h-5 w-5" checked={!!form.lateFunding} onChange={(e) => set({ lateFunding: e.target.checked ? { weekday: ((cutoffWeekday(form) + 3) % 7) as StoredPayWeek['weekStartDay'], time: '23:59' } : null })} />
              Money that clears after the week closes still pays that week if it is in by…
            </label>
            {form.lateFunding ? (
              <Select value={form.lateFunding.weekday} onChange={(e) => set({ lateFunding: { weekday: day(e.target.value), time: '23:59' } })} aria-label="Late money day">
                {WEEKDAY_NAMES.map((n, i) => <option key={n} value={i}>{n} 11:59 PM</option>)}
              </Select>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="rounded-ui border border-danger p-3 text-ui-base text-ink">{error}</p> : null}
        {check && !check.unchanged ? (
          <div className="flex flex-col gap-1 rounded-ui border border-surface-line bg-surface-subtle p-3 text-ui-base text-ink">
            <p className="font-semibold">{check.next.words}</p>
            <p>
              First week on it: {formatDateWeekday(check.preview.firstWeek.start)} – {formatDateWeekday(check.preview.firstWeek.end)}
              {check.preview.firstWeek.days !== 7 ? ` (${check.preview.firstWeek.days} days, once)` : ''}, paid {formatDateWeekday(check.preview.firstWeek.payDate)}.
            </p>
            {check.preview.then.map((w) => <p key={w.end}>Then {formatDateWeekday(w.start)} – {formatDateWeekday(w.end)}, paid {formatDateWeekday(w.payDate)}.</p>)}
            {check.oldWeeks.map((w) => (
              <p key={w.periodId} className="text-ui-base">Open week ending {formatDateWeekday(w.weekEnding)} closes{w.what !== 'nothing' ? `; its ${w.what} move to the week ending ${formatDateWeekday(w.movesTo)}` : ''}.</p>
            ))}
            {check.blockers.length ? <p className="font-semibold text-danger">Approve first: {check.blockers.map((b) => `week ending ${b.weekEnding} (${b.what})`).join('; ')}.</p> : null}
          </div>
        ) : check?.unchanged ? <p className="text-ui-base text-ink-muted">This is the current pay week.</p> : null}

        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={!check || check.unchanged || check.blockers.length > 0} onClick={save}>Save pay week</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
