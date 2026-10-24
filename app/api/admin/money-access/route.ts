import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { isMoneyPermission, listMoneyAccess, setMoneyAccess, type MoneyMode } from '@/lib/money-access'
import { isOwnerProfile } from '@/lib/super-admin'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

async function owner() {
  try {
    const { profile } = await requireAuthApi()
    return isOwnerProfile(profile) ? profile : null
  } catch {
    return null
  }
}

/** Who has the two money permissions today (owners only). */
export async function GET() {
  const profile = await owner()
  if (!profile) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json({ people: await listMoneyAccess(createServiceClient(), profile.org_id) })
}

/** POST { userId, permission, mode: 'default' | 'grant' | 'deny', reason? } - owners only, audited. */
export async function POST(request: NextRequest) {
  const profile = await owner()
  if (!profile) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await request.json().catch(() => null)) as { userId?: string; permission?: string; mode?: string; reason?: string } | null
  if (!body?.userId || !isMoneyPermission(body.permission) || !['default', 'grant', 'deny'].includes(String(body.mode))) {
    return NextResponse.json({ error: 'userId, permission and mode are required' }, { status: 400 })
  }
  const result = await setMoneyAccess(createServiceClient(), profile, { userId: body.userId, permission: body.permission, mode: body.mode as MoneyMode, reason: body.reason })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result)
}
