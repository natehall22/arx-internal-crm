import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { REPORT_BUCKET, REPORT_EDIT_ROLES } from '@/lib/inspection-report/types'
import { authErrorResponse, assertRepCanAccessReport, fetchReportForOrg, MAX_REPORT_PHOTOS, PHOTO_SIGNED_URL_TTL, opportunityAccessResponse } from '@/lib/inspection-report/server'

// Client compresses to ~1280px JPEG (~300KB) before upload; 4MB guard keeps us under
// Vercel's 4.5MB body cap and rejects accidental raw-camera uploads.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024

// POST — upload one compressed JPEG photo for this report
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

    const { count } = await admin
      .from('inspection_report_photos')
      .select('id', { count: 'exact', head: true })
      .eq('report_id', report.id)
      .eq('org_id', profile.org_id)
    if ((count ?? 0) >= MAX_REPORT_PHOTOS) {
      return NextResponse.json({ error: `Maximum ${MAX_REPORT_PHOTOS} photos per report` }, { status: 400 })
    }

    const formData = await request.formData()
    const raw = formData.get('file')
    if (!raw || typeof raw === 'string' || !(raw instanceof Blob) || raw.size === 0) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }
    if (raw.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'Photo too large — must be compressed before upload' }, { status: 400 })
    }
    const width = parseInt(String(formData.get('width') || ''), 10) || null
    const height = parseInt(String(formData.get('height') || ''), 10) || null

    // The client generates the id so the doc can reference the photo (and keep working
    // offline) before the upload lands. Must be a well-formed UUID.
    const clientId = String(formData.get('id') || '')
    const photoId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)
      ? clientId.toLowerCase()
      : crypto.randomUUID()

    // Idempotent retry: if this photo id already landed (flaky-signal double send), return it
    const { data: existing } = await admin
      .from('inspection_report_photos')
      .select('id, storage_path, width, height, created_at')
      .eq('id', photoId)
      .eq('report_id', report.id)
      .eq('org_id', profile.org_id)
      .maybeSingle()
    if (existing) {
      const { data: signedExisting } = await admin.storage
        .from(REPORT_BUCKET)
        .createSignedUrl(existing.storage_path, PHOTO_SIGNED_URL_TTL)
      return NextResponse.json({ photo: { ...existing, url: signedExisting?.signedUrl ?? null } })
    }
    const storagePath = `${profile.org_id}/${params.id}/photos/${photoId}.jpg`
    const fileBuffer = Buffer.from(await raw.arrayBuffer())

    // upsert: a prior attempt may have uploaded the object but died before the row insert
    // (flaky roof signal) — the path embeds the client UUID, so overwriting is safe and
    // keeps retries idempotent instead of wedging on 409s forever.
    const { error: uploadError } = await admin.storage
      .from(REPORT_BUCKET)
      .upload(storagePath, fileBuffer, { contentType: 'image/jpeg', upsert: true })
    if (uploadError) {
      console.error('report photo upload error:', uploadError)
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
    }

    const { data: row, error: insertError } = await admin
      .from('inspection_report_photos')
      .insert({
        id: photoId,
        org_id: profile.org_id,
        report_id: report.id,
        storage_path: storagePath,
        width,
        height,
      })
      .select('id, storage_path, width, height, created_at')
      .single()
    if (insertError || !row) {
      await admin.storage.from(REPORT_BUCKET).remove([storagePath])
      return NextResponse.json({ error: 'Failed to save photo record' }, { status: 500 })
    }

    // Keep the report "alive" for the retention cron — a photo landing counts as activity
    // even when every doc autosave failed on bad signal.
    await admin
      .from('inspection_reports')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', report.id)
      .eq('org_id', profile.org_id)

    const { data: signed } = await admin.storage
      .from(REPORT_BUCKET)
      .createSignedUrl(storagePath, PHOTO_SIGNED_URL_TTL)

    return NextResponse.json({ photo: { ...row, url: signed?.signedUrl ?? null } })
  } catch (err) {
    const auth = authErrorResponse(err)
    if (auth) return auth
    console.error('inspection-report photos POST:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
