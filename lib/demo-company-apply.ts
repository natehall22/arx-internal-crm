/**
 * Writes the demo company's sample data (lib/demo-company-data.ts) into ONE demo org. Called by the company seed
 * (lib/company-seed.ts `runCompanySeed` with `demo`), after the org, owner, trades and permission presets exist.
 *
 * It uses the app's OWN writers wherever one exists (customers, properties, custom fields, plans and visits, visit actions,
 * rain-day shift, crews, time entries, invoices, payments, purchase orders, thread messages, the customer-messages run), so
 * the sample data is shaped exactly like real data. Where no writer is practical to run from a script (a quote approval
 * needs a PDF and a signing page) rows are inserted directly and marked as sample data.
 *
 * Every section runs on its own: one that cannot run (a migration not applied here) is reported as skipped and the rest
 * still go. Refuses anything but a demo org (`assertDemoOrg`). Passwords are generated here and returned for the script to
 * print once; they are never stored anywhere but Supabase Auth.
 */
import { randomBytes, createHash } from 'crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import { assertDemoOrg } from '@/lib/demo-org'
import { buildDemoDataset, type DemoQuote, DEMO_CREWS, DEMO_CUSTOM_FIELDS, DEMO_DEFAULTS, DEMO_FEATURES, DEMO_PEOPLE, type DemoDataset } from '@/lib/demo-company-data'
import { mergeOrgSettings } from '@/lib/org-settings'
import { orgDb } from '@/lib/supabase/org-db'
import { companyAppUrl } from '@/lib/company-host'
import { upsertCustomer } from '@/lib/customers'
import { createProperty } from '@/lib/properties-db'
import { saveCustomFieldValues, saveDefinitionChange, loadCustomFieldDefinitions } from '@/lib/custom-fields-db'
import { saveTemplate, createServicePlan, ensureServiceVisits, applyVisitAction, bulkShiftVisits, loadVisits, loadTemplates } from '@/lib/service-plans-db'
import { saveCrewSetup, addTimeEntry, loadClockConfig } from '@/lib/time-tracking-db'
import { createServiceInvoiceFromLines, recordCustomerInvoicePayment, createCustomAmountInvoice, applyPaymentToInvoice } from '@/lib/invoices'
import { recordJobPayment } from '@/lib/job-payment-record'
import { savePoDraft, loadPoTarget, recordPoBill } from '@/lib/purchase-orders-db'
import { postMessage, postCustomerMessage } from '@/lib/threads/post-message'
import { runCustomerMessagesForOrg } from '@/lib/customer-messages-db'
import { readOrgTradesForSeed } from '@/lib/org-trades-admin'
import { serviceIsTrade } from '@/lib/org-trades'
import { newPortalToken, hashPortalToken } from '@/lib/portal/tokens'
import { addDaysYmd, localInstant } from '@/lib/payroll-week-schedule'
import { findOrCreateWeek } from '@/lib/payroll-periods'
import { weekCutoffContaining, readPayWeekSchedule } from '@/lib/payroll-week-schedule'
import { CUSTOMER_MESSAGES_SETTINGS_KEY } from '@/lib/customer-messages'
import { finalizeVisitPhotoUpload, registerVisitPhotoUpload } from '@/lib/job-photo-upload'
import { FILES_BUCKET } from '@/lib/files/storage'
import { ORG_FEATURES_SETTINGS_KEY } from '@/lib/org-features'
import { DEFAULT_TIMEZONE } from '@/lib/timezone'

type Row = Record<string, any>

export type DemoApplyReport = {
  lines: string[]
  skipped: string[]
  /** Printed once by the script; never stored. */
  logins: Array<{ role: string; email: string; password: string }>
  portalLink: string | null
}

type Ctx = {
  admin: SupabaseClient
  orgId: string
  ownerId: string
  now: Date
  today: string
  tz: string
  data: DemoDataset
  report: DemoApplyReport
  userIds: Map<string, string>
  customers: Map<string, { id: string; propertyIds: string[] }>
  subIds: Map<string, string>
  templateIds: Map<string, string>
  planIds: string[]
  oppIds: Map<string, string>
  pricebook: { id: string; items: Map<string, string> }
}

const money = (n: number) => Math.round(n * 100)

async function step(ctx: Ctx, name: string, fn: () => Promise<string | void>) {
  try {
    const out = await fn()
    ctx.report.lines.push(`${name}${out ? `: ${out}` : ''}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : JSON.stringify(e)
    ctx.report.skipped.push(`${name}: ${msg}`)
  }
}

function unwrap<T>(r: { data: T; error: { message?: string; code?: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message ?? r.error.code}`)
  return r.data
}

function password(): string {
  return randomBytes(12).toString('base64url')
}

// ---------------------------------------------------------------------------------------------------------------------

async function settingsStep(ctx: Ctx) {
  const { admin, orgId } = ctx
  const feats = await mergeOrgSettings(admin, orgId, { ...DEMO_FEATURES }, { path: [ORG_FEATURES_SETTINGS_KEY] })
  if (feats.error) throw new Error(`features: ${feats.error}`)
  const put = async (key: string, value: Record<string, unknown>) => {
    const r = await mergeOrgSettings(admin, orgId, value, { path: [key] })
    if (r.error) throw new Error(`${key}: ${r.error}`)
  }
  await put(CUSTOMER_MESSAGES_SETTINGS_KEY, {
    visitReminder: true,
    visitReminderDays: 1,
    visitWindow: 'between 8 AM and 5 PM',
    visitNote: 'Please leave the gate unlocked and let us know about any pets.',
    onTheWay: true,
    visitDone: true,
    visitDonePhotos: true,
    quoteFollowUp: true,
    quoteFollowUpDays: [3, 7],
    invoiceReminder: true,
    invoiceReminderDays: [0, 7],
  })
  await put('timeTracking', { autoCloseHours: 12, captureLocation: false, overtimeAfterHours: 40, breakWarningAfterHours: 6, selfClockRoles: [] })
  await put('hourlyBilling', { rounding: 'nearest15', minimumHours: 1, travel: 'no', basis: 'person_hours', equipmentFromOperator: true })
  await put('quoteApproval', { depositMode: 'percent', depositPercent: 25, linkDays: 14 })
  await put('customerPortal', { inviteOnly: false })
  // The texting line: a reserved 555-01xx number on the test adapter (no provider is ever called for a demo org).
  const now = new Date().toISOString()
  const sms = await orgDb(admin, orgId).from('org_sms').upsert(
    { e164: DEMO_DEFAULTS.textingE164, number_kind: 'local', number_source: 'manual', status: 'active', approved_at: now, updated_by: ctx.ownerId, updated_at: now },
    { onConflict: 'org_id' }
  )
  if (sms.error) throw new Error(`texting number: ${sms.error.message ?? sms.error.code}`)
  return 'features, messages, time clock, hourly billing, quote deposit, portal, texting line'
}

async function usersStep(ctx: Ctx) {
  const { admin, orgId } = ctx
  const db = orgDb(admin, orgId)
  for (const p of DEMO_PEOPLE) {
    const pw = password()
    const created = await admin.auth.admin.createUser({ email: p.email, password: pw, email_confirm: true, user_metadata: { full_name: p.fullName } })
    if (created.error || !created.data.user) throw new Error(`login ${p.email}: ${created.error?.message ?? 'failed'}`)
    const id = created.data.user.id
    const ins = await db.from('users').insert({ id, email: p.email, full_name: p.fullName, phone: p.phone, role: p.role, active: true, dashboard_view: 'sales', canvass_pin_visibility: 'org' })
    if (ins.error) throw new Error(`profile ${p.email}: ${ins.error.message ?? ins.error.code}`)
    ctx.userIds.set(p.key, id)
    if (p.login) ctx.report.logins.push({ role: 'crew lead', email: p.email, password: pw })
  }
  // Pay: two hourly crew leads and one commission salesperson (crew members clock time but are not on the payroll preview).
  const hourly = unwrap(await db.from('comp_plans').insert({ name: 'Hourly crew lead', plan_type: 'flat_rate', flat_amount: 0, hourly_rate: 23, is_active: true, applicable_roles: ['sales_rep'] }).select('id').single(), 'comp plan') as Row
  const commission = unwrap(await db.from('comp_plans').insert({ name: 'Salesperson 8%', plan_type: 'percentage', base_percentage: 8, is_active: true, applicable_roles: ['sales_rep'] }).select('id').single(), 'comp plan') as Row
  for (const p of DEMO_PEOPLE) {
    const userId = ctx.userIds.get(p.key)!
    if (p.key === 'lead1' || p.key === 'lead2') {
      const rate = p.pay.kind === 'hourly' ? p.pay.rate : null
      unwrap(await db.from('user_comp_plans').insert({ user_id: userId, comp_plan_id: hourly.id, effective_from: addDaysYmd(ctx.today, -120), hourly_rate_override: rate }), 'comp assignment')
    } else if (p.key === 'sales') {
      unwrap(await db.from('user_comp_plans').insert({ user_id: userId, comp_plan_id: commission.id, effective_from: addDaysYmd(ctx.today, -120) }), 'comp assignment')
    }
  }
  return `${DEMO_PEOPLE.length} people`
}

async function pricebookStep(ctx: Ctx) {
  const { admin, orgId } = ctx
  const db = orgDb(admin, orgId)
  let book = (unwrap(await db.from('pricebooks').select('id').eq('is_default', true).limit(1), 'pricebook') as Row[])[0]
  if (!book) book = unwrap(await db.from('pricebooks').insert({ name: 'Demo price book', is_default: true }).select('id').single(), 'pricebook') as Row
  ctx.pricebook = { id: book.id, items: new Map() }
  for (const it of ctx.data.pricebook) {
    const row = unwrap(
      await db.from('pricebook_items').insert({ pricebook_id: book.id, category: 'addons', item_type: 'addon', name: it.name, unit: it.unit, unit_price: it.price, is_labor: it.labor, is_taxable: false, active: true }).select('id').single(),
      `price book "${it.name}"`
    ) as Row
    ctx.pricebook.items.set(it.name, row.id)
  }
  return `${ctx.data.pricebook.length} hourly items`
}

async function customFieldsStep(ctx: Ctx) {
  const { admin, orgId, ownerId } = ctx
  for (const f of DEMO_CUSTOM_FIELDS) {
    const r = await saveDefinitionChange(admin, orgId, ownerId, { action: 'add', entity: f.entity, label: f.label, field_type: f.field_type, options: f.options ? [...f.options] : undefined } as never)
    if (!r.ok) throw new Error(r.error)
  }
  return `${DEMO_CUSTOM_FIELDS.length} property fields`
}

async function customersStep(ctx: Ctx) {
  const { admin, orgId, ownerId } = ctx
  const defs = (await loadCustomFieldDefinitions(admin, orgId, 'property')).definitions
  const byLabel = new Map(defs.map((d) => [d.label, d.id]))
  let props = 0
  for (const c of ctx.data.customers) {
    const first = c.properties[0]
    const addr = `${first.address_line1}, ${first.city}, ${first.state} ${first.zip}`
    const { customer_id } = await upsertCustomer(admin, orgId, { name: c.name, email: c.email, phone: c.phone, address_text: addr })
    const propertyIds: string[] = []
    for (const p of c.properties) {
      const made = await createProperty(
        admin,
        orgId,
        ownerId,
        customer_id,
        { label: p.label ?? undefined, address_line1: p.address_line1, city: p.city, state: p.state, zip: p.zip, access_notes: p.access_notes ?? undefined },
        { accessNotes: true }
      )
      if (!made.ok) throw new Error(`property ${p.address_line1}: ${made.error}`)
      propertyIds.push(made.property.id)
      props += 1
      const patch: Record<string, unknown> = {}
      if (p.gate && byLabel.get('Gate code')) patch[byLabel.get('Gate code')!] = p.gate
      if (byLabel.get('Dog on property')) patch[byLabel.get('Dog on property')!] = p.dog
      if (byLabel.get('Irrigation')) patch[byLabel.get('Irrigation')!] = p.irrigation
      if (Object.keys(patch).length) {
        const saved = await saveCustomFieldValues(admin, orgId, 'property', made.property.id, patch)
        if (!saved.ok) throw new Error(`custom fields: ${saved.error}`)
      }
    }
    ctx.customers.set(c.key, { id: customer_id, propertyIds })
  }
  return `${ctx.data.customers.length} customers (3 commercial accounts), ${props} properties`
}

async function crewsStep(ctx: Ctx) {
  const { admin, orgId, ownerId } = ctx
  const db = orgDb(admin, orgId)
  const trades = (await readOrgTradesForSeed(admin, orgId)) ?? []
  for (const c of DEMO_CREWS) {
    const lead = DEMO_PEOPLE.find((p) => p.key === c.lead)!
    const row = unwrap(
      await db.from('sub_contractors').insert({ company_name: c.name, contact_name: lead.fullName, phone: lead.phone, email: lead.email, services: [...c.services], active: true }).select('id').single(),
      `crew ${c.name}`
    ) as Row
    ctx.subIds.set(c.key, row.id)
    const r = await saveCrewSetup(admin, orgId, row.id, ownerId, {
      tracksTime: true,
      members: [{ userId: ctx.userIds.get(c.lead)!, isLead: true }, ...c.members.map((m) => ({ userId: ctx.userIds.get(m)!, isLead: false }))],
    })
    if (!r.ok) throw new Error(r.error)
  }
  void trades
  return `${DEMO_CREWS.length} crews on the time clock`
}

async function templatesStep(ctx: Ctx) {
  const { admin, orgId, ownerId } = ctx
  const trades = (await readOrgTradesForSeed(admin, orgId)) ?? []
  for (const t of ctx.data.templates) {
    const trade = trades.find((x) => serviceIsTrade(t.trade, x))
    if (!trade) throw new Error(`no trade "${t.trade}" in this company`)
    const r = await saveTemplate(admin, orgId, ownerId, null, {
      name: t.name,
      trade: trade.slug,
      description: t.description,
      seasons: t.seasons,
      billing_basis: t.billing_basis,
      taxable: t.taxable,
      pricing: {
        fields: [{ key: 'lawn_sqft', label: 'Lawn size (sq ft)' }],
        tiers: t.tiers.map((x) => ({ key: x.key, label: x.label, price: x.price, billingBasis: t.billing_basis, conditions: [{ field: 'lawn_sqft', op: 'lte', value: x.max }] })),
        allowCustom: true,
      },
      steps:
        t.name.startsWith('Yard & roof')
          ? [{ key: 'inspection', label: 'Roofline inspection', daysAfter: 2, assignTo: 'person', userId: ctx.ownerId, subId: null, results: [{ key: 'green', label: 'Green — good' }, { key: 'yellow', label: 'Yellow — watch it' }, { key: 'red', label: 'Red — needs work' }] }]
          : [],
    })
    if (!r.ok) throw new Error(`${t.name}: ${r.error}`)
    ctx.templateIds.set(t.name, r.template.id)
  }
  return `${ctx.data.templates.length} plan templates`
}

async function plansStep(ctx: Ctx) {
  const { admin, orgId, ownerId } = ctx
  const start = addDaysYmd(ctx.today, -42)
  const past = new Date(`${start}T14:00:00Z`)
  for (const a of ctx.data.planAssignments) {
    const cust = ctx.customers.get(a.customerKey)!
    const tmpl = ctx.data.templates[a.template]
    const sqft = ctx.data.customers.find((c) => c.key === a.customerKey)!.properties[a.propertyIndex].lawnSqft
    const tier = tmpl.tiers.find((t) => sqft <= t.max) ?? tmpl.tiers[tmpl.tiers.length - 1]
    const r = await createServicePlan(
      admin,
      orgId,
      ownerId,
      cust.id,
      {
        template_id: ctx.templateIds.get(tmpl.name),
        property_id: cust.propertyIds[a.propertyIndex],
        start_date: start,
        pricing_inputs: { lawn_sqft: sqft },
        tier_key: tier.key,
        default_sub_id: ctx.subIds.get(a.crew),
        preferred_weekday: a.weekday,
      },
      past
    )
    if (!r.ok) throw new Error(`plan for ${a.customerKey}: ${r.error}`)
    ctx.planIds.push(r.plan.id)
  }
  // The rest of the horizon, as the morning cron would.
  const ahead = await ensureServiceVisits(admin, orgId, { now: ctx.now, timeZone: ctx.tz })
  return `${ctx.planIds.length} active plans, ${ahead.created} upcoming visits added`
}

async function visitsStep(ctx: Ctx) {
  const { admin, orgId, ownerId } = ctx
  const o = ctx.data.visitOutcomes
  // 1. The rain day: everything on that day moved one day later, in one batch.
  const shifted = await bulkShiftVisits(admin, orgId, { from: o.rainDay, to: o.rainDay, days: 1, subId: 'all' }, { now: new Date(`${addDaysYmd(o.rainDay, -1)}T14:00:00Z`) })
  const moved = 'moved' in shifted ? shifted.moved : 0
  // 2. Outcomes for every visit that already passed: most done, some skipped with a reason, a few with photos.
  const visits = await loadVisits(admin, orgId, { from: addDaysYmd(ctx.today, -43), to: addDaysYmd(ctx.today, -1), accessNotes: false })
  let done = 0
  let skipped = 0
  let photos = 0
  const reasons: Array<'rain' | 'customer' | 'holiday' | 'other'> = ['customer', 'rain', 'other', 'customer']
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
  for (let i = 0; i < visits.length; i++) {
    const v = visits[i]
    if (v.status !== 'scheduled') continue
    const pick = (i * 37) % 100
    const now = new Date(`${v.scheduledDate}T22:00:00Z`)
    if (pick < 9) {
      const reason = reasons[i % reasons.length]
      const notes = o.skipReasons[i % o.skipReasons.length]
      const r = await applyVisitAction(admin, orgId, v.id, { action: 'skip', reason, notes }, { userId: ownerId, subId: v.subId }, { now })
      if (r.ok) skipped += 1
    } else {
      const r = await applyVisitAction(admin, orgId, v.id, { action: 'done', notes: pick % 7 === 0 ? 'Gate was locked — crew used the side path.' : undefined }, { userId: ownerId, subId: v.subId }, { now })
      if (r.ok) {
        done += 1
        if (pick % 5 === 0 && photos < 24) {
          const reg = await registerVisitPhotoUpload(admin, { orgId, visitId: v.id, filename: 'after-front-yard.png' })
          if (!('error' in reg)) {
            const up = await admin.storage.from(FILES_BUCKET).uploadToSignedUrl(reg.storagePath, reg.signedUploadToken, png, { contentType: 'image/png' })
            if (!up.error) {
              const fin = await finalizeVisitPhotoUpload(admin, { orgId, visitId: v.id, photoId: reg.photoId, photoTag: 'after', mimeType: 'image/png', fileSize: png.length, uploadedBy: ownerId })
              if (!('error' in fin)) photos += 1
            }
          }
        }
      }
    }
  }
  return `${moved} visits moved by the rain-day shift, ${done} done, ${skipped} skipped with reasons, ${photos} with sample photos`
}

async function timeStep(ctx: Ctx) {
  const { admin, orgId, ownerId } = ctx
  const tz = (await loadClockConfig(admin, orgId)).timeZone
  const dayWork = async (ymd: string, jobId: string | null) => {
    for (const key of ['lead1', 'crew1', 'crew2']) {
      const userId = ctx.userIds.get(key)!
      const a = await addTimeEntry(admin, orgId, ownerId, { userId, kind: 'work', startedAt: localInstant(ymd, '07:30', tz).toISOString(), endedAt: localInstant(ymd, '12:00', tz).toISOString(), jobId }, 'Sample data')
      const b = await addTimeEntry(admin, orgId, ownerId, { userId, kind: 'work', startedAt: localInstant(ymd, '12:30', tz).toISOString(), endedAt: localInstant(ymd, '16:00', tz).toISOString(), jobId }, 'Sample data')
      if (!a.ok) throw new Error(a.error)
      if (!b.ok) throw new Error(b.error)
    }
    for (const key of ['lead2', 'crew3']) {
      const userId = ctx.userIds.get(key)!
      const a = await addTimeEntry(admin, orgId, ownerId, { userId, kind: 'work', startedAt: localInstant(ymd, '08:00', tz).toISOString(), endedAt: localInstant(ymd, '16:30', tz).toISOString(), jobId }, 'Sample data')
      if (!a.ok) throw new Error(a.error)
    }
  }
  // Ordinary days over the last 9 days (Mon-Fri), no job (visit time).
  let days = 0
  for (let back = 9; back >= 1; back--) {
    const ymd = addDaysYmd(ctx.today, -back)
    const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay()
    if (dow === 0 || dow === 6) continue
    if (ctx.data.grading.days.some((g) => g.ymd === ymd)) continue
    await dayWork(ymd, null)
    days += 1
  }
  return `${days} days of crew time`
}

async function gradingStep(ctx: Ctx) {
  const { admin, orgId, ownerId } = ctx
  const db = orgDb(admin, orgId)
  const g = ctx.data.grading
  const cust = ctx.customers.get(g.customerKey)!
  const custRow = ctx.data.customers.find((c) => c.key === g.customerKey)!
  const addr = `${custRow.properties[0].address_line1}, ${custRow.properties[0].city}, ${custRow.properties[0].state} ${custRow.properties[0].zip}`
  const trades = (await readOrgTradesForSeed(admin, orgId)) ?? []
  const tractor = trades.find((t) => serviceIsTrade('Tractor / land work', t))
  const project = unwrap(await db.from('projects').insert({ customer_id: cust.id, address_text: addr, status: 'in_progress', owner_user_id: ctx.userIds.get('sales') }).select('id').single(), 'project') as Row
  const labor = ctx.pricebook.items.get('Crew labor (per hour)')
  const job = unwrap(
    await db
      .from('production_jobs')
      .insert({ project_id: project.id, customer_id: cust.id, address_text: addr, job_type: tractor?.slug ?? 'roofing', status: 'in_progress', sale_date: addDaysYmd(ctx.today, -12), billing_mode: 'time_materials', estimated_hours: g.estimatedHours, hourly_rate_item_id: labor ?? null, created_by: ownerId, property_id: cust.propertyIds[0] })
      .select('id')
      .single(),
    'grading job'
  ) as Row
  const tz = (await loadClockConfig(admin, orgId)).timeZone
  const tractorItem = ctx.pricebook.items.get('Tractor with operator (per hour)')
  for (const d of g.days) {
    const at = (hhmm: number) => localInstant(d.ymd, `${String(Math.floor(hhmm)).padStart(2, '0')}:${String(Math.round((hhmm % 1) * 60)).padStart(2, '0')}`, tz).toISOString()
    const people = ['lead2', 'crew3']
    for (let i = 0; i < people.length; i++) {
      const [s, e] = d.crewHours[i]
      const r = await addTimeEntry(admin, orgId, ownerId, { userId: ctx.userIds.get(people[i])!, kind: 'work', startedAt: at(s), endedAt: at(e), jobId: job.id }, 'Sample data')
      if (!r.ok) throw new Error(r.error)
    }
    if (tractorItem) {
      const ins = await db.from('time_entries').insert({ user_id: null, sub_id: ctx.subIds.get('wash-b'), kind: 'equipment', started_at: at(d.tractor[0]), ended_at: at(d.tractor[1]), pricebook_item_id: tractorItem, production_job_id: job.id, source: 'typed', end_source: 'typed', tapped_via: 'office', tapped_by_user_id: ownerId, ended_by_user_id: ownerId })
      if (ins.error) throw new Error(`tractor hours: ${ins.error.message ?? ins.error.code}`)
    }
  }
  return 'hourly grading job: 2 days of crew + tractor hours waiting on Hours to bill'
}

async function ensureOpportunity(ctx: Ctx, key: string, status: 'open' | 'won'): Promise<string> {
  const have = ctx.oppIds.get(key)
  if (have) return have
  const db = orgDb(ctx.admin, ctx.orgId)
  const cust = ctx.customers.get(key)!
  const c = ctx.data.customers.find((x) => x.key === key)!
  const p = c.properties[0]
  const row = unwrap(
    await db.from('opportunities').insert({ customer_id: cust.id, owner_user_id: ctx.userIds.get('sales'), status, address_text: `${p.address_line1}, ${p.city}, ${p.state} ${p.zip}`, notes: 'Sample data' }).select('id').single(),
    'opportunity'
  ) as Row
  ctx.oppIds.set(key, row.id)
  return row.id
}

async function quotesStep(ctx: Ctx) {
  const { admin, orgId, ownerId } = ctx
  const db = orgDb(admin, orgId)
  const lineRows = (proposalId: string, lines: DemoDatasetQuote['lines']) =>
    lines.map((l, i) => ({
      proposal_id: proposalId,
      category: 'addons',
      name: l.name,
      unit: l.unit,
      quantity: l.qty,
      unit_price: l.price,
      line_total: Math.round(l.qty * l.price * 100) / 100,
      is_adder: false,
      show_on_pdf: true,
      show_to_customer: true,
      sort_order: i,
      is_optional: l.optional === true,
      optional_default_on: l.defaultOn === true,
      taxable: false,
    }))
  let n = 0
  for (const q of ctx.data.quotes) {
    const cust = ctx.customers.get(q.customerKey)!
    const c = ctx.data.customers.find((x) => x.key === q.customerKey)!
    const p = c.properties[0]
    const oppId = await ensureOpportunity(ctx, q.customerKey, q.status === 'accepted' ? 'won' : 'open')
    const counted = q.lines.filter((l) => !l.optional || l.defaultOn)
    const total = Math.round(counted.reduce((s, l) => s + l.qty * l.price, 0) * 100) / 100
    n += 1
    const sentAt = new Date(`${addDaysYmd(ctx.today, -q.daysAgo)}T15:00:00Z`).toISOString()
    const prop = unwrap(
      await db
        .from('proposals')
        .insert({
          opportunity_id: oppId,
          created_by: ownerId,
          customer_name: c.name,
          customer_email: c.email,
          customer_phone: c.phone,
          customer_address: `${p.address_line1}, ${p.city}, ${p.state} ${p.zip}`,
          proposal_number: `Q-${String(n).padStart(4, '0')}`,
          title: q.title,
          status: q.status,
          subtotal: total,
          total,
          sent_at: sentAt,
          accepted_at: q.status === 'accepted' ? sentAt : null,
          expires_at: new Date(`${addDaysYmd(ctx.today, q.expiresInDays)}T23:00:00Z`).toISOString(),
          scope_of_work: 'Sample quote — fictional demo data.',
          deposit_mode: q.depositPercent ? 'percent' : null,
          deposit_value: q.depositPercent ?? null,
        })
        .select('id')
        .single(),
      `quote ${q.key}`
    ) as Row
    unwrap(await db.from('proposal_line_items').insert(lineRows(prop.id, q.lines)), `quote lines ${q.key}`)
    // The customer's quote link (only its hash is kept — a sample link, not usable).
    const token = newPortalToken()
    const link = unwrap(
      await db.from('quote_links').insert({ proposal_id: prop.id, token_hash: createHash('sha256').update(token).digest('hex'), created_by: ownerId, expires_at: new Date(`${addDaysYmd(ctx.today, q.expiresInDays)}T23:00:00Z`).toISOString(), sent_to: c.email, sent_at: sentAt }).select('id').single(),
      'quote link'
    ) as Row
    if (q.status !== 'accepted') continue
    // The approved quote: approval record, the sale (job), and a deposit invoice that was paid.
    const depositCents = Math.round(money(total) * ((q.depositPercent ?? 0) / 100))
    const project = unwrap(await db.from('projects').insert({ customer_id: cust.id, address_text: `${p.address_line1}, ${p.city}, ${p.state} ${p.zip}`, status: 'in_progress', owner_user_id: ctx.userIds.get('sales') }).select('id').single(), 'project') as Row
    const trades = (await readOrgTradesForSeed(admin, orgId)) ?? []
    const landscape = trades.find((t) => serviceIsTrade('Landscaping', t))
    const job = unwrap(
      await db
        .from('production_jobs')
        .insert({ project_id: project.id, customer_id: cust.id, address_text: `${p.address_line1}, ${p.city}, ${p.state} ${p.zip}`, job_type: landscape?.slug ?? 'roofing', status: 'sold', sale_amount: total, sale_date: addDaysYmd(ctx.today, -q.daysAgo + 1), accepted_proposal_id: prop.id, salesperson_id: ctx.userIds.get('sales'), created_by: ownerId, property_id: cust.propertyIds[0] })
        .select('id')
        .single(),
      'approved-quote job'
    ) as Row
    const inv = await createCustomAmountInvoice(admin, job.id, ownerId, depositCents, 'Deposit (25%)', { noContractCap: true })
    const paid = await recordJobPayment(admin, { orgId, jobId: job.id, paidAt: addDaysYmd(ctx.today, -q.daysAgo + 1), amountCents: depositCents, paymentType: 'deposit', method: 'card', payer: 'homeowner', note: 'Sample deposit', createdBy: ownerId })
    if (!paid.ok) throw new Error(paid.error)
    await applyPaymentToInvoice(admin, orgId, inv.id, paid.payment.id, depositCents, ownerId)
    const addressText = `${p.address_line1}, ${p.city}, ${p.state} ${p.zip}`
    const snapLines = q.lines.map((l, i) => ({ id: `demo-${q.key}-${i}`, name: l.name, quantity: l.qty, unit: l.unit, optional: l.optional === true, chosen: !l.optional || l.defaultOn === true, cents: Math.round(l.qty * l.price * 100) }))
    const approval = unwrap(
      await db
        .from('quote_approvals')
        .insert({
          proposal_id: prop.id,
          opportunity_id: oppId,
          link_id: link.id,
          typed_name: c.name,
          approved_at: sentAt,
          approved_ip: '203.0.113.10',
          selected_item_ids: [],
          snapshot: { proposalNumber: `Q-${String(n).padStart(4, '0')}`, title: q.title, customer: { name: c.name, address: addressText }, terms: 'Sample terms (fictional demo company).', lines: snapLines, declinedIds: [], taxLines: [], taxableCents: 0, legacyTax: false, deposit: { mode: 'percent', percent: q.depositPercent ?? 0, cents: depositCents } },
          subtotal_cents: money(total),
          discount_cents: 0,
          tax_cents: 0,
          total_cents: money(total),
          deposit_cents: depositCents,
          job_id: job.id,
          deposit_invoice_id: inv.id,
          finalized_at: sentAt,
        })
        .select('*')
        .single(),
      'quote approval'
    ) as Row
    // The signed agreement + its PDF, through the real quote-approval PDF path (a completed contract also counts as a sale
    // for every report, like a real online approval). A PDF failure is reported, never fatal.
    const contract = unwrap(
      await db
        .from('order_form_contracts')
        .insert({ agreement_type: 'installation', opportunity_id: oppId, proposal_id: prop.id, customer_name: c.name, customer_email: c.email, customer_phone: c.phone, project_address: addressText, project_cost: money(total) / 100, payment_method: 'other', deposit_amount: depositCents / 100, notes: `Approved online (quote Q-${String(n).padStart(4, '0')}) by ${c.name}.`, status: 'completed', created_by: ownerId, quote_approval_id: approval.id })
        .select('id')
        .single(),
      'approved-quote contract'
    ) as Row
    unwrap(await db.from('quote_approvals').update({ contract_id: contract.id }).eq('id', approval.id), 'approval contract link')
    try {
      const { storeApprovalPdf } = await import('@/lib/quotes/pdf')
      await storeApprovalPdf(admin, orgId, { ...(approval as object), contract_id: contract.id } as never, contract.id as string, { name: c.name, address: addressText })
    } catch (e) {
      ctx.report.skipped.push(`approved quote PDF not made: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return `${ctx.data.quotes.length} quotes (one sent with optional items, one approved with a paid deposit, one expired)`
}

type DemoDatasetQuote = DemoQuote

async function invoicesStep(ctx: Ctx) {
  const { admin, orgId, ownerId } = ctx
  const db = orgDb(admin, orgId)
  const visits = await loadVisits(admin, orgId, { from: addDaysYmd(ctx.today, -43), to: addDaysYmd(ctx.today, -1), accessNotes: false })
  const doneBy = new Map<string, typeof visits>()
  for (const v of visits.filter((x) => x.status === 'completed' && x.customerId)) doneBy.set(v.customerId!, [...(doneBy.get(v.customerId!) ?? []), v])
  const customerKeyById = new Map(Array.from(ctx.customers.entries()).map(([k, v]) => [v.id, k]))
  const plans = unwrap(await db.from('service_plans').select('id, customer_id, price, billing_basis, taxable'), 'plans') as Row[]
  const planOf = new Map(plans.map((p) => [p.id, p]))
  let made = 0
  const keys = Array.from(doneBy.keys())
  for (let i = 0; i < Math.min(keys.length, 14); i++) {
    const custId = keys[i]
    const vs = doneBy.get(custId)!.slice(0, 3)
    const plan = planOf.get(vs[0].planId)
    const price = Number(plan?.price ?? 65)
    const monthly = plan?.billing_basis === 'per_month'
    const lines = monthly
      ? [{ description: `${vs[0].planName} — ${vs[0].scheduledDate.slice(0, 7)}`, qty: 1, unit_price_cents: money(price), taxable: plan?.taxable === true, service_plan_id: vs[0].planId, billing_month: `${vs[0].scheduledDate.slice(0, 7)}-01` }]
      : vs.map((v) => ({ description: `${v.planName} — ${v.scheduledDate}`, qty: 1, unit_price_cents: money(price), taxable: plan?.taxable === true, work_order_id: v.id, service_date: v.scheduledDate }))
    const { invoiceId } = await createServiceInvoiceFromLines(admin, orgId, { customerId: custId, propertyId: vs[0].propertyId, createdBy: ownerId, lines })
    if (!invoiceId) continue
    made += 1
    const total = lines.reduce((s, l) => s + l.unit_price_cents * l.qty, 0)
    if (i % 3 === 0) {
      // paid (per-visit and monthly alike)
      await recordCustomerInvoicePayment(admin, orgId, invoiceId, { amountCents: total, paidAt: addDaysYmd(ctx.today, -3), method: i % 2 ? 'card' : 'check', note: 'Sample payment', createdBy: ownerId })
    } else if (i % 3 === 1) {
      // sent, overdue
      const issued = addDaysYmd(ctx.today, -34)
      await db.from('job_invoices').update({ status: 'sent', issued_at: new Date(`${issued}T15:00:00Z`).toISOString(), sent_at: new Date(`${issued}T15:00:00Z`).toISOString(), due_at: new Date(`${addDaysYmd(issued, 14)}T15:00:00Z`).toISOString() }).eq('id', invoiceId)
    } else {
      const issued = addDaysYmd(ctx.today, -4)
      await db.from('job_invoices').update({ status: 'sent', issued_at: new Date(`${issued}T15:00:00Z`).toISOString(), sent_at: new Date(`${issued}T15:00:00Z`).toISOString(), due_at: new Date(`${addDaysYmd(issued, 14)}T15:00:00Z`).toISOString() }).eq('id', invoiceId)
    }
  }
  void customerKeyById
  return `${made} service invoices (paid, overdue, due soon; per-visit and monthly)`
}

async function vendorsStep(ctx: Ctx) {
  const { admin, orgId, ownerId } = ctx
  const db = orgDb(admin, orgId)
  const jobs = unwrap(await db.from('production_jobs').select('id').order('created_at', { ascending: true }).limit(2), 'jobs') as Row[]
  if (jobs.length === 0) throw new Error('no job to order for')
  const vendorIds: string[] = []
  for (const v of ctx.data.vendors) {
    const row = unwrap(await db.from('vendors').insert({ name: v.name, contact_name: v.contact, phone: v.phone, email: v.email, active: true, created_by: ownerId, vendor_type: 'supplier' }).select('id').single(), `vendor ${v.name}`) as Row
    vendorIds.push(row.id)
  }
  const mk = async (jobId: string, vendorId: string, title: string, lines: Array<[string, number, string, number]>) => {
    const target = await loadPoTarget(admin, orgId, { jobId })
    if (!target) throw new Error('job not found for the order')
    const saved = await savePoDraft(admin, target, ownerId, {
      vendorId,
      lines: lines.map(([description, quantity, unit, cents]) => ({ description, quantity, unit, unitCostCents: cents, costType: 'material' as const, costCode: null, pricebookItemId: null })),
      date: addDaysYmd(ctx.today, 2),
      dateKind: 'delivery',
      address: null,
      note: 'Sample order — fictional demo data.',
      title,
    }, null)
    if (!saved.ok) throw new Error(saved.message)
    const now = new Date().toISOString()
    await db.from('supplier_orders').update({ status: 'sent', first_sent_at: now, last_sent_at: now }).eq('id', saved.id)
    return saved.id
  }
  const po1 = await mk(jobs[0].id, vendorIds[0], 'Sod and fertilizer', [['Centipede sod pallet', 2, 'pallet', 38500], ['Starter fertilizer 50 lb', 4, 'bag', 3200]])
  await mk(jobs[jobs.length - 1].id, vendorIds[1], 'Mulch and stone', [['Hardwood mulch', 6, 'cubic yard', 4200], ['River rock', 3, 'ton', 7800]])
  const bill = await recordPoBill(admin, orgId, ownerId, po1, { amountCents: 77000 + 12800, billNumber: 'SAMPLE-1042', billDate: addDaysYmd(ctx.today, -1), isCredit: false, notes: 'Sample bill', costType: 'material', clientKey: 'demo-bill-1' }, { over: true, duplicate: true })
  if (!bill.ok) throw new Error(bill.message)
  return '2 vendors, 2 purchase orders, 1 bill recorded'
}

async function threadsStep(ctx: Ctx) {
  const { admin, orgId } = ctx
  const owner = unwrap(await orgDb(admin, orgId).from('users').select('id, org_id, role, custom_role_id, is_super_admin, active').eq('id', ctx.ownerId).single(), 'owner') as Row
  let n = 0
  for (const t of ctx.data.threads) {
    const oppId = await ensureOpportunity(ctx, t.customerKey, 'open')
    const cust = ctx.customers.get(t.customerKey)!
    const deal = { id: oppId, owner_user_id: ctx.userIds.get('sales') ?? null, setter_user_id: null, customer_id: cust.id, lead_id: null }
    const r = await postMessage(admin, owner as never, deal, { body: t.team, audience: 'team' })
    if (!r.ok) throw new Error(r.error)
    n += 1
    for (let i = 0; i < t.portal.length; i++) {
      if (i % 2 === 0) {
        const m = await postCustomerMessage(admin, { orgId, customerId: cust.id, body: t.portal[i] } as never)
        if (!m.ok) throw new Error(m.error)
      } else {
        const m = await postMessage(admin, owner as never, deal, { body: t.portal[i], audience: 'customer' })
        if (!m.ok) throw new Error(m.error)
      }
      n += 1
    }
  }
  return `${n} thread messages (team notes + portal conversation)`
}

async function portalStep(ctx: Ctx) {
  const { admin, orgId } = ctx
  const cust = ctx.customers.get('res-1')!
  const row = unwrap(await orgDb(admin, orgId).from('customers').select('email').eq('id', cust.id).single(), 'portal customer') as Row
  const token = newPortalToken()
  const expires = new Date(ctx.now.getTime() + 7 * 24 * 3600 * 1000)
  unwrap(await orgDb(admin, orgId).from('portal_login_tokens').insert({ customer_id: cust.id, token_hash: hashPortalToken(token), sent_to: row.email, expires_at: expires.toISOString() }), 'portal link')
  const base = companyAppUrl(DEMO_DEFAULTS.subdomain)
  ctx.report.portalLink = `${base ?? ''}/portal/enter?t=${token}`
  return 'portal customer + a 7-day sign-in link (single use)'
}

async function remindersStep(ctx: Ctx) {
  const noon = localInstant(ctx.today, '10:30', ctx.tz)
  const run = await runCustomerMessagesForOrg(ctx.admin, ctx.orgId, noon)
  return `customer-messages run: ${JSON.stringify(run.stats ?? run.skipped ?? {})} (all outbound is suppressed and only logged)`
}

async function payWeekStep(ctx: Ctx) {
  const { admin, orgId } = ctx
  const cfg = await loadClockConfig(admin, orgId)
  const week = await findOrCreateWeek(admin, orgId, weekCutoffContaining(ctx.now, cfg.payWeek), cfg.payWeek)
  return `pay week "${week.cutoff_at.slice(0, 10)}" is open with the clock hours of 2 hourly crew leads and 1 commission salesperson`
}

// ---------------------------------------------------------------------------------------------------------------------

export async function applyDemoCompany(
  admin: SupabaseClient,
  orgId: string,
  ownerId: string,
  opts: { now?: Date; today: string; timeZone?: string }
): Promise<DemoApplyReport> {
  // The one gate for everything below: only a demo org, checked against the database (never cached).
  await assertDemoOrg(admin, orgId)
  void readPayWeekSchedule
  const report: DemoApplyReport = { lines: [], skipped: [], logins: [], portalLink: null }
  const ctx: Ctx = {
    admin,
    orgId,
    ownerId,
    now: opts.now ?? new Date(),
    today: opts.today,
    tz: opts.timeZone ?? DEFAULT_TIMEZONE,
    data: buildDemoDataset(opts.today),
    report,
    userIds: new Map(),
    customers: new Map(),
    subIds: new Map(),
    templateIds: new Map(),
    planIds: [],
    oppIds: new Map(),
    pricebook: { id: '', items: new Map() },
  }
  // Order matters: each step uses what the one before made; a step that fails is reported and the rest still run.
  await step(ctx, 'settings', () => settingsStep(ctx))
  await step(ctx, 'people', () => usersStep(ctx))
  await step(ctx, 'price book', () => pricebookStep(ctx))
  await step(ctx, 'custom fields', () => customFieldsStep(ctx))
  await step(ctx, 'customers', () => customersStep(ctx))
  await step(ctx, 'crews', () => crewsStep(ctx))
  await step(ctx, 'plan templates', () => templatesStep(ctx))
  await step(ctx, 'service plans', () => plansStep(ctx))
  await step(ctx, 'visits', () => visitsStep(ctx))
  await step(ctx, 'crew time', () => timeStep(ctx))
  await step(ctx, 'grading job', () => gradingStep(ctx))
  await step(ctx, 'quotes', () => quotesStep(ctx))
  await step(ctx, 'invoices', () => invoicesStep(ctx))
  await step(ctx, 'vendors + purchase orders', () => vendorsStep(ctx))
  await step(ctx, 'threads', () => threadsStep(ctx))
  await step(ctx, 'portal', () => portalStep(ctx))
  await step(ctx, 'reminders log', () => remindersStep(ctx))
  await step(ctx, 'pay week', () => payWeekStep(ctx))
  void loadTemplates
  return report
}
