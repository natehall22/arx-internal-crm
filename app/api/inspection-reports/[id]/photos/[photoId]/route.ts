import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { authErrorResponse, assertRepCanAccessReport, fetchReportForOrg, opportunityAccessResponse } from '@/lib/inspection-report/server'
import { createServiceClient } from '@/lib/supabase/service'
import { REPORT_BUCKET, REPORT_EDIT_ROLES } from '@/lib/inspection-report/types'

// DELETE — remove one photo (row + storage object). The doc's photoIds/captions are
// cleaned up by the client's next autosave; the PDF engine skips unknown ids anyway.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string; photoId: string } }
) {
  try {
    const { profile } = await requireAuthApi()
    if (!REPORT_EDIT_ROLES.has(profile.role)) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }
    const admin = createServiceClient()

    const report = await fetchReportForOrg(admin, params.id, profile.org_id)
    if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 })

    const access = await assertRepCanAccessReport(admin, profile, report)
    if (!access.ok) return opportunityAccessResponse(access)

    const { data: row } = await admin
      .from('inspection_report_photos')
      .select('id, storage_path')
      .eq('id', params.photoId)
      .eq('report_id', params.id)
      .eq('org_id', profile.org_id)
      .maybeSingle()
    if (!row) return NextResponse.json({ error: 'Photo not found' }, { status: 404 })

    await admin.storage.from(REPORT_BUCKET).remove([row.storage_path])
    const { error } = await admin
      .from('inspection_report_photos')
      .delete()
      .eq('id', params.photoId)
      .eq('report_id', params.id)
      .eq('org_id', profile.org_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (err) {
    const auth = authErrorResponse(err)
    if (auth) return auth
    console.error('inspection-report photo DELETE:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
