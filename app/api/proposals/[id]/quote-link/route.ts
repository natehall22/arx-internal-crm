import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { crossSiteWrite } from '@/lib/online-payments/access'
import { orgFeatureOffResponse } from '@/lib/org-features-server'
import { loadOrgProfile, t } from '@/lib/org-profile'
import { finalizeApproval, loadApproval } from '@/lib/quotes/approve'
import { createQuoteLink, revokeQuoteLinks } from '@/lib/quotes/links'
import { loadQuoteContext, priceForSelection } from '@/lib/quotes/load'
import { defaultSelectedIds } from '@/lib/quotes/pricing'
import { sendQuoteLinkEmail } from '@/lib/quotes/send'
import { depositCents, effectiveDeposit, isDepositMode } from '@/lib/quotes/settings'
import { diffSaleCredit, loadDealSaleCredit, saveDealSaleCredit, SALE_CREDIT_EDIT_ROLES, type SaleCreditChange } from '@/lib/deal-sale-credit'
import { isSuperAdmin } from '@/lib/super-admin'
import { resolveSalesDocAccessBarred } from '@/lib/sales-doc-access'
import { orgDb } from '@/lib/supabase/org-db'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const LINKS_PER_HOUR = 20
const OPEN = ['draft', 'sent', 'viewed']

async function caller(request: Request | null) {
  if (request && request.method !== 'GET' && crossSiteWrite(request)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as const
  let auth: Awaited<ReturnType<typeof requireAuthApi>>
  try {
    auth = await requireAuthApi()
  } catch {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  }
  const admin = createServiceClient()
  if (await resolveSalesDocAccessBarred(admin, auth.authUser.id, auth.profile)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as const
  const off = await orgFeatureOffResponse(auth.profile.org_id, 'quoteApproval')
  if (off) return { error: off } as const
  return { admin, profile: auth.profile } as const
}

/** What the staff card shows: the link, the approval, the deposit, and why a quote can't be sent yet. */
async function status(admin: ReturnType<typeof createServiceClient>, orgId: string, proposalId: string) {
  const ctx = await loadQuoteContext(admin, orgId, proposalId)
  if (!ctx) return null
  const p = ctx.proposal
  const approval = await loadApproval(admin, orgId, proposalId)
  const { data: links } = await orgDb(admin, orgId).from('quote_links').select('id, expires_at, revoked_at, first_opened_at, last_opened_at, sent_to, sent_at, created_at').eq('proposal_id', proposalId).order('created_at', { ascending: false }).limit(1)
  const link = ((links ?? []) as Array<{ expires_at: string; revoked_at: string | null; first_opened_at: string | null; last_opened_at: string | null; sent_to: string | null; sent_at: string | null }>)[0] ?? null
  const price = priceForSelection(ctx, defaultSelectedIds(ctx.lines))
  const d = effectiveDeposit(p, ctx.settings)
  const problems: string[] = []
  if (!approval) {
    if (!OPEN.includes(String(p.status))) problems.push('This quote is closed.')
    if (!p.opportunity_id) problems.push('Start the quote from the customer’s deal first.')
    if (!(p.customer_name ?? '').trim() || !(p.customer_address ?? '').trim()) problems.push('Add the customer name and address.')
    if (ctx.lines.length === 0 || price.totalCents <= 0) problems.push('Add at least one item with a price.')
    if (p.opportunity_id) {
      const { data: signed } = await orgDb(admin, orgId).from('order_form_contracts').select('id').eq('opportunity_id', p.opportunity_id).eq('agreement_type', 'installation').eq('status', 'completed').limit(1)
      if ((signed ?? []).length > 0) problems.push('This deal already has an approved quote. Start a new deal for extra work.')
    }
  }
  return {
    opportunityId: p.opportunity_id,
    customerEmail: p.customer_email,
    status: p.status,
    optionalCount: ctx.lines.filter((l) => l.is_optional).length,
    totalCents: price.totalCents,
    deposit: { mode: d.mode, percent: d.percent, fixedCents: d.fixedCents, overridden: d.overridden, cents: depositCents(price.totalCents, d) },
    company: { depositMode: ctx.settings.depositMode, depositPercent: ctx.settings.depositPercent, depositFixedCents: ctx.settings.depositFixedCents },
    problems,
    link: link ? { active: !link.revoked_at && Date.parse(link.expires_at) > Date.now(), expiresAt: link.expires_at, revoked: !!link.revoked_at, firstOpenedAt: link.first_opened_at, lastOpenedAt: link.last_opened_at, sentTo: link.sent_to, sentAt: link.sent_at } : null,
    approval: approval
      ? { typedName: approval.typed_name, approvedAt: approval.approved_at, ip: approval.approved_ip, totalCents: approval.total_cents, depositCents: approval.deposit_cents, finalized: !!approval.finalized_at, error: approval.finalize_error, jobId: approval.job_id, chosen: approval.snapshot.lines.filter((l) => l.chosen).map((l) => l.name), declined: approval.snapshot.lines.filter((l) => !l.chosen).map((l) => l.name) }
      : null,
  }
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const c = await caller(null)
  if ('error' in c) return c.error
  const s = await status(c.admin, c.profile.org_id, params.id)
  if (!s) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(s)
}

/**
 * POST { action }:
 *  - 'send' { email? }  make a fresh link (older ones stop working) and email it; the link is returned too, to copy.
 *  - 'link'             a fresh link only (to paste into a text).
 *  - 'revoke'           stop the live link.
 *  - 'deposit' { mode: 'none'|'percent'|'fixed'|null, value? }  this quote's own deposit (null = the company's default).
 *  - 'finish'           finish an approval that stopped half way.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const c = await caller(request)
  if ('error' in c) return c.error
  const { admin, profile } = c
  const orgId = profile.org_id
  const body = (await request.json().catch(() => ({}))) as { action?: string; email?: unknown; mode?: unknown; value?: unknown; saleCredit?: unknown }
  const s = await status(admin, orgId, params.id)
  if (!s) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (body.action === 'revoke') {
    await revokeQuoteLinks(admin, orgId, params.id)
    return NextResponse.json(await status(admin, orgId, params.id))
  }
  if (body.action === 'finish') {
    const a = await loadApproval(admin, orgId, params.id)
    if (!a) return NextResponse.json({ error: 'Nothing to finish' }, { status: 409 })
    await finalizeApproval(admin, orgId, a.id)
    return NextResponse.json(await status(admin, orgId, params.id))
  }
  if (body.action === 'deposit') {
    if (s.approval) return NextResponse.json({ error: 'This quote is already approved' }, { status: 409 })
    let patch: { deposit_mode: string | null; deposit_value: number | null }
    if (body.mode === null) patch = { deposit_mode: null, deposit_value: null }
    else if (isDepositMode(body.mode)) {
      const v = body.mode === 'none' ? 0 : Number(body.value)
      if (!Number.isFinite(v) || v < 0 || (body.mode === 'percent' && v > 100) || v > 10_000_000) return NextResponse.json({ error: 'Enter a valid deposit' }, { status: 400 })
      patch = { deposit_mode: body.mode, deposit_value: Math.round(v * 100) / 100 }
    } else return NextResponse.json({ error: 'Choose a deposit' }, { status: 400 })
    const { error } = await orgDb(admin, orgId).from('proposals').update(patch).eq('id', params.id)
    if (error) return NextResponse.json({ error: 'Could not save the deposit' }, { status: 500 })
    return NextResponse.json(await status(admin, orgId, params.id))
  }
  if (body.action === 'send' || body.action === 'link') {
    if (s.problems.length > 0) return NextResponse.json({ error: s.problems[0] }, { status: 409 })
    const since = new Date(Date.now() - 3_600_000).toISOString()
    const { count } = await orgDb(admin, orgId).from('quote_links').select('id', { count: 'exact', head: true }).eq('proposal_id', params.id).gte('created_at', since)
    if ((count ?? 0) >= LINKS_PER_HOUR) return NextResponse.json({ error: 'Too many links in the last hour' }, { status: 429 })
    const ctx = await loadQuoteContext(admin, orgId, params.id)
    if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    // Sale credit (closer / setter / self-generated) is confirmed by the sender BEFORE the quote goes out, exactly like the
    // contract screen, and saved with the deal through the one writer. Without it the signing pipeline would fall back to
    // whoever created the contract as the closer. Anyone may confirm the stored credit; only owners / admins may change it.
    const credit = body.saleCredit && typeof body.saleCredit === 'object' ? (body.saleCredit as Record<string, unknown>) : null
    if (!credit) return NextResponse.json({ error: 'Confirm who gets credit for this sale first.' }, { status: 400 })
    const next: SaleCreditChange = {}
    if ('closerUserId' in credit) next.closerUserId = typeof credit.closerUserId === 'string' && credit.closerUserId ? credit.closerUserId : null
    if ('setterUserId' in credit) next.setterUserId = typeof credit.setterUserId === 'string' && credit.setterUserId ? credit.setterUserId : null
    if (typeof credit.isSelfGenerated === 'boolean') next.isSelfGenerated = credit.isSelfGenerated
    if (!next.closerUserId) return NextResponse.json({ error: 'Pick who closed this sale.' }, { status: 400 })
    if (!SALE_CREDIT_EDIT_ROLES.has(String(profile.role || '').toLowerCase()) && !isSuperAdmin(profile)) {
      const stored = await loadDealSaleCredit(admin, orgId, ctx.proposal.opportunity_id as string)
      const changes = stored ? diffSaleCredit(stored.credit, next) : next
      if (Object.keys(changes).length > 0) return NextResponse.json({ error: 'Only an owner or admin can change who gets credit for this sale.' }, { status: 403 })
    }
    const savedCredit = await saveDealSaleCredit(admin, { orgId, opportunityId: ctx.proposal.opportunity_id as string, actor: profile, next, reason: typeof credit.reason === 'string' ? credit.reason : null })
    if (!savedCredit.ok) return NextResponse.json({ error: savedCredit.error }, { status: savedCredit.status })
    const link = await createQuoteLink(admin, orgId, params.id, profile.id, ctx.settings.linkDays)
    // Out with the customer = sent (the same stamp the builder writes; "waiting for approval" reads it).
    if (ctx.proposal.status === 'draft') await orgDb(admin, orgId).from('proposals').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', params.id).eq('status', 'draft')
    let emailed: { ok: boolean; error?: string } | null = null
    if (body.action === 'send') {
      const to = typeof body.email === 'string' && body.email.trim() ? body.email.trim() : ctx.proposal.customer_email ?? ''
      const word = t(await loadOrgProfile(admin, orgId), 'proposal')
      emailed = await sendQuoteLinkEmail(admin, orgId, { to, customerName: ctx.proposal.customer_name, url: link.url, title: ctx.proposal.title ?? '', expiresAt: link.expiresAt, proposalWord: word })
      if (emailed.ok) await orgDb(admin, orgId).from('quote_links').update({ sent_to: to, sent_at: new Date().toISOString() }).eq('id', link.id)
    }
    return NextResponse.json({ ...(await status(admin, orgId, params.id)), url: link.url, emailed })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
