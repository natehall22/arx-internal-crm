/**
 * Owner-only setup for a supplier's API connection (ABC Supply).
 *   GET — settings + item map + the org switches
 *   PUT — { settings?: {...}, itemMap?: [...], org?: { orderingEnabled, secondApprovalCents } }
 * Every change is written to the append-only supplier_api_events log (who, old → new).
 * Switching a supplier to PRODUCTION, turning ordering on, and the org switch are all owner actions
 * because this whole route is owner-only. Credentials are NOT handled here — they are env vars.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { canManageSuppliers } from '@/lib/supplier-admin'
import { logApiEvent } from '@/lib/suppliers/abc/settings-db'

export const dynamic = 'force-dynamic'

async function authorize() {
  try {
    const { profile } = await requireAuthApi()
    if (!canManageSuppliers(profile)) return { error: NextResponse.json({ error: 'Only owners can manage suppliers' }, { status: 403 }) }
    return { profile, admin: createServiceClient() }
  } catch {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
}

const SERVICES = ['COM', 'CPU', 'EXP', 'OTR', 'OTG', 'OTW', 'TPC']
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const a = await authorize()
  if ('error' in a) return a.error
  const org = a.profile.org_id
  const [settings, map, orgRow] = await Promise.all([
    a.admin.from('supplier_api_settings').select('*').eq('org_id', org).eq('vendor_id', params.id).maybeSingle(),
    a.admin.from('supplier_item_map').select('line_key, item_number, uom, qty_unit_word, est_unit_price_cents').eq('org_id', org).eq('vendor_id', params.id).order('line_key'),
    a.admin.from('orgs').select('supplier_api_ordering_enabled, supplier_api_second_approval_cents').eq('id', org).maybeSingle(),
  ])
  return NextResponse.json({ settings: settings.data, itemMap: map.data ?? [], org: orgRow.data })
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const a = await authorize()
  if ('error' in a) return a.error
  const org = a.profile.org_id
  const body = (await request.json().catch(() => null)) as Record<string, any> | null
  if (!body) return NextResponse.json({ error: 'Nothing to save' }, { status: 400 })

  const { data: vendor } = await a.admin.from('vendors').select('id').eq('org_id', org).eq('id', params.id).is('deleted_at', null).maybeSingle()
  if (!vendor) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })

  if (body.settings) {
    const s = body.settings
    const row = {
      org_id: org,
      vendor_id: params.id,
      provider: 'abc_supply',
      environment: s.environment === 'production' ? 'production' : 'sandbox',
      ordering_enabled: s.orderingEnabled === true,
      ship_to_number: text(s.shipToNumber, 40),
      branch_number: text(s.branchNumber, 40),
      delivery_service: SERVICES.includes(s.deliveryService) ? s.deliveryService : 'OTR',
      updated_by: a.profile.id,
      updated_at: new Date().toISOString(),
    }
    const { data: before } = await a.admin.from('supplier_api_settings').select('environment, ordering_enabled, ship_to_number, branch_number, delivery_service').eq('vendor_id', params.id).maybeSingle()
    const { error } = await a.admin.from('supplier_api_settings').upsert(row, { onConflict: 'vendor_id' })
    if (error) return NextResponse.json({ error: 'Could not save the connection settings' }, { status: 500 })
    await logApiEvent(a.admin, { orgId: org, vendorId: params.id, jobId: null, actorUserId: a.profile.id, event: 'settings_changed', environment: row.environment, detail: { before, after: { environment: row.environment, ordering_enabled: row.ordering_enabled, ship_to_number: row.ship_to_number, branch_number: row.branch_number, delivery_service: row.delivery_service } } })
  }

  if (Array.isArray(body.itemMap)) {
    const rows = []
    for (const m of body.itemMap.slice(0, 500)) {
      const lineKey = text(m?.lineKey, 120), itemNumber = text(m?.itemNumber, 60), uom = text(m?.uom, 10), word = text(m?.qtyUnitWord, 30)
      if (!lineKey || !itemNumber || !uom || !word) return NextResponse.json({ error: 'Each item needs a line key, item number, unit and quantity word' }, { status: 400 })
      const price = m.estUnitPriceCents == null ? null : Number(m.estUnitPriceCents)
      if (price !== null && (!Number.isInteger(price) || price < 0)) return NextResponse.json({ error: 'Estimated price must be whole cents' }, { status: 400 })
      rows.push({ org_id: org, vendor_id: params.id, line_key: lineKey, item_number: itemNumber, uom: uom.toUpperCase(), qty_unit_word: word.toLowerCase(), est_unit_price_cents: price, updated_by: a.profile.id, updated_at: new Date().toISOString() })
    }
    if (rows.length > 0) {
      const { error } = await a.admin.from('supplier_item_map').upsert(rows, { onConflict: 'vendor_id,line_key' })
      if (error) return NextResponse.json({ error: 'Could not save the item map' }, { status: 500 })
    }
    await logApiEvent(a.admin, { orgId: org, vendorId: params.id, jobId: null, actorUserId: a.profile.id, event: 'map_changed', detail: { items: rows.map((r) => ({ line_key: r.line_key, item_number: r.item_number, uom: r.uom })) } })
  }

  if (Array.isArray(body.itemMapRemove)) {
    const keys = body.itemMapRemove.map((k: unknown) => text(k, 120)).filter((k: string | null): k is string => !!k).slice(0, 500)
    if (keys.length > 0) {
      const { error } = await a.admin.from('supplier_item_map').delete().eq('org_id', org).eq('vendor_id', params.id).in('line_key', keys)
      if (error) return NextResponse.json({ error: 'Could not remove those items' }, { status: 500 })
      await logApiEvent(a.admin, { orgId: org, vendorId: params.id, jobId: null, actorUserId: a.profile.id, event: 'map_changed', detail: { removed: keys } })
    }
  }

  if (body.org) {
    const patch: Record<string, unknown> = {}
    if (typeof body.org.orderingEnabled === 'boolean') patch.supplier_api_ordering_enabled = body.org.orderingEnabled
    if (body.org.secondApprovalCents != null) {
      const c = Number(body.org.secondApprovalCents)
      if (!Number.isInteger(c) || c < 0) return NextResponse.json({ error: 'Approval limit must be whole cents' }, { status: 400 })
      patch.supplier_api_second_approval_cents = c
    }
    if (Object.keys(patch).length > 0) {
      const { error } = await a.admin.from('orgs').update(patch).eq('id', org)
      if (error) return NextResponse.json({ error: 'Could not save the company settings' }, { status: 500 })
      await logApiEvent(a.admin, { orgId: org, vendorId: null, jobId: null, actorUserId: a.profile.id, event: 'settings_changed', detail: { org: patch } })
    }
  }
  return NextResponse.json({ ok: true })
}
