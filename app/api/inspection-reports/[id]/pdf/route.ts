import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { signedUploadTokenForPath } from '@/lib/files/signed-upload'
import { REPORT_BUCKET, REPORT_EDIT_ROLES } from '@/lib/inspection-report/types'
import { authErrorResponse, assertRepCanAccessReport, fetchReportForOrg, opportunityAccessResponse } from '@/lib/inspection-report/server'

// The finished PDF can approach 25MB — far over Vercel's 4.5MB body cap — so the browser
// generates it, registers here for a signed-upload token, uploads straight to storage,
// then finalizes here. Same register → uploadToSignedUrl → finalize flow as ops job files.

function sanitizeSlug(raw: unknown): string {
  const s = String(raw || '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return s || `ARX-Roof-Report-${new Date().toISOString().slice(0, 10)}`
}

// GET — short-lived signed URL for viewing/downloading the stored PDF.
// ?redirect=1 302s straight to the file so plain <a> links work from server components.
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { profile } = await requireAuthApi()
    const admin = createServiceClient()

    const report = await fetchReportForOrg(admin, params.id, profile.org_id)
    if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 })

    const access = await assertRepCanAccessReport(admin, profile, report)
    if (!access.ok) return opportunityAccessResponse(access)

    if (!report.pdf_storage_path) {
      return NextResponse.json({ error: 'No PDF generated yet' }, { status: 404 })
    }
    const { data: signed, error } = await admin.storage
      .from(REPORT_BUCKET)
      .createSignedUrl(report.pdf_storage_path, 60 * 60)
    if (error || !signed?.signedUrl) {
      return NextResponse.json({ error: 'Could not sign PDF URL' }, { status: 500 })
    }
    if (request.nextUrl.searchParams.get('redirect') === '1') {
      return NextResponse.redirect(signed.signedUrl)
    }
    return NextResponse.json({ url: signed.signedUrl, size: report.pdf_size_bytes })
  } catch (err) {
    const auth = authErrorResponse(err)
    if (auth) return auth
    console.error('inspection-report pdf GET:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST — { stage: 'register', slug } → { path, token, bucket }
//        { stage: 'finalize', path } → verifies the object landed, records it on the report
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
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
    const stage = body?.stage

    if (stage === 'register') {
      const slug = sanitizeSlug(body?.slug)
      // Unique object per generation: signed-upload tokens can't upsert an existing object,
      // and the old PDF must stay live until the new one fully lands.
      const path = `${profile.org_id}/${report.id}/pdf/${crypto.randomUUID().slice(0, 8)}_${slug}.pdf`
      const signed = await signedUploadTokenForPath(admin, REPORT_BUCKET, path)
      if ('error' in signed) return NextResponse.json({ error: signed.error }, { status: 500 })
      return NextResponse.json({ bucket: REPORT_BUCKET, path, token: signed.token })
    }

    if (stage === 'finalize') {
      const path = typeof body?.path === 'string' ? body.path : ''
      const expectedPrefix = `${profile.org_id}/${report.id}/pdf/`
      if (!path.startsWith(expectedPrefix)) {
        return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
      }
      // Verify the upload actually landed (and get the true size from storage)
      const folder = path.slice(0, path.lastIndexOf('/'))
      const name = path.slice(path.lastIndexOf('/') + 1)
      const { data: items } = await admin.storage.from(REPORT_BUCKET).list(folder, { search: name, limit: 10 })
      const obj = items?.find((i) => i.name === name)
      if (!obj) return NextResponse.json({ error: 'Uploaded PDF not found in storage' }, { status: 400 })
      const size = typeof (obj.metadata as { size?: number } | null)?.size === 'number'
        ? (obj.metadata as { size: number }).size
        : null

      // Snapshot how many photos this PDF actually contains, so the public share page
      // reflects the stored file even if the doc is edited later without a rebuild.
      const photoCount =
        typeof body?.photo_count === 'number' && body.photo_count >= 0
          ? Math.floor(body.photo_count)
          : null

      // Server-side twin of the client's degraded-build guard: finalize deletes the old
      // PDF, so never accept a photo-less PDF while the report still has photos on file
      // (that only happens when a build couldn't load its images).
      if (photoCount === 0) {
        const { count: photosOnFile } = await admin
          .from('inspection_report_photos')
          .select('id', { count: 'exact', head: true })
          .eq('report_id', report.id)
          .eq('org_id', profile.org_id)
        if ((photosOnFile ?? 0) > 0) {
          return NextResponse.json(
            { error: 'This PDF contains no photos but the report has photos — rebuild after they load' },
            { status: 400 }
          )
        }
      }

      const oldPath = report.pdf_storage_path
      const { error } = await admin
        .from('inspection_reports')
        .update({
          pdf_storage_path: path,
          pdf_size_bytes: size,
          pdf_photo_count: photoCount,
          pdf_generated_at: new Date().toISOString(),
          status: report.status === 'sent' ? 'sent' : 'ready',
          updated_at: new Date().toISOString(),
        })
        .eq('id', report.id)
        .eq('org_id', profile.org_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      if (oldPath && oldPath !== path) {
        await admin.storage.from(REPORT_BUCKET).remove([oldPath]) // best-effort cleanup
      }

      const { data: signed } = await admin.storage.from(REPORT_BUCKET).createSignedUrl(path, 60 * 60)
      return NextResponse.json({ ok: true, size, url: signed?.signedUrl ?? null })
    }

    return NextResponse.json({ error: 'Unknown stage' }, { status: 400 })
  } catch (err) {
    const auth = authErrorResponse(err)
    if (auth) return auth
    console.error('inspection-report pdf POST:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
