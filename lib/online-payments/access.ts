/**
 * Who may do what with online payments (one place):
 *  - connect / disconnect the company's Stripe account and change its settings → owners (`isSuperAdmin`);
 *  - make pay links, save-card links, turn autopay off, remove a card → billing staff (`callerCanAccessJobBilling`,
 *    money:record — the same people who record payments by hand).
 * Customers never sign in: their links are checked in lib/online-payments/public.ts.
 */
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

import { requireAuthApi } from '@/lib/auth'
import { callerCanAccessJobBilling } from '@/lib/finance-access'
import { isSuperAdmin } from '@/lib/super-admin'
import { createServiceClient } from '@/lib/supabase/service'

type Profile = Awaited<ReturnType<typeof requireAuthApi>>['profile']
export type OnlinePaymentsCaller = { admin: SupabaseClient; profile: Profile; error?: undefined } | { error: NextResponse }

export async function requireOnlinePaymentsCaller(who: 'owner' | 'billing'): Promise<OnlinePaymentsCaller> {
  let profile: Profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const admin = createServiceClient()
  const allowed = who === 'owner' ? isSuperAdmin(profile) : await callerCanAccessJobBilling(admin, profile)
  if (!allowed) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { admin, profile }
}
