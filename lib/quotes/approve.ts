/**
 * Online quote approval — server only. The customer's act (typed name, time, address, what they ticked, the totals and terms
 * they saw) is recorded FIRST as one `quote_approvals` row (unique per proposal = single use; the claim). Everything after
 * is `finalizeApproval`, which can be repeated safely (each step checks what already happened):
 *
 *  1. the proposal is rewritten to what was sold: declined optional lines are removed (kept in the approval's snapshot),
 *     totals + tax snapshot set to the approved ones — so the commission base (contract − `proposals.tax_amount`), sold
 *     scope, materials and every other proposal reader see exactly what the customer bought;
 *  2. an ordinary `order_form_contracts` row is made (agreement 'installation', `quote_approval_id`) and signed through the
 *     EXISTING signing route (app/api/contracts/sign) — that one pipeline wins the deal, makes the project and job, writes
 *     the commission base (`syncJobSaleAndCommissionBase`) and notifies the owners. No second "won" writer;
 *  3. the deposit (if any) becomes an ordinary deposit invoice on that job and the customer pays it on the existing pay page
 *     (`/pay/<token>`, Stripe Connect). Payment lands through `recordJobPayment` like every other job payment.
 *
 * RECURRING LINES (service plan templates on the quote): not part of the one-time price and NEVER part of contract / job /
 * commission / deposit / balance money. `total_cents` is the ONE-TIME total (tax included), as before; the recurring first-season
 * ESTIMATE (existing plan maths, from max(line start, approval day)) is kept in `snapshot.recurring[]` and
 * `quote_approvals.recurring_estimate_cents`, and reporting (`rpt_recurring_sales`) shows it as its own dataset.
 * A PLAN-ONLY quote (no one-time total) has no contract, signing, job or deposit: approving it wins the deal, makes the plan(s) and
 * records the approval (the legal record + the sale). The `total_cents > 0` check needs a positive number there, so a plan-only
 * approval stores the estimate in `total_cents` as a placeholder; `approvalOneTimeCents` reads 0 for it, and nothing money-related
 * reads `total_cents` of a plan-only approval. COMMISSION on recurring sales: nothing is paid yet (owner's rule pending, see
 * CLAUDE.md); payroll reads contracts/jobs, which a recurring estimate never touches.
 *
 * DECISION (documented): for a company using online quotes, an APPROVED QUOTE == the SIGNED SALE AGREEMENT. The legal act is the
 * approval record; the contract row exists so every sales / payroll reader (which all filter `order_form_contracts` on
 * `completed`) counts it, but it carries no roofing terms or PDF — the terms the customer agreed to are in the approval snapshot.
 */
import { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

import { POST as signContract } from '@/app/api/contracts/sign/route'
import { orgAppUrl, tryOrgAppUrl } from '@/lib/company-links'
import { buildOrderFormContractSaleDescription, notifyOrgAdminsOfSale } from '@/lib/admin-sale-email'
import { customerSignedDocUrl } from '@/lib/files/files-object'
import { applyContractSignedStatuses } from '@/lib/job-status-events'
import { addInvoiceItem, computeInvoiceBalance, finalizeAndSendInvoice } from '@/lib/invoices'
import { loadOnlinePayments } from '@/lib/online-payments/accounts'
import { createPaymentLink, tooManyLinks } from '@/lib/online-payments/links'
import { orgDb } from '@/lib/supabase/org-db'
import { postMessage } from '@/lib/threads/post-message'
import { flagApprovalBlocked, NEEDS_DETAIL_MESSAGE } from '@/lib/quotes/blocked'
import { isOptionalLine } from '@/lib/quotes/pricing'
import { fingerprintOf, loadQuoteContext, priceForSelection, quoteDeposit, quoteTerms, recurringForSelection, type QuoteContext } from '@/lib/quotes/load'
import { approvalOneTimeCents, approvalRecurringEstimateCents, isRecurringLine } from '@/lib/quotes/recurring'
import type { QuoteLinkRow } from '@/lib/quotes/links'
import { newSigningTokenColumns, signingTokenOf } from '@/lib/signing-tokens'

export const FINALIZE_LEASE_MS = 2 * 60_000
const OPEN_STATUSES = ['draft', 'sent', 'viewed']
/** How long the (internal) signing token of an approval's contract stays valid: far out, so a retry never meets an expired token. */
export const APPROVAL_CONTRACT_TOKEN_DAYS = 3650

export type ApprovalRow = {
  id: string
  org_id: string
  proposal_id: string
  opportunity_id: string | null
  link_id: string | null
  typed_name: string
  approved_at: string
  approved_ip: string | null
  selected_item_ids: string[]
  snapshot: ApprovalSnapshot
  subtotal_cents: number
  discount_cents: number
  tax_cents: number
  total_cents: number
  deposit_cents: number
  contract_id: string | null
  job_id: string | null
  deposit_invoice_id: string | null
  proposal_rewritten_at: string | null
  finalized_at: string | null
  finalize_error: string | null
  confirmation_sent_at: string | null
}

export type ApprovalSnapshot = {
  proposalNumber: string | null
  title: string | null
  /** The customer as the approved quote named them (the PDF reads this, not the live proposal). */
  customer?: { name: string; address: string }
  terms: string
  /** Everything the customer read, so the stored PDF is exactly what was agreed (description/quantity/unit were added later: optional). */
  lines: Array<{ id: string; name: string; description?: string; quantity?: number | null; unit?: string; optional: boolean; chosen: boolean; cents: number }>
  declinedIds: string[]
  taxLines: Array<{ id: string | null; name: string; percent: number; amount_cents: number }>
  taxableCents: number
  legacyTax: boolean
  deposit: { mode: string; percent: number; cents: number }
  /** True when nothing one-time was approved: no contract, job or deposit; the approval itself is the sale record. */
  planOnly?: boolean
  /** Sum of the approved recurring lines' first-season estimates (cents); also stored on `quote_approvals.recurring_estimate_cents`. */
  recurringEstimateCents?: number
  /** Recurring lines (service plans) the customer saw, with the terms shown; `chosen` = approved. Absent on a quote with none. */
  recurring?: Array<{
    lineId: string
    name: string
    description?: string
    templateId: string
    templateName: string
    templateVersion: number
    startDate: string
    weekday: number | null
    priceCents: number
    billingBasis: string
    /** "$45 per visit · Apr 1–Oct 31 · about 15 visits" exactly as shown. */
    detail: string
    /** The terms line shown ("Billed after each visit. Cancel anytime."). */
    termsLine: string
    optional: boolean
    chosen: boolean
    estimatedVisits: number
    /** The first-season estimate of this line (summed into `recurring_estimate_cents`; never part of the one-time money). */
    firstSeasonCents: number
  }>
}

const APPROVAL_COLS =
  'id, org_id, proposal_id, opportunity_id, link_id, typed_name, approved_at, approved_ip, selected_item_ids, snapshot, subtotal_cents, discount_cents, tax_cents, total_cents, deposit_cents, contract_id, job_id, deposit_invoice_id, proposal_rewritten_at, finalized_at, finalize_error, confirmation_sent_at'

export async function loadApproval(admin: SupabaseClient, orgId: string, proposalId: string): Promise<ApprovalRow | null> {
  const { data } = await orgDb(admin, orgId).from('quote_approvals').select(APPROVAL_COLS).eq('proposal_id', proposalId).maybeSingle()
  return (data as ApprovalRow | null) ?? null
}

/** Pure: the name as typed — trimmed, spaces collapsed, 2–120 characters, no control characters. */
export function cleanTypedName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.replace(/\s+/g, ' ').trim()
  // eslint-disable-next-line no-control-regex
  if (v.length < 2 || v.length > 120 || /[\u0000-\u001f\u007f<>]/.test(v)) return null
  return v
}

/** Pure: the ticked ids must be unique ids of THIS quote's optional lines. */
export function validateSelection(ctx: Pick<QuoteContext, 'lines'>, raw: unknown): { ids: string[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: 'Choose your options again' }
  const optional = new Set(ctx.lines.filter(isOptionalLine).map((l) => l.id))
  const ids: string[] = []
  for (const v of raw) {
    if (typeof v !== 'string' || !optional.has(v)) return { error: 'One of the chosen items is not on this quote' }
    if (!ids.includes(v)) ids.push(v)
  }
  return { ids }
}

export type ApproveResult =
  | { ok: true; already: boolean; approvalId: string; finalized: boolean }
  | { ok: false; status: 400 | 404 | 409 | 410 | 500; error: string; changed?: boolean }

export async function approveQuote(
  admin: SupabaseClient,
  link: QuoteLinkRow,
  input: { typedName: unknown; selectedIds: unknown; fingerprint: unknown; agreed: unknown; ip: string; userAgent: string | null; pageUrl: string | null },
  now: Date = new Date()
): Promise<ApproveResult> {
  const orgId = link.org_id
  const ctx = await loadQuoteContext(admin, orgId, link.proposal_id)
  if (!ctx) return { ok: false, status: 404, error: 'This quote is not available' }
  const existing = await loadApproval(admin, orgId, ctx.proposal.id)
  if (existing) {
    // Single use: a second tap (or a second device) gets the first approval back and, if it stopped half way, finishes it.
    const done = existing.finalized_at ? true : await finalizeApproval(admin, orgId, existing.id, { pageUrl: input.pageUrl, now })
    return { ok: true, already: true, approvalId: existing.id, finalized: done }
  }
  const p = ctx.proposal
  if (p.expires_at && Date.parse(p.expires_at) < now.getTime()) return { ok: false, status: 410, error: 'This quote has expired. Please contact us for a new one.' }
  if (!OPEN_STATUSES.includes(String(p.status))) return { ok: false, status: 409, error: 'This quote can no longer be approved. Please contact us.' }
  if (input.agreed !== true) return { ok: false, status: 400, error: 'Please tick the box to agree' }
  const name = cleanTypedName(input.typedName)
  if (!name) return { ok: false, status: 400, error: 'Type your full name to approve' }
  if (!p.opportunity_id || !(p.customer_name ?? '').trim() || !(p.customer_address ?? '').trim()) return { ok: false, status: 409, error: 'This quote is not ready to approve. Please contact us.' }
  // Who gets credit for the sale is confirmed by the office when the link is sent (see the quote-link route). The signing
  // pipeline falls back to the contract's creator for an opportunity with no closer; never let that be whoever sent the link.
  const { data: oppRow } = await orgDb(admin, orgId).from('opportunities').select('owner_user_id').eq('id', p.opportunity_id).maybeSingle()
  if (!(oppRow as { owner_user_id?: string | null } | null)?.owner_user_id) {
    // A link sent before the rule: hold the approval, tell the sender (Needs-you row), and keep the customer's tone friendly.
    await flagApprovalBlocked(admin, orgId, link.id)
    return { ok: false, status: 409, error: NEEDS_DETAIL_MESSAGE }
  }
  const sel = validateSelection(ctx, input.selectedIds)
  if ('error' in sel) return { ok: false, status: 400, error: sel.error }
  if (input.fingerprint !== fingerprintOf(ctx)) return { ok: false, status: 409, changed: true, error: 'This quote was just updated. Please look it over again.' }

  // One approved sale per deal: signing a second installation agreement on the same deal voids the first (existing rule).
  // (A plan-only quote makes no installation contract, so an earlier sale on the deal does not stand in its way.)
  const planOnlyEarly = recurringForSelection(ctx, sel.ids).chosen.length > 0 && priceForSelection(ctx, sel.ids).totalCents <= 0
  const { data: signed } = planOnlyEarly ? { data: [] } : await orgDb(admin, orgId)
    .from('order_form_contracts')
    .select('id')
    .eq('opportunity_id', p.opportunity_id)
    .eq('agreement_type', 'installation')
    .eq('status', 'completed')
    .limit(1)
  if ((signed ?? []).length > 0) return { ok: false, status: 409, error: 'This job already has an approved quote. Please contact us.' }

  const price = priceForSelection(ctx, sel.ids)
  const rec = recurringForSelection(ctx, sel.ids)
  if (rec.unsupported.length > 0) return { ok: false, status: 409, error: 'This quote can’t be approved online right now. Please contact us.' }
  const estimateCents = rec.chosen.reduce((n, c) => n + c.info.facts.firstSeasonCents, 0)
  const planOnly = price.totalCents <= 0 && rec.chosen.length > 0
  if (price.totalCents <= 0 && estimateCents <= 0) return { ok: false, status: 400, error: 'The total must be more than $0' }
  // No one-time work = no deposit (the deposit is a share of the one-time total only).
  const dep = quoteDeposit(ctx, price.totalCents)
  const picked = new Set(sel.ids)
  const recurringSnap: NonNullable<ApprovalSnapshot['recurring']> = ctx.lines.filter(isRecurringLine).map((l) => {
    const info = ctx.recurring[l.id]
    // An optional line the customer left unticked that cannot be sold (template gone / off) is recorded as not chosen; it never blocks the rest.
    if (!info) return { lineId: l.id, name: l.name, description: (l.description ?? '').trim(), templateId: String(l.service_plan_template_id), templateName: l.name, templateVersion: 0, startDate: String(l.plan_start_date ?? ''), weekday: l.plan_weekday ?? null, priceCents: Math.round((Number(l.unit_price) || 0) * 100), billingBasis: '', detail: '', termsLine: '', optional: isOptionalLine(l), chosen: false, estimatedVisits: 0, firstSeasonCents: 0 }
    return {
      lineId: l.id,
      name: l.name,
      description: (l.description ?? '').trim(),
      templateId: info.template.id,
      templateName: info.template.name,
      templateVersion: info.template.version,
      startDate: String(l.plan_start_date),
      weekday: l.plan_weekday ?? null,
      priceCents: info.facts.priceCents,
      billingBasis: info.facts.basis,
      detail: info.facts.detail,
      termsLine: info.facts.termsLine,
      optional: isOptionalLine(l),
      chosen: !isOptionalLine(l) || picked.has(l.id),
      estimatedVisits: info.facts.visits,
      firstSeasonCents: info.facts.firstSeasonCents,
    }
  })
  const snapshot: ApprovalSnapshot = {
    proposalNumber: p.proposal_number,
    title: p.title,
    customer: { name: (p.customer_name ?? '').trim(), address: (p.customer_address ?? '').trim() },
    terms: quoteTerms(ctx),
    lines: ctx.lines.filter((l) => !isRecurringLine(l)).map((l) => ({ id: l.id, name: l.name, description: (l.description ?? '').trim(), quantity: l.quantity ?? null, unit: l.unit ?? '', optional: isOptionalLine(l), chosen: !isOptionalLine(l) || picked.has(l.id), cents: price.lineCents[l.id] ?? 0 })),
    declinedIds: ctx.lines.filter((l) => isOptionalLine(l) && !picked.has(l.id)).map((l) => l.id),
    taxLines: price.taxLines,
    taxableCents: price.taxableCents,
    legacyTax: price.legacy,
    deposit: { mode: dep.mode, percent: dep.percent, cents: dep.cents },
    ...(recurringSnap.length > 0 ? { recurring: recurringSnap, recurringEstimateCents: estimateCents } : {}),
    ...(planOnly ? { planOnly: true } : {}),
  }
  const { data: row, error } = await orgDb(admin, orgId)
    .from('quote_approvals')
    .insert({
      proposal_id: p.id,
      opportunity_id: p.opportunity_id,
      link_id: link.id,
      typed_name: name,
      approved_at: now.toISOString(),
      approved_ip: input.ip.slice(0, 80),
      approved_user_agent: input.userAgent ? input.userAgent.slice(0, 300) : null,
      selected_item_ids: sel.ids,
      snapshot,
      subtotal_cents: price.subtotalCents,
      discount_cents: price.discountCents,
      tax_cents: price.taxCents,
      // One-time total, as always. A plan-only approval has none: the estimate stands in (the table requires > 0; see the header).
      total_cents: planOnly ? estimateCents : price.totalCents,
      ...(rec.chosen.length > 0 ? { recurring_estimate_cents: estimateCents } : {}),
      deposit_cents: dep.cents,
    })
    .select('id')
    .single()
  if (error || !row) {
    if (error?.code === '23505') {
      // A second request won the race: use its approval.
      const winner = await loadApproval(admin, orgId, p.id)
      if (winner) return { ok: true, already: true, approvalId: winner.id, finalized: !!winner.finalized_at }
    }
    console.error('approveQuote: could not record the approval', error)
    return { ok: false, status: 500, error: 'We could not record your approval. Please try again.' }
  }
  const approvalId = (row as { id: string }).id
  const finalized = await finalizeApproval(admin, orgId, approvalId, { pageUrl: input.pageUrl, now })
  return { ok: true, already: false, approvalId, finalized }
}

async function claim(admin: SupabaseClient, orgId: string, approvalId: string, now: Date): Promise<boolean> {
  const stale = new Date(now.getTime() - FINALIZE_LEASE_MS).toISOString()
  const { data } = await orgDb(admin, orgId)
    .from('quote_approvals')
    .update({ finalize_claimed_at: now.toISOString() })
    .eq('id', approvalId)
    .is('finalized_at', null)
    .or(`finalize_claimed_at.is.null,finalize_claimed_at.lt.${stale}`)
    .select('id')
  return (data ?? []).length === 1
}

async function setApproval(admin: SupabaseClient, orgId: string, approvalId: string, patch: Record<string, unknown>) {
  const { error } = await orgDb(admin, orgId).from('quote_approvals').update(patch).eq('id', approvalId)
  if (error) throw new Error(`quote approval update: ${error.message}`)
}

/**
 * Plan-only sale: (1) the "won" note on the deal, written through the one thread write path (`postMessage`: an ordinary 'note', not a
 * `status_change`, so job catch-up does not read it as job movement), keyed on the approval so it is written once per approval;
 * (2) the owner sale email, once, marked by `quote_approvals.sale_notified_at`. Both are safe to call on every finalize run.
 */
async function announcePlanOnlySale(
  admin: SupabaseClient,
  orgId: string,
  approval: ApprovalRow,
  ctx: { proposalNumber: string | null; customerName: string; creator: string | null }
): Promise<{ noteError: string | null }> {
  const db = orgDb(admin, orgId)
  const oppId = approval.opportunity_id as string
  const { data: opp } = await db.from('opportunities').select('id, owner_user_id, setter_user_id, customer_id, lead_id').eq('id', oppId).maybeSingle()
  const deal = opp as { id: string; owner_user_id: string | null; setter_user_id: string | null; customer_id: string | null; lead_id: string | null } | null
  if (!deal) return { noteError: null }
  const snap = approval.snapshot
  const estimate = (approvalRecurringEstimateCents(approval) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })

  // The author is whoever sent the quote link; if the thread write path refuses them, the deal's closer. Both are active staff of
  // this company. The note keeps the dollar amount, so it is stored pricing-restricted (setters / field roles never read it).
  type Author = { id: string; org_id: string; role: string; custom_role_id?: string | null; is_super_admin?: boolean | null; active?: boolean | null }
  const tryAuthor = async (userId: string | null): Promise<string | null> => {
    if (!userId) return 'no author'
    const { data: author } = await db.from('users').select('id, org_id, role, custom_role_id, is_super_admin, active').eq('id', userId).maybeSingle()
    if (!author) return 'author not found'
    const posted = await postMessage(admin, author as Author, deal, {
      body: `Won: recurring service approved online${ctx.proposalNumber ? ` (quote ${ctx.proposalNumber})` : ''} by ${approval.typed_name}, about ${estimate} est. first season. No job or contract.`,
      audience: 'sales',
      clientId: `quote-approval-won:${approval.id}`,
      source: 'quote_approval',
      origin: 'system',
      noMentions: true,
      keepPricingRestricted: true,
    })
    return posted.ok ? null : posted.error
  }
  const authorId = ctx.creator ?? deal.owner_user_id
  let noteError = await tryAuthor(authorId)
  if (noteError && deal.owner_user_id && deal.owner_user_id !== authorId) noteError = await tryAuthor(deal.owner_user_id)
  if (noteError) console.error('plan-only won note not written', approval.id, noteError)

  const { data: sent, error: sentErr } = await db.from('quote_approvals').select('sale_notified_at').eq('id', approval.id).maybeSingle()
  // Column not there yet (migration pending): say nothing rather than risk a second email on every run.
  if (sentErr || (sent as { sale_notified_at?: string | null } | null)?.sale_notified_at) return { noteError }
  const ids = [deal.owner_user_id, deal.setter_user_id].filter(Boolean) as string[]
  const { data: people } = ids.length > 0 ? await db.from('users').select('id, full_name').in('id', ids) : { data: [] }
  const nameOf = (id?: string | null) => ((people ?? []) as { id: string; full_name: string }[]).find((u) => u.id === id)?.full_name ?? null
  const appUrl = await tryOrgAppUrl(orgId, 'quote plan-only sale notice')
  await notifyOrgAdminsOfSale(admin, {
    orgId,
    customerName: ctx.customerName || 'Customer',
    soldDescription: `${buildOrderFormContractSaleDescription({ scope_other: snap.recurring?.filter((r) => r.chosen).map((r) => `${r.name} (recurring)`).join(', ') })} — recurring service, no job`,
    totalAmount: approvalRecurringEstimateCents(approval) / 100,
    setterName: nameOf(deal.setter_user_id),
    closerName: nameOf(deal.owner_user_id),
    recordUrl: appUrl ? `${appUrl}/opportunities/${oppId}` : undefined,
  })
  await setApproval(admin, orgId, approval.id, { sale_notified_at: new Date().toISOString() })
  return { noteError }
}

/**
 * Finish what an approval starts. Safe to call again and again (a page load, the office's "Finish" button): one runner at a
 * time (a 2-minute lease), each step skips what is already done. Returns true when everything is in place.
 */
export async function finalizeApproval(admin: SupabaseClient, orgId: string, approvalId: string, opts: { pageUrl?: string | null; now?: Date } = {}): Promise<boolean> {
  const now = opts.now ?? new Date()
  if (!(await claim(admin, orgId, approvalId, now))) {
    const { data } = await orgDb(admin, orgId).from('quote_approvals').select('finalized_at').eq('id', approvalId).maybeSingle()
    return !!(data as { finalized_at?: string | null } | null)?.finalized_at
  }
  try {
    const { data: a } = await orgDb(admin, orgId).from('quote_approvals').select(APPROVAL_COLS).eq('id', approvalId).maybeSingle()
    const approval = a as ApprovalRow | null
    if (!approval) return false
    const db = orgDb(admin, orgId)
    const { data: pr } = await db.from('proposals').select('id, status, opportunity_id, proposal_number, customer_name, customer_email, customer_phone, customer_address, discount_percent, created_by').eq('id', approval.proposal_id).maybeSingle()
    const proposal = pr as { id: string; status: string; opportunity_id: string | null; proposal_number: string | null; customer_name: string; customer_email: string | null; customer_phone: string | null; customer_address: string; discount_percent: number | null; created_by: string | null } | null
    if (!proposal) throw new Error('proposal missing')
    const snap = approval.snapshot
    let creator: string | null = proposal.created_by
    if (approval.link_id) {
      const { data: l } = await db.from('quote_links').select('created_by').eq('id', approval.link_id).maybeSingle()
      creator = (l as { created_by?: string | null } | null)?.created_by ?? creator
    }

    // 1. The proposal becomes what was sold.
    if (!approval.proposal_rewritten_at) {
      if (snap.declinedIds.length > 0) await db.from('proposal_line_items').delete().eq('proposal_id', proposal.id).in('id', snap.declinedIds)
      if (approval.selected_item_ids.length > 0) await db.from('proposal_line_items').update({ is_optional: false }).eq('proposal_id', proposal.id).in('id', approval.selected_item_ids)
      const patch: Record<string, unknown> = {
        subtotal: approval.subtotal_cents / 100,
        tax_amount: approval.tax_cents / 100,
        // The proposal is what was sold ONE TIME (a plan-only approval keeps its recurring estimate in total_cents as a placeholder).
        total: approvalOneTimeCents(approval) / 100,
      }
      if (Number(proposal.discount_percent) > 0 || approval.discount_cents > 0) patch.discount_amount = approval.discount_cents / 100
      if (!snap.legacyTax) {
        patch.tax_lines = snap.taxLines
        patch.taxable_subtotal = snap.taxableCents / 100
      }
      const { error } = await db.from('proposals').update(patch).eq('id', proposal.id)
      if (error) throw new Error(`rewrite proposal: ${error.message}`)
      await setApproval(admin, orgId, approvalId, { proposal_rewritten_at: now.toISOString() })
      approval.proposal_rewritten_at = now.toISOString()
    }

    // A PLAN-ONLY quote (nothing one-time) has no installation contract, no signing, no job and no deposit: the approval wins the
    // deal, makes the plan(s), and is the sale record (rpt_recurring_sales reads `recurring_estimate_cents`). Contract / job money is never touched.
    const planOnly = snap.planOnly === true
    let contractId = approval.contract_id
    let contractToken: string | null = null
    let jobId = approval.job_id
    let note: string | null = null
    // False when the owner sale notice failed: the approval then stays unfinished so the next run (page load, "Finish") sends it.
    let announced = true
    if (planOnly) {
      if (approval.opportunity_id) {
        const { data: o } = await db.from('opportunities').select('customer_id').eq('id', approval.opportunity_id).maybeSingle()
        const won: Record<string, unknown> = { status: 'won' }
        const cid = (o as { customer_id?: string | null } | null)?.customer_id
        if (cid) won.customer_id = cid
        await db.from('opportunities').update(won).eq('id', approval.opportunity_id).neq('status', 'won')
      }
      // The same status writer the signing pipeline uses: proposal -> accepted, the deal's past inspections closed out.
      await applyContractSignedStatuses(admin, { orgId, proposalId: proposal.id, opportunityId: approval.opportunity_id, projectId: null, signedAtIso: approval.approved_at })
      // The won note and the owner "sale" notice belong to the APPROVAL, not to the run that flipped the deal: any run that has
      // not done them yet does them (the note is keyed on the approval, the email on `sale_notified_at`), so a retry after a
      // stop in between, or a deal already won by hand, still gets both exactly once.
      if (approval.opportunity_id) {
        try {
          const { noteError } = await announcePlanOnlySale(admin, orgId, approval, { proposalNumber: proposal.proposal_number, customerName: proposal.customer_name, creator })
          if (noteError) note = `${note ? `${note} ` : ''}The "won" note could not be added to the deal.`
        } catch (e) {
          announced = false
          console.error('plan-only sale notice failed', approvalId, e)
          note = `${note ? `${note} ` : ''}The owner sale notice could not be sent.`
        }
      }
    } else {
    // 2. The signed sale — through the one signing pipeline.
    if (!contractId) {
      const { columns: signingTokenColumns } = newSigningTokenColumns('contract')
      const chosen = snap.lines.filter((l) => l.chosen).map((l) => l.name)
      const { data: c, error } = await db
        .from('order_form_contracts')
        .insert({
          agreement_type: 'installation',
          opportunity_id: approval.opportunity_id,
          proposal_id: proposal.id,
          customer_name: proposal.customer_name,
          customer_email: proposal.customer_email,
          customer_phone: proposal.customer_phone,
          project_address: proposal.customer_address,
          project_cost: approval.total_cents / 100,
          payment_method: 'other',
          deposit_amount: approval.deposit_cents / 100,
          scope_other: chosen.join(', ').slice(0, 1000) || null,
          notes: `Approved online${proposal.proposal_number ? ` (quote ${proposal.proposal_number})` : ''} by ${approval.typed_name}.`,
          status: 'pending_customer',
          created_by: creator,
          quote_approval_id: approval.id,
          ...signingTokenColumns,
          // The signing link of this contract is never sent to anyone (we sign it ourselves, now or on a retry), and the quote
          // link has its own expiry. The 7-day default would make a retry after a week fail forever.
          token_expires_at: new Date(now.getTime() + APPROVAL_CONTRACT_TOKEN_DAYS * 86_400_000).toISOString(),
        })
        .select('id')
        .single()
      if (error || !c) throw new Error(`make contract: ${error?.message ?? 'unknown'}`)
      contractId = (c as { id: string }).id
      await setApproval(admin, orgId, approvalId, { contract_id: contractId })
    }
    const { data: ct } = await db.from('order_form_contracts').select('id, status, signing_token, signing_token_enc, pdf_url').eq('id', contractId).maybeSingle()
    const contractRow = ct as { id: string; status: string; signing_token: string | null; signing_token_enc: string | null; pdf_url: string | null } | null
    if (!contractRow) throw new Error('contract missing')
    const contract = { ...contractRow, signing_token: signingTokenOf(contractRow) }
    if (!contract.signing_token) throw new Error('contract link unreadable')
    contractToken = contract.signing_token
    // A COMPLETED contract is never reopened (it would drop out of sales and payroll, overwrite customer_signed_at, re-send the
    // sale email, and a lease expiry could then make a second job). The signing route marks a contract completed BEFORE it
    // makes the project and job; if it stopped in between, the contract reads completed with no job. The one recovery is the
    // signing route's own idempotent "finish what is missing" call on the SAME token (project/job, won, voiding, commission
    // base — never touching status or the signed fields; a quote approval makes no roofing PDF and sends no contract email). The per-approval lease taken above
    // is the lock; the job is re-checked right before the call, so no second job is ever made from here.
    // The route finishes a completed-but-unfinished contract (finishSignedContract, CLAUDE.md "Signing safety") only once its own
    // 2-minute lease is stale; inside that window it answers 200 and does nothing, and the check below makes this attempt fail
    // ("the job was not created") so the next retry — after the lease — completes it.
    const jobExists = async () => ((await db.from('production_jobs').select('id').eq('accepted_proposal_id', proposal.id).limit(1)).data ?? []).length > 0
    if (contract.status !== 'completed' || (!approval.job_id && !(await jobExists()))) {
      const res = await signContract(
        new NextRequest('http://internal.invalid/api/contracts/sign', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': approval.approved_ip ?? 'unknown' },
          body: JSON.stringify({ token: contract.signing_token, printName: approval.typed_name, signature: `typed:${approval.typed_name}` }),
        })
      )
      const body = (await res.json().catch(() => ({}))) as { error?: string; projectCreateError?: string | null }
      if (!res.ok) throw new Error(`signing: ${body.error ?? res.status}`)
      // The route answers 200 even when the project/job step failed; that is a failure here so the retry finishes it.
      if (body.projectCreateError) throw new Error(`job setup: ${body.projectCreateError}`)
    }

    // 3. The job it made, and the deposit invoice on it.
    if (!jobId) {
      const { data: j } = await db.from('production_jobs').select('id, sale_amount').eq('accepted_proposal_id', proposal.id).limit(1)
      const job = ((j ?? []) as Array<{ id: string; sale_amount: number | null }>)[0]
      if (!job) throw new Error('the job was not created')
      jobId = job.id
      await setApproval(admin, orgId, approvalId, { job_id: jobId })
      if (Math.abs(Number(job.sale_amount ?? 0) - approval.total_cents / 100) > 0.05) note = `Job sale amount (${job.sale_amount}) differs from the approved total (${approval.total_cents / 100}) — check the job.`
    }
    if (approval.deposit_cents > 0 && !approval.deposit_invoice_id) {
      const invoiceId = await makeDepositInvoice(admin, orgId, jobId!, creator ?? proposal.created_by, approval.deposit_cents, snap.deposit, proposal.customer_email)
      await setApproval(admin, orgId, approvalId, { deposit_invoice_id: invoiceId })
      approval.deposit_invoice_id = invoiceId
    }
    }
    // 3a. Recurring lines become service plans (idempotent: one plan per quote line, ever). Before the PDF + email, which name the first visit.
    let plans: Awaited<ReturnType<typeof import('@/lib/quotes/recurring-plans').ensureQuotePlans>> = []
    if ((snap.recurring ?? []).some((r) => r.chosen)) {
      const { ensureQuotePlans } = await import('@/lib/quotes/recurring-plans')
      plans = await ensureQuotePlans(admin, orgId, {
        snapshot: snap,
        opportunityId: approval.opportunity_id,
        customer: { name: proposal.customer_name, email: proposal.customer_email, phone: proposal.customer_phone, address: proposal.customer_address },
        userId: creator,
        approvalId,
        now,
      })
    }
    // 3b. The record of what was agreed, from the snapshot. The sale already stands, so a PDF failure is noted for the office
    // (and the customer still gets the page), never held against the approval.
    let pdfPath: string | null = null
    try {
      // Already stored (a contract's pdf, or a plan-only approval's own `pdf_path`): reuse it, never render again on a rerun.
      const { approvalPdfPath } = await import('@/lib/quotes/approval-pdf-path')
      pdfPath = await approvalPdfPath(admin, orgId, { id: approvalId, contract_id: contractId })
      if (!pdfPath) {
        const { storeApprovalPdf } = await import('@/lib/quotes/pdf')
        pdfPath = await storeApprovalPdf(admin, orgId, approval, contractId, { name: proposal.customer_name, address: proposal.customer_address })
      }
    } catch (e) {
      console.error('quote approval PDF failed', approvalId, e)
      note = `${note ? `${note} ` : ''}The approval PDF could not be made — the approval record itself is saved.`
    }
    await setApproval(admin, orgId, approvalId, announced ? { finalized_at: now.toISOString(), finalize_error: note } : { finalize_error: note }) // unfinished: the lease stays, so a rerun backs off FINALIZE_LEASE_MS

    // 4. One confirmation to the customer (the sale email to the owners is the signing pipeline's).
    if (!approval.confirmation_sent_at && proposal.customer_email) {
      const { sendApprovalConfirmation } = await import('@/lib/quotes/send')
      // The customer's copy goes through the signing-token download route (never a bucket URL), like a signed contract's.
      const copyUrl = pdfPath && contractToken ? customerSignedDocUrl('contract', contractToken, await tryOrgAppUrl(orgId, 'quote approval copy')) : null
      const sent = await sendApprovalConfirmation(admin, orgId, approval, proposal.customer_email, opts.pageUrl ?? null, copyUrl, plans).catch((e) => {
        console.error('quote approval confirmation failed', e)
        return false
      })
      if (sent) await setApproval(admin, orgId, approvalId, { confirmation_sent_at: new Date().toISOString() })
    }
    return announced
  } catch (e) {
    console.error('finalizeApproval failed (will be retried)', approvalId, e)
    await orgDb(admin, orgId).from('quote_approvals').update({ finalize_error: (e instanceof Error ? e.message : 'unknown').slice(0, 300), finalize_claimed_at: null }).eq('id', approvalId)
    return false
  }
}

async function makeDepositInvoice(
  admin: SupabaseClient,
  orgId: string,
  jobId: string,
  createdBy: string | null,
  cents: number,
  dep: { mode: string; percent: number },
  email: string | null
): Promise<string> {
  const { data: ex } = await orgDb(admin, orgId).from('production_jobs').select('id').eq('id', jobId).maybeSingle()
  if (!ex) throw new Error('job not found for the deposit')
  // An earlier attempt may have stopped half way (invoice made, line not added, or never sent). Reuse the invoice, but
  // finish only what is missing: add the line when there is none, send when it is still a draft. A complete one is left alone.
  // org-scope-ok: the job was just read in orgId above; job_invoices.org_id is set by trigger from the job
  const { data: found } = await admin.from('job_invoices').select('id, status, job_invoice_items(id)').eq('job_id', jobId).eq('invoice_kind', 'deposit').neq('status', 'void').order('created_at', { ascending: true }).limit(1)
  let inv = ((found ?? []) as Array<{ id: string; status: string; job_invoice_items?: Array<{ id: string }> | null }>)[0] ?? null
  if (!inv) {
    if (!createdBy) throw new Error('no one to own the deposit invoice')
    // org-scope-ok: insert; org_id comes from the job by trigger
    const { data: made, error } = await admin
      .from('job_invoices')
      .insert({ job_id: jobId, created_by: createdBy, status: 'draft', invoice_kind: 'deposit', public_note: 'Thank you for approving your quote.' })
      .select('id, status')
      .single()
    if (error || !made) throw new Error(`deposit invoice: ${error?.message ?? 'unknown'}`)
    inv = { ...(made as { id: string; status: string }), job_invoice_items: [] }
  }
  if ((inv.job_invoice_items ?? []).length === 0 && inv.status === 'draft') {
    await addInvoiceItem(admin, inv.id, { description: dep.mode === 'percent' ? `Deposit (${dep.percent}%)` : 'Deposit', qty: 1, unit_price_cents: cents })
  }
  if (inv.status === 'draft') await finalizeAndSendInvoice(admin, inv.id, email ?? '')
  return inv.id
}

/* ------------------------------------------------------------------------------------------------------------------ *
 * Paying the deposit — the existing pay page; this only makes its link.
 * ------------------------------------------------------------------------------------------------------------------ */

export type DepositState = { state: 'none' | 'paid' | 'due'; canPayOnline: boolean }

export async function depositStateFor(admin: SupabaseClient, orgId: string, approval: ApprovalRow): Promise<DepositState> {
  if (approval.deposit_cents <= 0) return { state: 'none', canPayOnline: false }
  if (!approval.deposit_invoice_id) return { state: 'due', canPayOnline: false }
  const bal = await computeInvoiceBalance(admin, approval.deposit_invoice_id)
  const op = await loadOnlinePayments(admin, orgId)
  return { state: bal.is_paid ? 'paid' : 'due', canPayOnline: op.ready && !bal.is_paid }
}

/** A fresh pay link for the deposit invoice (the page then opens `/pay/<token>`). Null when there is nothing to pay online. */
export async function makeDepositPayUrl(admin: SupabaseClient, orgId: string, approval: ApprovalRow): Promise<{ url: string } | { error: string; status: 409 | 429 | 503 }> {
  if (!approval.finalized_at || !approval.deposit_invoice_id || approval.deposit_cents <= 0) return { error: 'There is no deposit to pay yet.', status: 409 }
  const st = await depositStateFor(admin, orgId, approval)
  if (st.state === 'paid') return { error: 'The deposit is already paid. Thank you!', status: 409 }
  if (!st.canPayOnline) return { error: 'Online payment is not available right now. We will contact you about the deposit.', status: 503 }
  if (await tooManyLinks(admin, orgId, { invoiceId: approval.deposit_invoice_id })) return { error: 'Too many tries. Please wait a few minutes.', status: 429 }
  const link = await createPaymentLink(admin, orgId, { kind: 'invoice', invoiceId: approval.deposit_invoice_id }, null)
  return { url: link.url }
}

export async function quotePageUrl(orgId: string, token: string): Promise<string> {
  return `${await orgAppUrl(orgId)}/q/${token}`
}
