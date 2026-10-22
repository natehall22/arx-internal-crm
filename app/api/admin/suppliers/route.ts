/**
 * Suppliers (the vendors table) as the ordering flow sees them: order email, cc, account, default
 * trades, delivery notes, how orders are sent. Same access as sending orders (ops job editors /
 * super admins). Two ACTIVE suppliers may not both be the default for the same trade.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { isValidEmail } from '@/lib/supplier-order-email'
import { resolveSupplierOrderAccess } from '@/lib/supplier-orders'

export const dynamic = 'force-dynamic'

const COLUMNS =
  'id, name, active, order_email, order_cc_emails, account_number, default_branch, default_delivery_notes, default_for_trades, connection_type'

async function authorize() {
  try {
    const { authUser, profile } = await requireAuthApi()
    const admin = createServiceClient()
    const access = await resolveSupplierOrderAccess(admin, authUser.id, profile)
    return { admin, profile, ...access }
  } catch {
    return null
  }
}

export async function GET() {
  const auth = await authorize()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.canView) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { data, error } = await auth.admin
    .from('vendors')
    .select(COLUMNS)
    .eq('org_id', auth.profile.org_id)
    .is('deleted_at', null)
    .order('name')
  if (error) return NextResponse.json({ error: 'Could not load suppliers' }, { status: 500 })
  return NextResponse.json({ suppliers: data ?? [], canEdit: auth.canSend })
}

function cleanEmails(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null
  const out = v.map((x) => String(x).trim().toLowerCase()).filter(Boolean)
  return out.every(isValidEmail) ? out : null
}

/** POST { id?, name, order_email, order_cc_emails[], account_number, default_branch, default_delivery_notes, default_for_trades[], active } — creates or updates. */
export async function POST(request: NextRequest) {
  const auth = await authorize()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.canSend) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!b) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 120) : ''
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  const orderEmail = typeof b.order_email === 'string' && b.order_email.trim() ? b.order_email.trim().toLowerCase() : null
  if (orderEmail && !isValidEmail(orderEmail)) return NextResponse.json({ error: 'Order email is not a valid address' }, { status: 400 })
  const cc = b.order_cc_emails === undefined ? [] : cleanEmails(b.order_cc_emails)
  if (cc === null) return NextResponse.json({ error: 'A cc address is not valid' }, { status: 400 })
  const trades = Array.isArray(b.default_for_trades)
    ? Array.from(new Set(b.default_for_trades.map((t) => String(t).trim().toLowerCase()).filter(Boolean)))
    : []
  const active = b.active !== false
  const text = (v: unknown, max = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
  const id = typeof b.id === 'string' && b.id ? b.id : null
  const orgId = auth.profile.org_id

  if (active && trades.length > 0) {
    const { data: others } = await auth.admin
      .from('vendors')
      .select('id, name, default_for_trades')
      .eq('org_id', orgId)
      .eq('active', true)
      .is('deleted_at', null)
      .overlaps('default_for_trades', trades)
    const clash = (others ?? []).find((o) => o.id !== id)
    if (clash) {
      return NextResponse.json({ error: `${clash.name} is already the default supplier for one of those trades` }, { status: 409 })
    }
  }

  const row = {
    name,
    active,
    order_email: orderEmail,
    order_cc_emails: cc,
    account_number: text(b.account_number, 100),
    default_branch: text(b.default_branch, 200),
    default_delivery_notes: text(b.default_delivery_notes, 1000),
    default_for_trades: trades,
    updated_at: new Date().toISOString(),
  }
  const query = id
    ? auth.admin.from('vendors').update(row).eq('id', id).eq('org_id', orgId).select(COLUMNS).maybeSingle()
    : auth.admin.from('vendors').insert({ ...row, org_id: orgId, created_by: auth.profile.id }).select(COLUMNS).maybeSingle()
  const { data, error } = await query
  if (error || !data) return NextResponse.json({ error: 'Could not save the supplier' }, { status: 500 })
  return NextResponse.json({ supplier: data })
}
