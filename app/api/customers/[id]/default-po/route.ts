import { NextResponse } from 'next/server'

import { billingRouteAuth } from '@/lib/service-billing-access'
import { isMissingColumn } from '@/lib/supabase/errors'
import { orgDb } from '@/lib/supabase/org-db'

export const dynamic = 'force-dynamic'

/**
 * PATCH { po: string | null } — the customer's default PO number (e.g. a builder's blanket PO). New invoices without a job
 * copy it into their PO field (lib/invoices.ts createServiceInvoiceFromLines); invoices already made keep theirs. Same gate
 * as the customer's other invoice settings (service plans on, money:record).
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const ctx = await billingRouteAuth()
  if (ctx instanceof Response) return ctx
  const body = (await request.json().catch(() => null)) as { po?: unknown } | null
  if (!body || !('po' in body) || (body.po !== null && typeof body.po !== 'string')) return NextResponse.json({ error: 'Type the PO number' }, { status: 400 })
  const po = typeof body.po === 'string' ? body.po.trim() : ''
  if (po.length > 60) return NextResponse.json({ error: 'A PO number is at most 60 characters' }, { status: 400 })
  const { data, error } = await orgDb(ctx.admin, ctx.orgId).from('customers').update({ default_po: po || null }).eq('id', params.id).select('id').maybeSingle()
  if (error) {
    if (isMissingColumn(error, 'default_po')) return NextResponse.json({ error: 'A default PO needs a database update first (migration 202611300200).' }, { status: 409 })
    return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  return NextResponse.json({ ok: true, po: po || null })
}
