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

/**
 * Pure: a cookie-authenticated WRITE must come from our own page. Browsers send `Origin` on every cross-site POST (and
 * `Sec-Fetch-Site`), so a mismatch is a forged request (CSRF) → refused. No Origin at all = not a browser form/fetch from
 * another site (the phone app, server-to-server) → allowed; those carry their own bearer token.
 */
export function crossSiteWrite(request: Request): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return true
  const origin = request.headers.get('origin')
  if (!origin) return false
  let host: string
  try {
    host = new URL(origin).host
  } catch {
    return true
  }
  return host !== (request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? new URL(request.url).host)
}

export async function requireOnlinePaymentsCaller(who: 'owner' | 'billing', request?: Request): Promise<OnlinePaymentsCaller> {
  if (request && request.method !== 'GET' && crossSiteWrite(request)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
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
