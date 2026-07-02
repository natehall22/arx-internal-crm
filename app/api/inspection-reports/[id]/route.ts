import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { normalizeReportDoc, REPORT_BUCKET, REPORT_EDIT_ROLES } from '@/lib/inspection-report/types'
import { authErrorResponse, attachSignedUrls, assertRepCanAccessReport, fetchReportForOrg, fetchReportPhotos, opportunityAccessResponse } from '@/lib/inspection-report/server'

// GET — full report + photos with signed URLs
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { profile } = await requireAuthApi()
    const admin = createServiceClient()

    const report = await fetchReportForOrg(admin, params.id, profile.org_id)
    if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 })

    const access = await assertRepCanAccessReport(admin, profile, report)
    if (!access.ok) return opportunityAccessResponse(access)

    const photos = await attachSignedUrls(
      admin,
      await fetchReportPhotos(admin, params.id, profile.org_id)
    )
    return NextResponse.json({ report, photos })
  } catch (err) {
    const auth = authErrorResponse(err)
    if (auth) return auth
    console.error('inspection-report GET:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH — autosave the document (and only the document; PDF/send state has its own routes)
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
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

    const body = await request.json().catch(() => null)
    if (!body || typeof body.doc !== 'object' || body.doc === null) {
      return NextResponse.json({ error: 'doc is required' }, { status: 400 })
    }
    // Normalize instead of trusting the client shape — a malformed doc must never be able
    // to brick the builder or the PDF engine for this report.
    const doc = normalizeReportDoc(body.doc)

    // Optimistic concurrency on doc_updated_at (NOT updated_at — that also moves on photo
    // uploads and would make a device conflict with itself). A whole-doc PATCH from a stale
    // device would silently erase another device's edits, so mismatch = 409.
    // compare as instants — Postgres returns '+00:00' offsets while our responses use 'Z'
    const baseDocUpdatedAt = typeof body.base_updated_at === 'string' ? body.base_updated_at : null
    const sameInstant = (a: string, b: string) => new Date(a).getTime() === new Date(b).getTime()
    if (baseDocUpdatedAt && report.doc_updated_at && !sameInstant(report.doc_updated_at, baseDocUpdatedAt)) {
      return NextResponse.json(
        { error: 'This report was changed on another device', conflict: true },
        { status: 409 }
      )
    }

    const now = new Date().toISOString()
    let update = admin
      .from('inspection_reports')
      .update({ doc, doc_updated_at: now, updated_at: now })
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
    // guard on the value we just read so a write racing between read and update can't be lost
    update = report.doc_updated_at
      ? update.eq('doc_updated_at', report.doc_updated_at)
      : update.is('doc_updated_at', null)
    const { data: updatedRows, error } = await update.select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!updatedRows?.length) {
      return NextResponse.json(
        { error: 'This report was changed on another device', conflict: true },
        { status: 409 }
      )
    }

    return NextResponse.json({ ok: true, updated_at: now })
  } catch (err) {
    const auth = authErrorResponse(err)
    if (auth) return auth
    console.error('inspection-report PATCH:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE — remove the report, its photo rows (FK cascade) and its storage folder
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
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

    const photos = await fetchReportPhotos(admin, params.id, profile.org_id)
    const paths = photos.map((p) => p.storage_path)
    if (report.pdf_storage_path) paths.push(report.pdf_storage_path)
    if (paths.length) {
      // best-effort; orphaned objects are invisible (private bucket) and cheap
      await admin.storage.from(REPORT_BUCKET).remove(paths)
    }

    const { error } = await admin
      .from('inspection_reports')
      .delete()
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (err) {
    const auth = authErrorResponse(err)
    if (auth) return auth
    console.error('inspection-report DELETE:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
