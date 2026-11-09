'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import ContactActions, { type LoggedContact } from '@/components/customer/ContactActions'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import type { CheckupResult, CheckupView } from '@/lib/checkups'
import { formatDate, formatDateShort } from '@/lib/format'

type Section = { id: string; title: string; empty: string; rows: CheckupView[] }

const RESULT_STYLE: Record<CheckupResult, { label: string; cls: string }> = {
  green: { label: 'Green — looks good', cls: 'bg-green-700 text-white' },
  yellow: { label: 'Yellow — watch / minor repair', cls: 'bg-amber-400 text-[#2c2c2a]' },
  red: { label: 'Red — needs repair', cls: 'bg-red-700 text-white' },
}

const STATUS_TEXT: Record<CheckupView['status'], string> = {
  due: 'Due',
  booked: 'Booked',
  done: 'Done',
  declined: 'Customer declined',
  unreachable: 'Couldn’t reach',
}

const fmt = (ymd: string | null) => formatDate(ymd)

async function act(id: string, payload: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(`/api/ops/checkups/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    toast.error(data.error || 'Could not save')
    return false
  }
  return true
}

function CheckupCard({ c, today }: { c: CheckupView; today: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [sheet, setSheet] = useState<null | 'book' | 'result' | 'close'>(null)
  const [date, setDate] = useState(c.booked_for ?? today)
  const [notes, setNotes] = useState(c.notes ?? '')
  const open = c.status === 'due' || c.status === 'booked'
  const overdue = open && (c.status === 'due' ? c.due_on < today : !!c.booked_for && c.booked_for < today)
  const fileHref = c.customer_id && c.opportunity_id ? `/c/${c.customer_id}/d/${c.opportunity_id}` : `/ops/jobs/${c.production_job_id}`

  const run = async (payload: Record<string, unknown>, done: string) => {
    setBusy(true)
    const ok = await act(c.id, payload)
    setBusy(false)
    if (ok) {
      toast.success(done)
      setSheet(null)
      router.refresh()
    }
  }

  const onLogged = async (l: LoggedContact) => {
    const ok = await act(c.id, { action: 'contact', outcome: l.outcome, activityId: l.activityId })
    if (ok) router.refresh()
  }

  return (
    <li className="rounded-xl border border-surface-line bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-ui-lg font-semibold text-[#2c2c2a]">{c.customerName || 'Customer'}</p>
          <p className="text-ui-base font-medium text-[#2c2c2a]">{c.label}</p>
          <p className="break-words text-ui-sm text-[#2c2c2a]">{c.address || '—'}{c.jobNumber ? ` · Job ${c.jobNumber}` : ''}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-ui-sm font-semibold ${overdue ? 'bg-red-700 text-white' : open ? 'bg-gray-100 text-[#2c2c2a]' : 'bg-gray-200 text-[#2c2c2a]'}`}>
          {c.status === 'booked' ? (overdue ? `Visit was ${fmt(c.booked_for)} — record result` : `Booked ${fmt(c.booked_for)}`) : open ? (overdue ? `Overdue · ${fmt(c.due_on)}` : `Due ${fmt(c.due_on)}`) : STATUS_TEXT[c.status]}
        </span>
      </div>

      <dl className="mt-2 grid grid-cols-[7.5rem_1fr] gap-y-1 text-ui-sm text-[#2c2c2a]">
        <dt className="font-medium">Installed</dt><dd>{fmt(c.installedOn)}</dd>
        {c.assigneeName && (<><dt className="font-medium">Assigned to</dt><dd>{c.assigneeName}</dd></>)}
        {c.attempts > 0 && (<><dt className="font-medium">Tries</dt><dd>{c.attempts}{c.last_attempt_at ? ` · last ${formatDateShort(c.last_attempt_at)}` : ''}</dd></>)}
        {c.result && (<><dt className="font-medium">Result</dt><dd><span className={`rounded px-2 py-0.5 font-semibold ${RESULT_STYLE[c.result].cls}`}>{RESULT_STYLE[c.result].label}</span></dd></>)}
        {c.notes && (<><dt className="font-medium">Notes</dt><dd className="whitespace-pre-wrap">{c.notes}</dd></>)}
      </dl>

      <div className="mt-3 flex flex-col gap-2">
        {open && <ContactActions dealId={c.opportunity_id} phone={c.phone} email={c.email} surface="job" onLogged={onLogged} />}
        <div className="flex flex-wrap gap-2">
          {open && c.kind === 'inspection' && (
            <>
              <button type="button" disabled={busy} onClick={() => setSheet('book')} className="inline-flex h-11 items-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-[#2c2c2a]">
                {c.status === 'booked' ? 'Change date' : 'Book visit'}
              </button>
              <button type="button" disabled={busy} onClick={() => setSheet('result')} className="inline-flex h-11 items-center rounded-lg bg-[#2c2c2a] px-4 text-sm font-semibold text-white">
                Record result
              </button>
            </>
          )}
          {open && c.kind === 'touch' && (
            <button type="button" disabled={busy} onClick={() => run({ action: 'done', notes }, 'Marked done')} className="inline-flex h-11 items-center rounded-lg bg-[#2c2c2a] px-4 text-sm font-semibold text-white">
              Mark done
            </button>
          )}
          {open && (
            <button type="button" disabled={busy} onClick={() => setSheet('close')} className="inline-flex h-11 items-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-[#2c2c2a]">
              Close without visit
            </button>
          )}
          {!open && (
            <button type="button" disabled={busy} onClick={() => run({ action: 'reopen' }, 'Reopened')} className="inline-flex h-11 items-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-[#2c2c2a]">
              Reopen
            </button>
          )}
          <Link href={fileHref} className="inline-flex h-11 items-center px-2 text-sm font-semibold text-[#2c2c2a] underline">Open customer</Link>
        </div>
        {!c.opportunity_id && open && <p className="text-ui-sm text-[#2c2c2a]">This job has no deal linked, so calls can’t be logged here yet.</p>}
      </div>

      <Dialog open={sheet !== null} onOpenChange={(o) => !o && setSheet(null)}>
        {sheet === 'book' && (
          <DialogContent title="Book the visit" description={c.label}>
            <label className="flex flex-col gap-1 text-sm font-medium text-[#2c2c2a]">
              Date
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11 rounded-lg border border-gray-300 px-3 text-base text-[#2c2c2a]" />
            </label>
            <button type="button" disabled={busy || !date} onClick={() => run({ action: 'book', date }, 'Booked')} className="inline-flex h-12 items-center justify-center rounded-lg bg-[#2c2c2a] px-4 text-base font-semibold text-white">
              Save date
            </button>
          </DialogContent>
        )}
        {sheet === 'result' && (
          <DialogContent title="How did the roof look?" description={c.label}>
            <label className="flex flex-col gap-1 text-sm font-medium text-[#2c2c2a]">
              Notes (optional)
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} className="rounded-lg border border-gray-300 p-2 text-base text-[#2c2c2a]" placeholder="What you saw, anything to fix" />
            </label>
            <div className="grid gap-2">
              {(Object.keys(RESULT_STYLE) as CheckupResult[]).map((r) => (
                <button key={r} type="button" disabled={busy} onClick={() => run({ action: 'done', result: r, notes }, 'Result saved')} className={`inline-flex h-12 items-center justify-center rounded-lg px-4 text-base font-semibold ${RESULT_STYLE[r].cls}`}>
                  {RESULT_STYLE[r].label}
                </button>
              ))}
            </div>
          </DialogContent>
        )}
        {sheet === 'close' && (
          <DialogContent title="Close without a visit" description={c.label}>
            <label className="flex flex-col gap-1 text-sm font-medium text-[#2c2c2a]">
              Notes (optional)
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} className="rounded-lg border border-gray-300 p-2 text-base text-[#2c2c2a]" />
            </label>
            <div className="grid gap-2">
              <button type="button" disabled={busy} onClick={() => run({ action: 'decline', notes }, 'Closed')} className="inline-flex h-12 items-center justify-center rounded-lg bg-[#2c2c2a] px-4 text-base font-semibold text-white">
                Customer declined
              </button>
              <button type="button" disabled={busy} onClick={() => run({ action: 'unreachable', notes }, 'Closed')} className="inline-flex h-12 items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-base font-semibold text-[#2c2c2a]">
                Couldn’t reach them
              </button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </li>
  )
}

export default function CheckupList({ today, sections }: { today: string; sections: Section[] }) {
  return (
    <div className="flex flex-col gap-6">
      {sections.map((s) => (
        <section key={s.id} aria-labelledby={`checkups-${s.id}`}>
          <h2 id={`checkups-${s.id}`} className="mb-2 text-ui-lg font-semibold text-[#2c2c2a]">
            {s.title} <span className="font-normal">({s.rows.length})</span>
          </h2>
          {s.rows.length === 0 ? (
            <p className="text-ui-base text-[#2c2c2a]">{s.empty}</p>
          ) : (
            <ul className="flex flex-col gap-3">{s.rows.map((c) => <CheckupCard key={c.id} c={c} today={today} />)}</ul>
          )}
        </section>
      ))}
    </div>
  )
}
