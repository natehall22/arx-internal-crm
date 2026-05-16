/**
 * LiDAR measurement ingestion — opportunity context.
 *
 * iOS companion app endpoint. The ARX iOS app posts ARKit LiDAR
 * measurements here after an on-site capture session. The server
 * merges them into the existing measure report so ops can review
 * and fine-tune in the web form.
 *
 * POST /api/opportunities/:id/measure/lidar
 * Authorization: Bearer <supabase_access_token>
 * Content-Type: application/json
 *
 * Body: LidarMeasurePayload (see lib/lidar-measure-ingest.ts)
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { loadExteriorMeasure, resolveOpportunityMeasureContext } from '@/lib/exterior-measure-api'
import { ingestLidarPayload, type LidarMeasurePayload } from '@/lib/lidar-measure-ingest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { profile, authUser } = await requireAuthApi()
    const supabase = createServiceClient()

    const context = await resolveOpportunityMeasureContext(supabase, profile.org_id, params.id)
    if (!context) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    const body: LidarMeasurePayload = await request.json().catch(() => null)
    if (!body || !Array.isArray(body.elevations) || body.elevations.length === 0) {
      return NextResponse.json(
        { error: 'Request body must include at least one elevation in the elevations array.' },
        { status: 400 }
      )
    }

    const { reportId, elevationIds } = await ingestLidarPayload(supabase, {
      orgId: profile.org_id,
      opportunityId: params.id,
      jobId: context.jobId,
      userId: authUser.id,
      payload: body,
    })

    // Return the full updated measure so the iOS app can display a confirmation
    const measure = await loadExteriorMeasure(supabase, {
      orgId: profile.org_id,
      opportunityId: params.id,
      jobId: context.jobId,
    })

    return NextResponse.json({
      success: true,
      reportId,
      elevationIds,
      ...measure,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'LiDAR ingest failed'
    console.error('LiDAR ingest (opportunity):', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
