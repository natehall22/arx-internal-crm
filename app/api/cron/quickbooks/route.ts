import { NextResponse } from 'next/server'

import { verifyCronSecret } from '@/lib/cron-auth'
import { loadCronOrgs } from '@/lib/cron-orgs'
import { orgFeatureChecker } from '@/lib/org-features-server'
import { keepQuickBooksWarm } from '@/lib/quickbooks/connection'
import { runQuickBooksForOrg } from '@/lib/quickbooks/worker'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

/**
 * The ONE QuickBooks background job (docs/quickbooks-sync.md), every 10 minutes. Per company (skipping any whose switch is off):
 *  1. keep the Intuit login fresh (a refresh at least weekly, with token rotation; surfaces a reconnect before Intuit ends the grant);
 *  2. drain that company's outbox into ITS OWN QuickBooks (lib/quickbooks/worker.ts). A company that has not finished the mapping,
 *     is not connected, or whose QuickBooks is not answering is left untouched and reported, never half-sent.
 * Companies run one after another and share the run's time budget; each stops cleanly at its own slice.
 */
export async function GET(request: Request) {
  const denied = verifyCronSecret(request, 'quickbooks')
  if (denied) return denied
  const admin = createServiceClient()
  const quickBooksOn = orgFeatureChecker('quickbooks')
  const out = { companies: 0, refreshed: 0, needsReconnect: 0, unavailable: 0, sent: 0, skipped: 0, retrying: 0, needsYou: 0 }
  const startedAt = Date.now()
  const orgs = await loadCronOrgs(admin)
  for (let index = 0; index < orgs.length; index++) {
    const org = orgs[index]
    try {
      if (!(await quickBooksOn(org.id))) continue
      const warm = await keepQuickBooksWarm(admin, org.id)
      if (warm !== 'skipped') {
        out.companies++
        if (warm === 'refreshed') out.refreshed++
        else if (warm === 'needs_reconnect') out.needsReconnect++
        else out.unavailable++
      }
      // What is left of the run is split evenly over the companies still to go, so one busy company cannot starve the rest.
      const left = 50_000 - (Date.now() - startedAt)
      if (left < 3_000) continue
      const report = await runQuickBooksForOrg({ admin, budgetMs: Math.floor(left / (orgs.length - index)) }, org, true)
      out.sent += report.done
      out.skipped += report.skipped
      out.retrying += report.retried
      out.needsYou += report.needsYou
    } catch (e) {
      console.error('quickbooks cron: company failed', org.id, e instanceof Error ? e.message : e)
    }
  }
  return NextResponse.json(out)
}
