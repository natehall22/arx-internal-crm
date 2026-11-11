'use client'

import { useEffect, useState } from 'react'

import { formatDateTime } from '@/lib/format'
import { Button, Card, CardContent, Input, confirmDialog, toast } from '@/components/ui'

type Totals = { texts: number; segments: number; costMicros: number }
type Usage = { out: Totals; in: Totals; cost: string }
type View = {
  companyName: string
  number: { e164: string; display: string | null; kind: string; source: string } | null
  status: string
  statusText: string
  notReady: string | null
  rejectionReason: string | null
  dailyCap: number
  blockers: string[]
  registration: { fields: Array<{ key: string; label: string; required: boolean; help: string; max: number }>; values: Record<string, string>; missing: string[] }
  submit: { enabled: boolean; note: string }
  usage: { thisMonth: Usage; lastMonth: Usage; thisMonthLabel: string; lastMonthLabel: string }
  consent: { version: string; text: string }
  inbox: Array<{ id: string; from: string; body: string; kind: string; at: string }>
}

const monthName = (ym: string) => new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ym}-01T12:00:00Z`))
const when = (iso: string) => formatDateTime(iso)

/**
 * Settings → Texting (owners). Where the company's texting stands in one sentence, its number, the business details the
 * carriers ask for, what it has used this month, and texts nobody could be matched to. "Submit for registration" is shown
 * but off until the carrier account is connected to this app.
 */
export default function TextingSettings() {
  const [view, setView] = useState<View | null>(null)
  const [busy, setBusy] = useState(false)
  const [number, setNumber] = useState('')
  const [draft, setDraft] = useState<Record<string, string>>({})

  useEffect(() => {
    void fetch('/api/admin/texting')
      .then((r) => r.json())
      .then((v: View) => setView(v))
      .catch(() => toast.error('Could not load'))
  }, [])

  async function patch(body: Record<string, unknown>, ok?: string): Promise<boolean> {
    setBusy(true)
    const res = await fetch('/api/admin/texting', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    setBusy(false)
    const data = (res ? await res.json().catch(() => ({})) : {}) as View & { error?: string }
    if (!res || !res.ok) {
      toast.error(data.error || 'Could not save')
      return false
    }
    setView(data)
    if (ok) toast.success(ok)
    return true
  }

  if (!view) return <p className="text-ui-base text-ink">Loading…</p>
  const active = view.status === 'active'
  const dirty = Object.keys(draft).length > 0
  const field = (k: string) => (k in draft ? draft[k] : (view.registration.values[k] ?? ''))

  return (
    <div className="flex flex-col gap-4 pb-28">
      {view.blockers.length > 0 ? (
        <div role="alert" className="rounded-ui border-2 border-red-700 bg-white p-4 text-ui-base text-ink">
          <p className="font-bold">Texting can’t work yet:</p>
          <ul className="mt-1 list-disc pl-5">
            {view.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-3 pt-4">
          <p className="text-ui-lg font-bold text-ink">{active ? 'Texting is on' : 'Texting isn’t on yet'}</p>
          <p className="text-ui-base text-ink">{view.statusText}.</p>
          {view.rejectionReason ? <p className="text-ui-base font-semibold text-red-700">{view.rejectionReason}</p> : null}
          {view.number ? (
            <p className="text-ui-base text-ink">
              Your texting number: <span className="font-bold">{view.number.display ?? view.number.e164}</span>
            </p>
          ) : null}
          {!active ? (
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-ui-sm font-semibold text-ink">
                Already registered your number with the carrier? Enter it here
                <Input inputMode="tel" placeholder="(850) 555-0100" value={number} onChange={(e) => setNumber(e.target.value)} />
              </label>
              <Button className="min-h-tap self-start" disabled={!number.trim()} loading={busy} onClick={() => void patch({ connectNumber: number }, 'Texting is on').then((ok) => ok && setNumber(''))}>
                Turn on texting with this number
              </Button>
            </div>
          ) : (
            <Button
              variant="secondary"
              className="min-h-tap self-start"
              onClick={async () => {
                if (await confirmDialog({ title: 'Turn texting off?', description: 'Nothing is sent until you turn it back on. Replies and STOP are still recorded.', confirmLabel: 'Turn off' })) void patch({ disconnect: true }, 'Texting is off')
              }}
            >
              Turn texting off
            </Button>
          )}
          <p className="text-ui-sm text-ink">Which messages go by text is chosen in Customer messages. Staff can also text a customer from their file.</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-4">
          <p className="text-ui-lg font-bold text-ink">Your business details</p>
          <p className="text-ui-base text-ink">Carriers ask for these once, to approve your number. {view.registration.missing.length > 0 ? `Still needed: ${view.registration.missing.join(', ')}.` : 'Everything they need is filled in.'}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {view.registration.fields.map((f) => (
              <label key={f.key} className={`flex flex-col gap-1 text-ui-sm font-semibold text-ink ${f.key === 'useCase' || f.key === 'optInMethod' ? 'sm:col-span-2' : ''}`}>
                {f.label}
                {f.required ? '' : ' (optional)'}
                <Input maxLength={f.max} value={field(f.key)} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} />
                {f.help ? <span className="text-ui-sm font-normal text-ink">{f.help}</span> : null}
              </label>
            ))}
          </div>
          <div className="flex flex-col gap-1">
            <Button className="min-h-tap self-start" disabled title={view.submit.note}>
              Submit for registration
            </Button>
            <p className="text-ui-sm text-ink">{view.submit.note}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-4">
          <p className="text-ui-lg font-bold text-ink">What customers agree to</p>
          <p className="text-ui-base text-ink">Before we text a customer, they (or your staff, on their say-so) agree to this. The exact words and who agreed are kept as proof.</p>
          <p className="rounded-ui border border-surface-line bg-white p-3 text-ui-base text-ink">{view.consent.text}</p>
          <p className="text-ui-sm text-ink">Wording {view.consent.version}. “Said OK by phone / in person” is recorded in the customer’s file when you first text them.</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-4">
          <p className="text-ui-lg font-bold text-ink">Usage</p>
          {([view.usage.thisMonth, view.usage.lastMonth] as const).map((u, i) => (
            <p key={i} className="text-ui-base text-ink">
              <span className="font-bold">{monthName(i === 0 ? view.usage.thisMonthLabel : view.usage.lastMonthLabel)}:</span> {u.out.texts} sent, {u.in.texts} received ({u.out.segments + u.in.segments} message parts), carrier cost about {u.cost}
            </p>
          ))}
          <a className="inline-flex min-h-tap items-center text-ui-base font-semibold underline" href={`/api/admin/texting/usage?month=${view.usage.thisMonthLabel}&format=csv`}>
            Download this month (CSV)
          </a>
          <label className="flex flex-col gap-1 text-ui-sm font-semibold text-ink">
            Most texts sent in one day (a safety limit)
            <Input inputMode="numeric" defaultValue={String(view.dailyCap)} onBlur={(e) => Number(e.target.value) !== view.dailyCap && void patch({ dailyCap: Number(e.target.value) }, 'Saved')} />
          </label>
        </CardContent>
      </Card>

      {view.inbox.length > 0 ? (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-4">
            <p className="text-ui-lg font-bold text-ink">Texts waiting for a person</p>
            <p className="text-ui-base text-ink">These came from a number that isn’t on a customer, or they asked to stop. Nothing was created for them.</p>
            <ul className="divide-y divide-surface-line">
              {view.inbox.map((m) => (
                <li key={m.id} className="flex flex-col gap-1 py-3 text-ui-base text-ink">
                  <span className="font-semibold">
                    <a className="underline" href={`tel:${m.from}`}>
                      {m.from}
                    </a>{' '}
                    · {when(m.at)}
                    {m.kind === 'optout_phrase' || m.kind === 'wrong_number' ? ' · treated as “stop”' : ''}
                  </span>
                  <span className="whitespace-pre-wrap break-words">{m.body}</span>
                  <Button variant="secondary" className="min-h-tap self-start" onClick={() => void patch({ dismissInbound: m.id }, 'Done')}>
                    Done
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {dirty ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-surface-line bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-3xl gap-3">
            <Button variant="secondary" className="min-h-tap flex-1" onClick={() => setDraft({})}>
              Undo changes
            </Button>
            <Button className="min-h-tap flex-1" loading={busy} onClick={() => void patch({ registration: draft }, 'Saved').then((ok) => ok && setDraft({}))}>
              Save changes
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
