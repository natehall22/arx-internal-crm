/** Today's date (YYYY-MM-DD) on the company's own clock (`orgs.timezone`), for the daily log and selection due dates. */
import type { SupabaseClient } from '@supabase/supabase-js'

import { loadOrgTimeZone } from '@/lib/cron-orgs'
import { ymdInZone } from '@/lib/service-plans'

export async function orgTodayYmd(admin: SupabaseClient, orgId: string, now: Date = new Date()): Promise<string> {
  return ymdInZone(now, await loadOrgTimeZone(admin, orgId))
}
