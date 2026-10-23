import type { SupabaseClient } from '@supabase/supabase-js'

import type { AbcDeliveryService, ItemMapRow, SupplierApiSettings } from '@/lib/suppliers/abc/types'

const SERVICES: readonly string[] = ['COM', 'CPU', 'EXP', 'OTR', 'OTG', 'OTW', 'TPC']

/**
 * API settings + item map per supplier. Before the migration is applied these tables don't exist:
 * every error is read as "no API settings", so email ordering keeps working untouched.
 */
export async function loadSupplierApiSettings(admin: SupabaseClient, orgId: string): Promise<Map<string, SupplierApiSettings>> {
  const out = new Map<string, SupplierApiSettings>()
  const [settingsRes, mapRes, orgRes] = await Promise.all([
    admin.from('supplier_api_settings').select('vendor_id, provider, environment, ordering_enabled, ship_to_number, branch_number, delivery_service').eq('org_id', orgId),
    admin.from('supplier_item_map').select('vendor_id, line_key, item_number, uom, qty_unit_word, est_unit_price_cents').eq('org_id', orgId),
    admin.from('orgs').select('supplier_api_ordering_enabled, supplier_api_second_approval_cents').eq('id', orgId).maybeSingle(),
  ])
  if (settingsRes.error || mapRes.error || orgRes.error) return out
  const org = orgRes.data as { supplier_api_ordering_enabled?: boolean; supplier_api_second_approval_cents?: number } | null

  const maps = new Map<string, ItemMapRow[]>()
  for (const r of (mapRes.data ?? []) as Array<Record<string, any>>) {
    const list = maps.get(r.vendor_id) ?? []
    list.push({
      lineKey: String(r.line_key),
      itemNumber: String(r.item_number),
      uom: String(r.uom),
      qtyUnitWord: String(r.qty_unit_word),
      estUnitPriceCents: typeof r.est_unit_price_cents === 'number' ? r.est_unit_price_cents : null,
    })
    maps.set(r.vendor_id, list)
  }
  for (const r of (settingsRes.data ?? []) as Array<Record<string, any>>) {
    if (r.provider !== 'abc_supply') continue
    out.set(String(r.vendor_id), {
      provider: 'abc_supply',
      environment: r.environment === 'production' ? 'production' : 'sandbox',
      orderingEnabled: r.ordering_enabled === true,
      shipToNumber: r.ship_to_number ? String(r.ship_to_number) : null,
      branchNumber: r.branch_number ? String(r.branch_number) : null,
      deliveryService: (SERVICES.includes(r.delivery_service) ? r.delivery_service : 'OTR') as AbcDeliveryService,
      itemMap: maps.get(String(r.vendor_id)) ?? [],
      orgOrderingEnabled: org?.supplier_api_ordering_enabled === true,
      secondApprovalCents: typeof org?.supplier_api_second_approval_cents === 'number' ? org.supplier_api_second_approval_cents : 1_000_000,
    })
  }
  return out
}

export type OpenApproval = { id: string; supplierOrderId: string; contentHash: string; requestedBy: string; requestedByName: string | null; status: 'pending' | 'approved' }

export async function loadOpenApprovals(admin: SupabaseClient, orgId: string, jobId: string): Promise<OpenApproval[]> {
  const { data, error } = await admin
    .from('supplier_api_approvals')
    .select('id, supplier_order_id, content_hash, requested_by, status, users:requested_by(full_name)')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .in('status', ['pending', 'approved'])
  if (error) return []
  return ((data ?? []) as Array<Record<string, any>>).map((r) => ({
    id: String(r.id),
    supplierOrderId: String(r.supplier_order_id),
    contentHash: String(r.content_hash),
    requestedBy: String(r.requested_by),
    requestedByName: (Array.isArray(r.users) ? r.users[0]?.full_name : r.users?.full_name) ?? null,
    status: r.status === 'approved' ? 'approved' : 'pending',
  }))
}

export async function logApiEvent(
  admin: SupabaseClient,
  row: { orgId: string; vendorId: string | null; jobId: string | null; sendId?: string | null; actorUserId: string | null; event: string; environment?: string | null; detail?: Record<string, unknown> }
): Promise<void> {
  const { error } = await admin.from('supplier_api_events').insert({
    org_id: row.orgId,
    vendor_id: row.vendorId,
    job_id: row.jobId,
    send_id: row.sendId ?? null,
    actor_user_id: row.actorUserId,
    event: row.event,
    environment: row.environment ?? null,
    detail: row.detail ?? {},
  })
  if (error) console.error('[supplier-api] could not write audit event', row.event, error.message)
}
