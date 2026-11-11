'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button, Card, Dialog, DialogContent, DialogFooter, EmptyState, Select, Textarea } from '@/components/ui'
import { describeChange } from '@/lib/change-log'
import { formatDuration, localHm, localTimeToInstant, localYmd } from '@/lib/time-tracking'
import type { TimeEntryHistory, TimeListEntry, TimeListPerson, TimeWeek } from '@/lib/time-tracking-db'

const inputCls = 'min-h-[48px] w-full rounded-lg border-2 border-[#2c2c2a] bg-white px-3 text-base text-[#2c2c2a]'

const SOURCE_WORDS: Record<string, string> = { lead_tap: 'crew lead', self_tap: 'self', typed: 'typed', auto_closed: 'stopped by system' }

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function dayLabel(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso))
}
function hm12(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
}
const hoursText = (h: number) => `${(Math.round(h * 100) / 100).toFixed(2)} h`

type EditTarget = { mode: 'edit'; entry: TimeListEntry; person: TimeListPerson } | { mode: 'add'; person: TimeListPerson | null }

/**
 * Office time list (payroll admins): one pay week, people who need a look first, each person's paid total next to what
 * payroll has, warnings (never deductions), and every entry editable with a reason — while the week is open.
 */
export default function TimeWeekClient({ initial }: { initial?: TimeWeek | null }) {
  const [week, setWeek] = useState<TimeWeek | null>(initial ?? null)
  const [day, setDay] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [edit, setEdit] = useState<EditTarget | null>(null)

  const load = useCallback(async (d: string | null) => {
    setError(null)
    const res = await fetch(`/api/admin/time${d ? `?day=${d}` : ''}`, { cache: 'no-store' }).catch(() => null)
    if (!res || !res.ok) {
      setError('Couldn’t load the time list. Try again.')
      return
    }
    setWeek((await res.json()) as TimeWeek)
  }, [])
  useEffect(() => {
    if (!initial) void load(null)
  }, [initial, load])

  if (!week) return <p className="text-ui-base text-ink">{error ?? 'Loading…'}</p>
  if (!week.ready) return <EmptyState title="Time clock not ready" body="It turns on once the database update for it is applied." />
  const tz = week.timeZone
  const go = (n: number) => {
    const d = addDays(week.weekEnd, n * 7)
    setDay(d)
    void load(d)
  }

  return (
    <div className="flex flex-col gap-4 text-[#2c2c2a]">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => go(-1)} aria-label="Previous week">
          ← Previous
        </Button>
        <p className="flex-1 text-center text-base font-bold">{`${dayLabel(`${week.weekStart}T12:00:00Z`, 'UTC')} – ${dayLabel(`${week.weekEnd}T12:00:00Z`, 'UTC')}`}</p>
        <Button variant="secondary" onClick={() => go(1)} aria-label="Next week">
          Next →
        </Button>
      </div>
      {day ? (
        <Button variant="ghost" onClick={() => { setDay(null); void load(null) }}>
          Back to this week
        </Button>
      ) : null}
      {!week.editable ? <p className="rounded-lg bg-[#fff4cc] px-3 py-2 text-base">This week is approved. Its time can’t change — put any fix on an open week.</p> : null}
      {error ? <p role="alert" className="rounded-lg border-2 border-red-700 bg-white p-3 text-base font-semibold text-red-800">{error}</p> : null}
      {week.editable ? (
        <Button className="self-start" onClick={() => setEdit({ mode: 'add', person: null })}>
          + Add time
        </Button>
      ) : null}

      {week.people.length === 0 ? <EmptyState title="No time this week" body="Taps from crew phones and the job page show up here." /> : null}
      {week.people.map((p) => {
        const off = p.payrollHours !== null && Math.abs(p.payrollHours - (p.regularHours + p.overtimeHours)) > 0.01
        return (
          <Card key={p.userId} className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-bold">{p.name}</h2>
              <p className="text-base font-bold">{formatDuration(p.paidSeconds)}</p>
            </div>
            <p className="text-base">
              {`Regular ${hoursText(p.regularHours)}${p.overtimeHours ? ` · Overtime ${hoursText(p.overtimeHours)}` : ''}${p.travelSeconds ? ` · includes ${formatDuration(p.travelSeconds)} driving` : ''}${p.breakSeconds ? ` · lunch ${formatDuration(p.breakSeconds)}` : ''}`}
            </p>
            {p.payrollHours === null ? (
              p.paidSeconds > 0 ? <p className="text-base font-semibold text-red-800">Not in payroll yet — does this person have an hourly pay rate?</p> : null
            ) : off ? (
              <p className="text-base font-semibold text-red-800">{`Payroll has ${hoursText(p.payrollHours)} — it updates when time changes (a typed hours box can disagree).`}</p>
            ) : (
              <p className="text-base">{`In payroll: ${hoursText(p.payrollHours)}`}</p>
            )}
            {p.typedHours !== null ? (
              <p className="rounded-lg bg-[#fff4cc] px-3 py-2 text-base font-semibold">{`Typed ${hoursText(p.typedHours)} vs clocked ${hoursText(p.regularHours + p.overtimeHours)} — payroll uses the clock. Fix time here; the typed hours come back only if the clock time is removed.`}</p>
            ) : null}
            {p.warnings.length ? (
              <ul className="flex flex-col gap-1">
                {p.warnings.map((w, i) => (
                  <li key={i} className="rounded-lg bg-[#fff4cc] px-3 py-2 text-base">
                    {w.day ? `${dayLabel(`${w.day}T12:00:00Z`, 'UTC')}: ` : ''}
                    {w.text}
                  </li>
                ))}
              </ul>
            ) : null}
            <ul className="flex flex-col gap-2">
              {p.entries.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    className={`flex min-h-[48px] w-full flex-col items-start gap-0.5 rounded-lg border-2 px-3 py-2 text-left text-base ${e.needsReview ? 'border-red-700' : 'border-[#e5e3dc]'}`}
                    onClick={() => setEdit({ mode: 'edit', entry: e, person: p })}
                  >
                    <span className="font-semibold">
                      {`${dayLabel(e.startedAt, tz)} · ${hm12(e.startedAt, tz)} – ${e.endedAt ? hm12(e.endedAt, tz) : 'still clocked in'}`}
                      {e.kind === 'break' ? ' · lunch' : ''}
                    </span>
                    <span>{`${e.where}${e.endedAt ? ` · ${formatDuration((Date.parse(e.endedAt) - Date.parse(e.startedAt)) / 1000)}` : ''} · ${SOURCE_WORDS[e.source] ?? e.source}${e.tappedBy ? ` (${e.tappedBy})` : ''}`}</span>
                    {e.needsReview && e.reviewNote ? <span className="font-semibold text-red-800">{e.reviewNote}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
            {week.editable ? (
              <Button variant="secondary" className="self-start" onClick={() => setEdit({ mode: 'add', person: p })}>
                {`+ Add time for ${p.name.split(' ')[0]}`}
              </Button>
            ) : null}
          </Card>
        )
      })}

      {week.equipment.length ? (
        <Card className="flex flex-col gap-2 p-4">
          <h2 className="text-lg font-bold">Equipment</h2>
          {week.equipment.map((e) => (
            <p key={e.id} className="text-base">
              {`${e.equipment} · ${dayLabel(e.startedAt, tz)} ${hm12(e.startedAt, tz)} – ${e.endedAt ? hm12(e.endedAt, tz) : 'running'} · ${e.where}`}
            </p>
          ))}
        </Card>
      ) : null}

      {edit ? (
        <EntrySheet
          target={edit}
          week={week}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null)
            void load(day)
          }}
        />
      ) : null}
    </div>
  )
}

function EntrySheet({ target, week, onClose, onSaved }: { target: EditTarget; week: TimeWeek; onClose: () => void; onSaved: () => void }) {
  const tz = week.timeZone
  const e = target.mode === 'edit' ? target.entry : null
  const [userId, setUserId] = useState(target.person?.userId ?? '')
  const [date, setDate] = useState(e ? localYmd(Date.parse(e.startedAt), tz) : week.weekEnd)
  const [start, setStart] = useState(e ? localHm(Date.parse(e.startedAt), tz) : '07:00')
  const [endDate, setEndDate] = useState(e?.endedAt ? localYmd(Date.parse(e.endedAt), tz) : e ? '' : week.weekEnd)
  const [end, setEnd] = useState(e?.endedAt ? localHm(Date.parse(e.endedAt), tz) : e ? '' : '15:00')
  const [kind, setKind] = useState<'work' | 'break'>(e?.kind === 'break' ? 'break' : 'work')
  // Places this person (or anyone this week) worked: the stops / jobs to pick for added time.
  const places = useMemo(() => {
    const seen = new Map<string, { label: string; workOrderId: string | null; jobId: string | null }>()
    const from = week.people.filter((p) => !userId || p.userId === userId).flatMap((p) => p.entries)
    for (const x of from.length ? from : week.people.flatMap((p) => p.entries)) {
      const key = x.workOrderId ?? `job:${x.jobId}`
      if ((x.workOrderId || x.jobId) && !seen.has(key)) seen.set(key, { label: x.where, workOrderId: x.workOrderId, jobId: x.jobId })
    }
    return Array.from(seen.entries())
  }, [week, userId])
  const [place, setPlace] = useState(e ? e.workOrderId ?? `job:${e.jobId}` : '')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [history, setHistory] = useState<TimeEntryHistory[] | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const editable = week.editable

  async function send(method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, unknown>) {
    setBusy(true)
    setErr(null)
    const url = method === 'POST' ? '/api/admin/time' : `/api/admin/time/${e!.id}`
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const out = (res ? await res.json().catch(() => ({})) : {}) as { error?: string }
    setBusy(false)
    if (!res || !res.ok) return setErr(out.error || 'Couldn’t save — try again.')
    onSaved()
  }

  function save() {
    const s = localTimeToInstant(date, start, tz)
    const en = end ? localTimeToInstant(endDate || date, end, tz) : null
    if (!s || (end && !en)) return setErr('Check the times')
    const chosen = places.find(([k]) => k === place)?.[1]
    if (target.mode === 'add') {
      return void send('POST', { userId, kind, startedAt: s.toISOString(), endedAt: en?.toISOString() ?? null, workOrderId: chosen?.workOrderId ?? null, jobId: chosen?.jobId ?? null, reason })
    }
    const body: Record<string, unknown> = { reason }
    if (s.toISOString() !== new Date(e!.startedAt).toISOString()) body.startedAt = s.toISOString()
    const newEnd = en ? en.toISOString() : null
    if (newEnd !== (e!.endedAt ? new Date(e!.endedAt).toISOString() : null)) body.endedAt = newEnd
    if (kind !== e!.kind && e!.kind !== 'equipment') body.kind = kind
    if (e!.needsReview && Object.keys(body).length === 1) body.needsReview = false // "Looks right" clears the flag
    void send('PATCH', body)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={target.mode === 'add' ? 'Add time' : `Time for ${target.person?.name ?? ''}`}>
        {target.mode === 'add' ? (
          <label className="flex flex-col gap-1 text-base font-semibold">
            Person
            <Select className={inputCls} value={userId} onChange={(ev) => setUserId(ev.target.value)}>
              <option value="">Pick a person</option>
              {week.staff.map((s) => (
                <option key={s.userId} value={s.userId}>
                  {s.name}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-base font-semibold">
            Day
            <input type="date" className={inputCls} value={date} disabled={!editable} onChange={(ev) => setDate(ev.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-base font-semibold">
            Type
            <Select className={inputCls} value={kind} disabled={!editable || e?.kind === 'equipment'} onChange={(ev) => setKind(ev.target.value as 'work' | 'break')}>
              <option value="work">Work</option>
              <option value="break">Lunch / break</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-base font-semibold">
            Start
            <input type="time" className={inputCls} value={start} disabled={!editable} onChange={(ev) => setStart(ev.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-base font-semibold">
            End
            <input type="time" className={inputCls} value={end} disabled={!editable} onChange={(ev) => setEnd(ev.target.value)} />
          </label>
        </div>
        {end && start && end <= start && (endDate || date) === date ? (
          <label className="flex flex-col gap-1 text-base font-semibold">
            Ends on (overnight)
            <input type="date" className={inputCls} value={endDate || date} disabled={!editable} onChange={(ev) => setEndDate(ev.target.value)} />
          </label>
        ) : null}
        {target.mode === 'add' && kind === 'work' ? (
          <label className="flex flex-col gap-1 text-base font-semibold">
            Where
            <Select className={inputCls} value={place} onChange={(ev) => setPlace(ev.target.value)}>
              <option value="">Pick a job or stop</option>
              {places.map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
            {places.length === 0 ? <span className="text-sm font-normal">Only jobs and stops worked this week can be picked here. For anything else, add the time from that job’s page.</span> : null}
          </label>
        ) : e ? (
          <p className="text-base">{`Where: ${e.where}`}</p>
        ) : null}
        {e?.reviewNote ? <p className="rounded-lg bg-[#fff4cc] px-3 py-2 text-base">{e.reviewNote}</p> : null}
        {editable ? (
          <label className="flex flex-col gap-1 text-base font-semibold">
            Why? (required)
            <Textarea className="min-h-[4rem] text-base" maxLength={500} value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder={target.mode === 'add' ? 'Phone was dead' : e?.needsReview ? 'Checked with the crew lead' : 'Came in late'} />
          </label>
        ) : null}
        {err ? <p role="alert" className="text-base font-semibold text-red-800">{err}</p> : null}
        {e ? (
          <div className="flex flex-col gap-2">
            <Button
              variant="ghost"
              className="self-start"
              onClick={async () => {
                const res = await fetch(`/api/admin/time/${e.id}`, { cache: 'no-store' }).catch(() => null)
                setHistory(res && res.ok ? ((await res.json()) as { history: TimeEntryHistory[] }).history : [])
              }}
            >
              History
            </Button>
            {history ? (
              history.length === 0 ? (
                <p className="text-base">No changes — as tapped.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {history.map((h, i) => (
                    <li key={i} className="text-base">
                      {`${dayLabel(h.at, tz)} ${hm12(h.at, tz)} · ${h.by ?? 'Someone'}${h.reason ? ` — “${h.reason}”` : ''}${h.changes.length ? `: ${h.changes.map(describeChange).join('; ')}` : h.action === 'removed' ? ': removed' : ''}`}
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>
        ) : null}
        {editable ? (
          <DialogFooter>
            {e ? (
              confirmRemove ? (
                <Button variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={() => void send('DELETE', { reason })}>
                  Yes, remove it
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setConfirmRemove(true)}>
                  Remove
                </Button>
              )
            ) : null}
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={busy} disabled={reason.trim().length < 3 || (target.mode === 'add' && (!userId || (kind === 'work' && !place)))} onClick={save}>
              Save
            </Button>
          </DialogFooter>
        ) : (
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
