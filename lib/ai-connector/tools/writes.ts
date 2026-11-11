/**
 * Phase 2 write tools. Each one only PREPARES a change (`prepare`: the person's own permission + the exact preview) and,
 * once the person confirms, SAVES it through the app's existing writer (`apply`). No new write path lives here:
 *   add_note / log_contact → postMessage · create_lead → createLeadRecord · create_customer → upsertCustomer ·
 *   reschedule_visit → applyVisitAction · add_cost_line → addJobCostLine · draft_invoice → createServiceInvoiceFromLines ·
 *   draft_purchase_order → savePoDraft.
 * Never here: payments, payroll, sending anything (email, text, invoice, order), deleting, permissions, settings, cancelling.
 * Text typed by the AI is stored as plain text: control characters and anything that looks like an HTML tag are removed.
 */
import { z } from 'zod'

import { writeTool } from '@/lib/ai-connector/changes'
import { ID, ToolError, type ChangePreview, type McpTool, type ToolContext } from '@/lib/ai-connector/tools/types'
import { ownCustomerIds } from '@/lib/ai-connector/tools/contact-scope'
import { loadOrgTimeZone } from '@/lib/cron-orgs'
import { CONTACT_KINDS, CONTACT_KIND_LABELS, CONTACT_OUTCOME_LABELS, OUTCOMES_FOR_KIND, type ContactKind, type ContactOutcome } from '@/lib/customer-contact'
import { findExistingCustomer, upsertCustomer } from '@/lib/customers'
import { effectiveHasPermission, resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { createServiceInvoiceFromLines } from '@/lib/invoices'
import { hasAtMost2Decimals, lineTotalCents } from '@/lib/invoice-lines'
import { authorizeJobCost, parseCostInput } from '@/lib/job-cost-record'
import { addJobCostLine, JOB_COST_TYPES, signedCostAmount } from '@/lib/job-cost-ledger'
import { MANUAL_LEAD_SOURCES } from '@/lib/lead-sources'
import { createLeadRecord } from '@/lib/leads-create'
import { canEditCustomerRecordsFromPermissionNames } from '@/lib/permissions'
import { formatMoney, parsePoDraft, poTotalCents, PO_MAX_LINES } from '@/lib/purchase-orders'
import { resolvePoAccess } from '@/lib/purchase-orders-access'
import { loadPoTarget, savePoDraft } from '@/lib/purchase-orders-db'
import { computeCustomerSalesTax } from '@/lib/sales-tax-server'
import { addDaysYmd, isYmd, ymdInZone } from '@/lib/service-plans'
import { canBillService } from '@/lib/service-billing-access'
import { loadVisitsPage, applyVisitAction } from '@/lib/service-plans-db'
import { resolveServicePlanAccess } from '@/lib/service-plans-access'
import { orgDb } from '@/lib/supabase/org-db'
import { canOpenDeal } from '@/lib/threads/api'
import { dealRefOf, loadDeal } from '@/lib/threads/get-thread'
import { postMessage } from '@/lib/threads/post-message'
import { resolveThreadViewer } from '@/lib/threads/viewer'
import { isFieldRole, looksLikePricing, writableAudiences, type Audience } from '@/lib/threads/visibility'

/* ---- shared helpers -------------------------------------------------------------------------------------------------- */

/** Plain text only: control characters and anything shaped like an HTML tag are removed, then length is capped. */
export function cleanText(s: string): string {
  return (
    s
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .replace(/<[^>]*>/g, '')
      .replace(/[<>]/g, '')
      .trim()
  )
}
const plain = (max: number, min = 1) =>
  z
    .string()
    .max(max * 4)
    .transform(cleanText)
    .pipe(z.string().min(min).max(max))
const optPlain = (max: number) => plain(max, 0).optional()
const ymd = z.string().refine(isYmd, 'Use YYYY-MM-DD')
const dollars = (max: number) => z.number().finite().min(0).max(max)

const link = (label: string, path: string) => ({ label, path })

/** Field roles (setters, canvassers, inside sales) never get money, production or customer-record edits through the AI either. */
async function notFieldRole(ctx: ToolContext) {
  const viewer = await resolveThreadViewer(ctx.admin, ctx.profile)
  if (isFieldRole(viewer)) throw new ToolError('denied', 'Your role cannot make this change in the app, so the AI cannot either.', 'field_role')
  return viewer
}

/** Everything the AI writes into a conversation carries this, so a reader can tell it did not come from the person typing. */
const aiTag = (ctx: ToolContext) => `Written by AI (via ${ctx.clientName ?? 'an AI app'})`
const AI_TAG_WARNING = 'It will be marked "Written by AI" with the app\'s name. @names in it are plain text: nobody is pinged or notified.'

const REFUSED = 'You do not have permission to make this change in the app, so the AI cannot either.'

/* ---- notes + contact log (postMessage) ------------------------------------------------------------------------------- */

const NOTE_AUDIENCES = ['team', 'sales', 'production'] as const // never crew (leaves the building on the crew link) or customer (shown to the customer)

/** team first; else the first of sales / production the person may write. Pure + deterministic. */
export function pickAudience(allowed: readonly Audience[], requested: (typeof NOTE_AUDIENCES)[number] | undefined): Audience | null {
  if (requested) return allowed.includes(requested) ? requested : null
  return (NOTE_AUDIENCES as readonly Audience[]).find((a) => allowed.includes(a)) ?? null
}
const AUDIENCE_WORDS: Record<string, string> = { team: 'The team (everyone who can open this deal)', sales: 'Sales people on this deal', production: 'Production / job-board people' }

async function dealGate(ctx: ToolContext, dealId: string, requested: (typeof NOTE_AUDIENCES)[number] | undefined) {
  const viewer = await resolveThreadViewer(ctx.admin, ctx.profile)
  const deal = await loadDeal(ctx.admin, ctx.orgId, dealId)
  // The same two doors as the Customer File: who may open the deal, then which audiences this person may write.
  if (!deal || !canOpenDeal(viewer, deal)) throw new ToolError('not_found')
  const audience = pickAudience(writableAudiences(viewer, dealRefOf(deal)), requested)
  if (!audience) throw new ToolError('denied', requested ? `You cannot write ${requested} notes on this deal.` : 'You cannot post on this deal.', 'audience')
  return { viewer, deal, audience }
}
const dealLinks = (deal: { id: string; customer_id: string | null; lead_id: string | null }, tab = 'notes') =>
  deal.customer_id ? [link('Open the deal', `/c/${deal.customer_id}/d/${deal.id}/${tab}`)] : deal.lead_id ? [link('Open the lead', `/c/lead/${deal.lead_id}`)] : []

const noteSchema = z.object({ deal_id: z.string().regex(ID), text: plain(2000), audience: z.enum(NOTE_AUDIENCES).optional() }).strict()

export const addNote = writeTool({
  name: 'add_note',
  title: 'Add a note to a deal',
  description: 'Adds a note (plain text, up to 2000 characters) to a deal\'s conversation as the signed-in person. It never notifies or emails anyone, even if the text has an @name.',
  inputSchema: {
    type: 'object',
    properties: {
      deal_id: { type: 'string', description: 'Deal (opportunity) id' },
      text: { type: 'string', maxLength: 2000, description: 'The note, plain text' },
      audience: { type: 'string', enum: [...NOTE_AUDIENCES], description: 'Who can read it (default: the team). Only audiences this person may write are accepted.' },
    },
    required: ['deal_id', 'text'],
    additionalProperties: false,
  },
  schema: noteSchema,
  write: {
    idempotent: true,
    async prepare(ctx, a): Promise<ChangePreview> {
      const g = await dealGate(ctx, a.deal_id, a.audience)
      const warnings: string[] = []
      if (looksLikePricing(a.text)) warnings.push('This looks like it contains prices, so it will be hidden from setters.')
      warnings.push(AI_TAG_WARNING)
      return {
        title: 'Add a note',
        lines: [
          { label: 'Deal', value: g.deal.address_text || 'Deal' },
          { label: 'Who can read it', value: AUDIENCE_WORDS[g.audience] ?? g.audience },
          { label: 'Note', value: a.text },
        ],
        links: dealLinks(g.deal),
        recordIds: [g.deal.id],
        warnings,
      }
    },
    async apply(ctx, a, changeId) {
      const g = await dealGate(ctx, a.deal_id, a.audience)
      // The one write path for deal conversations. No notifyMessage: an AI app never sends email or push.
      const res = await postMessage(ctx.admin, ctx.profile, g.deal, { body: `${aiTag(ctx)}: ${a.text}`, audience: g.audience, clientId: changeId, source: 'ai_connector', surface: 'other', noMentions: true }, { viewer: g.viewer })
      if (!res.ok) throw new ToolError(res.status === 403 || res.status === 404 ? 'denied' : 'bad_input', res.error, 'post_refused')
      return { summary: 'Note added.', links: dealLinks(g.deal), recordIds: [g.deal.id, res.message.id] }
    },
  },
})

const contactSchema = z
  .object({
    deal_id: z.string().regex(ID),
    kind: z.enum(CONTACT_KINDS),
    outcome: z.enum(['reached', 'voicemail', 'no_answer', 'sent', 'replied']),
    note: optPlain(1000),
  })
  .strict()
  .refine((a) => (OUTCOMES_FOR_KIND[a.kind as ContactKind] as readonly string[]).includes(a.outcome), { message: 'That outcome does not fit that kind of contact' })

export const logContact = writeTool({
  name: 'log_contact',
  title: 'Log a call, text, email or visit',
  description: 'Records that the person ALREADY contacted a customer (a call, text, email or visit) and how it went, on the deal. It does not call, text or email anyone.',
  inputSchema: {
    type: 'object',
    properties: {
      deal_id: { type: 'string', description: 'Deal (opportunity) id' },
      kind: { type: 'string', enum: [...CONTACT_KINDS] },
      outcome: { type: 'string', enum: ['reached', 'voicemail', 'no_answer', 'sent', 'replied'], description: 'call: reached / voicemail / no_answer; text and email: sent / replied; visit: reached / no_answer' },
      note: { type: 'string', maxLength: 1000, description: 'Optional detail, plain text' },
    },
    required: ['deal_id', 'kind', 'outcome'],
    additionalProperties: false,
  },
  schema: contactSchema,
  write: {
    idempotent: true,
    async prepare(ctx, a): Promise<ChangePreview> {
      const g = await dealGate(ctx, a.deal_id, undefined)
      return {
        title: 'Log a contact',
        lines: [
          { label: 'Deal', value: g.deal.address_text || 'Deal' },
          { label: 'What happened', value: `${CONTACT_KIND_LABELS[a.kind as ContactKind]} — ${CONTACT_OUTCOME_LABELS[a.outcome as ContactOutcome]}` },
          ...(a.note ? [{ label: 'Note', value: a.note }] : []),
        ],
        links: dealLinks(g.deal),
        recordIds: [g.deal.id],
        warnings: ['This only records a contact that already happened. Nothing is sent to the customer.', AI_TAG_WARNING],
      }
    },
    async apply(ctx, a, changeId) {
      const g = await dealGate(ctx, a.deal_id, undefined)
      const res = await postMessage(ctx.admin, ctx.profile, g.deal, { body: a.note ? `${a.note} (${aiTag(ctx)})` : aiTag(ctx), noMentions: true, contact: { kind: a.kind as ContactKind, outcome: a.outcome as ContactOutcome }, clientId: changeId, source: 'ai_connector', surface: 'other' }, { viewer: g.viewer })
      if (!res.ok) throw new ToolError(res.status === 403 || res.status === 404 ? 'denied' : 'bad_input', res.error, 'post_refused')
      return { summary: 'Contact logged.', links: dealLinks(g.deal), recordIds: [g.deal.id, res.message.id] }
    },
  },
})

/* ---- lead + customer ------------------------------------------------------------------------------------------------- */

const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/
const leadSources = MANUAL_LEAD_SOURCES.map((s) => s.value) as [string, ...string[]]
const contactFields = {
  name: optPlain(120),
  phone: optPlain(40),
  email: plain(254, 0).refine((v) => v === '' || EMAIL.test(v), 'Check the email address').optional(),
  address: optPlain(300),
}
const leadSchema = z.object({ ...contactFields, notes: optPlain(2000), source: z.enum(leadSources).optional() }).strict().refine((a) => !!(a.name || a.phone || a.email || a.address), { message: 'Give at least a name, phone, email or address' })

/** A matching existing customer is shown only to people who may see customer records (a setter must not learn who owns a phone number). */
async function matchFor(ctx: ToolContext, a: { name?: string; phone?: string; email?: string; address?: string }): Promise<{ id: string; name: string | null } | 'hidden' | null> {
  const viewer = await resolveThreadViewer(ctx.admin, ctx.profile)
  if (isFieldRole(viewer) || !(a.email || a.phone || (a.name && a.address))) return null
  const m = (await findExistingCustomer(ctx.admin, ctx.orgId, { name: a.name ?? '', email: a.email || null, phone: a.phone || null, address_text: a.address || null })) as { id: string; name: string | null } | null
  return m ? await visibleOrHidden(ctx, m) : null
}

const POSSIBLE_DUPLICATE = 'A possible duplicate already exists. Ask the office before adding this.'

/** The existing customer is named or linked ONLY if this person may open that record (the read tools' own rule); otherwise it is reported without a name or id. */
async function visibleOrHidden<T extends { id: string }>(ctx: ToolContext, m: T): Promise<T | 'hidden'> {
  const own = await ownCustomerIds(ctx, [m.id])
  return own === null || own.has(m.id) ? m : 'hidden'
}

async function mayCreateLeads(ctx: ToolContext) {
  const perms = await resolveEffectivePermissionNames(ctx.admin, ctx.userId, ctx.profile as never)
  if (!effectiveHasPermission(perms, 'leads:create')) throw new ToolError('denied', REFUSED, 'no_permission')
}

export const createLead = writeTool({
  name: 'create_lead',
  title: 'Add a lead',
  description: 'Adds a new lead (a possible customer) owned by the signed-in person. Give at least a name, phone, email or address.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', maxLength: 120 },
      phone: { type: 'string', maxLength: 40 },
      email: { type: 'string', maxLength: 254 },
      address: { type: 'string', maxLength: 300, description: 'Property address' },
      notes: { type: 'string', maxLength: 2000 },
      source: { type: 'string', enum: leadSources, description: 'Where the lead came from (default: other)' },
    },
    additionalProperties: false,
  },
  schema: leadSchema,
  write: {
    async prepare(ctx, a): Promise<ChangePreview> {
      await mayCreateLeads(ctx)
      const m = await matchFor(ctx, a)
      return {
        title: 'Add a lead',
        lines: [
          ...(a.name ? [{ label: 'Name', value: a.name }] : []),
          ...(a.phone ? [{ label: 'Phone', value: a.phone }] : []),
          ...(a.email ? [{ label: 'Email', value: a.email }] : []),
          ...(a.address ? [{ label: 'Address', value: a.address }] : []),
          ...(a.notes ? [{ label: 'Notes', value: a.notes }] : []),
          { label: 'Source', value: a.source ?? 'other' },
          { label: 'Owner', value: 'You (the signed-in person)' },
        ],
        links: m && m !== 'hidden' ? [link('Existing customer with the same details', `/c/${m.id}`)] : [],
        recordIds: m && m !== 'hidden' ? [m.id] : [],
        warnings: m === 'hidden' ? [POSSIBLE_DUPLICATE] : m ? [`A customer with these details is already on file (${m.name ?? 'unnamed'}). Make sure you want a separate lead.`] : [],
      }
    },
    async apply(ctx, a) {
      await mayCreateLeads(ctx)
      const made = await createLeadRecord(ctx.admin, ctx.orgId, ctx.userId, { homeowner_name: a.name, phone: a.phone, email: a.email, address_text: a.address, notes: a.notes, source: a.source ?? 'other' })
      if (!made.ok) throw new ToolError('bad_input', 'The lead could not be saved.', 'insert_failed')
      return { summary: 'Lead added.', links: [link('Open the lead', `/c/lead/${made.id}`)], recordIds: [made.id] }
    },
  },
})

const customerSchema = z.object({ name: plain(120), phone: optPlain(40), email: contactFields.email, address: optPlain(300) }).strict()

async function mayEditCustomers(ctx: ToolContext) {
  await notFieldRole(ctx)
  const perms = await resolveEffectivePermissionNames(ctx.admin, ctx.profile.id, ctx.profile as never)
  if (!canEditCustomerRecordsFromPermissionNames(perms)) throw new ToolError('denied', REFUSED, 'no_permission')
}

export const createCustomer = writeTool({
  name: 'create_customer',
  title: 'Add a customer',
  description: 'Adds a customer record. If a customer with the same email, phone or name + address already exists, that one is reused and only its blank fields are filled — nothing is overwritten.',
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string', maxLength: 120 }, phone: { type: 'string', maxLength: 40 }, email: { type: 'string', maxLength: 254 }, address: { type: 'string', maxLength: 300 } },
    required: ['name'],
    additionalProperties: false,
  },
  schema: customerSchema,
  write: {
    async prepare(ctx, a): Promise<ChangePreview> {
      await mayEditCustomers(ctx)
      const found = (await findExistingCustomer(ctx.admin, ctx.orgId, { name: a.name, email: a.email || null, phone: a.phone || null, address_text: a.address || null })) as { id: string; name: string | null; email: string | null; phone: string | null; address_text: string | null } | null
      // The caller's own access check comes FIRST: a customer this person cannot open is never named, linked, described or filled.
      const seen = found ? await visibleOrHidden(ctx, found) : null
      if (seen === 'hidden') throw new ToolError('bad_input', POSSIBLE_DUPLICATE, 'possible_duplicate')
      const m = seen
      if (!m) {
        return {
          title: 'Add a customer',
          lines: [{ label: 'Name', value: a.name }, ...(a.phone ? [{ label: 'Phone', value: a.phone }] : []), ...(a.email ? [{ label: 'Email', value: a.email }] : []), ...(a.address ? [{ label: 'Address', value: a.address }] : [])],
          links: [],
          recordIds: [],
        }
      }
      const fills = [!m.email && a.email ? 'email' : null, !m.phone && a.phone ? 'phone' : null, !m.address_text && a.address ? 'address' : null, !m.name && a.name ? 'name' : null].filter((x): x is string => !!x)
      return {
        title: 'Customer already on file',
        lines: [{ label: 'Existing customer', value: m.name ?? 'Unnamed' }, { label: 'Will fill if blank', value: fills.length ? fills.join(', ') : 'nothing (no new details)' }],
        links: [link('Open the customer', `/c/${m.id}`)],
        recordIds: [m.id],
        warnings: ['No new customer is created. Nothing already on the record is changed.'],
      }
    },
    async apply(ctx, a) {
      await mayEditCustomers(ctx)
      const r = await upsertCustomer(ctx.admin, ctx.orgId, { name: a.name, email: a.email || null, phone: a.phone || null, address_text: a.address || null })
      return { summary: r.created ? 'Customer added.' : 'Customer already existed; blank details filled.', links: [link('Open the customer', `/c/${r.customer_id}`)], recordIds: [r.customer_id] }
    },
  },
})

/* ---- service visit date ---------------------------------------------------------------------------------------------- */

const visitSchema = z.object({ visit_id: z.string().regex(ID), date: ymd }).strict()

async function visitGate(ctx: ToolContext, visitId: string, date: string) {
  const viewer = await resolveThreadViewer(ctx.admin, ctx.profile)
  const access = await resolveServicePlanAccess(ctx.admin, ctx.userId, ctx.profile)
  // Same door as moving a visit on the Visits screen: service plans on and jobs:edit; never a field role.
  if (!access.feature || isFieldRole(viewer) || !access.edit) throw new ToolError('denied', REFUSED, 'no_permission')
  const page = await loadVisitsPage(ctx.admin, ctx.orgId, { from: '2000-01-01', to: '2100-01-01', ids: [visitId], accessNotes: false, limit: 1 })
  const visit = page.visits[0]
  if (!visit) throw new ToolError('not_found')
  if (visit.status !== 'scheduled') throw new ToolError('bad_input', 'Only a scheduled visit can be moved.', 'not_scheduled')
  const today = ymdInZone(new Date(ctx.now ?? Date.now()), await loadOrgTimeZone(ctx.admin, ctx.orgId))
  if (date < today) throw new ToolError('bad_input', 'Pick today or a later day.', 'in_past')
  if (date > addDaysYmd(today, 366)) throw new ToolError('bad_input', 'Pick a day within the next year.', 'too_far')
  if (date === visit.scheduledDate) throw new ToolError('bad_input', 'The visit is already on that day.', 'same_day')
  return visit
}

export const rescheduleVisit = writeTool({
  name: 'reschedule_visit',
  title: 'Move a service visit to another day',
  description: 'Moves one scheduled recurring-service visit (mowing, cleaning, care plan) to another day. Only the day changes; the crew stays. Visits that are done, skipped or billed cannot be moved. Install-crew scheduling is not available here.',
  inputSchema: {
    type: 'object',
    properties: { visit_id: { type: 'string', description: 'Visit id from list_visits' }, date: { type: 'string', description: 'New day, YYYY-MM-DD (today or later, within a year)' } },
    required: ['visit_id', 'date'],
    additionalProperties: false,
  },
  schema: visitSchema,
  destructive: true,
  write: {
    async prepare(ctx, a): Promise<ChangePreview> {
      const v = await visitGate(ctx, a.visit_id, a.date)
      return {
        title: 'Move a visit',
        lines: [
          { label: 'Visit', value: `${v.workOrderNumber ?? 'Visit'} — ${v.planName}` },
          { label: 'Customer', value: v.customerName ?? 'Unknown' },
          ...(v.address ? [{ label: 'Address', value: v.address }] : []),
          { label: 'From', value: v.scheduledDate },
          { label: 'To', value: a.date },
        ],
        links: v.customerId ? [link('Open the customer', `/c/${v.customerId}`)] : [],
        recordIds: [v.id],
        warnings: ['If automatic reminders are turned on for this company, the customer\'s reminder follows the new day.'],
      }
    },
    async apply(ctx, a) {
      const v = await visitGate(ctx, a.visit_id, a.date)
      const res = await applyVisitAction(ctx.admin, ctx.orgId, v.id, { action: 'move', date: a.date }, { userId: ctx.userId, subId: null })
      if (!res.ok) throw new ToolError(res.status === 404 ? 'not_found' : 'bad_input', res.error, 'move_refused')
      return { summary: `Visit moved to ${a.date}.`, links: v.customerId ? [link('Open the customer', `/c/${v.customerId}`)] : [], recordIds: [v.id] }
    },
  },
})

/* ---- cost line ------------------------------------------------------------------------------------------------------- */

const costSchema = z.object({ job_id: z.string().regex(ID), description: plain(200), amount: z.number().finite().gt(0).max(10_000_000), cost_type: z.enum(JOB_COST_TYPES).optional(), credit: z.boolean().optional() }).strict()

export const addCostLine = writeTool({
  name: 'add_cost_line',
  title: 'Add a cost to a job',
  description: 'Adds one cost (materials, labor, permit, ...) to a job\'s cost list in dollars. It is added as unapproved. For a return or refund set credit true. The lender fee cannot be added this way.',
  inputSchema: {
    type: 'object',
    properties: {
      job_id: { type: 'string', description: 'Job id from find_job' },
      description: { type: 'string', maxLength: 200 },
      amount: { type: 'number', exclusiveMinimum: 0, description: 'Dollars, above zero' },
      cost_type: { type: 'string', enum: [...JOB_COST_TYPES], description: 'Default: other' },
      credit: { type: 'boolean', description: 'True for a return / credit (stored as a negative cost)' },
    },
    required: ['job_id', 'description', 'amount'],
    additionalProperties: false,
  },
  schema: costSchema,
  write: {
    async prepare(ctx, a): Promise<ChangePreview> {
      await notFieldRole(ctx)
      const gate = await authorizeJobCost(ctx.admin, ctx.profile, a.job_id)
      if (!gate.ok) throw new ToolError(gate.status === 404 ? 'not_found' : 'denied', gate.status === 404 ? undefined : REFUSED, 'no_permission')
      const input = parseCostInput({ description: a.description, amount: a.amount, cost_type: a.cost_type, credit: a.credit })
      if (!input.ok) throw new ToolError('bad_input', input.error, 'bad_cost')
      const { data: same } = await orgDb(ctx.admin, ctx.orgId).from('job_cost_lines').select('id').eq('job_id', a.job_id).eq('description', input.value.description).eq('amount', input.value.credit ? -input.value.amount : input.value.amount).is('deleted_at', null).limit(1)
      return {
        title: input.value.credit ? 'Add a credit to a job' : 'Add a cost to a job',
        lines: [
          { label: 'Job', value: [gate.job.job_number, gate.job.address_text].filter(Boolean).join(' — ') || 'Job' },
          { label: 'What', value: input.value.description },
          { label: 'Type', value: input.value.costType },
          { label: 'Amount', value: formatMoney(Math.round(signedCostAmount(input.value.amount, input.value.credit) * 100)) },
        ],
        links: [link('Open the job', `/ops/jobs/${a.job_id}`)],
        recordIds: [a.job_id],
        warnings: ['Added as unapproved.', ...((same ?? []).length > 0 ? ['A cost with the same text and amount is already on this job.'] : [])],
      }
    },
    async apply(ctx, a) {
      await notFieldRole(ctx)
      const gate = await authorizeJobCost(ctx.admin, ctx.profile, a.job_id)
      if (!gate.ok) throw new ToolError(gate.status === 404 ? 'not_found' : 'denied', gate.status === 404 ? undefined : REFUSED, 'no_permission')
      const input = parseCostInput({ description: a.description, amount: a.amount, cost_type: a.cost_type, credit: a.credit })
      if (!input.ok) throw new ToolError('bad_input', input.error, 'bad_cost')
      const written = await addJobCostLine(ctx.admin, { orgId: ctx.orgId, jobId: a.job_id, userId: ctx.userId, description: input.value.description, amount: input.value.amount, costType: input.value.costType, credit: input.value.credit, vendorId: null, source: 'manual' })
      if (!written.ok) throw new ToolError('bad_input', 'The cost could not be saved.', 'insert_failed')
      return { summary: 'Cost added (unapproved).', links: [link('Open the job', `/ops/jobs/${a.job_id}`)], recordIds: [a.job_id, written.line.id] }
    },
  },
})

/* ---- draft invoice --------------------------------------------------------------------------------------------------- */

const invoiceLine = z.object({ description: plain(200), qty: z.number().finite().gt(0).max(10_000).refine(hasAtMost2Decimals, 'Quantity can have at most 2 decimals'), unit_price: dollars(1_000_000).refine(hasAtMost2Decimals, 'Prices are in dollars and cents'), taxable: z.boolean().optional() }).strict()
const invoiceSchema = z.object({ customer_id: z.string().regex(ID), property_id: z.string().regex(ID).optional(), lines: z.array(invoiceLine).min(1).max(20) }).strict()

async function invoiceGate(ctx: ToolContext, a: z.infer<typeof invoiceSchema>) {
  await notFieldRole(ctx)
  // Same door as Ready to bill / the customer's invoice list: service plans on AND money:record.
  const { feature, bill } = await canBillService(ctx.admin, ctx.profile as never)
  if (!feature || !bill) throw new ToolError('denied', REFUSED, 'no_permission')
  const db = orgDb(ctx.admin, ctx.orgId)
  const { data: customer } = await db.from('customers').select('id, name').eq('id', a.customer_id).maybeSingle()
  if (!customer) throw new ToolError('not_found')
  if (a.property_id) {
    const { data: prop } = await db.from('properties').select('id, address_text').eq('id', a.property_id).eq('customer_id', a.customer_id).maybeSingle()
    if (!prop) throw new ToolError('not_found')
  }
  const lines = a.lines.map((l) => ({ description: l.description, qty: l.qty, unit_price_cents: Math.round(l.unit_price * 100), taxable: l.taxable === true }))
  const tax = await computeCustomerSalesTax(ctx.admin, ctx.orgId, a.customer_id, lines.map((l) => ({ amountCents: lineTotalCents(l.qty, l.unit_price_cents), taxable: l.taxable })))
  const total = tax.subtotalCents + tax.taxCents
  if (total <= 0) throw new ToolError('bad_input', 'The invoice total must be above zero.', 'zero_total')
  return { customer: customer as { id: string; name: string | null }, lines, tax, total }
}

export const draftInvoice = writeTool({
  name: 'draft_invoice',
  title: 'Start a draft invoice for a customer',
  description: 'Creates a DRAFT invoice (not tied to a job) for a customer with up to 20 lines in dollars. It is never sent or charged; a person reviews and sends it in the app. Sales tax is worked out by the app.',
  inputSchema: {
    type: 'object',
    properties: {
      customer_id: { type: 'string', description: 'Customer id from find_customer' },
      property_id: { type: 'string', description: 'Optional property id of that customer' },
      lines: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: {
          type: 'object',
          properties: { description: { type: 'string', maxLength: 200 }, qty: { type: 'number', exclusiveMinimum: 0 }, unit_price: { type: 'number', minimum: 0, description: 'Dollars per unit' }, taxable: { type: 'boolean', description: 'Charge sales tax on this line (default false)' } },
          required: ['description', 'qty', 'unit_price'],
          additionalProperties: false,
        },
      },
    },
    required: ['customer_id', 'lines'],
    additionalProperties: false,
  },
  schema: invoiceSchema,
  write: {
    async prepare(ctx, a): Promise<ChangePreview> {
      const g = await invoiceGate(ctx, a)
      return {
        title: 'Start a draft invoice',
        lines: [
          { label: 'Customer', value: g.customer.name ?? 'Customer' },
          ...g.lines.map((l, i) => ({ label: `Line ${i + 1}`, value: `${l.description} — ${l.qty} × ${formatMoney(l.unit_price_cents)} = ${formatMoney(lineTotalCents(l.qty, l.unit_price_cents))}${l.taxable ? ' (taxable)' : ''}` })),
          { label: 'Subtotal', value: formatMoney(g.tax.subtotalCents) },
          { label: 'Sales tax', value: formatMoney(g.tax.taxCents) },
          { label: 'Total', value: formatMoney(g.total) },
        ],
        links: [link('Open the customer', `/c/${g.customer.id}`)],
        recordIds: [g.customer.id],
        warnings: ['A draft only. It is not sent or charged; a person reviews and sends it in the app.'],
      }
    },
    async apply(ctx, a) {
      const g = await invoiceGate(ctx, a)
      const made = await createServiceInvoiceFromLines(ctx.admin, ctx.orgId, { customerId: g.customer.id, propertyId: a.property_id ?? null, createdBy: ctx.userId, lines: g.lines })
      if (!made.invoiceId) throw new ToolError('bad_input', 'The invoice could not be made.', 'not_created')
      const { data: row } = await orgDb(ctx.admin, ctx.orgId).from('job_invoices').select('invoice_number, status').eq('id', made.invoiceId).maybeSingle()
      const r = row as { invoice_number?: string; status?: string } | null
      return { summary: `Draft invoice ${r?.invoice_number ?? ''} for ${formatMoney(g.total)} created${r?.status && r.status !== 'draft' ? ` (status ${r.status})` : ' (not sent)'}.`.replace('  ', ' '), links: [link('Open the customer', `/c/${g.customer.id}`)], recordIds: [g.customer.id, made.invoiceId] }
    },
  },
})

/* ---- draft purchase order -------------------------------------------------------------------------------------------- */

const poLine = z.object({ description: plain(200), quantity: z.number().finite().gt(0).max(1_000_000), unit: optPlain(20), unit_cost: dollars(1_000_000).optional(), cost_type: z.enum(JOB_COST_TYPES).optional() }).strict()
const poSchema = z.object({ job_id: z.string().regex(ID), vendor_id: z.string().regex(ID), lines: z.array(poLine).min(1).max(PO_MAX_LINES), delivery_date: ymd.optional(), note: optPlain(1000) }).strict()

async function poGate(ctx: ToolContext, a: z.infer<typeof poSchema>) {
  await notFieldRole(ctx)
  const access = await resolvePoAccess(ctx.admin, ctx.userId, ctx.profile as never)
  if (!access.canEdit) throw new ToolError('denied', REFUSED, 'no_permission')
  const target = await loadPoTarget(ctx.admin, ctx.orgId, { jobId: a.job_id })
  if (!target) throw new ToolError('not_found')
  if (target.cancelled) throw new ToolError('bad_input', 'This job is cancelled, so orders cannot be made.', 'job_cancelled')
  const db = orgDb(ctx.admin, ctx.orgId)
  const { data: vendor } = await db.from('vendors').select('id, name, active, deleted_at').eq('id', a.vendor_id).maybeSingle()
  const v = vendor as { id: string; name: string | null; active: boolean | null; deleted_at: string | null } | null
  if (!v || v.deleted_at || v.active === false) throw new ToolError('not_found')
  // The app keeps ONE order per vendor per job and saving to it replaces its items. An AI draft only ever STARTS one.
  const { data: existing } = await db.from('supplier_orders').select('id, po_number').eq('kind', 'general').eq('vendor_id', a.vendor_id).eq('job_id', a.job_id).is('work_order_id', null).limit(1)
  const ex = ((existing ?? []) as Array<{ id: string; po_number: string | null }>)[0]
  if (ex) throw new ToolError('bad_input', `There is already an order for this vendor on this job (${ex.po_number ?? 'PO'}). Change it on the job page; an AI app only starts new drafts.`, 'po_exists')
  const parsed = parsePoDraft({ vendorId: a.vendor_id, lines: a.lines.map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit || null, unitCost: l.unit_cost ?? 0, costType: l.cost_type ?? 'material' })), date: a.delivery_date ?? null, dateKind: 'delivery', note: a.note ?? null })
  if (!parsed.ok) throw new ToolError('bad_input', parsed.error, 'bad_po')
  return { target, vendor: v, draft: parsed.value }
}

export const draftPurchaseOrder = writeTool({
  name: 'draft_purchase_order',
  title: 'Start a draft purchase order on a job',
  description: 'Starts a DRAFT purchase order to a vendor for a job (items, quantities, optional prices in dollars, optional delivery day). It is never sent; a person reviews and sends it in the app. Only for a vendor that has no order on that job yet.',
  inputSchema: {
    type: 'object',
    properties: {
      job_id: { type: 'string', description: 'Job id from find_job' },
      vendor_id: { type: 'string', description: 'Vendor id (a vendor already in the company list)' },
      lines: {
        type: 'array',
        minItems: 1,
        maxItems: PO_MAX_LINES,
        items: {
          type: 'object',
          properties: { description: { type: 'string', maxLength: 200 }, quantity: { type: 'number', exclusiveMinimum: 0 }, unit: { type: 'string', maxLength: 20 }, unit_cost: { type: 'number', minimum: 0, description: 'Dollars per unit (optional)' }, cost_type: { type: 'string', enum: [...JOB_COST_TYPES], description: 'Default: material' } },
          required: ['description', 'quantity'],
          additionalProperties: false,
        },
      },
      delivery_date: { type: 'string', description: 'Wanted delivery day, YYYY-MM-DD (optional)' },
      note: { type: 'string', maxLength: 1000, description: 'Note to the vendor (optional)' },
    },
    required: ['job_id', 'vendor_id', 'lines'],
    additionalProperties: false,
  },
  schema: poSchema,
  write: {
    async prepare(ctx, a): Promise<ChangePreview> {
      const g = await poGate(ctx, a)
      return {
        title: 'Start a draft purchase order',
        lines: [
          { label: 'Job', value: [g.target.reference, g.target.address].filter(Boolean).join(' — ') },
          { label: 'Vendor', value: g.vendor.name ?? 'Vendor' },
          ...g.draft.lines.map((l, i) => ({ label: `Item ${i + 1}`, value: `${l.description} — ${l.quantity}${l.unit ? ` ${l.unit}` : ''}${l.unitCostCents ? ` × ${formatMoney(l.unitCostCents)}` : ''}` })),
          { label: 'Total', value: formatMoney(poTotalCents(g.draft.lines)) },
          ...(g.draft.date ? [{ label: 'Delivery', value: g.draft.date }] : []),
          ...(g.draft.note ? [{ label: 'Note', value: g.draft.note }] : []),
        ],
        links: [link('Open the job', `/ops/jobs/${a.job_id}`)],
        recordIds: [a.job_id, a.vendor_id],
        warnings: ['A draft only. It is not sent to the vendor; a person reviews and sends it in the app.'],
      }
    },
    async apply(ctx, a) {
      const g = await poGate(ctx, a)
      const saved = await savePoDraft(ctx.admin, g.target, ctx.userId, g.draft, null, { createOnly: true })
      if (!saved.ok) throw new ToolError(saved.status === 404 ? 'not_found' : 'bad_input', saved.message, 'po_refused')
      return { summary: 'Draft purchase order created (not sent).', links: [link('Open the job', `/ops/jobs/${a.job_id}`)], recordIds: [a.job_id, saved.id] }
    },
  },
})

export const WRITE_TOOLS: readonly McpTool[] = [addNote, logContact, createLead, createCustomer, rescheduleVisit, addCostLine, draftInvoice, draftPurchaseOrder] as unknown as readonly McpTool[]
