import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { callerCanAccessJobBilling } from '@/lib/finance-access'
import { orgDb } from '@/lib/supabase/org-db'
import { isMissingColumn } from '@/lib/supabase/errors'
import { ownListIdOrNull } from '@/lib/price-list-server'

export const dynamic = 'force-dynamic'

/**
 * Set a customer's price list (e.g. Builder), or clear it (= the company's default list). Billing people only, like tax
 * exemption: it changes what new quotes start at. A list that is not this company's own is refused.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createServiceClient()
  if (!(await callerCanAccessJobBilling(admin, profile))) {
    return NextResponse.json({ error: 'Only billing staff can change a customer’s price list' }, { status: 403 })
  }
  const body = (await request.json().catch(() => null)) as { pricebook_id?: unknown } | null
  if (!body || !('pricebook_id' in body)) return NextResponse.json({ error: 'Pick a price list' }, { status: 400 })
  let listId: string | null = null
  if (body.pricebook_id !== null && body.pricebook_id !== '') {
    listId = await ownListIdOrNull(admin, profile.org_id, body.pricebook_id)
    if (!listId) return NextResponse.json({ error: 'That price list does not exist' }, { status: 400 })
  }

  const db = orgDb(admin, profile.org_id)
  const { data: customer } = await db.from('customers').select('id').eq('id', params.id).maybeSingle()
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const { data, error } = await db.from('customers').update({ pricebook_id: listId }).eq('id', params.id).select('id, pricebook_id').maybeSingle()
  if (error) {
    if (isMissingColumn(error, 'pricebook_id')) {
      return NextResponse.json({ error: 'Price lists need a database update first (migration 202611220030).' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  }
  return NextResponse.json({ customer: data })
}
