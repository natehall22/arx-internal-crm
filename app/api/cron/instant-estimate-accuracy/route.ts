import { NextRequest, NextResponse } from 'next/server'
import { isOrgFeatureOn } from '@/lib/org-features-server'

import { verifyCronSecret } from '@/lib/cron-auth'
import { DEFAULT_ACCURACY_CHECK_LIMIT, runAccuracyChecks } from '@/lib/instant-estimate-accuracy'
import { getPublicEstimateOrgId } from '@/lib/public-estimate-config'
import { createServiceClient } from '@/lib/supabase/service'

// Nightly: score the public Instant Estimate against properties ARX has trusted squares for
// (docs/measure-tool/instant-estimate-accuracy.md). Sequential and capped — each check costs Google Solar calls.
// Kill switch: INSTANT_ESTIMATE_ACCURACY_CRON=false. Optional INSTANT_ESTIMATE_ACCURACY_LIMIT (default 15, max 50).

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const authFailure = verifyCronSecret(request, 'instant-estimate-accuracy')
  if (authFailure) return authFailure

  if (process.env.INSTANT_ESTIMATE_ACCURACY_CRON === 'false') {
    return NextResponse.json({ skipped: true, reason: 'INSTANT_ESTIMATE_ACCURACY_CRON=false' })
  }

  let orgId: string
  try {
    orgId = getPublicEstimateOrgId()
  } catch (e) {
    console.error('instant-estimate-accuracy: no org', e)
    return NextResponse.json({ error: 'PUBLIC_ESTIMATE_ORG_ID not set' }, { status: 503 })
  }

  if (!(await isOrgFeatureOn(orgId, 'roofMeasure'))) {
    return NextResponse.json({ skipped: true, reason: 'roof measuring is turned off for this company' })
  }

  const envLimit = Number(process.env.INSTANT_ESTIMATE_ACCURACY_LIMIT)
  const limit = Number.isFinite(envLimit) && envLimit > 0 ? envLimit : DEFAULT_ACCURACY_CHECK_LIMIT

  try {
    const result = await runAccuracyChecks(createServiceClient(), orgId, { limit })
    if (result.errors.length) console.warn('instant-estimate-accuracy: errors', result.errors.slice(0, 20))
    return NextResponse.json({ ...result, errors: result.errors.slice(0, 20) })
  } catch (e) {
    console.error('instant-estimate-accuracy: run failed', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Run failed' }, { status: 500 })
  }
}
