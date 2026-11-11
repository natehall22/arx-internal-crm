'use client'

import { useEffect, useState } from 'react'

import { Button, Card, CardContent, Dialog, DialogContent, Input, Select, toast } from '@/components/ui'
import type { CustomerMessageSettings, MessageKind } from '@/lib/customer-messages'

type View = {
  settings: CustomerMessageSettings
  describe: Record<MessageKind, string>
  quiet: string
  blockers: string[]
  samples: Record<MessageKind, { subject: string; html: string }>
}

const MESSAGES: Array<{ kind: MessageKind; key: keyof CustomerMessageSettings; title: string }> = [
  { kind: 'visit_reminder', key: 'visitReminder', title: 'Visit reminder' },
  { kind: 'visit_on_the_way', key: 'onTheWay', title: '“On the way”' },
  { kind: 'visit_done', key: 'visitDone', title: '“Visit done”' },
  { kind: 'quote_follow_up', key: 'quoteFollowUp', title: 'Quote follow-up' },
  { kind: 'invoice_reminder', key: 'invoiceReminder', title: 'Invoice reminder' },
]

const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: h, label: h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM` }))

const daysText = (d: number[]) => d.join(', ')
function parseDays(s: string): number[] | null {
  const parts = s.split(/[,\s]+/).filter(Boolean)
  if (parts.length === 0) return null
  const n = parts.map((p) => Number(p))
  return n.every((x) => Number.isInteger(x)) ? n : null
}

/**
 * Settings → Customer messages (owners). One card per email: a switch, one sentence saying exactly what it does with the
 * current timing, the timing right there, and "See the email" (the real email, with the company's own brand). A switch
 * saves on tap; timing saves with the bar at the bottom.
 */
export default function CustomerMessagesSettings({ initial = null }: { initial?: View | null }) {
  const [view, setView] = useState<View | null>(initial)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<MessageKind | null>(null)

  useEffect(() => {
    if (initial) return
    void fetch('/api/admin/customer-messages')
      .then((r) => r.json())
      .then((v: View) => setView(v))
      .catch(() => toast.error('Could not load'))
  }, [initial])

  async function save(set: Partial<CustomerMessageSettings>): Promise<boolean> {
    setBusy(true)
    const res = await fetch('/api/admin/customer-messages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerMessages: set }),
    }).catch(() => null)
    setBusy(false)
    const data = (res ? await res.json().catch(() => ({})) : {}) as View & { error?: string }
    if (!res || !res.ok) {
      toast.error(data.error || 'Could not save')
      return false
    }
    setView(data)
    return true
  }

  if (!view) return <p className="text-ui-base text-ink">Loading…</p>
  const s = view.settings
  const field = (k: string, fallback: string) => (k in draft ? draft[k] : fallback)
  const setField = (k: string, v: string) => setDraft((d) => ({ ...d, [k]: v }))
  const dirty = Object.keys(draft).length > 0

  async function saveTiming() {
    const set: Partial<CustomerMessageSettings> = {}
    if ('visitReminderDays' in draft) set.visitReminderDays = Number(draft.visitReminderDays)
    if ('visitWindow' in draft) set.visitWindow = draft.visitWindow
    if ('visitNote' in draft) set.visitNote = draft.visitNote
    for (const k of ['quoteFollowUpDays', 'invoiceReminderDays'] as const) {
      if (!(k in draft)) continue
      const days = parseDays(draft[k])
      if (!days) return toast.error('Days: whole numbers, separated by commas')
      set[k] = days
    }
    if (await save(set)) {
      setDraft({})
      toast.success('Saved')
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-28">
      {view.blockers.length > 0 ? (
        <div role="alert" className="rounded-ui border-2 border-red-700 bg-white p-4 text-ui-base text-ink">
          <p className="font-bold">Nothing can be sent yet:</p>
          <ul className="mt-1 list-disc pl-5">
            {view.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {MESSAGES.map((m) => {
        const on = s[m.key] as boolean
        return (
          <Card key={m.kind}>
            <CardContent className="flex flex-col gap-3 pt-4">
              <label className="flex min-h-tap cursor-pointer items-center justify-between gap-3">
                <span className="text-ui-lg font-bold text-ink">{m.title}</span>
                <span className="flex items-center gap-2 text-ui-base font-semibold text-ink">
                  {on ? 'On' : 'Off'}
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={`${m.title} ${on ? 'on' : 'off'}`}
                    className="h-7 w-7"
                    checked={on}
                    disabled={busy}
                    onChange={(e) => void save({ [m.key]: e.target.checked }).then((ok) => ok && toast.success(e.target.checked ? `${m.title} is on` : `${m.title} is off`))}
                  />
                </span>
              </label>
              <p className="text-ui-base text-ink">{view.describe[m.kind]}</p>

              {on && m.kind === 'visit_reminder' ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-ui-sm font-semibold text-ink">
                    Days before the visit
                    <Select value={field('visitReminderDays', String(s.visitReminderDays))} onChange={(e) => setField('visitReminderDays', e.target.value)}>
                      {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                        <option key={d} value={d}>
                          {d === 1 ? '1 day (the day before)' : `${d} days`}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="flex flex-col gap-1 text-ui-sm font-semibold text-ink">
                    Arrival window (optional)
                    <Input placeholder="between 8 AM and 5 PM" maxLength={60} value={field('visitWindow', s.visitWindow)} onChange={(e) => setField('visitWindow', e.target.value)} />
                  </label>
                  <label className="flex flex-col gap-1 text-ui-sm font-semibold text-ink sm:col-span-2">
                    Note on every reminder (gates, pets)
                    <Input maxLength={200} value={field('visitNote', s.visitNote)} onChange={(e) => setField('visitNote', e.target.value)} />
                  </label>
                </div>
              ) : null}
              {on && m.kind === 'visit_done' ? (
                <label className="flex min-h-tap items-center gap-3 text-ui-base text-ink">
                  <input type="checkbox" className="h-5 w-5" checked={s.visitDonePhotos} disabled={busy} onChange={(e) => void save({ visitDonePhotos: e.target.checked })} />
                  Include a link to the visit’s photos
                </label>
              ) : null}
              {on && m.kind === 'quote_follow_up' ? (
                <label className="flex flex-col gap-1 text-ui-sm font-semibold text-ink">
                  Days after the quote is sent (up to 3, e.g. 3, 7)
                  <Input inputMode="numeric" value={field('quoteFollowUpDays', daysText(s.quoteFollowUpDays))} onChange={(e) => setField('quoteFollowUpDays', e.target.value)} />
                </label>
              ) : null}
              {on && m.kind === 'invoice_reminder' ? (
                <label className="flex flex-col gap-1 text-ui-sm font-semibold text-ink">
                  Days from the due date (0 = due day, 7 = a week late; up to 4)
                  <Input inputMode="numeric" value={field('invoiceReminderDays', daysText(s.invoiceReminderDays))} onChange={(e) => setField('invoiceReminderDays', e.target.value)} />
                </label>
              ) : null}

              <Button variant="secondary" className="min-h-tap self-start" onClick={() => setPreview(m.kind)}>
                See the email
              </Button>
            </CardContent>
          </Card>
        )
      })}

      <Card>
        <CardContent className="flex flex-col gap-3 pt-4">
          <p className="text-ui-lg font-bold text-ink">Quiet hours</p>
          <p className="text-ui-base text-ink">{view.quiet}</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-ui-sm font-semibold text-ink">
              From
              <Select value={s.quietStart} disabled={busy} onChange={(e) => void save({ quietStart: Number(e.target.value) })}>
                {HOURS.map((h) => (
                  <option key={h.value} value={h.value}>
                    {h.label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-ui-sm font-semibold text-ink">
              Until
              <Select value={s.quietEnd} disabled={busy} onChange={(e) => void save({ quietEnd: Number(e.target.value) })}>
                {HOURS.map((h) => (
                  <option key={h.value} value={h.value}>
                    {h.label}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <p className="text-ui-sm text-ink">
            Every email has a “Stop these automatic emails” link. To stop emails to one customer, open them and tap “Don’t email this customer”.
          </p>
        </CardContent>
      </Card>

      {dirty ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-surface-line bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-3xl gap-3">
            <Button variant="secondary" className="min-h-tap flex-1" onClick={() => setDraft({})}>
              Undo changes
            </Button>
            <Button className="min-h-tap flex-1" loading={busy} onClick={() => void saveTiming()}>
              Save changes
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog open={preview != null} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent title={preview ? (MESSAGES.find((x) => x.kind === preview)?.title ?? 'Email') : 'Email'} className="h-[90dvh] max-h-[90dvh] sm:h-[85dvh] sm:max-w-2xl">
          {preview ? (
            <>
              <p className="text-ui-base text-ink">
                <span className="font-bold">Subject:</span> {view.samples[preview].subject}
              </p>
              <iframe title="Email preview" sandbox="" srcDoc={view.samples[preview].html} className="min-h-0 w-full flex-1 rounded-ui border border-surface-line bg-white" />
              <Button className="min-h-tap" onClick={() => setPreview(null)}>
                Close
              </Button>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
