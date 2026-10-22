/**
 * Suppliers (the vendors table as the ordering flow sees them). OWNERS ONLY (super admin or owner role):
 * a supplier's order email decides where a job's address and materials list are sent.
 *   GET  — suppliers + "last order sent to" + the recent change log
 *   POST — create or update one supplier; validated (lib/supplier-admin.ts) and logged old → new
 * Atomic save + log and the one-default-per-trade rule live in the database (save_supplier + trigger).
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { canManageSuppliers, describeChange, parseSupplierInput, type FieldChange } from '@/lib/supplier-admin'

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

const RPC_ERRORS: Array<[RegExp, number, (m: RegExpMatchArray) => string]> = [
  [/supplier_name_required/, 400, () => 'Name is required'],
  [/supplier_not_found/, 404, () => 'Supplier not found'],
  [/supplier_stale/, 409, () => 'This supplier was changed by someone else since you opened it. Close and reopen it to see the latest.'],
  [/supplier_name_taken/, 409, () => 'A supplier with that name already exists'],
  [/supplier_default_clash:(.+)/, 409, (m) => `${m[1].trim()} is already the default supplier for one of those trades`],
]

export async function POST(request: NextRequest) {
  const a = await authorize()
  if ('error' in a) return a.error

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const parsed = parseSupplierInput(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const id = typeof body?.id === 'string' && body.id ? body.id : null
  const seen = typeof body?.updated_at === 'string' ? body.updated_at : null

  // One database function does the whole save: validation of names/default trades under a lock, the vendors
  // write, the old -> new diff and the change-log row — all in one transaction (migration 202610220030).
  const { data, error } = await a.admin.rpc('save_supplier', {
    p_org: a.profile.org_id,
    p_actor: a.profile.id,
    p_id: id,
    p_expected_updated_at: seen,
    p_input: parsed.value,
  })
  if (error) {
    for (const [re, status, message] of RPC_ERRORS) {
      const m = String(error.message || '').match(re)
      if (m) return NextResponse.json({ error: message(m) }, { status })
    }
    console.error('[admin/suppliers] save failed', error.message)
    return NextResponse.json({ error: 'Could not save the supplier' }, { status: 500 })
  }
  const result = data as { id: string; updated_at: string; changes: FieldChange[]; unchanged?: boolean }
  return NextResponse.json({ supplier: { id: result.id, updated_at: result.updated_at }, changes: (result.changes ?? []).map(describeChange), unchanged: !!result.unchanged })
}
