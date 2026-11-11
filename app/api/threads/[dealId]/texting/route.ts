import { NextResponse } from 'next/server'

import { suppressionOf } from '@/lib/customer-message-suppressions'
import { loadOrgFeatures } from '@/lib/org-features'
import { consentText, recordConsent } from '@/lib/sms/consent'
import { textStatus, type TextStatus } from '@/lib/sms/gate'
import { normalizeUsPhone } from '@/lib/sms/phone'
import { orgDb } from '@/lib/supabase/org-db'
import { dealRefOf } from '@/lib/threads/get-thread'
import { threadAuth, threadDeal } from '@/lib/threads/api'
import { writableAudiences } from '@/lib/threads/visibility'

export const dynamic = 'force-dynamic'

/** What the "Text" button and the composer need: may this deal's customer be texted, and if not, why (plain words). */
async function statusFor(ctx: Exclude<Awaited<ReturnType<typeof threadAuth>>, Response>, customerId: string | null): Promise<{ enabled: boolean; status: TextStatus | null; lastCameBy: 'sms' | null }> {
  const features = await loadOrgFeatures(ctx.admin, ctx.viewer.orgId)
  if (!features.texting || !customerId) return { enabled: false, status: null, lastCameBy: null }
  const status = await textStatus(ctx.admin, ctx.viewer.orgId, customerId)
  // Reply on the channel they used: did the customer's latest message arrive by text?
  const { data } = await orgDb(ctx.admin, ctx.viewer.orgId).from('activities').select('origin').eq('customer_id', customerId).in('origin', ['sms', 'customer_portal']).is('deleted_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle()
  return { enabled: true, status, lastCameBy: (data as { origin: string } | null)?.origin === 'sms' ? 'sms' : null }
}

/** GET — may we text this deal's customer? */
export async function GET(_request: Request, { params }: { params: { dealId: string } }) {
  const ctx = await threadAuth()
  if (ctx instanceof NextResponse) return ctx
  const deal = await threadDeal(ctx, params.dealId)
  if (!deal) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(await statusFor(ctx, deal.customer_id))
}

/**
 * POST { action: 'record_consent', how: 'phone' | 'in_person' } — "the customer said it's OK to text them". Writes one
 * append-only consent row with who recorded it, when and how, and the exact wording they agreed to. Not for field roles.
 * A customer who texted STOP is never put back this way: only they can, by texting START.
 */
export async function POST(request: Request, { params }: { params: { dealId: string } }) {
  const ctx = await threadAuth()
  if (ctx instanceof NextResponse) return ctx
  const deal = await threadDeal(ctx, params.dealId)
  if (!deal) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = (await request.json().catch(() => ({}))) as { action?: unknown; how?: unknown }
  if (body.action !== 'record_consent' || (body.how !== 'phone' && body.how !== 'in_person')) return NextResponse.json({ error: 'Say how the customer agreed' }, { status: 400 })
  if (!writableAudiences(ctx.viewer, dealRefOf(deal), true).includes('customer')) return NextResponse.json({ error: 'You can’t record this' }, { status: 403 })
  const features = await loadOrgFeatures(ctx.admin, ctx.viewer.orgId)
  if (!features.texting || !deal.customer_id) return NextResponse.json({ error: 'Texting is off' }, { status: 404 })
  const orgId = ctx.viewer.orgId
  const { data: c } = await orgDb(ctx.admin, orgId).from('customers').select('id, phone').eq('id', deal.customer_id).maybeSingle()
  const phone = normalizeUsPhone((c as { phone: string | null } | null)?.phone)
  if (!phone) return NextResponse.json({ error: 'This customer has no US phone number on file.' }, { status: 409 })
  if (await suppressionOf(ctx.admin, orgId, 'sms', phone)) return NextResponse.json({ error: 'This number replied STOP or can’t get texts. Only the customer can turn texts back on, by replying START.' }, { status: 409 })
  const { data: org } = await ctx.admin.from('orgs').select('name').eq('id', orgId).maybeSingle()
  const companyName = ((org as { name?: string | null } | null)?.name ?? '').trim()
  const r = await recordConsent(ctx.admin, orgId, {
    customerId: deal.customer_id,
    phone,
    status: 'granted',
    source: body.how === 'phone' ? 'staff_phone' : 'staff_in_person',
    companyName,
    evidence: { recordedBy: ctx.viewer.userId, how: body.how, wording: consentText(companyName) },
    createdBy: ctx.viewer.userId,
  })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 })
  return NextResponse.json(await statusFor(ctx, deal.customer_id))
}
