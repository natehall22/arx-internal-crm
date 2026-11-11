import { NextResponse } from 'next/server'

import { activeCrewDay } from '@/lib/service-plans-access'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * GET — is this crew phone link still good? The open page asks on focus, on return and every few minutes, and wipes
 * what it shows (addresses, gate codes) the moment the answer is no — a replaced or expired link must not keep showing
 * them on a phone that still has the page open.
 */
export async function GET(_request: Request, { params }: { params: { token: string } }) {
  const crew = await activeCrewDay(createServiceClient(), params.token)
  return NextResponse.json({ active: !!crew }, { headers: { 'Cache-Control': 'no-store, private' } })
}
