import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

const BUCKET = 'inspection-photos'
const RETENTION_DAYS = 30

export async function GET(request: NextRequest) {
  // Verify the Vercel cron secret to prevent unauthorized invocation
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    console.error('CRON_SECRET env var not set — cleanup-inspection-photos will not run')
    return NextResponse.json({ error: 'Cron endpoint not configured' }, { status: 503 })
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createServiceClient()
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()

  try {
    // Fetch rows older than the retention window
    const { data: expired, error: fetchError } = await admin
      .from('inspection_result_photos')
      .select('id, storage_path')
      .lt('created_at', cutoff)
      .limit(500) // Process in batches to stay within execution limits

    if (fetchError) {
      console.error('cleanup-inspection-photos: fetch error', fetchError)
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }

    if (!expired || expired.length === 0) {
      return NextResponse.json({ deleted: 0, message: 'Nothing to clean up' })
    }

    const storagePaths = expired.map((r) => r.storage_path)
    const ids = expired.map((r) => r.id)

    // Delete from storage
    const { error: storageError } = await admin.storage
      .from(BUCKET)
      .remove(storagePaths)

    if (storageError) {
      console.error('cleanup-inspection-photos: storage remove error', storageError)
      // Continue to delete DB rows — orphaned storage files caught on next run
    }

    // Delete DB rows
    const { error: deleteError } = await admin
      .from('inspection_result_photos')
      .delete()
      .in('id', ids)

    if (deleteError) {
      console.error('cleanup-inspection-photos: db delete error', deleteError)
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    console.log(`cleanup-inspection-photos: deleted ${expired.length} photos older than ${RETENTION_DAYS} days`)
    return NextResponse.json({ deleted: expired.length })
  } catch (err) {
    console.error('cleanup-inspection-photos: unexpected error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
