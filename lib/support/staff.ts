/**
 * The staff side's identity check (server only): "is the person REALLY signed in, and are they platform support staff?" —
 * decided from their own session (getRealAuthContext ignores any support cookie), against `platform_support_staff`, on this
 * address's company fence (so /support exists only where the operator's own company is served, never on a customer's address).
 */
import { NextResponse } from 'next/server'

import { getRealAuthContext, type AuthContext } from '@/lib/auth'
import { crossSiteWrite } from '@/lib/online-payments/access'
import { createServiceClient } from '@/lib/supabase/service'
import { isPlatformStaff } from '@/lib/support/access'

export async function getPlatformStaffContext(): Promise<AuthContext | null> {
  const ctx = await getRealAuthContext()
  if (!ctx) return null
  return (await isPlatformStaff(createServiceClient(), ctx.authUser.id)) ? ctx : null
}

/** API guard for the staff routes: a cross-site write, a signed-out person and a non-staff person are all refused. */
export async function requirePlatformStaffApi(request?: Request): Promise<{ ctx: AuthContext } | { error: NextResponse }> {
  if (request && request.method !== 'GET' && crossSiteWrite(request)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  const ctx = await getPlatformStaffContext()
  // Not staff looks exactly like not found: the existence of this door is not advertised.
  if (!ctx) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return { ctx }
}
