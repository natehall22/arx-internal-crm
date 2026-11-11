/**
 * Service plans + visits — database side (server only, service-role client through orgDb). THE one writer of
 * `service_plans` and of service-visit `work_orders` rows (`work_order_type = 'service_visit'`). Rules live in
 * lib/service-plans.ts. Callers check who may act first (lib/service-plans-access.ts); crons check the company's
 * `servicePlans` feature switch.
 *
 * Visits are created lazily by ONE generator, `ensureServiceVisits` (the pattern of `ensureCheckups`): it fills today
 * through VISIT_HORIZON_DAYS ahead, is idempotent on (org_id, service_plan_id, service_planned_date) and runs on the
 * morning cron, on Visits page loads and after every plan save. History (done / skipped / cancelled visits, and any
 * visit today or earlier) is never rewritten.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { loadOrgTimeZone } from '@/lib/cron-orgs'
import { loadOrgTrades } from '@/lib/org-trades'
import { describeChange, diffFields, type FieldChange } from '@/lib/change-log'
import {
  EMPTY_PRICING,
  PLAN_FIELD_LABELS,
  SERVICE_PLAN_COLUMNS,
  SERVICE_STEP,
  SERVICE_VISIT_TYPE,
  TEMPLATE_COLUMNS,
  TEMPLATE_FIELD_LABELS,
  addDaysYmd,
  cleanPlanInput,
  cleanPricingInputs,
  cleanTemplateInput,
  crewAfterEdit,
  describeVisitEffect,
  followUpVisitFields,
  planVisitDates,
  previewVisitEffect,
  readPricing,
  readSteps,
  regenerationPlan,
  resolvePlanPricing,
  seasonLabel,
  stepResultKeys,
  visitHorizon,
  visitPatch,
  visitPrice,
  ymdInZone,
  type BulkShift,
  type ExistingVisit,
  type PlanStatusChange,
  type Season,
  type ServicePlan,
  type ServicePlanInput,
  type ServicePlanTemplate,
  type StepResultOption,
  type VisitAction,
  type VisitEffect,
} from '@/lib/service-plans'
import { orgDb } from '@/lib/supabase/org-db'

const PAGE = 1000
/** The visit idempotency key (unique index work_orders_service_slot_key). */
const VISIT_SLOT_CONFLICT = 'org_id,service_plan_id,service_planned_date,visit_step'

/** "That table / column is not there yet" — migration 202611110030 not applied. */
export function isServicePlansNotReadyError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const msg = String(error.message ?? '')
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    (/(service_plans?|service_planned_date|service_price|skip_reason|crew_day_links)/.test(msg) && /does not exist|could not find/i.test(msg))
  )
}

export const SERVICE_PLANS_NOT_READY = 'Service plans turn on once the database update for them is applied.'

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function planFromRow(r: Record<string, unknown>): ServicePlan {
  const inputs = cleanPricingInputs(r.pricing_inputs ?? {})
  return {
    id: String(r.id),
    org_id: String(r.org_id),
    customer_id: String(r.customer_id),
    property_id: String(r.property_id),
    template_id: (r.template_id as string | null) ?? null,
    template_version: num(r.template_version),
    trade: String(r.trade),
    name: String(r.name ?? ''),
    description: (r.description as string | null) ?? null,
    price: num(r.price),
    billing_basis: r.billing_basis === 'per_month' || r.billing_basis === 'per_year' ? r.billing_basis : 'per_visit',
    taxable: r.taxable === true,
    pricing: readPricing(r.pricing ?? {}),
    pricing_inputs: inputs.ok ? inputs.value : {},
    tier_key: (r.tier_key as string | null) ?? null,
    steps: readSteps(r.steps ?? []),
    status: r.status === 'paused' || r.status === 'ended' ? r.status : 'active',
    start_date: String(r.start_date),
    end_date: (r.end_date as string | null) ?? null,
    paused_until: (r.paused_until as string | null) ?? null,
    seasons: Array.isArray(r.seasons) ? (r.seasons as Season[]) : [],
    preferred_weekday: num(r.preferred_weekday),
    default_sub_id: (r.default_sub_id as string | null) ?? null,
    route_position: num(r.route_position),
    created_by: String(r.created_by ?? ''),
    created_at: String(r.created_at ?? ''),
    updated_at: String(r.updated_at ?? ''),
  }
}

export type PlansLoad = { ready: boolean; plans: ServicePlan[] }

/** A customer's plans (or all of a company's), newest first. `ready: false` until the migration is applied. */
export async function loadServicePlans(admin: SupabaseClient, orgId: string, opts: { customerId?: string; ids?: string[]; templateId?: string } = {}): Promise<PlansLoad> {
  const out: ServicePlan[] = []
  for (let from = 0; ; from += PAGE) {
    let q = orgDb(admin, orgId).from('service_plans').select(SERVICE_PLAN_COLUMNS)
    if (opts.customerId) q = q.eq('customer_id', opts.customerId)
    if (opts.ids) q = q.in('id', opts.ids)
    if (opts.templateId) q = q.eq('template_id', opts.templateId)
    const { data, error } = await q.order('created_at', { ascending: false }).order('id').range(from, from + PAGE - 1)
    if (error) {
      if (!isServicePlansNotReadyError(error)) console.error('[service-plans] load failed', error)
      return { ready: false, plans: [] }
    }
    out.push(...((data ?? []) as Record<string, unknown>[]).map(planFromRow))
    if ((data ?? []).length < PAGE) break
  }
  return { ready: true, plans: out }
}

export async function loadServicePlan(admin: SupabaseClient, orgId: string, planId: string): Promise<ServicePlan | null> {
  if (typeof planId !== 'string' || !planId) return null
  const { data, error } = await orgDb(admin, orgId).from('service_plans').select(SERVICE_PLAN_COLUMNS).eq('id', planId).maybeSingle()
  if (error) {
    if (!isServicePlansNotReadyError(error)) console.error('[service-plans] load one failed', error)
    return null
  }
  return data ? planFromRow(data as Record<string, unknown>) : null
}

type Fail = { ok: false; status: number; error: string }
type Ref = { ok: true } | Fail

/** References in a save are this company's: the customer's own active property, an active trade, crews, people. */
async function checkRefs(admin: SupabaseClient, orgId: string, customerId: string | null, v: Partial<ServicePlanInput>): Promise<Ref> {
  const db = orgDb(admin, orgId)
  if (v.property_id !== undefined && customerId) {
    const { data } = await db.from('properties').select('id, active').eq('id', v.property_id).eq('customer_id', customerId).maybeSingle()
    if (!data) return { ok: false, status: 400, error: 'That property is not this customer’s' }
    if ((data as { active?: boolean }).active === false) return { ok: false, status: 400, error: 'That property is turned off' }
  }
  if (v.trade !== undefined) {
    const trades = await loadOrgTrades(admin, orgId)
    if (!trades.some((t) => t.slug === v.trade && t.active)) return { ok: false, status: 400, error: 'Pick one of your service types' }
  }
  const subIds = [v.default_sub_id, ...(v.steps ?? []).map((s) => s.subId)].filter((x): x is string => !!x)
  if (subIds.length) {
    const { data } = await db.from('sub_contractors').select('id').in('id', Array.from(new Set(subIds)))
    if ((data ?? []).length !== new Set(subIds).size) return { ok: false, status: 400, error: 'Pick one of your crews' }
  }
  const userIds = (v.steps ?? []).map((s) => s.userId).filter((x): x is string => !!x)
  if (userIds.length) {
    const { data } = await db.from('users').select('id').in('id', Array.from(new Set(userIds))).eq('active', true)
    if ((data ?? []).length !== new Set(userIds).size) return { ok: false, status: 400, error: 'Pick who does each follow-on step' }
  }
  return { ok: true }
}

/** Price from the plan's own rules: a tier's price if the home qualifies, else the typed (custom) price. */
function priced(v: Partial<ServicePlanInput>, base: Pick<ServicePlan, 'pricing' | 'tier_key' | 'price' | 'billing_basis' | 'pricing_inputs'> | null): { ok: true; value: Partial<ServicePlanInput> } | Fail {
  const touches = ['pricing', 'tier_key', 'price', 'billing_basis', 'pricing_inputs'].some((k) => k in v)
  if (!touches && base) return { ok: true, value: v }
  const pricing = v.pricing ?? base?.pricing ?? EMPTY_PRICING
  const r = resolvePlanPricing(
    {
      tier_key: 'tier_key' in v ? v.tier_key ?? null : base?.tier_key ?? null,
      price: 'price' in v ? v.price ?? null : base?.price ?? null,
      billing_basis: v.billing_basis ?? base?.billing_basis ?? 'per_visit',
      pricing_inputs: v.pricing_inputs ?? base?.pricing_inputs ?? {},
    },
    pricing
  )
  if (!r.ok) return { ok: false, status: 400, error: r.error }
  return { ok: true, value: { ...v, price: r.price, billing_basis: r.billing_basis, tier_key: r.tier_key } }
}

// ---------------------------------------------------------------------------------------------------------------------
// History (service_plan_changes; same shape as supplier_audit_log)
// ---------------------------------------------------------------------------------------------------------------------

export type ChangeAction = 'created' | 'updated' | 'paused' | 'resumed' | 'ended' | 'template_applied' | 'auto_resumed' | 'auto_ended'

/** Best-effort: a failed history write is logged, never undoes the change (same as the supplier log). */
async function writeChange(
  admin: SupabaseClient,
  orgId: string,
  row: { plan_id?: string | null; template_id?: string | null; action: ChangeAction; changed_by: string | null; changes: FieldChange[]; visit_effect?: VisitEffect | null }
): Promise<void> {
  const { error } = await orgDb(admin, orgId).from('service_plan_changes').insert({
    plan_id: row.plan_id ?? null,
    template_id: row.template_id ?? null,
    action: row.action,
    changed_by: row.changed_by,
    changes: row.changes,
    visit_effect: row.visit_effect ?? null,
  })
  if (error) console.error('[service-plans] history write failed', row.action, error)
}

export type HistoryEntry = { id: string; action: ChangeAction; at: string; by: string | null; lines: string[]; effect: VisitEffect | null }

/** A plan's (or template's) history, newest first, as lines people read. */
export async function loadChangeHistory(admin: SupabaseClient, orgId: string, subject: { planId?: string; templateId?: string }, limit = 100): Promise<HistoryEntry[]> {
  let q = orgDb(admin, orgId).from('service_plan_changes').select('id, action, changed_at, changed_by, changes, visit_effect')
  q = subject.planId ? q.eq('plan_id', subject.planId) : q.eq('template_id', subject.templateId ?? '')
  const { data, error } = await q.order('changed_at', { ascending: false }).limit(limit)
  if (error) return []
  const rows = (data ?? []) as Array<{ id: string; action: ChangeAction; changed_at: string; changed_by: string | null; changes: FieldChange[] | null; visit_effect: VisitEffect | null }>
  const userIds = Array.from(new Set(rows.map((r) => r.changed_by).filter((x): x is string => !!x)))
  const { data: users } = userIds.length ? await orgDb(admin, orgId).from('users').select('id, full_name').in('id', userIds) : { data: [] }
  const names = new Map(((users ?? []) as Array<{ id: string; full_name: string | null }>).map((u) => [u.id, u.full_name]))
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    at: r.changed_at,
    by: r.changed_by ? names.get(r.changed_by) ?? 'Someone' : null,
    lines: (r.changes ?? []).map(describeChange),
    effect: r.visit_effect,
  }))
}

/** Field changes for the history, with ids shown as names (crew, property) and big json as short words. */
function planChanges(before: ServicePlan, patch: Record<string, unknown>, names: { crews?: Map<string, string>; properties?: Map<string, string> } = {}): FieldChange[] {
  const show = (field: string, v: unknown): unknown => {
    if (v === null || v === undefined) return null
    if (field === 'default_sub_id') return names.crews?.get(String(v)) ?? v
    if (field === 'property_id') return names.properties?.get(String(v)) ?? v
    if (field === 'seasons') return (v as Season[]).map(seasonLabel)
    if (field === 'steps') return (v as Array<{ label: string }>).map((x) => x.label)
    if (field === 'pricing') return (v as { tiers: Array<{ label: string; price: number }> }).tiers.map((t) => `${t.label} $${t.price}`)
    return v
  }
  return diffFields(before as unknown as Record<string, unknown>, patch, PLAN_FIELD_LABELS).map((c) => ({ ...c, old: show(c.field, c.old), new: show(c.field, c.new) }))
}

async function nameMaps(admin: SupabaseClient, orgId: string, crewIds: Array<string | null | undefined>, propIds: Array<string | null | undefined>) {
  const db = orgDb(admin, orgId)
  const c = Array.from(new Set(crewIds.filter((x): x is string => !!x)))
  const p = Array.from(new Set(propIds.filter((x): x is string => !!x)))
  const [crews, props] = await Promise.all([
    c.length ? db.from('sub_contractors').select('id, company_name').in('id', c) : Promise.resolve({ data: [] }),
    p.length ? db.from('properties').select('id, label, address_text').in('id', p) : Promise.resolve({ data: [] }),
  ])
  return {
    crews: new Map(((crews.data ?? []) as Array<{ id: string; company_name: string | null }>).map((x) => [x.id, x.company_name ?? 'Crew'])),
    properties: new Map(((props.data ?? []) as Array<{ id: string; label: string | null; address_text: string }>).map((x) => [x.id, x.label || x.address_text])),
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Templates (owner-managed; a plan copies its template at sale)
// ---------------------------------------------------------------------------------------------------------------------

export function templateFromRow(r: Record<string, unknown>): ServicePlanTemplate {
  return {
    id: String(r.id),
    org_id: String(r.org_id),
    name: String(r.name ?? ''),
    trade: String(r.trade ?? ''),
    description: (r.description as string | null) ?? null,
    seasons: Array.isArray(r.seasons) ? (r.seasons as Season[]) : [],
    billing_basis: r.billing_basis === 'per_month' || r.billing_basis === 'per_year' ? r.billing_basis : 'per_visit',
    taxable: r.taxable === true,
    pricing: readPricing(r.pricing ?? {}),
    steps: readSteps(r.steps ?? []),
    active: r.active !== false,
    version: num(r.version) ?? 1,
    updated_at: String(r.updated_at ?? ''),
  }
}

export async function loadTemplates(admin: SupabaseClient, orgId: string, opts: { activeOnly?: boolean } = {}): Promise<{ ready: boolean; templates: ServicePlanTemplate[] }> {
  let q = orgDb(admin, orgId).from('service_plan_templates').select(TEMPLATE_COLUMNS)
  if (opts.activeOnly) q = q.eq('active', true)
  const { data, error } = await q.order('name')
  if (error) {
    if (!isServicePlansNotReadyError(error)) console.error('[service-plans] templates load failed', error)
    return { ready: false, templates: [] }
  }
  return { ready: true, templates: ((data ?? []) as Record<string, unknown>[]).map(templateFromRow) }
}

export async function loadTemplate(admin: SupabaseClient, orgId: string, id: string): Promise<ServicePlanTemplate | null> {
  if (typeof id !== 'string' || !id) return null
  const { data } = await orgDb(admin, orgId).from('service_plan_templates').select(TEMPLATE_COLUMNS).eq('id', id).maybeSingle()
  return data ? templateFromRow(data as Record<string, unknown>) : null
}

export type TemplateSave = { ok: true; template: ServicePlanTemplate } | Fail

/** Create or edit a template (owners). Each save bumps `version`; plans already sold keep their copy. */
export async function saveTemplate(admin: SupabaseClient, orgId: string, userId: string, id: string | null, body: unknown): Promise<TemplateSave> {
  const old = id ? await loadTemplate(admin, orgId, id) : null
  if (id && !old) return { ok: false, status: 404, error: 'Template not found' }
  const clean = cleanTemplateInput(body, !!old)
  if (!clean.ok) return { ok: false, status: 400, error: clean.error }
  const v = clean.value
  const refs = await checkRefs(admin, orgId, null, { trade: v.trade, steps: v.steps })
  if (!refs.ok) return refs
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const db = orgDb(admin, orgId)
  if (!old) {
    const { data, error } = await db
      .from('service_plan_templates')
      .insert({ ...v, created_by: userId, updated_by: userId })
      .select(TEMPLATE_COLUMNS)
      .single()
    if (error || !data) {
      if (isServicePlansNotReadyError(error)) return { ok: false, status: 503, error: SERVICE_PLANS_NOT_READY }
      console.error('[service-plans] template create failed', error)
      return { ok: false, status: 500, error: 'Could not save the template' }
    }
    const t = templateFromRow(data as Record<string, unknown>)
    await writeChange(admin, orgId, { template_id: t.id, action: 'created', changed_by: userId, changes: [] })
    return { ok: true, template: t }
  }
  const changes = diffFields(old as unknown as Record<string, unknown>, v as Record<string, unknown>, TEMPLATE_FIELD_LABELS)
  if (changes.length === 0) return { ok: true, template: old }
  let q = db.from('service_plan_templates').update({ ...v, version: old.version + 1, updated_by: userId }).eq('id', old.id)
  if (typeof b.expectedUpdatedAt === 'string') q = q.eq('updated_at', b.expectedUpdatedAt)
  const { data, error } = await q.select(TEMPLATE_COLUMNS)
  if (error) return { ok: false, status: 500, error: 'Could not save the template' }
  const row = (data ?? [])[0] as Record<string, unknown> | undefined
  if (!row) return { ok: false, status: 409, error: 'Someone just changed this template — refresh and try again' }
  await writeChange(admin, orgId, { template_id: old.id, action: 'updated', changed_by: userId, changes })
  return { ok: true, template: templateFromRow(row) }
}

/** A template's parts as plan values (what is copied at sale, or pushed later). Trade only at sale. */
export function templatePlanValues(t: ServicePlanTemplate, atSale: boolean): Partial<ServicePlanInput> & { template_id: string; template_version: number } {
  return {
    ...(atSale ? { trade: t.trade, name: t.name, description: t.description } : {}),
    seasons: t.seasons,
    billing_basis: t.billing_basis,
    taxable: t.taxable,
    pricing: t.pricing,
    steps: t.steps,
    template_id: t.id,
    template_version: t.version,
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Plans: create, edit (with preview), status changes, template push
// ---------------------------------------------------------------------------------------------------------------------

export type PlanSave = { ok: true; plan: ServicePlan; effect: VisitEffect; changes: FieldChange[] } | Fail
export type PlanPreview = { ok: true; preview: true; effect: VisitEffect; changes: FieldChange[]; summary: string } | Fail

/**
 * Sell a plan. With `template_id` the template is copied first (seasons, price rules, steps, billing, tax, name, trade)
 * and anything in the body overrides it for this one plan. The price comes from the plan's own rules.
 */
export async function createServicePlan(admin: SupabaseClient, orgId: string, userId: string, customerId: string, body: unknown, now = new Date()): Promise<PlanSave> {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  let base: Record<string, unknown> = {}
  if (typeof b.template_id === 'string' && b.template_id) {
    const t = await loadTemplate(admin, orgId, b.template_id)
    if (!t || !t.active) return { ok: false, status: 400, error: 'That plan template is not offered' }
    base = templatePlanValues(t, true)
  }
  const merged = { ...base, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) }
  const clean = cleanPlanInput(merged)
  if (!clean.ok) return { ok: false, status: 400, error: clean.error }
  const refs = await checkRefs(admin, orgId, customerId, clean.value)
  if (!refs.ok) return refs
  const p = priced(clean.value, null)
  if (!p.ok) return p
  const v = p.value as ServicePlanInput
  const { data, error } = await orgDb(admin, orgId)
    .from('service_plans')
    .insert({
      ...v,
      description: v.description ?? null,
      template_id: (base.template_id as string | undefined) ?? null,
      template_version: (base.template_version as number | undefined) ?? null,
      customer_id: customerId,
      status: 'active',
      created_by: userId,
      updated_by: userId,
    })
    .select(SERVICE_PLAN_COLUMNS)
    .single()
  if (error || !data) {
    if (isServicePlansNotReadyError(error)) return { ok: false, status: 503, error: SERVICE_PLANS_NOT_READY }
    console.error('[service-plans] create failed', error)
    return { ok: false, status: 500, error: 'Could not save the plan' }
  }
  const plan = planFromRow(data as Record<string, unknown>)
  const { created } = await ensureServiceVisits(admin, orgId, { now, planIds: [plan.id] })
  const effect = { removed: 0, added: created, updated: 0 }
  await writeChange(admin, orgId, { plan_id: plan.id, action: 'created', changed_by: userId, changes: [], visit_effect: effect })
  return { ok: true, plan, effect, changes: [] }
}

/** Pure-ish: the patch an edit or status change would make, or why not (validation + reference checks). */
async function planPatch(
  admin: SupabaseClient,
  orgId: string,
  old: ServicePlan,
  body: Record<string, unknown>,
  statusChange: PlanStatusChange | null,
  today: string,
  now: Date
): Promise<{ ok: true; patch: Record<string, unknown>; action: ChangeAction } | Fail> {
  if (old.status === 'ended') return { ok: false, status: 400, error: 'This plan has ended' }
  if (statusChange) {
    if (statusChange.action === 'pause') return { ok: true, patch: { status: 'paused', paused_until: statusChange.until }, action: 'paused' }
    if (statusChange.action === 'resume') return { ok: true, patch: { status: 'active', paused_until: null }, action: 'resumed' }
    const on = statusChange.on ?? today
    if (on < old.start_date) return { ok: false, status: 400, error: 'The end date is before the plan started' }
    // Ending in the future = an end date; ending today or earlier = ended now.
    return { ok: true, patch: on > today ? { end_date: on } : { status: 'ended', end_date: on, ended_at: now.toISOString(), paused_until: null }, action: on > today ? 'updated' : 'ended' }
  }
  const clean = cleanPlanInput(body, true)
  if (!clean.ok) return { ok: false, status: 400, error: clean.error }
  const v = clean.value
  const start = v.start_date ?? old.start_date
  const end = 'end_date' in v ? v.end_date ?? null : old.end_date
  if (end && end < start) return { ok: false, status: 400, error: 'End date is before the start date' }
  const refs = await checkRefs(admin, orgId, old.customer_id, v)
  if (!refs.ok) return refs
  const p = priced(v, old)
  if (!p.ok) return p
  // Keep only real changes, so the history and the preview say exactly what moved.
  const patch = Object.fromEntries(Object.entries(p.value).filter(([k, val]) => JSON.stringify((old as unknown as Record<string, unknown>)[k] ?? null) !== JSON.stringify(val ?? null)))
  return { ok: true, patch, action: 'updated' }
}

/** Future service visits of a plan with what the preview compares. */
async function futureVisits(admin: SupabaseClient, orgId: string, planId: string, today: string) {
  const { data, error } = await orgDb(admin, orgId)
    .from('work_orders')
    .select('id, visit_step, status, service_planned_date, scheduled_date, assigned_sub_id, completed_at, title, service_price, service_taxable, property_id')
    .eq('service_plan_id', planId)
    .eq('work_order_type', SERVICE_VISIT_TYPE)
    .eq('visit_step', SERVICE_STEP)
    .gte('service_planned_date', today)
  if (error) throw error
  return ((data ?? []) as Array<ExistingVisit & { title: string | null; service_price: unknown; service_taxable: boolean | null; property_id: string | null }>).map((v) => ({ ...v, service_price: num(v.service_price) }))
}

/**
 * Edit a plan or change its status. `preview: true` in the body = say what would change (fields + visits removed /
 * added / updated) and write nothing. Otherwise: save, bring future unstarted visits in line, top up the horizon and
 * write the history. Done / skipped visits and anything today or earlier never change. `expectedUpdatedAt` guards two
 * people saving at once.
 */
export async function updateServicePlan(
  admin: SupabaseClient,
  orgId: string,
  userId: string | null,
  planId: string,
  body: unknown,
  statusChange: PlanStatusChange | null,
  now = new Date(),
  opts: { action?: ChangeAction; extraPatch?: Record<string, unknown> } = {}
): Promise<PlanSave | PlanPreview> {
  const old = await loadServicePlan(admin, orgId, planId)
  if (!old) return { ok: false, status: 404, error: 'Plan not found' }
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  const timeZone = await loadOrgTimeZone(admin, orgId)
  const today = ymdInZone(now, timeZone)
  const made = await planPatch(admin, orgId, old, b, statusChange, today, now)
  if (!made.ok) return made
  // Server-set columns a body may never carry (e.g. the template version a push brings the plan to).
  const patch = { ...made.patch, ...(opts.extraPatch ?? {}) }
  const names = await nameMaps(admin, orgId, [old.default_sub_id, patch.default_sub_id as string | undefined], [old.property_id, patch.property_id as string | undefined])
  const changes = planChanges(old, patch, names)
  const next = { ...old, ...patch } as ServicePlan

  if (b.preview === true) {
    const effect = previewVisitEffect(await futureVisits(admin, orgId, old.id, today), old, next, today)
    return { ok: true, preview: true, effect, changes, summary: describeVisitEffect(effect) }
  }
  if (Object.keys(patch).length === 0) return { ok: false, status: 400, error: 'Nothing changed' }

  let q = orgDb(admin, orgId).from('service_plans').update({ ...patch, updated_by: userId }).eq('id', planId)
  if (typeof b.expectedUpdatedAt === 'string') q = q.eq('updated_at', b.expectedUpdatedAt)
  const { data, error } = await q.select(SERVICE_PLAN_COLUMNS)
  if (error) {
    console.error('[service-plans] update failed', error)
    return { ok: false, status: 500, error: 'Could not save the plan' }
  }
  const row = (data ?? [])[0] as Record<string, unknown> | undefined
  if (!row) return { ok: false, status: 409, error: 'Someone just changed this plan — refresh and try again' }
  const plan = planFromRow(row)
  const regen = await regenerateFutureVisits(admin, orgId, old, plan, today)
  const { created } = await ensureServiceVisits(admin, orgId, { now, planIds: [plan.id], timeZone })
  const effect: VisitEffect = { removed: regen.removed + regen.cancelled, added: created, updated: regen.updated }
  await writeChange(admin, orgId, { plan_id: plan.id, action: opts.action ?? made.action, changed_by: userId, changes, visit_effect: effect })
  return { ok: true, plan, effect, changes }
}

/**
 * Push a template's current version to plans sold from it (owners, on purpose). Copies seasons, price rules, steps,
 * billing and tax — never the plan's property, crew, day, name or dates. A plan on a tier gets the tier's new price if
 * the home still qualifies; otherwise it keeps its price as a custom price (listed in `needsPriceCheck`). Ended plans
 * are skipped. `preview` = totals only, nothing written.
 */
export async function applyTemplateToPlans(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  templateId: string,
  opts: { preview: boolean; planIds?: string[]; now?: Date }
): Promise<{ ok: true; plans: number; effect: VisitEffect; needsPriceCheck: string[]; summary: string } | Fail> {
  const t = await loadTemplate(admin, orgId, templateId)
  if (!t) return { ok: false, status: 404, error: 'Template not found' }
  const { plans } = await loadServicePlans(admin, orgId, { templateId })
  const targets = plans.filter((p) => p.status !== 'ended' && (p.template_version ?? 0) < t.version && (!opts.planIds || opts.planIds.includes(p.id)))
  const total: VisitEffect = { removed: 0, added: 0, updated: 0 }
  const needsPriceCheck: string[] = []
  for (const p of targets) {
    const { template_id: _t, template_version, ...values } = templatePlanValues(t, false) as Record<string, unknown>
    // The plan's price under the new rules: its tier's new price if the home still fits; otherwise it keeps what it pays,
    // as a custom price (allowed for this plan even if the template no longer sells custom), and the owner is told.
    const fits = resolvePlanPricing({ tier_key: p.tier_key, price: p.price, billing_basis: p.billing_basis, pricing_inputs: p.pricing_inputs }, t.pricing).ok
    if (!fits) {
      values.tier_key = null
      values.pricing = { ...t.pricing, allowCustom: true }
      needsPriceCheck.push(p.name)
    }
    if (!fits || !p.tier_key) {
      values.price = p.price
      values.billing_basis = p.billing_basis
    }
    const r = await updateServicePlan(admin, orgId, userId, p.id, { ...values, preview: opts.preview }, null, opts.now, { action: 'template_applied', extraPatch: { template_version } })
    if (!r.ok) {
      if (r.status === 400 && r.error === 'Nothing changed') continue
      return r
    }
    total.removed += r.effect.removed
    total.added += r.effect.added
    total.updated += r.effect.updated
  }
  const summary = `${targets.length} plan${targets.length === 1 ? '' : 's'}: ${describeVisitEffect(total)}${needsPriceCheck.length ? ` ${needsPriceCheck.length} no longer fit their price tier and keep their current price — check them.` : ''}`
  return { ok: true, plans: targets.length, effect: total, needsPriceCheck, summary }
}

/**
 * After an edit: future unstarted visits whose slot the new schedule dropped are removed (cancelled instead when they
 * hold photos), kept ones get the new name / price / property / crew (a crew picked by hand stays). The generator then
 * adds the new slots. Visits today or earlier, and every done / skipped / cancelled visit, are left exactly as they are.
 */
export async function regenerateFutureVisits(admin: SupabaseClient, orgId: string, old: ServicePlan, plan: ServicePlan, today: string): Promise<{ removed: number; cancelled: number; updated: number }> {
  const db = orgDb(admin, orgId)
  const visits = await futureVisits(admin, orgId, plan.id, addDaysYmd(today, 1))
  const tomorrow = addDaysYmd(today, 1)
  const newDates = new Set(planVisitDates(plan, tomorrow, addDaysYmd(today, 3650)))
  const { remove, keep } = regenerationPlan(visits, newDates, today)

  let cancelled = 0
  if (remove.length) {
    const { data: withPhotos, error: pErr } = await db.from('photos').select('work_order_id').in('work_order_id', remove).is('deleted_at', null)
    if (pErr) throw pErr
    const photoIds = new Set(((withPhotos ?? []) as Array<{ work_order_id: string }>).map((p) => p.work_order_id))
    const del = remove.filter((id) => !photoIds.has(id))
    const cancel = remove.filter((id) => photoIds.has(id))
    // Only rows still unstarted at the moment of the write (a crew may have just tapped "done").
    if (del.length) {
      const { error: dErr } = await db.from('work_orders').delete().in('id', del).eq('status', 'scheduled').is('completed_at', null)
      if (dErr) throw dErr
    }
    if (cancel.length) {
      const { error: cErr } = await db.from('work_orders').update({ status: 'cancelled' }).in('id', cancel).eq('status', 'scheduled')
      if (cErr) throw cErr
      cancelled = cancel.length
    }
  }

  let updated = 0
  if (keep.length) {
    const address = plan.property_id !== old.property_id ? await propertyAddressFields(admin, orgId, [plan.property_id]) : null
    const base: Record<string, unknown> = { title: plan.name, description: plan.description, service_price: visitPrice(plan), service_taxable: plan.taxable }
    if (address) Object.assign(base, { property_id: plan.property_id, ...(address.get(plan.property_id) ?? {}) })
    // Group by the crew each visit should end up with (one update per crew value).
    const byCrew = new Map<string, string[]>()
    for (const v of keep) {
      const crew = crewAfterEdit(v.assigned_sub_id, old.default_sub_id, plan.default_sub_id) ?? ''
      byCrew.set(crew, [...(byCrew.get(crew) ?? []), v.id])
    }
    for (const [crew, ids] of Array.from(byCrew.entries())) {
      const { error: uErr } = await db
        .from('work_orders')
        .update({ ...base, assigned_sub_id: crew || null })
        .in('id', ids)
        .eq('status', 'scheduled')
      if (uErr) throw uErr
    }
    // Count only visits that actually differ (same rule as the preview).
    updated = previewVisitEffect(keep as Parameters<typeof previewVisitEffect>[0], old, plan, today).updated
  }
  return { removed: remove.length - cancelled, cancelled, updated }
}

/** Address columns for visit rows, from the property (work_orders keeps its own copy for the older lists). */
async function propertyAddressFields(admin: SupabaseClient, orgId: string, propertyIds: string[]): Promise<Map<string, Record<string, string | null>>> {
  const out = new Map<string, Record<string, string | null>>()
  for (let i = 0; i < propertyIds.length; i += 200) {
    const { data, error } = await orgDb(admin, orgId).from('properties').select('id, address_line1, city, state, zip, address_text').in('id', propertyIds.slice(i, i + 200))
    if (error) throw error
    for (const p of (data ?? []) as Array<Record<string, string | null>>) {
      out.set(String(p.id), { address: p.address_line1 || p.address_text, city: p.city ?? null, state: p.state ?? null, zip: p.zip ?? null })
    }
  }
  return out
}

/**
 * THE visit generator. For each active plan (and paused plans whose resume date has come — they flip back to active
 * here), every planned date from today to the horizon that has no visit row yet gets one. Idempotent: a slot that
 * already has a row — in any status, on any day it was moved to — is never created again.
 */
export async function ensureServiceVisits(
  admin: SupabaseClient,
  orgId: string,
  opts: { now?: Date; timeZone?: string; planIds?: string[] } = {}
): Promise<{ created: number; resumed: number }> {
  const now = opts.now ?? new Date()
  const timeZone = opts.timeZone ?? (await loadOrgTimeZone(admin, orgId))
  const today = ymdInZone(now, timeZone)
  const { from, to } = visitHorizon(today)
  const db = orgDb(admin, orgId)

  const { ready, plans: all } = await loadServicePlans(admin, orgId, opts.planIds ? { ids: opts.planIds } : {})
  if (!ready) return { created: 0, resumed: 0 }

  // A pause whose resume date has come ends here (the plan reads "active" again everywhere).
  let resumed = 0
  for (const p of all.filter((x) => x.status === 'paused' && x.paused_until && x.paused_until <= today)) {
    const { data, error } = await db.from('service_plans').update({ status: 'active', paused_until: null }).eq('id', p.id).eq('status', 'paused').select('id')
    if (error) throw error
    if ((data ?? []).length) {
      resumed += 1
      await writeChange(admin, orgId, { plan_id: p.id, action: 'auto_resumed', changed_by: null, changes: [{ field: 'status', label: PLAN_FIELD_LABELS.status, old: 'paused', new: 'active' }] })
      p.status = 'active'
      p.paused_until = null
    }
  }

  // A plan whose end date has passed is ended (the card and every list then say so).
  for (const p of all.filter((x) => x.status !== 'ended' && x.end_date && x.end_date < today)) {
    const { data: ended, error } = await db.from('service_plans').update({ status: 'ended', ended_at: now.toISOString(), paused_until: null }).eq('id', p.id).neq('status', 'ended').select('id')
    if (error) throw error
    if ((ended ?? []).length) await writeChange(admin, orgId, { plan_id: p.id, action: 'auto_ended', changed_by: null, changes: [{ field: 'status', label: PLAN_FIELD_LABELS.status, old: p.status, new: 'ended' }] })
    p.status = 'ended'
  }

  const plans = all.filter((p) => p.status !== 'ended')
  const wanted = plans.map((p) => ({ plan: p, dates: planVisitDates(p, from, to) })).filter((x) => x.dates.length)
  if (wanted.length === 0) return { created: 0, resumed }

  const planIds = wanted.map((w) => w.plan.id)
  const have = new Set<string>()
  for (let i = 0; i < planIds.length; i += 200) {
    for (let page = 0; ; page += PAGE) {
      const { data, error } = await db
        .from('work_orders')
        .select('service_plan_id, service_planned_date')
        .in('service_plan_id', planIds.slice(i, i + 200))
        .eq('visit_step', SERVICE_STEP)
        .gte('service_planned_date', from)
        .order('id')
        .range(page, page + PAGE - 1)
      if (error) throw error
      for (const r of (data ?? []) as Array<{ service_plan_id: string; service_planned_date: string }>) have.add(`${r.service_plan_id}|${r.service_planned_date}`)
      if ((data ?? []).length < PAGE) break
    }
  }

  const addresses = await propertyAddressFields(admin, orgId, Array.from(new Set(wanted.map((w) => w.plan.property_id))))
  const rows = wanted.flatMap(({ plan, dates }) =>
    dates
      .filter((d) => !have.has(`${plan.id}|${d}`))
      .map((d) => ({
        work_order_type: SERVICE_VISIT_TYPE,
        visit_step: SERVICE_STEP,
        status: 'scheduled',
        priority: 'normal',
        service_plan_id: plan.id,
        service_planned_date: d,
        scheduled_date: d,
        service_price: visitPrice(plan),
        service_taxable: plan.taxable,
        customer_id: plan.customer_id,
        property_id: plan.property_id,
        trade: plan.trade,
        assigned_sub_id: plan.default_sub_id,
        title: plan.name,
        description: plan.description,
        created_by: plan.created_by,
        ...(addresses.get(plan.property_id) ?? {}),
      }))
  )
  let created = 0
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await db
      .from('work_orders')
      .upsert(rows.slice(i, i + 500), { onConflict: VISIT_SLOT_CONFLICT, ignoreDuplicates: true })
      .select('id')
    if (error) throw error
    created += (data ?? []).length
  }
  return { created, resumed }
}

// ---------------------------------------------------------------------------------------------------------------------
// Visits: read, act, move
// ---------------------------------------------------------------------------------------------------------------------

export type VisitView = {
  id: string
  workOrderNumber: string | null
  planId: string
  planName: string
  status: string
  scheduledDate: string
  plannedDate: string
  moved: boolean
  trade: string
  customerId: string | null
  customerName: string | null
  propertyId: string | null
  address: string | null
  lat: number | null
  lng: number | null
  /** Gate codes etc. `null` when the viewer may not see them. */
  accessNotes: string | null
  subId: string | null
  subName: string | null
  routePosition: number | null
  /** 'service' = the plan's own visit; otherwise a follow-on step's key (its label in `stepLabel`). */
  step: string
  stepLabel: string | null
  /** The recorded result of a follow-on step, and the options the plan gives that step (empty = none asked). */
  result: StepResultOption | null
  resultOptions: StepResultOption[]
  /** A staff person (the follow-on inspector), when the visit is a person's rather than a crew's. */
  userId: string | null
  userName: string | null
  skipReason: string | null
  notes: string | null
  completedAt: string | null
  photoCount: number
  updatedAt: string
}

const VISIT_COLS =
  'id, work_order_number, service_plan_id, visit_step, step_result, status, scheduled_date, service_planned_date, trade, customer_id, property_id, assigned_sub_id, assigned_user_id, skip_reason, completion_notes, completed_at, updated_at, address, title'

/** Visits on [from, to] (by the day they sit on), ordered by day, then the crew's stop number, then address. */
export async function loadVisits(
  admin: SupabaseClient,
  orgId: string,
  opts: { from: string; to: string; subId?: string | null; userId?: string; planId?: string; customerId?: string; ids?: string[]; accessNotes: boolean; limit?: number }
): Promise<VisitView[]> {
  const db = orgDb(admin, orgId)
  let q = db.from('work_orders').select(VISIT_COLS).eq('work_order_type', SERVICE_VISIT_TYPE).gte('scheduled_date', opts.from).lte('scheduled_date', opts.to)
  if (opts.subId === null) q = q.is('assigned_sub_id', null)
  else if (opts.subId) q = q.eq('assigned_sub_id', opts.subId)
  if (opts.userId) q = q.eq('assigned_user_id', opts.userId)
  if (opts.planId) q = q.eq('service_plan_id', opts.planId)
  if (opts.customerId) q = q.eq('customer_id', opts.customerId)
  if (opts.ids) q = q.in('id', opts.ids)
  const { data, error } = await q.order('scheduled_date').limit(opts.limit ?? 2000)
  if (error) {
    if (isServicePlansNotReadyError(error)) return []
    throw error
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>
  if (rows.length === 0) return []
  const ids = rows.map((r) => String(r.id))
  const uniq = (k: string) => Array.from(new Set(rows.map((r) => r[k]).filter((v): v is string => typeof v === 'string' && !!v)))
  const planIds = uniq('service_plan_id')
  const custIds = uniq('customer_id')
  const propIds = uniq('property_id')
  const subIds = uniq('assigned_sub_id')
  const userIds = uniq('assigned_user_id')
  const [plans, custs, props, subs, photos, users] = await Promise.all([
    db.from('service_plans').select('id, name, route_position, steps').in('id', planIds),
    custIds.length ? db.from('customers').select('id, name').in('id', custIds) : Promise.resolve({ data: [], error: null }),
    propIds.length ? db.from('properties').select('id, address_text, lat, lng, access_notes').in('id', propIds) : Promise.resolve({ data: [], error: null }),
    subIds.length ? db.from('sub_contractors').select('id, company_name').in('id', subIds) : Promise.resolve({ data: [], error: null }),
    db.from('photos').select('work_order_id').in('work_order_id', ids).is('deleted_at', null),
    userIds.length ? db.from('users').select('id, full_name').in('id', userIds) : Promise.resolve({ data: [], error: null }),
  ])
  for (const r of [plans, custs, props, subs, photos, users]) if (r.error) throw r.error
  const userBy = new Map(((users.data ?? []) as Array<{ id: string; full_name: string | null }>).map((u) => [u.id, u.full_name]))
  const planBy = new Map(((plans.data ?? []) as Array<{ id: string; name: string; route_position: number | null; steps: unknown }>).map((p) => [p.id, { ...p, steps: readSteps(p.steps) }]))
  const custBy = new Map(((custs.data ?? []) as Array<{ id: string; name: string | null }>).map((c) => [c.id, c.name]))
  const propBy = new Map(((props.data ?? []) as Array<{ id: string; address_text: string; lat: unknown; lng: unknown; access_notes: string | null }>).map((p) => [p.id, p]))
  const subBy = new Map(((subs.data ?? []) as Array<{ id: string; company_name: string | null }>).map((s) => [s.id, s.company_name]))
  const photoCount = new Map<string, number>()
  for (const p of (photos.data ?? []) as Array<{ work_order_id: string }>) photoCount.set(p.work_order_id, (photoCount.get(p.work_order_id) ?? 0) + 1)

  const views: VisitView[] = rows.map((r) => {
    const plan = planBy.get(String(r.service_plan_id))
    const prop = r.property_id ? propBy.get(String(r.property_id)) : undefined
    return {
      id: String(r.id),
      workOrderNumber: (r.work_order_number as string | null) ?? null,
      planId: String(r.service_plan_id),
      planName: plan?.name ?? String(r.title ?? ''),
      status: String(r.status),
      scheduledDate: String(r.scheduled_date),
      plannedDate: String(r.service_planned_date),
      moved: r.scheduled_date !== r.service_planned_date,
      trade: String(r.trade ?? ''),
      customerId: (r.customer_id as string | null) ?? null,
      customerName: r.customer_id ? custBy.get(String(r.customer_id)) ?? null : null,
      propertyId: (r.property_id as string | null) ?? null,
      address: prop?.address_text ?? ((r.address as string | null) ?? null),
      lat: num(prop?.lat),
      lng: num(prop?.lng),
      accessNotes: opts.accessNotes ? prop?.access_notes ?? null : null,
      subId: (r.assigned_sub_id as string | null) ?? null,
      subName: r.assigned_sub_id ? subBy.get(String(r.assigned_sub_id)) ?? null : null,
      routePosition: plan?.route_position ?? null,
      step: String(r.visit_step ?? SERVICE_STEP),
      ...(() => {
        const st = plan?.steps.find((x) => x.key === r.visit_step)
        const options = st?.results ?? []
        const key = (r.step_result as string | null) ?? null
        return {
          stepLabel: st?.label ?? (r.visit_step && r.visit_step !== SERVICE_STEP ? String(r.visit_step) : null),
          resultOptions: options,
          result: key ? options.find((o) => o.key === key) ?? { key, label: key, tone: 'neutral' as const } : null,
        }
      })(),
      userId: (r.assigned_user_id as string | null) ?? null,
      userName: r.assigned_user_id ? userBy.get(String(r.assigned_user_id)) ?? null : null,
      skipReason: (r.skip_reason as string | null) ?? null,
      notes: (r.completion_notes as string | null) ?? null,
      completedAt: (r.completed_at as string | null) ?? null,
      photoCount: photoCount.get(String(r.id)) ?? 0,
      updatedAt: String(r.updated_at ?? ''),
    }
  })
  return sortVisits(views)
}

/** Day, then stop number (unnumbered last), then address. */
export function sortVisits<T extends Pick<VisitView, 'scheduledDate' | 'routePosition' | 'address' | 'id'>>(v: T[]): T[] {
  return [...v].sort(
    (a, b) =>
      a.scheduledDate.localeCompare(b.scheduledDate) ||
      (a.routePosition ?? 10_000) - (b.routePosition ?? 10_000) ||
      (a.address ?? '').localeCompare(b.address ?? '') ||
      a.id.localeCompare(b.id)
  )
}

export type VisitActResult = { ok: true } | { ok: false; status: 400 | 404 | 409; error: string }

/**
 * One visit action (done, skip, reopen, move, assign). `onlySubId` limits it to one crew's visits (the crew phone link).
 * Optimistic: only if nobody changed the visit since it was read.
 */
export async function applyVisitAction(
  admin: SupabaseClient,
  orgId: string,
  visitId: string,
  a: VisitAction,
  by: { userId: string | null; subId: string | null },
  opts: { onlySubId?: string; now?: Date } = {}
): Promise<VisitActResult> {
  const db = orgDb(admin, orgId)
  let q = db
    .from('work_orders')
    .select('id, status, scheduled_date, updated_at, visit_step, service_plan_id, service_planned_date')
    .eq('id', visitId)
    .eq('work_order_type', SERVICE_VISIT_TYPE)
  if (opts.onlySubId) q = q.eq('assigned_sub_id', opts.onlySubId)
  const { data: row } = await q.maybeSingle()
  if (!row) return { ok: false, status: 404, error: 'Visit not found' }
  const r = row as { id: string; status: string; scheduled_date: string | null; updated_at: string; visit_step: string | null; service_plan_id: string; service_planned_date: string }
  if (a.action === 'assign' && a.subId) {
    const { data: sub } = await db.from('sub_contractors').select('id').eq('id', a.subId).maybeSingle()
    if (!sub) return { ok: false, status: 400, error: 'Pick one of your crews' }
  }
  // A follow-on step's result options come from the plan (its own copy of the template's steps).
  let results: string[] = []
  if ((r.visit_step ?? SERVICE_STEP) !== SERVICE_STEP && a.action === 'done') {
    const plan = await loadServicePlan(admin, orgId, r.service_plan_id)
    results = stepResultKeys(plan?.steps ?? [], r.visit_step)
  }
  const patch = visitPatch({ ...r, results }, a, by, opts.now ?? new Date())
  if ('error' in patch) return { ok: false, status: 400, error: patch.error as string }
  const { data: updated, error } = await db.from('work_orders').update(patch).eq('id', visitId).eq('updated_at', r.updated_at).select('id')
  if (error) return { ok: false, status: 409, error: 'Could not save' }
  if (!updated || updated.length === 0) return { ok: false, status: 409, error: 'Someone just changed this visit — refresh and try again' }
  if (a.action === 'done') {
    // The visit stands even if the follow-on can't be made; ops sees the missing step on the Visits list.
    await createFollowUpVisit(admin, orgId, r, opts.now ?? new Date()).catch((e) => console.error('[service-plans] follow-up failed', visitId, e))
  }
  return { ok: true }
}

/** After a visit is done: the plan's next step (e.g. the inspector's visit after a cleaning), once per slot and step. */
async function createFollowUpVisit(
  admin: SupabaseClient,
  orgId: string,
  parent: { id: string; visit_step: string | null; service_plan_id: string; service_planned_date: string },
  now: Date
): Promise<void> {
  const plan = await loadServicePlan(admin, orgId, parent.service_plan_id)
  if (!plan) return
  const today = ymdInZone(now, await loadOrgTimeZone(admin, orgId))
  const f = followUpVisitFields(plan.steps, parent, today)
  if (!f) return
  const { title_suffix, ...fields } = f
  const addr = await propertyAddressFields(admin, orgId, [plan.property_id])
  const { error } = await orgDb(admin, orgId)
    .from('work_orders')
    .upsert(
      {
        ...fields,
        work_order_type: SERVICE_VISIT_TYPE,
        status: 'scheduled',
        priority: 'normal',
        service_plan_id: plan.id,
        customer_id: plan.customer_id,
        property_id: plan.property_id,
        trade: plan.trade,
        title: `${plan.name} — ${title_suffix}`,
        created_by: plan.created_by,
        ...(addr.get(plan.property_id) ?? {}),
      },
      { onConflict: VISIT_SLOT_CONFLICT, ignoreDuplicates: true }
    )
  if (error) throw error
}

/**
 * The rain / hurricane button: move every SCHEDULED visit sitting on [from, to] (optionally one crew's, or the
 * unassigned ones) by `days`. Done / skipped visits stay where they happened. The planned slot is unchanged, so the
 * generator never puts a moved visit back. Returns how many moved.
 */
export async function bulkShiftVisits(admin: SupabaseClient, orgId: string, s: BulkShift): Promise<{ moved: number }> {
  const db = orgDb(admin, orgId)
  let q = db.from('work_orders').select('id, scheduled_date').eq('work_order_type', SERVICE_VISIT_TYPE).eq('status', 'scheduled').gte('scheduled_date', s.from).lte('scheduled_date', s.to)
  if (s.subId === null) q = q.is('assigned_sub_id', null)
  else if (s.subId !== 'all') q = q.eq('assigned_sub_id', s.subId)
  const { data, error } = await q.limit(5000)
  if (error) throw error
  const byDay = new Map<string, string[]>()
  for (const r of (data ?? []) as Array<{ id: string; scheduled_date: string }>) byDay.set(r.scheduled_date, [...(byDay.get(r.scheduled_date) ?? []), r.id])
  let moved = 0
  // One update per source day. Every row in it moves to the same new day; status re-checked at write time.
  for (const [day, ids] of Array.from(byDay.entries())) {
    for (let i = 0; i < ids.length; i += 200) {
      const { data: done, error: uErr } = await db
        .from('work_orders')
        .update({ scheduled_date: addDaysYmd(day, s.days) })
        .in('id', ids.slice(i, i + 200))
        .eq('status', 'scheduled')
        .eq('scheduled_date', day)
        .select('id')
      if (uErr) throw uErr
      moved += (done ?? []).length
    }
  }
  return { moved }
}

// ---------------------------------------------------------------------------------------------------------------------
// Crew phone link (/crew/day/<token>)
// ---------------------------------------------------------------------------------------------------------------------

const CREW_DAY_TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/

export function newCrewDayToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Buffer.from(bytes).toString('base64url')
}

export type CrewDay = { orgId: string; subId: string; crewName: string }

/** Who a crew phone link belongs to, or null (bad or rotated token, or a crew that was turned off). */
export async function resolveCrewDay(admin: SupabaseClient, token: string, now = new Date()): Promise<CrewDay | null> {
  if (typeof token !== 'string' || !CREW_DAY_TOKEN_RE.test(token)) return null
  // org-scope-ok: lookup by a secret token column; the row names its own company, which every later query uses
  const { data, error } = await admin.from('crew_day_links').select('org_id, sub_id, expires_at').eq('token', token).maybeSingle()
  if (error || !data) return null
  const link = data as { org_id: string; sub_id: string; expires_at: string | null }
  // An expired link is dead even before anyone replaces it (it shows gate codes).
  if (!link.expires_at || Date.parse(link.expires_at) <= now.getTime()) return null
  const { data: sub } = await orgDb(admin, link.org_id).from('sub_contractors').select('id, company_name, active').eq('id', link.sub_id).maybeSingle()
  const s = sub as { id: string; company_name: string | null; active: boolean | null } | null
  if (!s || s.active === false) return null
  return { orgId: link.org_id, subId: s.id, crewName: s.company_name ?? 'Crew' }
}

/** Days a crew phone link works before it must be made again. */
export const CREW_DAY_LINK_DAYS = 30

/** Crews with a link that still works (never returns the token — it is shown once, when made). */
export async function crewDayLinkSubIds(admin: SupabaseClient, orgId: string, now = new Date()): Promise<Set<string>> {
  const { data, error } = await orgDb(admin, orgId).from('crew_day_links').select('sub_id, expires_at').gt('expires_at', now.toISOString())
  if (error) return new Set()
  return new Set(((data ?? []) as Array<{ sub_id: string }>).map((r) => r.sub_id))
}

/** Make (or replace) a crew's phone link. The old link stops working at once. */
export async function rotateCrewDayToken(
  admin: SupabaseClient,
  orgId: string,
  subId: string,
  userId: string
): Promise<{ ok: true; token: string; expiresInDays: number } | { ok: false; status: number; error: string }> {
  const db = orgDb(admin, orgId)
  const { data: sub } = await db.from('sub_contractors').select('id').eq('id', subId).maybeSingle()
  if (!sub) return { ok: false, status: 404, error: 'Crew not found' }
  const token = newCrewDayToken()
  const now = new Date()
  const { error } = await db
    .from('crew_day_links')
    .upsert({ sub_id: subId, token, created_by: userId, created_at: now.toISOString(), expires_at: new Date(now.getTime() + CREW_DAY_LINK_DAYS * 86_400_000).toISOString() }, { onConflict: 'org_id,sub_id' })
  if (error) {
    if (isServicePlansNotReadyError(error)) return { ok: false, status: 503, error: SERVICE_PLANS_NOT_READY }
    console.error('[service-plans] crew link failed', error)
    return { ok: false, status: 500, error: 'Could not make the link' }
  }
  return { ok: true, token, expiresInDays: CREW_DAY_LINK_DAYS }
}

/** A crew may act on its own service visits from yesterday and today only (a late "done" is fine; the future is not). */
export const CREW_VISIT_PHOTO_LIMIT = 20
const CREW_VISIT_UNFINISHED_LIMIT = 10

export async function loadCrewVisit(admin: SupabaseClient, crew: CrewDay, visitId: string, now = new Date()): Promise<{ id: string; status: string } | null> {
  if (typeof visitId !== 'string' || !visitId) return null
  const today = ymdInZone(now, await loadOrgTimeZone(admin, crew.orgId))
  const { data } = await orgDb(admin, crew.orgId)
    .from('work_orders')
    .select('id, status')
    .eq('id', visitId)
    .eq('work_order_type', SERVICE_VISIT_TYPE)
    .eq('assigned_sub_id', crew.subId)
    .gte('scheduled_date', addDaysYmd(today, -1))
    .lte('scheduled_date', today)
    .maybeSingle()
  return (data as { id: string; status: string } | null) ?? null
}

/** Why a crew may not start another photo upload on a visit, or null. Fails closed (public endpoint). */
export async function crewVisitUploadRefusal(admin: SupabaseClient, orgId: string, visitId: string): Promise<string | null> {
  const { FILES_BUCKET, visitPhotoFolder } = await import('@/lib/files/storage')
  const [{ count, error }, { data: objects, error: listError }] = await Promise.all([
    orgDb(admin, orgId).from('photos').select('id', { count: 'exact', head: true }).eq('work_order_id', visitId),
    admin.storage.from(FILES_BUCKET).list(visitPhotoFolder(orgId, visitId), { limit: 200 }),
  ])
  if (error || listError) return 'Couldn’t start the upload — try again.'
  if ((count ?? 0) >= CREW_VISIT_PHOTO_LIMIT) return `That’s the most photos for one visit (${CREW_VISIT_PHOTO_LIMIT}).`
  if ((objects ?? []).length - (count ?? 0) >= CREW_VISIT_UNFINISHED_LIMIT) return 'Too many unfinished uploads on this visit — try again later.'
  return null
}

// ---------------------------------------------------------------------------------------------------------------------
// The invoicing hook
// ---------------------------------------------------------------------------------------------------------------------

export type BillableVisit = {
  visitId: string
  planId: string
  customerId: string | null
  propertyId: string | null
  completedAt: string
  servedOn: string
  /** Per-visit plans: the price snapshot taken when the visit was planned. Per-month plans: null (bill the plan). */
  price: number | null
}

/**
 * THE read the invoicing builder starts from (not built yet): visits marked done whose completion falls in
 * [fromIso, toIso). Per-visit plans bill each row at its `price`; per-month plans bill the plan's price for each month
 * with at least one done visit (or every active month — the builder's call). Skipped / cancelled visits never bill.
 * The builder records what it billed on its own rows; nothing here is ever rewritten.
 */
export async function loadCompletedServiceVisits(admin: SupabaseClient, orgId: string, fromIso: string, toIso: string): Promise<BillableVisit[]> {
  const out: BillableVisit[] = []
  for (let page = 0; ; page += PAGE) {
    const { data, error } = await orgDb(admin, orgId)
      .from('work_orders')
      .select('id, service_plan_id, customer_id, property_id, completed_at, scheduled_date, service_price')
      .eq('work_order_type', SERVICE_VISIT_TYPE)
      .eq('status', 'completed')
      .gte('completed_at', fromIso)
      .lt('completed_at', toIso)
      .order('id')
      .range(page, page + PAGE - 1)
    if (error) throw error
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      out.push({
        visitId: String(r.id),
        planId: String(r.service_plan_id),
        customerId: (r.customer_id as string | null) ?? null,
        propertyId: (r.property_id as string | null) ?? null,
        completedAt: String(r.completed_at),
        servedOn: String(r.scheduled_date),
        price: num(r.service_price),
      })
    }
    if ((data ?? []).length < PAGE) break
  }
  return out
}
