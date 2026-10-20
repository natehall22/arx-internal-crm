import { NextResponse } from 'next/server'

import { verifyCronSecret } from '@/lib/cron-auth'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * Nightly: open partners nobody has touched within their type's window, and warn the
 * assigned rep 7 days before. All logic (and the audit rows) live in
 * `referral_partners_run_expiry`; Company Relationship never expires.
 */
export async function GET(request: Request) {
  const denied = verifyCronSecret(request, 'referral-partners')
  if (denied) return denied

  const { data, error } = await createServiceClient().rpc('referral_partners_run_expiry')
  if (error) {
    console.error('referral-partners cron failed:', error)
    return NextResponse.json({ error: 'Expiry run failed' }, { status: 500 })
  }
  return NextResponse.json(data)
}
