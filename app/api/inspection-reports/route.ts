import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { REPORT_EDIT_ROLES } from '@/lib/inspection-report/types'
import { authErrorResponse, attachSignedUrls, fetchReportPhotos, getOrCreateReport } from '@/lib/inspection-report/server'

// POST — get-or-create the report for an opportunity (one report per opportunity by default;
// returns the latest existing one so the rep always resumes where they left off).
export async function POST(request: NextRequest) {
  try {
    const { profile } = await requireAuthApi()
    if (!REPORT_EDIT_ROLES.has(profile.role)) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    const opportunityId = typeof body?.opportunity_id === 'string' ? body.opportunity_id : null
    if (!opportunityId) {
      return NextResponse.json({ error: 'opportunity_id is required' }, { status: 400 })
    }

    const admin = createServiceClient()
    const result = await getOrCreateReport(admin, {
      opportunityId,
      profile,
    })
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    const photos = await attachSignedUrls(
      admin,
      await fetchReportPhotos(admin, result.report.id, profile.org_id)
    )
    return NextResponse.json({ report: result.report, photos, created: result.created })
  } catch (err) {
    const auth = authErrorResponse(err)
    if (auth) return auth
    console.error('inspection-reports POST:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
