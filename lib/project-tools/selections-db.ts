/**
 * Selections & allowances (server). Pure rules: lib/selections.ts. Table: job_selections.
 *
 * Flow: office adds the item (allowance + options) → "Send" gives a customer link (and emails it when there is an address)
 * → the customer picks an option on /s/[token] (company brand, no login). Within allowance → approved. Over → the overage
 * becomes a change order through lib/change-orders-remote.ts (the EXISTING change-order system, signed by the customer on
 * the existing signing page). Choosing for the customer in person (office) goes through the same `chooseSelection`.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import nodemailer from 'nodemailer'

import { createRemoteChangeOrder } from '@/lib/change-orders-remote'
import { orgAppUrl } from '@/lib/company-links'
import { buildSelectionRequestEmail } from '@/lib/contracts/customer-emails'
import { getCrmEmailFrom } from '@/lib/crm-email-from'
import { getPaymentsByJob } from '@/lib/job-payments'
import { sumCollectedCents } from '@/lib/job-collection'
import { roundMoney } from '@/lib/money'
import { getDocumentBrand } from '@/lib/org-brand'
import { isMissingProjectToolsSchema, PROJECT_TOOLS_NOT_READY } from '@/lib/project-tools/budget-db'
import { orgDb } from '@/lib/supabase/org-db'
import { nextChangeOrderNumber, parseSelectionOptions, priceDifference, readStoredOptions, selectionChangeOrderDescription, selectionState, type SelectionOption, type SelectionState } from '@/lib/selections'

const TOKEN_RE = /^[A-Za-z0-9_-]{24,64}$/
const SIG_RE = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/
const MAX_SIG_CHARS = 250_000
const LINK_DAYS = 30

const COLUMNS =
  'id, job_id, item, allowance, options, chosen_option_id, chosen_label, chosen_price, due_date, status, link_token, token_expires_at, sent_at, chosen_at, chosen_by_name, chosen_source, change_order_id, requested_by_name, created_at'

export type SelectionView = {
  id: string
  item: string
  allowance: number
  options: SelectionOption[]
  chosen_option_id: string | null
  chosen_label: string | null
  chosen_price: number | null
  difference: number | null
  due_date: string | null
  status: string
  state: SelectionState
  link: string | null
  change_order_number: string | null
  change_order_url: string | null
  chosen_by_name: string | null
  chosen_source: string | null
}

type Row = Record<string, unknown>

function toNum(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export async function listSelections(admin: SupabaseClient, orgId: string, jobId: string, todayYmd: string): Promise<{ selections: SelectionView[]; ready: boolean }> {
  const db = orgDb(admin, orgId)
  const { data, error } = await db.from('job_selections').select(COLUMNS).eq('job_id', jobId).neq('status', 'cancelled').order('created_at', { ascending: true })
  if (error) {
    if (!isMissingProjectToolsSchema(error)) console.error('[selections] list failed', error)
    return { selections: [], ready: false }
  }
  const rows = (data ?? []) as Row[]
  const coIds = Array.from(new Set(rows.map((r) => r.change_order_id).filter((x): x is string => typeof x === 'string')))
  const coBy = new Map<string, { status: string | null; co_number: string; signing_token: string | null }>()
  if (coIds.length > 0) {
    const { data: cos } = await db.from('job_change_orders').select('id, status, co_number, signing_token').in('id', coIds)
    for (const c of (cos ?? []) as Array<{ id: string; status: string | null; co_number: string; signing_token: string | null }>) coBy.set(c.id, c)
  }
  const appUrl = rows.some((r) => r.link_token || r.change_order_id) ? await orgAppUrl(orgId).catch(() => null) : null
  const selections = rows.map((r): SelectionView => {
    const co = typeof r.change_order_id === 'string' ? coBy.get(r.change_order_id) ?? null : null
    const base = {
      status: r.status as 'draft' | 'sent' | 'chosen' | 'cancelled',
      chosen_price: r.chosen_price === null || r.chosen_price === undefined ? null : toNum(r.chosen_price),
      allowance: toNum(r.allowance),
      change_order_id: (r.change_order_id as string | null) ?? null,
      due_date: (r.due_date as string | null) ?? null,
    }
    return {
      id: String(r.id),
      item: String(r.item),
      allowance: base.allowance,
      options: readStoredOptions(r.options),
      chosen_option_id: (r.chosen_option_id as string | null) ?? null,
      chosen_label: (r.chosen_label as string | null) ?? null,
      chosen_price: base.chosen_price,
      difference: priceDifference(base.allowance, base.chosen_price),
      due_date: base.due_date,
      status: base.status,
      state: selectionState(base, co?.status ?? null, todayYmd),
      link: appUrl && r.link_token && base.status !== 'chosen' ? `${appUrl}/s/${r.link_token}` : null,
      change_order_number: co?.co_number ?? null,
      change_order_url: appUrl && co?.signing_token && co.status !== 'completed' ? `${appUrl}/change-orders/sign/${co.signing_token}` : null,
      chosen_by_name: (r.chosen_by_name as string | null) ?? null,
      chosen_source: (r.chosen_source as string | null) ?? null,
    }
  })
  return { selections, ready: true }
}

type Fail = { error: string; status: number }

function dueOrNull(v: unknown): string | null | Fail {
  if (v === undefined || v === null || v === '') return null
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  return { error: 'Pick a valid due date', status: 400 }
}
function parseAllowance(v: unknown): number | Fail {
  const n = typeof v === 'number' ? v : Number(String(v ?? '0').replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n >= 0 && n <= 1e9 ? roundMoney(n) : { error: 'Enter the allowance as $0 or more', status: 400 }
}

export async function saveSelection(admin: SupabaseClient, ctx: { orgId: string; userId: string; jobId: string }, input: { id?: string; item?: unknown; allowance?: unknown; options?: unknown; due_date?: unknown }): Promise<{ id: string } | Fail> {
  const item = typeof input.item === 'string' ? input.item.trim().slice(0, 120) : ''
  if (!item) return { error: 'What is the customer choosing? (e.g. Kitchen faucet)', status: 400 }
  const allowance = parseAllowance(input.allowance)
  if (typeof allowance !== 'number') return allowance
  const options = parseSelectionOptions(input.options)
  if ('error' in options) return { error: options.error, status: 400 }
  const due = dueOrNull(input.due_date)
  if (due !== null && typeof due === 'object') return due
  const db = orgDb(admin, ctx.orgId)
  if (input.id) {
    const { data: cur } = await db.from('job_selections').select('id, status').eq('id', input.id).eq('job_id', ctx.jobId).maybeSingle()
    if (!cur) return { error: 'Selection not found', status: 404 }
    if (cur.status === 'chosen') return { error: 'The customer already chose. Cancel this one and add a new one to change it.', status: 409 }
    const { error } = await db.from('job_selections').update({ item, allowance, options, due_date: due, updated_at: new Date().toISOString() }).eq('id', input.id).eq('job_id', ctx.jobId).in('status', ['draft', 'sent'])
    if (error) return { error: 'Could not save', status: 500 }
    return { id: input.id }
  }
  const { data, error } = await db.from('job_selections').insert({ job_id: ctx.jobId, item, allowance, options, due_date: due, status: 'draft', created_by: ctx.userId }).select('id').single()
  if (error || !data) return isMissingProjectToolsSchema(error) ? { error: PROJECT_TOOLS_NOT_READY, status: 409 } : { error: 'Could not save', status: 500 }
  return { id: data.id as string }
}

export async function cancelSelection(admin: SupabaseClient, ctx: { orgId: string; jobId: string }, id: string): Promise<{ ok: true } | Fail> {
  const { data, error } = await orgDb(admin, ctx.orgId).from('job_selections').update({ status: 'cancelled', link_token: null, updated_at: new Date().toISOString() }).eq('id', id).eq('job_id', ctx.jobId).in('status', ['draft', 'sent']).select('id')
  if (error) return { error: 'Could not cancel', status: 500 }
  return data && data.length > 0 ? { ok: true } : { error: 'Already chosen or not found', status: 409 }
}

export type JobContact = { projectId: string | null; name: string; email: string | null; address: string }

/** Who the job is for: its customer, else the project's customer / lead. */
export async function loadJobContact(admin: SupabaseClient, orgId: string, job: { customer_id: string | null; project_id: string | null; address_text: string | null }): Promise<JobContact> {
  const db = orgDb(admin, orgId)
  let name = ''
  let email: string | null = null
  if (job.customer_id) {
    const { data } = await db.from('customers').select('name, email').eq('id', job.customer_id).maybeSingle()
    name = data?.name ?? ''
    email = data?.email ?? null
  }
  if ((!name || !email) && job.project_id) {
    const { data: p } = await db.from('projects').select('customers(name, email), leads(homeowner_name, email)').eq('id', job.project_id).maybeSingle()
    const c = p ? (Array.isArray(p.customers) ? p.customers[0] : p.customers) : null
    const l = p ? (Array.isArray(p.leads) ? p.leads[0] : p.leads) : null
    name = name || c?.name || l?.homeowner_name || ''
    email = email || c?.email || l?.email || null
  }
  return { projectId: job.project_id, name: name || 'Customer', email, address: job.address_text || '' }
}

function validSignature(sig: unknown): sig is string {
  return typeof sig === 'string' && sig.length <= MAX_SIG_CHARS && SIG_RE.test(sig)
}

/** Send: make (or keep) the customer link, remember who asked + their signature (for a change order), email if asked. */
export async function sendSelection(
  admin: SupabaseClient,
  ctx: { orgId: string; userId: string; userName: string; jobId: string; contact: JobContact },
  id: string,
  opts: { repSignature: unknown; email: boolean }
): Promise<{ link: string; emailed: boolean } | Fail> {
  if (!validSignature(opts.repSignature)) return { error: 'Signature missing', status: 400 }
  const db = orgDb(admin, ctx.orgId)
  const { data: cur } = await db.from('job_selections').select('id, item, due_date, status, link_token').eq('id', id).eq('job_id', ctx.jobId).maybeSingle()
  if (!cur) return { error: 'Selection not found', status: 404 }
  if (cur.status === 'chosen' || cur.status === 'cancelled') return { error: 'This one is already settled', status: 409 }
  const appUrl = await orgAppUrl(ctx.orgId)
  const token = cur.link_token && TOKEN_RE.test(cur.link_token) ? (cur.link_token as string) : crypto.randomBytes(24).toString('base64url')
  const { error } = await db
    .from('job_selections')
    .update({
      link_token: token,
      token_expires_at: new Date(Date.now() + LINK_DAYS * 86400000).toISOString(),
      status: 'sent',
      sent_at: new Date().toISOString(),
      requested_by: ctx.userId,
      requested_by_name: ctx.userName,
      requested_signature: opts.repSignature,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('job_id', ctx.jobId)
    .in('status', ['draft', 'sent'])
  if (error) return { error: 'Could not send', status: 500 }
  const link = `${appUrl}/s/${token}`
  let emailed = false
  if (opts.email && ctx.contact.email) {
    try {
      const brand = await getDocumentBrand(admin, ctx.orgId)
      const mail = buildSelectionRequestEmail({ brand, customerName: ctx.contact.name, item: cur.item as string, link, dueDate: (cur.due_date as string | null) ?? null, repName: ctx.userName || brand.name })
      const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } })
      await transporter.sendMail({ from: getCrmEmailFrom(), to: ctx.contact.email, subject: mail.subject, text: mail.text, html: mail.html })
      emailed = true
    } catch (e) {
      console.error('[selections] email failed', e)
    }
  }
  return { link, emailed }
}

export type ChooseResult = { ok: true; state: 'approved' | 'needs_signature'; difference: number; signingUrl: string | null } | Fail

/**
 * Record the customer's pick. One claim (status draft/sent → chosen) so a double tap or two devices cannot make two change
 * orders. Overage → a change order for the DIFFERENCE through the existing system; if that fails the claim is undone.
 */
export async function chooseSelection(
  admin: SupabaseClient,
  args: { orgId: string; selectionId: string; optionId: string; byName: string; source: 'customer' | 'staff'; staffUserId?: string | null; staffName?: string | null; staffSignature?: unknown }
): Promise<ChooseResult> {
  const db = orgDb(admin, args.orgId)
  const { data: sel } = await db.from('job_selections').select(`${COLUMNS}, requested_signature, requested_by, requested_by_name`).eq('id', args.selectionId).maybeSingle()
  if (!sel) return { error: 'Not found', status: 404 }
  if (sel.status === 'chosen') return { error: 'This has already been chosen.', status: 409 }
  if (sel.status === 'cancelled') return { error: 'This selection was cancelled.', status: 409 }
  const option = readStoredOptions(sel.options).find((o) => o.id === args.optionId)
  if (!option) return { error: 'Pick one of the options', status: 400 }
  const allowance = toNum(sel.allowance)
  const diff = roundMoney(option.price - allowance)

  const repName = args.source === 'staff' ? args.staffName || 'Office' : (sel.requested_by_name as string | null) || ''
  const repSignature = args.source === 'staff' ? args.staffSignature : sel.requested_signature
  if (diff > 0 && (!repName || !validSignature(repSignature))) return { error: 'This request has no company signature on it. Ask the office to send it again.', status: 409 }

  const { data: claimed, error: claimErr } = await db
    .from('job_selections')
    .update({ status: 'chosen', chosen_option_id: option.id, chosen_label: option.label, chosen_price: option.price, chosen_at: new Date().toISOString(), chosen_by_name: args.byName.slice(0, 120), chosen_source: args.source, updated_at: new Date().toISOString() })
    .eq('id', args.selectionId)
    .in('status', ['draft', 'sent'])
    .select('id')
  if (claimErr) return { error: 'Could not save your choice. Please try again.', status: 500 }
  if (!claimed || claimed.length === 0) return { error: 'This has already been chosen.', status: 409 }

  if (diff <= 0) return { ok: true, state: 'approved', difference: diff, signingUrl: null }

  const undo = async (message: string, status = 500): Promise<Fail> => {
    await db.from('job_selections').update({ status: sel.status, chosen_option_id: null, chosen_label: null, chosen_price: null, chosen_at: null, chosen_by_name: null, chosen_source: null, updated_at: new Date().toISOString() }).eq('id', args.selectionId).eq('status', 'chosen').is('change_order_id', null)
    return { error: message, status }
  }

  const { data: job } = await db.from('production_jobs').select('id, project_id, customer_id, address_text, sale_amount').eq('id', sel.job_id).maybeSingle()
  if (!job?.project_id) return undo('This project has no signed contract to change yet, so the extra cost cannot become a change order. Ask the office.', 409)
  const contact = await loadJobContact(admin, args.orgId, job)

  const collected = sumCollectedCents(await getPaymentsByJob(admin, job.id)) / 100
  const description = selectionChangeOrderDescription({ item: sel.item as string, allowance, chosen_label: option.label, chosen_price: option.price })

  for (let attempt = 0; attempt < 3; attempt++) {
    // Build on the latest change order's total (like the Change order form does), else the job's sale amount. Re-read each try:
    // a 409 means another change order took the number a moment ago.
    const { data: cos } = await db.from('job_change_orders').select('co_number, updated_total').eq('project_id', job.project_id)
    const list = (cos ?? []) as Array<{ co_number: string; updated_total: number | string }>
    const latest = list.reduce<{ n: number; total: number } | null>((best, c) => {
      const n = parseInt(String(c.co_number).replace(/^CO-/, ''), 10)
      return Number.isFinite(n) && (!best || n > best.n) ? { n, total: toNum(c.updated_total) } : best
    }, null)
    const originalAmount = latest ? latest.total : toNum(job.sale_amount)
    const updatedTotal = roundMoney(originalAmount + diff)
    const res = await createRemoteChangeOrder(admin, {
      orgId: args.orgId,
      createdBy: sel.requested_by ?? args.staffUserId ?? null,
      projectId: job.project_id,
      jobId: job.id,
      coNumber: nextChangeOrderNumber(list.map((c) => c.co_number)),
      description,
      originalAmount,
      updatedTotal,
      updatedRemaining: Math.max(0, roundMoney(updatedTotal - collected)),
      customerPrintName: contact.name,
      customerName: contact.name,
      // A customer on this very page signs next, so no email (the link below goes straight to the signing page); office choice emails it.
      customerEmail: args.source === 'staff' ? contact.email : null,
      projectAddress: contact.address,
      repName,
      repSignature: repSignature as string,
      originalContractId: null,
      originalContractDate: null,
      paymentMethod: null,
      isCommissionable: true,
      activityUserId: args.staffUserId ?? sel.requested_by ?? null,
    })
    if (res.ok) {
      await db.from('job_selections').update({ change_order_id: res.changeOrderId }).eq('id', args.selectionId)
      return { ok: true, state: 'needs_signature', difference: diff, signingUrl: res.signingUrl }
    }
    if (res.status !== 409) return undo('We could not prepare the change order. Please try again.')
  }
  return undo('We could not prepare the change order. Please try again.')
}
