import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { syncOrgSetterRampGates, syncSetterFloorBonuses } from '@/lib/sync-setter-ramp-core'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    console.error('CRON_SECRET env var not set — sync-setter-ramp cron will not run')
    return NextResponse.json({ error: 'Cron endpoint not configured' }, { status: 503 })
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createServiceClient()

  const { data: orgRows, error: orgError } = await admin
    .from('setter_ramp_enrollments')
    .select('org_id')
    .eq('status', 'active')

  if (orgError) {
    console.error('[cron/sync-setter-ramp] Failed to fetch active orgs:', orgError.message)
    return NextResponse.json({ error: orgError.message }, { status: 500 })
  }

  const orgIds = Array.from(new Set((orgRows ?? []).map((r) => r.org_id as string)))
  if (orgIds.length === 0) {
    return NextResponse.json({ orgs: 0, gates: null, floorBonuses: null })
  }

  let weeksSynced = 0
  let floorWins = 0
  let commissionWins = 0
  let held = 0

  for (const orgId of orgIds) {
    try {
      const gateResult = await syncOrgSetterRampGates(admin, orgId)
      weeksSynced += gateResult.weeksSynced
    } catch (err) {
      console.error(`[cron/sync-setter-ramp] gate sync error for org ${orgId}:`, err instanceof Error ? err.message : err)
    }

    try {
      // Floor-vs-commission reconciliation only resolves once a period is
      // locked — see the KNOWN GAP note on getSetterPeriodCommissionTotal in
      // lib/sync-setter-ramp-core.ts before trusting this in production.
      const floorResult = await syncSetterFloorBonuses(admin, orgId, null)
      floorWins += floorResult.floorWins
      commissionWins += floorResult.commissionWins
      held += floorResult.held
    } catch (err) {
      console.error(`[cron/sync-setter-ramp] floor bonus sync error for org ${orgId}:`, err instanceof Error ? err.message : err)
    }
  }

  return NextResponse.json({
    orgs: orgIds.length,
    gates: { weeksSynced },
    floorBonuses: { floorWins, commissionWins, held },
  })
}
