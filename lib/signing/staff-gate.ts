import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { crossSiteWrite } from '@/lib/online-payments/access'
import { resolveSalesDocAccessBarred } from '@/lib/sales-doc-access'
import { createServiceClient } from '@/lib/supabase/service'

export const PRIVATE = { 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer' }

/**
 * The ONE door for the office's signing routes: same-site writes only, a signed-in user, and never a field role (setters,
 * canvassers, inside sales never send, void or read money documents). Returns the service client and the caller, or the response to send.
 */
export async function staffSigningGate(request: Request | null) {
  if (request && crossSiteWrite(request)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: PRIVATE }) } as const
  let auth: Awaited<ReturnType<typeof requireAuthApi>>
  try {
    auth = await requireAuthApi()
  } catch {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: PRIVATE }) } as const
  }
  const admin = createServiceClient()
  if (await resolveSalesDocAccessBarred(admin, auth.authUser.id, auth.profile)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: PRIVATE }) } as const
  }
  return { admin, profile: auth.profile, userId: auth.authUser.id as string } as const
}
