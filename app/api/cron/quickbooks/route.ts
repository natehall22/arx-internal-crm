import { NextResponse } from 'next/server'

import { verifyCronSecret } from '@/lib/cron-auth'
import { loadCronOrgs } from '@/lib/cron-orgs'
import { orgFeatureChecker } from '@/lib/org-features-server'
import { keepQuickBooksWarm } from '@/lib/quickbooks/connection'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

/**
 * The ONE QuickBooks background job (docs/quickbooks-sync.md). Today it only keeps each connected company's Intuit
 * login fresh (a refresh at least weekly, with token rotation) and surfaces a reconnect before Intuit ends the grant.
 * PR 4 makes it also drain the integration outbox — it is not a second cron.
 */
export async function GET(request: Request) {
  const denied = verifyCronSecret(request, 'quickbooks')
  if (denied) return denied
  const admin = createServiceClient()
  const quickBooksOn = orgFeatureChecker('quickbooks')
  const out = { companies: 0, refreshed: 0, needsReconnect: 0, unavailable: 0 }
  for (const org of await loadCronOrgs(admin)) {
    try {
      if (!(await quickBooksOn(org.id))) continue
      const r = await keepQuickBooksWarm(admin, org.id)
      if (r === 'skipped') continue
      out.companies++
      if (r === 'refreshed') out.refreshed++
      else if (r === 'needs_reconnect') out.needsReconnect++
      else out.unavailable++
    } catch (e) {
      console.error('quickbooks cron: company failed', org.id, e instanceof Error ? e.message : e)
    }
  }
  return NextResponse.json(out)
}
