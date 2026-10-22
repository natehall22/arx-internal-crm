/**
 * Suppliers (the vendors table as the ordering flow sees them). OWNERS ONLY (super admin or owner role):
 * a supplier's order email decides where a job's address and materials list are sent.
 *   GET  — suppliers + "last order sent to" + the recent change log
 *   POST — create or update one supplier; validated (lib/supplier-admin.ts) and logged old → new
 * Two ACTIVE suppliers may not both be the default for the same trade; names are unique per company.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { canManageSuppliers, describeChange, diffSupplier, parseSupplierInput, type SupplierInput } from '@/lib/supplier-admin'

export const dynamic = 'force-dynamic'

const COLUMNS =
  'id, updated_at, name, active, order_email, order_cc_emails, account_number, default_branch, default_delivery_notes, default_for_trades, connection_type'

async function authorize() {
  try {
    const { profile } = await requireAuthApi()
    if (!canManageSuppliers(profile)) return { error: NextResponse.json({ error: 'Only owners can manage suppliers' }, { status: 403 }) }
    return { profile, admin: createServiceClient() }
  } catch {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
}

export async function GET() {
  const a = await authorize()
  if ('error' in a) return a.error
  const orgId = a.profile.org_id

  const [suppliersRes, , logRes] = await Promise.all([
    a.admin.from('vendors').select(COLUMNS).eq('org_id', orgId).is('deleted_at', null).order('name'),
    Promise.resolve(null),
    a.admin
      .from('supplier_audit_log')
      .select('id, vendor_id, action, changed_at, changes, changed_by, users:changed_by(full_name)')
      .eq('org_id', orgId)
      .order('changed_at', { ascending: false })
      .limit(200),
  ])
  if (suppliersRes.error) return NextResponse.json({ error: 'Could not load suppliers' }, { status: 500 })

  // Last REAL email per supplier ("sent by hand" has no address). One small query each, so an old
  // supplier is never crowded out by newer sends to others.
  const lastOrder = new Map<string, { to: string; at: string | null; po: string }>()
  await Promise.all(
    (suppliersRes.data ?? []).map(async (s) => {
      const { data } = await a.admin
        .from('supplier_order_sends')
        .select('to_email, sent_at, po_label')
        .eq('org_id', orgId)
        .eq('vendor_id', s.id as string)
        .eq('status', 'sent')
        .neq('to_email', 'sent by hand')
        .order('sent_at', { ascending: false })
        .limit(1)
      const row = (data ?? [])[0]
      if (row) lastOrder.set(s.id as string, { to: row.to_email as string, at: row.sent_at as string | null, po: row.po_label as string })
    })
  )
  const logByVendor = new Map<string, Array<{ at: string; by: string | null; action: string; lines: string[] }>>()
  for (const row of (logRes.data ?? []) as Array<Record<string, any>>) {
    const list = logByVendor.get(row.vendor_id) ?? []
    if (list.length < 10) {
      list.push({
        at: row.changed_at,
        by: (Array.isArray(row.users) ? row.users[0]?.full_name : row.users?.full_name) ?? null,
        action: row.action,
        lines: (row.changes ?? []).map(describeChange),
      })
    }
    logByVendor.set(row.vendor_id, list)
  }

  return NextResponse.json({
    suppliers: (suppliersRes.data ?? []).map((s) => ({
      ...s,
      last_order: lastOrder.get(s.id as string) ?? null,
      log: logByVendor.get(s.id as string) ?? [],
    })),
  })
}

export async function POST(request: NextRequest) {
  const a = await authorize()
  if ('error' in a) return a.error
  const orgId = a.profile.org_id

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const parsed = parseSupplierInput(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const next = parsed.value
  const id = typeof body?.id === 'string' && body.id ? body.id : null

  let before: SupplierInput | null = null
  if (id) {
    const { data } = await a.admin.from('vendors').select(COLUMNS).eq('id', id).eq('org_id', orgId).is('deleted_at', null).maybeSingle()
    if (!data) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })
    // Stale form: someone saved this supplier after it was opened. Reload instead of overwriting them.
    const seen = typeof body?.updated_at === 'string' ? body.updated_at : null
    if (seen && (data as any).updated_at && new Date(seen).getTime() !== new Date((data as any).updated_at).getTime()) {
      return NextResponse.json({ error: 'This supplier was changed by someone else since you opened it. Close and reopen it to see the latest.' }, { status: 409 })
    }
    before = { ...(data as unknown as SupplierInput), order_cc_emails: (data as any).order_cc_emails ?? [], default_for_trades: (data as any).default_for_trades ?? [] }
  }

  const { data: others } = await a.admin
    .from('vendors')
    .select('id, name, active, default_for_trades')
    .eq('org_id', orgId)
    .is('deleted_at', null)
  const clashName = (others ?? []).find((o) => o.id !== id && String(o.name).trim().toLowerCase() === next.name.toLowerCase())
  if (clashName) return NextResponse.json({ error: `A supplier named "${clashName.name}" already exists` }, { status: 409 })
  if (next.active && next.default_for_trades.length > 0) {
    const clash = (others ?? []).find(
      (o) => o.id !== id && o.active && ((o.default_for_trades as string[] | null) ?? []).some((t) => next.default_for_trades.includes(t))
    )
    if (clash) return NextResponse.json({ error: `${clash.name} is already the default supplier for one of those trades` }, { status: 409 })
  }

  const changes = diffSupplier(before, next)
  if (id && changes.length === 0) return NextResponse.json({ supplier: { id, ...next }, unchanged: true })

  const row = { ...next, updated_at: new Date().toISOString() }
  const result = id
    ? await a.admin.from('vendors').update(row).eq('id', id).eq('org_id', orgId).select(COLUMNS).maybeSingle()
    : await a.admin.from('vendors').insert({ ...row, org_id: orgId, created_by: a.profile.id }).select(COLUMNS).maybeSingle()
  if (result.error || !result.data) return NextResponse.json({ error: 'Could not save the supplier' }, { status: 500 })
  const saved = result.data as unknown as { id: string }

  const action = !id ? 'created' : before && before.active && !next.active ? 'deactivated' : before && !before.active && next.active ? 'reactivated' : 'updated'
  const { error: logError } = await a.admin
    .from('supplier_audit_log')
    .insert({ org_id: orgId, vendor_id: saved.id, action, changed_by: a.profile.id, changes })
  if (logError) {
    // No change without a record of it: undo and report.
    if (id && before) await a.admin.from('vendors').update(before).eq('id', id).eq('org_id', orgId)
    else await a.admin.from('vendors').delete().eq('id', saved.id).eq('org_id', orgId)
    return NextResponse.json({ error: 'Could not record the change, so it was not saved. Try again.' }, { status: 500 })
  }
  return NextResponse.json({ supplier: saved, changes: changes.map(describeChange) })
}
