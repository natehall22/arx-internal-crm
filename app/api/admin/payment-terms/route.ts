import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { mergeOrgSettings } from '@/lib/org-settings'
import { PAYMENT_TERMS_SETTINGS_KEY, parsePaymentTerms, readOrgPaymentTerms } from '@/lib/payment-terms'
import { isSuperAdmin } from '@/lib/super-admin'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

async function owner() {
  try {
    const { profile } = await requireAuthApi()
    return isSuperAdmin(profile as never) ? { orgId: profile.org_id as string } : (NextResponse.json({ error: 'Forbidden' }, { status: 403 }) as Response)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) as Response
  }
}

/** GET — the company's default payment terms (owners). */
export async function GET() {
  const ctx = await owner()
  if (ctx instanceof Response) return ctx
  const { data } = await createServiceClient().from('orgs').select('settings').eq('id', ctx.orgId).maybeSingle()
  return NextResponse.json({ defaultTerms: readOrgPaymentTerms((data as { settings?: unknown } | null)?.settings) })
}

/** PATCH { defaultTerms: 'due_on_receipt' | 'net_15' | 'net_30' } — owners. Applies to invoices issued from now on; issued ones keep their due day. */
export async function PATCH(request: Request) {
  const ctx = await owner()
  if (ctx instanceof Response) return ctx
  const body = (await request.json().catch(() => null)) as { defaultTerms?: unknown } | null
  const terms = parsePaymentTerms(body?.defaultTerms)
  if (!terms) return NextResponse.json({ error: 'Pick Due on receipt, Net 15 or Net 30' }, { status: 400 })
  const { error } = await mergeOrgSettings(createServiceClient(), ctx.orgId, { defaultTerms: terms }, { path: [PAYMENT_TERMS_SETTINGS_KEY] })
  if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  return NextResponse.json({ ok: true, defaultTerms: terms })
}
