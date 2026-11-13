'use client'

import * as React from 'react'

import { useOrgFeatures } from '@/hooks/useOrgFeatures'

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, DialogContent, DialogFooter, Field, Input, Select, Textarea, toast } from '@/components/ui'
import { PricingEditor, SeasonsEditor, StepsEditor } from '@/components/service-plans/PlanSpecEditors'
import { formatDateTime } from '@/lib/format'
import type { StarterTemplate } from '@/lib/service-plan-starters'
import { BILLING_BASIS_LABELS, EMPTY_PRICING, billingBasisChoices, type BillingBasis, type PlanPricing, type PlanStep, type Season, type ServicePlanTemplate } from '@/lib/service-plans'

type Option = { id: string; name: string }
type Load = { ready: boolean; canEdit: boolean; templates: ServicePlanTemplate[]; starters: StarterTemplate[]; trades: Array<{ slug: string; label: string }>; crews: Option[]; people: Option[] }
type Draft = { id: string | null; updated_at: string | null; name: string; trade: string; description: string; service_lines: string; seasons: Season[]; billing_basis: BillingBasis; taxable: boolean; pricing: PlanPricing; steps: PlanStep[]; active: boolean }
type Detail = { template: ServicePlanTemplate; plans: number; behind: number; history: Array<{ id: string; action: string; at: string; by: string | null; lines: string[] }> }

function draftFrom(t: Partial<ServicePlanTemplate> | StarterTemplate | null, trades: Load['trades']): Draft {
  const match = t?.trade ? trades.find((x) => x.slug === t.trade || x.label.toLowerCase().includes(String(t.trade).toLowerCase())) : null
  return {
    id: t && 'id' in t && t.id ? t.id : null,
    updated_at: t && 'updated_at' in t && t.updated_at ? t.updated_at : null,
    name: t?.name ?? '',
    trade: match?.slug ?? trades[0]?.slug ?? '',
    description: t?.description ?? '',
    service_lines: ((t as Partial<ServicePlanTemplate> | null)?.service_lines ?? []).join('\n'),
    seasons: t?.seasons?.length ? t.seasons.map((s) => ({ ...s })) : [{ from: '01-01', to: '12-31', frequency: 'weekly' }],
    billing_basis: t?.billing_basis ?? 'per_visit',
    taxable: t?.taxable ?? false,
    pricing: (t?.pricing as PlanPricing | undefined) ? JSON.parse(JSON.stringify(t!.pricing)) : { ...EMPTY_PRICING, fields: [], tiers: [] },
    steps: t?.steps ? JSON.parse(JSON.stringify(t.steps)) : [],
    active: t && 'active' in t ? t.active !== false : true,
  }
}

/**
 * Settings → Plan templates (owners): what the company sells — name, service type, seasons, billing, tax, price rules
 * (questions about the home + tiers + custom price) and follow-on steps with their results. Plans copy a template when
 * sold; editing one never changes a plan already sold. "Update plans" pushes the new version to them after a preview.
 * Data: /api/admin/service-plan-templates.
 */
export default function ServicePlanTemplatesCard() {
  const hourlyOn = useOrgFeatures().hourlyBilling
  const [data, setData] = React.useState<Load | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [detail, setDetail] = React.useState<Detail | null>(null)
  const [push, setPush] = React.useState<{ id: string; summary: string } | null>(null)
  const [busy, setBusy] = React.useState(false)
  // "New prices start on": plans keep today's price for visits before this day (empty = from each plan's next visit).
  const [startsOn, setStartsOn] = React.useState('')

  const load = React.useCallback(async () => {
    const res = await fetch('/api/admin/service-plan-templates', { cache: 'no-store' }).catch(() => null)
    if (!res || !res.ok) return setFailed(true)
    setFailed(false)
    setData((await res.json()) as Load)
  }, [])
  React.useEffect(() => {
    void load()
  }, [load])

  async function call(url: string, method: string, body?: unknown): Promise<Record<string, unknown> | null> {
    setBusy(true)
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null)
    const out = (res ? await res.json().catch(() => ({})) : {}) as Record<string, unknown>
    setBusy(false)
    if (!res || !res.ok) {
      toast.error(typeof out.error === 'string' ? out.error : 'Could not save')
      return null
    }
    return out
  }

  async function openDetail(id: string) {
    const out = await call(`/api/admin/service-plan-templates/${id}`, 'GET')
    if (out) setDetail(out as unknown as Detail)
  }

  async function save() {
    if (!draft) return
    const { id, updated_at, ...body } = draft
    const out = id ? await call(`/api/admin/service-plan-templates/${id}`, 'PATCH', { ...body, expectedUpdatedAt: updated_at }) : await call('/api/admin/service-plan-templates', 'POST', body)
    if (!out) return
    toast.success(id ? 'Template saved — plans already sold keep their copy' : 'Template added')
    setDraft(null)
    await load()
    if (id) await openDetail(id)
  }

  async function previewPush(id: string) {
    const out = await call(`/api/admin/service-plan-templates/${id}/apply`, 'POST', { preview: true, priceStartsOn: startsOn || null })
    if (out) setPush({ id, summary: String(out.summary ?? '') })
  }

  if (failed) return <p className="text-ui-base text-ink">Plan templates couldn’t load. Refresh to try again.</p>
  if (!data) return null
  const d = data

  return (
    <Card id="plan-templates" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Plan templates</CardTitle>
        {d.ready ? (
          <Button size="sm" onClick={() => setDraft(draftFrom(null, d.trades))}>
            + New template
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!d.ready ? <p className="text-ui-base text-ink">Plan templates turn on once the database update for them is applied.</p> : null}
        <p className="text-ui-base text-ink">What you sell. A plan copies its template when it’s sold, so changing a template never changes a plan already sold — use “Update plans” to push a change on purpose (it carries the schedule, price rules, steps and “What’s included”; you see a preview first).</p>
        {d.starters.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ui-sm font-semibold text-ink">Start from:</span>
            {d.starters.map((s) => (
              <Button key={s.key} size="sm" variant="secondary" onClick={() => setDraft(draftFrom(s, d.trades))}>
                {s.name}
              </Button>
            ))}
          </div>
        ) : null}
        {d.templates.length === 0 ? (
          <p className="text-ui-base text-ink">No templates yet.</p>
        ) : (
          <ul className="divide-y divide-surface-line">
            {d.templates.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="break-words text-ui-base font-semibold text-ink">
                    {t.name} {!t.active ? <Badge>Not offered</Badge> : null}
                  </p>
                  <p className="text-ui-sm text-ink">
                    {d.trades.find((x) => x.slug === t.trade)?.label ?? t.trade} · {BILLING_BASIS_LABELS[t.billing_basis]}
                    {t.taxable ? ' + tax' : ''} · {t.pricing.tiers.length} price tier{t.pricing.tiers.length === 1 ? '' : 's'}
                    {t.steps.length ? ` · then ${t.steps.map((s) => s.label).join(', ')}` : ''} · version {t.version}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setDraft(draftFrom(t, d.trades))}>Edit</Button>
                  <Button size="sm" variant="secondary" loading={busy} onClick={() => void openDetail(t.id)}>Plans & history</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {draft ? (
        <Dialog open onOpenChange={(o) => !o && !busy && setDraft(null)}>
          <DialogContent title={draft.id ? 'Edit plan template' : 'New plan template'} description="Prices you leave blank must be filled before the template can be saved.">
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                void save()
              }}
            >
              <Field label="Name *">{(a) => <Input {...a} className="text-base" maxLength={120} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />}</Field>
              <Field label="Service type *">
                {(a) => (
                  <Select {...a} className="text-base" value={draft.trade} onChange={(e) => setDraft({ ...draft, trade: e.target.value })}>
                    {d.trades.map((t) => (
                      <option key={t.slug} value={t.slug}>{t.label}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="What’s included (one per line)" hint="Copied onto each plan sold (and onto sold plans only when you push “Update plans”); the crew checks these off on every visit. No prices.">{(a) => <Textarea {...a} className="text-base" rows={4} maxLength={1800} value={draft.service_lines} onChange={(e) => setDraft({ ...draft, service_lines: e.target.value })} />}</Field>
              <Field label="Description (optional)">{(a) => <Textarea {...a} className="text-base" maxLength={2000} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />}</Field>
              <SeasonsEditor value={draft.seasons} onChange={(seasons) => setDraft({ ...draft, seasons })} />
              <Field label="Billed (custom prices)">
                {(a) => (
                  <Select {...a} className="text-base" value={draft.billing_basis} onChange={(e) => setDraft({ ...draft, billing_basis: e.target.value as BillingBasis })}>
                    {billingBasisChoices(hourlyOn, draft.billing_basis).map((b) => (
                      <option key={b} value={b}>{BILLING_BASIS_LABELS[b]}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <PricingEditor value={draft.pricing} onChange={(pricing) => setDraft({ ...draft, pricing })} />
              <label className="flex min-h-tap items-center gap-2 text-ui-base text-ink">
                <input type="checkbox" className="h-5 w-5" checked={draft.taxable} onChange={(e) => setDraft({ ...draft, taxable: e.target.checked })} />
                Charge sales tax
              </label>
              <StepsEditor value={draft.steps} onChange={(steps) => setDraft({ ...draft, steps })} crews={d.crews} people={d.people} />
              <label className="flex min-h-tap items-center gap-2 text-ui-base text-ink">
                <input type="checkbox" className="h-5 w-5" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
                Offered (new plans can be sold from it)
              </label>
              <DialogFooter className="sticky bottom-0 bg-surface pt-2">
                <Button type="button" variant="secondary" disabled={busy} onClick={() => setDraft(null)}>Cancel</Button>
                <Button type="submit" loading={busy} disabled={!draft.name.trim() || !draft.trade}>Save template</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}

      {detail ? (
        <Dialog open onOpenChange={(o) => !o && !busy && (setDetail(null), setPush(null))}>
          <DialogContent title={detail.template.name} description={`Version ${detail.template.version}. ${detail.plans} plan${detail.plans === 1 ? '' : 's'} sold from it; ${detail.behind} on an older version.`}>
            {detail.behind > 0 ? (
              <Field label="New prices start on (optional)" hint="Visits before this day keep their old price. Leave empty to change prices from the next visit.">
                {(a) => (
                  <Input
                    {...a}
                    type="date"
                    className="text-base"
                    value={startsOn}
                    onChange={(e) => {
                      setStartsOn(e.target.value)
                      setPush(null) // the preview must match the date
                    }}
                  />
                )}
              </Field>
            ) : null}
            {detail.behind > 0 ? (
              push?.id === detail.template.id ? (
                <div className="flex flex-col gap-2 rounded-ui border border-amber-600 bg-amber-50 p-3">
                  <p className="text-ui-base text-ink">{push.summary}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      loading={busy}
                      onClick={async () => {
                        const out = await call(`/api/admin/service-plan-templates/${detail.template.id}/apply`, 'POST', { preview: false, priceStartsOn: startsOn || null })
                        if (out) {
                          toast.success(String(out.summary ?? 'Plans updated'))
                          setPush(null)
                          await openDetail(detail.template.id)
                        }
                      }}
                    >
                      Update {detail.behind} plan{detail.behind === 1 ? '' : 's'}
                    </Button>
                    <Button variant="secondary" disabled={busy} onClick={() => setPush(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <Button className="self-start" loading={busy} onClick={() => void previewPush(detail.template.id)}>Update plans… (see what changes first)</Button>
              )
            ) : null}
            <h3 className="text-ui-base font-semibold text-ink">History</h3>
            {detail.history.length === 0 ? (
              <p className="text-ui-base text-ink">No changes yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {detail.history.map((h) => (
                  <li key={h.id} className="text-ui-sm text-ink">
                    <span className="font-semibold">{formatDateTime(h.at)}</span> · {h.by ?? 'Automatic'} · {h.action.replace('_', ' ')}
                    {h.lines.length ? <ul className="ml-4 list-disc">{h.lines.map((l, i) => <li key={i} className="break-words">{l}</li>)}</ul> : null}
                  </li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button variant="secondary" onClick={() => (setDetail(null), setPush(null))}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Card>
  )
}
