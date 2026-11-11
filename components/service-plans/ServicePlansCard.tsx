'use client'

import * as React from 'react'

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, confirmDialog, Dialog, DialogContent, DialogFooter, Field, Input, toast } from '@/components/ui'
import { PlanFields, bodyFrom, formFromPlan, formFromTemplate, planFormReady, todayLocal, type PlanEditorOptions, type PlanFormValues, type PlanRow } from '@/components/service-plans/PlanForm'
import { formatDateShort, formatDateTime, formatMoney } from '@/lib/format'
import { BILLING_BASIS_LABELS, WEEKDAY_LABELS, planWeekday, seasonLabel } from '@/lib/service-plans'

type Load = PlanEditorOptions & { ready: boolean; plans: PlanRow[]; canEdit: boolean }

type Preview = { body: Record<string, unknown>; plan: PlanRow; summary: string; lines: string[] }
type HistoryEntry = { id: string; action: string; at: string; by: string | null; lines: string[]; effect: { removed: number; added: number; updated: number } | null }
type History = { plan: PlanRow; entries: HistoryEntry[] | null }

const STATUS_TONE = { active: 'success', paused: 'warning', ended: 'neutral' } as const
const ACTION_WORDS: Record<string, string> = {
  created: 'Started',
  updated: 'Changed',
  paused: 'Paused',
  resumed: 'Resumed',
  ended: 'Ended',
  template_applied: 'Template update applied',
  auto_resumed: 'Resumed on its date',
  auto_ended: 'Ended on its end date',
}

/**
 * Customer File → Service plans: recurring work at one of the customer's properties. A new plan starts from one of the
 * company's plan templates (Settings → Plan templates) and copies it; everything stays editable on the plan — schedule,
 * seasons, price, crew, property, follow-on steps, billing. Saving an edit first shows what will change on the calendar
 * (visits removed / added / updated); done, skipped and today's visits never change. Every change is in the plan's
 * history. Reads and saves through /api/customers/[id]/service-plans and /api/service-plans/[id].
 */
export default function ServicePlansCard({ customerId }: { customerId: string }) {
  const [data, setData] = React.useState<Load | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [editing, setEditing] = React.useState<{ plan: PlanRow | null; form: PlanFormValues } | null>(null)
  const [preview, setPreview] = React.useState<Preview | null>(null)
  const [pausing, setPausing] = React.useState<{ plan: PlanRow; until: string } | null>(null)
  const [history, setHistory] = React.useState<History | null>(null)
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    const res = await fetch(`/api/customers/${customerId}/service-plans`, { cache: 'no-store' }).catch(() => null)
    if (res && (res.status === 403 || res.status === 404)) return setData(null)
    if (!res || !res.ok) return setFailed(true)
    setFailed(false)
    setData((await res.json()) as Load)
  }, [customerId])
  React.useEffect(() => {
    void load()
  }, [load])

  if (failed) return <p className="text-ui-base text-ink">Service plans couldn’t load. Refresh to try again.</p>
  if (!data || !data.ready) return null
  if (data.plans.length === 0 && !data.canEdit) return null
  const d = data

  async function send(url: string, method: string, body: unknown): Promise<Record<string, unknown> | null> {
    setSaving(true)
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const out = (res ? await res.json().catch(() => ({})) : {}) as Record<string, unknown>
    setSaving(false)
    if (!res || !res.ok) {
      toast.error(typeof out.error === 'string' ? out.error : 'Could not save')
      return null
    }
    return out
  }

  /** Every change to an existing plan: preview first, then save with the same body. */
  async function previewThenSave(plan: PlanRow, body: Record<string, unknown>) {
    const out = await send(`/api/service-plans/${plan.id}`, 'PATCH', { ...body, preview: true })
    if (!out) return
    const lines = ((out.changes ?? []) as Array<{ label: string }>).map((c) => c.label)
    setPreview({ body, plan, summary: String(out.summary ?? ''), lines })
  }

  async function confirmSave() {
    if (!preview) return
    const out = await send(`/api/service-plans/${preview.plan.id}`, 'PATCH', { ...preview.body, expectedUpdatedAt: preview.plan.updated_at })
    if (!out) return
    toast.success('Plan saved')
    setPreview(null)
    setEditing(null)
    setPausing(null)
    await load()
  }

  async function createPlan() {
    if (!editing) return
    const out = await send(`/api/customers/${customerId}/service-plans`, 'POST', bodyFrom(editing.form, true))
    if (!out) return
    toast.success('Plan started — visits are on the calendar')
    setEditing(null)
    await load()
  }

  async function openHistory(plan: PlanRow) {
    setHistory({ plan, entries: null })
    const res = await fetch(`/api/service-plans/${plan.id}/history`, { cache: 'no-store' }).catch(() => null)
    const out = (res && res.ok ? await res.json().catch(() => ({})) : {}) as { history?: HistoryEntry[] }
    setHistory((h) => (h && h.plan.id === plan.id ? { ...h, entries: out.history ?? [] } : h))
  }

  const set = (patch: Partial<PlanFormValues>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e))
  const nameOf = (list: Array<{ id: string; name: string }>, id: string | null) => list.find((o) => o.id === id)?.name ?? null
  const tradeName = (slug: string) => d.trades.find((t) => t.slug === slug)?.label ?? slug
  const tierLabel = (p: PlanRow) => p.pricing.tiers.find((t) => t.key === p.tier_key)?.label ?? null

  const f = editing?.form

  return (
    <Card>
      <CardHeader>
        <CardTitle>Service plans</CardTitle>
        {d.canEdit && d.properties.length > 0 ? (
          <Button size="sm" onClick={() => setEditing({ plan: null, form: formFromTemplate(d.templates[0] ?? null, d) })}>
            + Add plan
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {d.canEdit && d.properties.length === 0 ? <p className="text-ui-base text-ink">Add a property first — a plan is for one property.</p> : null}
        {d.plans.length === 0 ? (
          d.properties.length > 0 ? <p className="text-ui-base text-ink">No service plans yet.</p> : null
        ) : (
          <ul className="divide-y divide-surface-line">
            {d.plans.map((p) => (
              <li key={p.id} className="flex flex-col gap-1.5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="break-words text-ui-base font-semibold text-ink">{p.name}</p>
                  <Badge tone={STATUS_TONE[p.status]}>
                    {p.status === 'paused' ? (p.paused_until ? `Paused until ${formatDateShort(p.paused_until)}` : 'Paused') : p.status === 'ended' ? 'Ended' : 'Active'}
                  </Badge>
                </div>
                <p className="text-ui-base text-ink">{[tradeName(p.trade), nameOf(d.properties, p.property_id), `${WEEKDAY_LABELS[planWeekday(p)]}s`].filter(Boolean).join(' · ')}</p>
                <ul className="text-ui-sm text-ink">
                  {p.seasons.map((s, i) => (
                    <li key={i}>{seasonLabel(s)}</li>
                  ))}
                </ul>
                <p className="text-ui-sm text-ink">
                  {p.priceHidden
                    ? null
                    : p.price != null
                      ? `${formatMoney(p.price)} ${BILLING_BASIS_LABELS[p.billing_basis]}${tierLabel(p) ? ` (${tierLabel(p)})` : ' (custom)'}${p.taxable ? ' + tax' : ''} · `
                      : 'No price · '}
                  {nameOf(d.crews, p.default_sub_id) ?? 'No crew yet'}
                  {p.steps.length ? ` · then ${p.steps.map((s) => `${s.label} (+${s.daysAfter}d)`).join(', ')}` : ''}
                  {p.end_date && p.status !== 'ended' ? ` · ends ${formatDateShort(p.end_date)}` : ''}
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {d.canEdit && p.status !== 'ended' ? (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setEditing({ plan: p, form: formFromPlan(p) })}>
                        Edit
                      </Button>
                      {p.status === 'paused' ? (
                        <Button size="sm" variant="secondary" loading={saving} onClick={() => void previewThenSave(p, { action: 'resume' })}>
                          Resume
                        </Button>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => setPausing({ plan: p, until: '' })}>
                          Pause
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={saving}
                        onClick={async () => {
                          if (await confirmDialog({ title: `End “${p.name}”?`, description: 'You’ll see what comes off the calendar before it saves.', confirmLabel: 'Continue', destructive: true })) {
                            await previewThenSave(p, { action: 'end' })
                          }
                        }}
                      >
                        End plan
                      </Button>
                    </>
                  ) : null}
                  <Button size="sm" variant="ghost" className="underline" onClick={() => void openHistory(p)}>
                    History
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {pausing ? (
        <Dialog open onOpenChange={(o) => !o && !saving && setPausing(null)}>
          <DialogContent title={`Pause ${pausing.plan.name}`} description="Visits after today come off the calendar until it resumes. Leave the date empty to pause until someone resumes it.">
            <Field label="Resume on (optional)">{(a) => <Input {...a} type="date" className="text-base" value={pausing.until} min={todayLocal()} onChange={(e) => setPausing({ ...pausing, until: e.target.value })} />}</Field>
            <DialogFooter className="sticky bottom-0 bg-surface pt-2">
              <Button variant="secondary" disabled={saving} onClick={() => setPausing(null)}>
                Cancel
              </Button>
              <Button loading={saving} onClick={() => void previewThenSave(pausing.plan, { action: 'pause', until: pausing.until || null })}>
                Next
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {preview ? (
        <Dialog open onOpenChange={(o) => !o && !saving && setPreview(null)}>
          <DialogContent title="What will change" description={preview.plan.name}>
            {preview.lines.length ? <p className="text-ui-base text-ink">Changing: {preview.lines.join(', ')}.</p> : null}
            <p className="rounded-ui border border-amber-600 bg-amber-50 p-3 text-ui-base text-ink">{preview.summary}</p>
            <DialogFooter className="sticky bottom-0 bg-surface pt-2">
              <Button variant="secondary" disabled={saving} onClick={() => setPreview(null)}>
                Back
              </Button>
              <Button loading={saving} onClick={() => void confirmSave()}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {history ? (
        <Dialog open onOpenChange={(o) => !o && setHistory(null)}>
          <DialogContent title={`History — ${history.plan.name}`}>
            {history.entries === null ? (
              <p className="text-ui-base text-ink">Loading…</p>
            ) : history.entries.length === 0 ? (
              <p className="text-ui-base text-ink">No changes recorded.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {history.entries.map((h) => (
                  <li key={h.id} className="text-ui-sm text-ink">
                    <p>
                      <span className="font-semibold">{ACTION_WORDS[h.action] ?? h.action}</span> · {formatDateTime(h.at)} · {h.by ?? 'Automatic'}
                    </p>
                    {h.lines.length ? (
                      <ul className="ml-4 list-disc">
                        {h.lines.map((l, i) => (
                          <li key={i} className="break-words">{l}</li>
                        ))}
                      </ul>
                    ) : null}
                    {h.effect && (h.effect.removed || h.effect.added || h.effect.updated) ? (
                      <p>Visits: {h.effect.removed} removed, {h.effect.added} added, {h.effect.updated} updated</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button variant="secondary" onClick={() => setHistory(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {editing && f ? (
        <Dialog open onOpenChange={(o) => !o && !saving && setEditing(null)}>
          <DialogContent
            className="scroll-pb-40"
            title={editing.plan ? 'Edit service plan' : 'New service plan'}
            description={editing.plan ? 'You’ll see what changes on the calendar before it saves. Done, skipped and today’s visits never change.' : 'Visits go on the calendar for the next 6 weeks, and keep coming.'}
          >
            <form
              className="flex flex-col gap-3 pb-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (editing.plan) void previewThenSave(editing.plan, bodyFrom(f, false))
                else void createPlan()
              }}
            >
              <PlanFields
                key={editing.plan?.id ?? f.template_id}
                d={d}
                f={f}
                set={set}
                plan={editing.plan}
                onTemplate={(t) => setEditing({ plan: null, form: { ...formFromTemplate(t, d), property_id: f.property_id, start_date: f.start_date, default_sub_id: f.default_sub_id } })}
              />

              <DialogFooter className="sticky bottom-0 bg-surface pt-2">
                <Button type="button" variant="secondary" disabled={saving} onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button type="submit" loading={saving} disabled={!planFormReady(f, true)}>
                  {editing.plan ? 'Next: see what changes' : 'Start plan'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </Card>
  )
}
