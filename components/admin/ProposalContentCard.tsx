'use client'

import { useEffect, useState } from 'react'

import { Button, Card, CardContent, CardHeader, CardTitle, toast } from '@/components/ui'
import type { ProposalContentItem } from '@/lib/industry-profiles-proposal'
import { fillCompanyToken, MAX_BODY_LENGTH, MAX_ITEMS, MAX_TITLE_LENGTH, type ProposalPdfContent } from '@/lib/proposal-content'

type Payload = { content: ProposalPdfContent; defaults: ProposalPdfContent; companyName: string }
type Form = Pick<ProposalPdfContent, 'coverSubtitle' | 'processTitle' | 'processSubtitle' | 'processSteps' | 'whyUsTitle' | 'whyUsItems'>

const field = 'min-h-tap w-full rounded-ui border border-surface-line bg-white px-3 text-base text-ink'
const small = 'min-h-tap rounded-ui border border-surface-line bg-white px-3 text-ui-base font-semibold text-ink disabled:opacity-40'

function toForm(c: ProposalPdfContent): Form {
  return { coverSubtitle: c.coverSubtitle, processTitle: c.processTitle, processSubtitle: c.processSubtitle, processSteps: c.processSteps.map((i) => ({ ...i })), whyUsTitle: c.whyUsTitle, whyUsItems: c.whyUsItems.map((i) => ({ ...i })) }
}

function ListEditor({ label, noun, items, onChange }: { label: string; noun: string; items: ProposalContentItem[]; onChange: (v: ProposalContentItem[]) => void }) {
  const set = (n: number, patch: Partial<ProposalContentItem>) => onChange(items.map((it, i) => (i === n ? { ...it, ...patch } : it)))
  const move = (n: number, d: -1 | 1) => {
    const next = items.slice()
    const [it] = next.splice(n, 1)
    next.splice(n + d, 0, it!)
    onChange(next)
  }
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-ui-base font-semibold text-ink">{label}</legend>
      {items.map((it, n) => (
        <div key={n} className="flex flex-col gap-2 rounded-ui border border-surface-line p-3">
          <input value={it.title} maxLength={MAX_TITLE_LENGTH} onChange={(e) => set(n, { title: e.target.value })} aria-label={`${noun} ${n + 1} title`} placeholder="Title" className={field} />
          <textarea value={it.body} maxLength={MAX_BODY_LENGTH} rows={3} onChange={(e) => set(n, { body: e.target.value })} aria-label={`${noun} ${n + 1} text`} placeholder="One or two sentences" className="w-full rounded-ui border border-surface-line bg-white p-3 text-base text-ink" />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={small} disabled={n === 0} onClick={() => move(n, -1)} aria-label={`Move ${noun} ${n + 1} up`}>Up</button>
            <button type="button" className={small} disabled={n === items.length - 1} onClick={() => move(n, 1)} aria-label={`Move ${noun} ${n + 1} down`}>Down</button>
            <button type="button" className={small} onClick={() => onChange(items.filter((_, i) => i !== n))} aria-label={`Remove ${noun} ${n + 1}`}>Remove</button>
          </div>
        </div>
      ))}
      {items.length < MAX_ITEMS ? (
        <button type="button" className={`${small} self-start`} onClick={() => onChange([...items, { title: '', body: '' }])}>Add {noun}</button>
      ) : (
        <p className="text-ui-sm text-ink">Up to {MAX_ITEMS}.</p>
      )}
    </fieldset>
  )
}

/**
 * Settings → Proposal content (owners): the cover subtitle, the Process page and the Why-choose-us list on the proposal PDF.
 * Starts from the industry profile's wording; "Reset to default" goes back to it. Route /api/admin/proposal-content;
 * rules lib/proposal-content.ts. The preview below is text only — the PDF itself is drawn from the proposal.
 */
export default function ProposalContentCard({ proposalWord = 'Proposal' }: { proposalWord?: string }) {
  const [data, setData] = useState<Payload | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)

  function fill(d: Payload) {
    setData(d)
    setForm(toForm(d.content))
  }

  useEffect(() => {
    void fetch('/api/admin/proposal-content', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Payload | null) => d?.content && fill(d))
      .catch(() => null)
  }, [])

  async function send(body: Record<string, unknown>, done: string) {
    setBusy(true)
    const res = await fetch('/api/admin/proposal-content', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const d = res ? ((await res.json().catch(() => ({}))) as Partial<Payload> & { error?: string }) : null
    setBusy(false)
    if (!res?.ok || !d?.content) return toast.error(d?.error || 'Could not save')
    fill(d as Payload)
    toast.success(done)
  }

  const co = data?.companyName || 'Your company'
  return (
    <Card>
      <CardHeader>
        <CardTitle>{proposalWord} content</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-ui-base text-ink">The words on your {proposalWord.toLowerCase()} PDF&rsquo;s cover, process and why-choose-us pages. The big cover title is each {proposalWord.toLowerCase()}&rsquo;s own title. Use {'{company}'} for your company name. Keep it short: very long text can push a page onto a second sheet.</p>
        {!data || !form ? (
          <p className="text-ui-sm text-ink">Loading…</p>
        ) : (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-ui-base font-semibold text-ink">Cover subtitle</span>
              <input value={form.coverSubtitle} maxLength={MAX_TITLE_LENGTH} onChange={(e) => setForm({ ...form, coverSubtitle: e.target.value })} className={field} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-ui-base font-semibold text-ink">Process page heading</span>
              <input value={form.processTitle} maxLength={MAX_TITLE_LENGTH} onChange={(e) => setForm({ ...form, processTitle: e.target.value })} className={field} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-ui-base font-semibold text-ink">Process page subheading</span>
              <input value={form.processSubtitle} maxLength={MAX_TITLE_LENGTH} onChange={(e) => setForm({ ...form, processSubtitle: e.target.value })} className={field} />
            </label>
            <ListEditor label="Process steps" noun="step" items={form.processSteps} onChange={(processSteps) => setForm({ ...form, processSteps })} />
            <label className="flex flex-col gap-1">
              <span className="text-ui-base font-semibold text-ink">Why-choose-us heading</span>
              <input value={form.whyUsTitle} maxLength={MAX_TITLE_LENGTH} onChange={(e) => setForm({ ...form, whyUsTitle: e.target.value })} className={field} />
            </label>
            <ListEditor label="Why-choose-us items" noun="item" items={form.whyUsItems} onChange={(whyUsItems) => setForm({ ...form, whyUsItems })} />

            <section aria-label="Preview" className="flex flex-col gap-2 rounded-ui border border-surface-line bg-surface-subtle p-3 text-ink">
              <h3 className="text-ui-base font-semibold">Preview (text only)</h3>
              <p className="text-ui-base">{fillCompanyToken(form.coverSubtitle, co)}</p>
              <p className="mt-2 text-ui-base font-semibold">{fillCompanyToken(form.processTitle, co)}</p>
              <p className="text-ui-base">{fillCompanyToken(form.processSubtitle, co)}</p>
              <ol className="list-decimal pl-5 text-ui-base">
                {form.processSteps.filter((s) => s.title.trim()).map((s, i) => (
                  <li key={i}><span className="font-semibold">{fillCompanyToken(s.title, co)}.</span> {fillCompanyToken(s.body, co)}</li>
                ))}
              </ol>
              <p className="mt-2 text-ui-base font-semibold">{fillCompanyToken(form.whyUsTitle, co)}</p>
              <ul className="list-disc pl-5 text-ui-base">
                {form.whyUsItems.filter((s) => s.title.trim()).map((s, i) => (
                  <li key={i}><span className="font-semibold">{fillCompanyToken(s.title, co)}.</span> {fillCompanyToken(s.body, co)}</li>
                ))}
              </ul>
            </section>

            <div className="flex flex-wrap gap-2">
              <Button className="min-h-tap" loading={busy} onClick={() => void send({ settings: form }, 'Saved')}>Save</Button>
              <button type="button" className={small} disabled={busy} onClick={() => void send({ reset: true }, 'Back to the default text')}>Reset to default</button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
