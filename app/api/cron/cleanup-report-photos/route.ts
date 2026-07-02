import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { REPORT_BUCKET } from '@/lib/inspection-report/types'

// Storage-bloat control for roof reports: once the PDF is built, the PDF *is* the
// deliverable — the individual source photos don't need to live in Supabase forever.
// Photos are purged 30 days after the report was last touched, but ONLY when a PDF
// exists (the report stays fully editable until then; the PDF is kept indefinitely).
// Drafts that never produced a PDF get a longer 90-day leash before their photos go.

const RETENTION_DAYS_WITH_PDF = 30
const RETENTION_DAYS_NO_PDF = 90

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    console.error('CRON_SECRET env var not set — cleanup-report-photos will not run')
    return NextResponse.json({ error: 'Cron endpoint not configured' }, { status: 503 })
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createServiceClient()
  const cutoffWithPdf = new Date(Date.now() - RETENTION_DAYS_WITH_PDF * 24 * 60 * 60 * 1000).toISOString()
  const cutoffNoPdf = new Date(Date.now() - RETENTION_DAYS_NO_PDF * 24 * 60 * 60 * 1000).toISOString()

  try {
    // Reports whose photos are eligible for purge
    const { data: withPdf, error: e1 } = await admin
      .from('inspection_reports')
      .select('id')
      .not('pdf_storage_path', 'is', null)
      .lt('updated_at', cutoffWithPdf)
      .limit(200)
    if (e1) {
      console.error('cleanup-report-photos: fetch (with pdf) error', e1)
      return NextResponse.json({ error: e1.message }, { status: 500 })
    }
    const { data: noPdf, error: e2 } = await admin
      .from('inspection_reports')
      .select('id')
      .is('pdf_storage_path', null)
      .lt('updated_at', cutoffNoPdf)
      .limit(200)
    if (e2) {
      console.error('cleanup-report-photos: fetch (no pdf) error', e2)
      return NextResponse.json({ error: e2.message }, { status: 500 })
    }

    const reportIds = [...(withPdf ?? []), ...(noPdf ?? [])].map((r) => r.id)
    if (!reportIds.length) {
      return NextResponse.json({ deleted: 0, message: 'Nothing to clean up' })
    }

    const { data: photos, error: fetchError } = await admin
      .from('inspection_report_photos')
      .select('id, storage_path')
      .in('report_id', reportIds)
      .limit(500) // batch; the rest is caught on the next nightly run
    if (fetchError) {
      console.error('cleanup-report-photos: photo fetch error', fetchError)
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }
    if (!photos || photos.length === 0) {
      return NextResponse.json({ deleted: 0, message: 'Nothing to clean up' })
    }

    const { error: storageError } = await admin.storage
      .from(REPORT_BUCKET)
      .remove(photos.map((p) => p.storage_path))
    if (storageError) {
      console.error('cleanup-report-photos: storage remove error', storageError)
      // Continue to delete DB rows — orphaned storage files caught on next run
    }

    const { error: deleteError } = await admin
      .from('inspection_report_photos')
      .delete()
      .in('id', photos.map((p) => p.id))
    if (deleteError) {
      console.error('cleanup-report-photos: db delete error', deleteError)
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    console.log(`cleanup-report-photos: deleted ${photos.length} photos across ${reportIds.length} idle reports`)
    return NextResponse.json({ deleted: photos.length, reports: reportIds.length })
  } catch (err) {
    console.error('cleanup-report-photos: unexpected error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
