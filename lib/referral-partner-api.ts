import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { getPartnerAccess } from '@/lib/referral-partners'
import { createServiceClient } from '@/lib/supabase/service'

/** Auth + service client + manage flag, once, for every Referral Partners route. Throws on no session. */
export async function partnerRequestContext() {
  const { authUser, profile } = await requireAuthApi()
  const supabase = createServiceClient()
  const access = await getPartnerAccess(supabase, authUser.id, profile)
  return { supabase, userId: authUser.id, orgId: profile.org_id, profile, access }
}

export function partnerApiError(error: unknown, label: string) {
  const message = error instanceof Error ? error.message : ''
  if (message === 'Unauthorized' || message === 'Account disabled') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  console.error(`${label} error:`, error)
  return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
}
