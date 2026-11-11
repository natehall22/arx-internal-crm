/**
 * Who may bill recurring service (server only). One answer for the Ready to bill screen, its API and the customer's
 * invoice list: the company has service plans on (lib/org-features.ts `servicePlans`, default OFF) AND the person
 * records money (`callerCanAccessJobBilling`, money:record — the same people who invoice jobs today). Job-board access
 * is NOT required: an office biller may never see crews.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { callerCanAccessJobBilling } from '@/lib/finance-access'
import { isOrgFeatureOn } from '@/lib/org-features-server'

type BillingProfile = { id: string; org_id: string; role?: string | null; custom_role_id?: string | null }

export async function canBillService(admin: SupabaseClient, profile: BillingProfile): Promise<{ feature: boolean; bill: boolean }> {
  const feature = await isOrgFeatureOn(profile.org_id, 'servicePlans')
  if (!feature) return { feature, bill: false }
  return { feature, bill: await callerCanAccessJobBilling(admin, profile) }
}

/** Route guard: signed in (401), service plans on (404), records money (403). */
export async function billingRouteAuth(): Promise<{ admin: SupabaseClient; userId: string; orgId: string } | Response> {
  const { NextResponse } = await import('next/server')
  const { requireAuthApi } = await import('@/lib/auth')
  const { createServiceClient } = await import('@/lib/supabase/service')
  let auth: Awaited<ReturnType<typeof requireAuthApi>>
  try {
    auth = await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createServiceClient()
  const profile = auth.profile as BillingProfile
  const { feature, bill } = await canBillService(admin, profile)
  if (!feature) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!bill) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return { admin, userId: profile.id, orgId: profile.org_id }
}
