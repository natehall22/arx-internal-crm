import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { syncOrgEnrollments } from '@/lib/sync-444-core'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    console.error('CRON_SECRET env var not set — sync-444 cron will not run')
    return NextResponse.json({ error: 'Cron endpoint not configured' }, { status: 503 })
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createServiceClient()

  // Find all orgs with active 444 enrollments
  const { data: orgRows, error: orgError } = await admin
    .from('program_444_enrollments')
    .select('org_id')
    .eq('status', 'active')

  if (orgError) {
    console.error('[cron/sync-444] Failed to fetch active orgs:', orgError.message)
    return NextResponse.json({ error: orgError.message }, { status: 500 })
  }

  const orgIds = Array.from(new Set((orgRows ?? []).map((r) => r.org_id as string)))

  if (orgIds.length === 0) {
    return NextResponse.json({ orgs: 0, synced: 0, qualified: [] })
  }

  let totalSynced = 0
  const allQualified: { org_id: string; user_id: string; week: 1 | 2 }[] = []

  for (const orgId of orgIds) {
    try {
      const result = await syncOrgEnrollments(admin, orgId, null)
      totalSynced += result.synced
      for (const q of result.qualified) {
        allQualified.push({ org_id: orgId, ...q })
      }
    } catch (err) {
      console.error(`[cron/sync-444] Error syncing org ${orgId}:`, err instanceof Error ? err.message : err)
    }
  }

  return NextResponse.json({ orgs: orgIds.length, synced: totalSynced, qualified: allQualified })
}
