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
 * DECISION (documented): for a company using online quotes, an APPROVED QUOTE == the SIGNED SALE AGREEMENT. The legal act is the
 * approval record; the contract row exists so every sales / payroll reader (which all filter `order_form_contracts` on
 * `completed`) counts it, but it carries no roofing terms or PDF — the terms the customer agreed to are in the approval snapshot.
 */
import { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

import { POST as signContract } from '@/app/api/contracts/sign/route'
import { orgAppUrl, tryOrgAppUrl } from '@/lib/company-links'
import { customerSignedDocUrl } from '@/lib/files/files-object'
import { addInvoiceItem, computeInvoiceBalance, finalizeAndSendInvoice } from '@/lib/invoices'
import { loadOnlinePayments } from '@/lib/online-payments/accounts'
import { createPaymentLink, tooManyLinks } from '@/lib/online-payments/links'
import { orgDb } from '@/lib/supabase/org-db'
import { flagApprovalBlocked, NEEDS_DETAIL_MESSAGE } from '@/lib/quotes/blocked'
import { isOptionalLine } from '@/lib/quotes/pricing'
import { fingerprintOf, loadQuoteContext, priceForSelection, quoteDeposit, quoteTerms, type QuoteContext } from '@/lib/quotes/load'
import type { QuoteLinkRow } from '@/lib/quotes/links'

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
  const { data: signed } = await orgDb(admin, orgId)
    .from('order_form_contracts')
    .select('id')
    .eq('opportunity_id', p.opportunity_id)
    .eq('agreement_type', 'installation')
    .eq('status', 'completed')
    .limit(1)
  if ((signed ?? []).length > 0) return { ok: false, status: 409, error: 'This job already has an approved quote. Please contact us.' }

  const price = priceForSelection(ctx, sel.ids)
  if (price.totalCents <= 0) return { ok: false, status: 400, error: 'The total must be more than $0' }
  const dep = quoteDeposit(ctx, price.totalCents)
  const picked = new Set(sel.ids)
  const snapshot: ApprovalSnapshot = {
    proposalNumber: p.proposal_number,
    title: p.title,
    customer: { name: (p.customer_name ?? '').trim(), address: (p.customer_address ?? '').trim() },
    terms: quoteTerms(ctx),
    lines: ctx.lines.map((l) => ({ id: l.id, name: l.name, description: (l.description ?? '').trim(), quantity: l.quantity ?? null, unit: l.unit ?? '', optional: isOptionalLine(l), chosen: !isOptionalLine(l) || picked.has(l.id), cents: price.lineCents[l.id] ?? 0 })),
    declinedIds: ctx.lines.filter((l) => isOptionalLine(l) && !picked.has(l.id)).map((l) => l.id),
    taxLines: price.taxLines,
    taxableCents: price.taxableCents,
    legacyTax: price.legacy,
    deposit: { mode: dep.mode, percent: dep.percent, cents: dep.cents },
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
      total_cents: price.totalCents,
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
        total: approval.total_cents / 100,
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

    // 2. The signed sale — through the one signing pipeline.
    let contractId = approval.contract_id
    if (!contractId) {
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
    const { data: ct } = await db.from('order_form_contracts').select('id, status, signing_token, pdf_url').eq('id', contractId).maybeSingle()
    const contract = ct as { id: string; status: string; signing_token: string; pdf_url: string | null } | null
    if (!contract) throw new Error('contract missing')
    // A COMPLETED contract is never reopened (it would drop out of sales and payroll, overwrite customer_signed_at, re-send the
    // sale email, and a lease expiry could then make a second job). The signing route marks a contract completed BEFORE it
    // makes the project and job; if it stopped in between, the contract reads completed with no job. The one recovery is the
    // signing route's own idempotent "finish what is missing" call on the SAME token (fix/signing-safety: project/job, won,
    // voiding, commission base, PDF, email — never touching status or the signed fields). The per-approval lease taken above
    // is the lock; the job is re-checked right before the call, so no second job is ever made from here.
    // TODO(fix/signing-safety): until that route change is merged the route answers 400 "already signed" and finishes
    // nothing — the retry then fails with "the job was not created" and the office sees it on the approval card.
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
      const alreadySigned = contract.status === 'completed' && !res.ok && /already been signed/i.test(body.error ?? '')
      if (!res.ok && !alreadySigned) throw new Error(`signing: ${body.error ?? res.status}`)
      // The route answers 200 even when the project/job step failed; that is a failure here so the retry finishes it.
      if (body.projectCreateError) throw new Error(`job setup: ${body.projectCreateError}`)
    }

    // 3. The job it made, and the deposit invoice on it.
    let jobId = approval.job_id
    let note: string | null = null
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
    // 3b. The record of what was agreed, from the snapshot. The sale already stands, so a PDF failure is noted for the office
    // (and the customer still gets the page), never held against the approval.
    let pdfPath: string | null = null
    try {
      const { data: have } = await db.from('order_form_contracts').select('pdf_url').eq('id', contractId).maybeSingle()
      pdfPath = (have as { pdf_url?: string | null } | null)?.pdf_url ?? null
      if (!pdfPath) {
        const { storeApprovalPdf } = await import('@/lib/quotes/pdf')
        pdfPath = await storeApprovalPdf(admin, orgId, approval, contractId, { name: proposal.customer_name, address: proposal.customer_address })
      }
    } catch (e) {
      console.error('quote approval PDF failed', approvalId, e)
      note = `${note ? `${note} ` : ''}The approval PDF could not be made — the approval record itself is saved.`
    }
    await setApproval(admin, orgId, approvalId, { finalized_at: now.toISOString(), finalize_error: note })

    // 4. One confirmation to the customer (the sale email to the owners is the signing pipeline's).
    if (!approval.confirmation_sent_at && proposal.customer_email) {
      const { sendApprovalConfirmation } = await import('@/lib/quotes/send')
      // The customer's copy goes through the signing-token download route (never a bucket URL), like a signed contract's.
      const copyUrl = pdfPath ? customerSignedDocUrl('contract', contract.signing_token, await tryOrgAppUrl(orgId, 'quote approval copy')) : null
      const sent = await sendApprovalConfirmation(admin, orgId, approval, proposal.customer_email, opts.pageUrl ?? null, copyUrl).catch((e) => {
        console.error('quote approval confirmation failed', e)
        return false
      })
      if (sent) await setApproval(admin, orgId, approvalId, { confirmation_sent_at: new Date().toISOString() })
    }
    return true
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
