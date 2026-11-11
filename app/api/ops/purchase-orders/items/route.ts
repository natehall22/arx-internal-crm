/** GET ?q= — price book items to pick a PO line from (name, unit, and OUR cost as the starting unit cost). Editors only; never sell prices. */
import { NextRequest, NextResponse } from 'next/server'

import { authorizePo } from '@/lib/purchase-orders-route'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const a = await authorizePo('canEdit')
  if ('error' in a) return a.error
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 60)
  if (q.length < 2) return NextResponse.json({ items: [] })
  const { data, error } = await a.ctx.admin
    .from('pricebook_items')
    .select('id, name, unit, cost_price, material_cost')
    .eq('org_id', a.ctx.orgId)
    .eq('active', true)
    .ilike('name', `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`)
    .order('name')
    .limit(10)
  if (error) return NextResponse.json({ items: [] })
  return NextResponse.json({
    items: ((data ?? []) as Array<Record<string, any>>).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      unit: (r.unit as string | null) ?? null,
      unitCost: Number(r.cost_price ?? r.material_cost ?? 0) || 0,
    })),
  })
}
