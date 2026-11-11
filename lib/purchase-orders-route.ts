/** Shared auth for the purchase-order routes: signed in, a company, and the PO access rules. Server-only. */
import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { resolvePoAccess, type PoAccess } from '@/lib/purchase-orders-access'

export async function authorizePo(need: keyof PoAccess = 'canView') {
  let ctx
  try {
    const { authUser, profile } = await requireAuthApi()
    const admin = createServiceClient()
    ctx = { admin, authUser, profile, orgId: profile.org_id as string, access: await resolvePoAccess(admin, authUser.id, profile) }
  } catch {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  }
  if (!ctx.access[need]) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as const
  return { ctx } as const
}
