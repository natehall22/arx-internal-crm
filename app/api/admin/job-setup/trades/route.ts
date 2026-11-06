import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { loadOrgTradesWithSource } from '@/lib/org-trades'
import { saveOrgTradeChange, type OrgTradeChange } from '@/lib/org-trades-admin'
import { isSuperAdmin } from '@/lib/super-admin'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

async function superAdmin() {
  try {
    const { profile } = await requireAuthApi()
    return isSuperAdmin(profile) ? (profile as { id: string; org_id: string }) : null
  } catch {
    return null
  }
}

/**
 * GET — the company's trades (owners only). `editable: false` only until migration 202611060030 is applied (or when the
 * table can't be read); a company with zero rows is editable — its first save seeds the standard list.
 */
export async function GET() {
  const profile = await superAdmin()
  if (!profile) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { trades, tableExists } = await loadOrgTradesWithSource(createServiceClient(), profile.org_id)
  return NextResponse.json({ trades, editable: tableExists })
}

/**
 * POST — one change to the list (owners only). The one write path for org_trades.
 * body: { action: 'add', label } | { action: 'rename', slug, label } | { action: 'setActive', slug, active } | { action: 'reorder', order: slug[] }
 */
export async function POST(request: Request) {
  const profile = await superAdmin()
  if (!profile) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await request.json().catch(() => null)) as OrgTradeChange | null
  if (!body || typeof body !== 'object' || typeof (body as { action?: unknown }).action !== 'string') {
    return NextResponse.json({ error: 'action is required' }, { status: 400 })
  }
  const result = await saveOrgTradeChange(createServiceClient(), profile.org_id, profile.id, body)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ trades: result.trades, editable: true })
}
