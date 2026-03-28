import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'

const BUCKET = 'inspection-photos'

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; photoId: string } }
) {
  try {
    const { profile } = await requireAuthApi()
    const admin = createServiceClient()

    const { data: photo, error: fetchError } = await admin
      .from('inspection_result_photos')
      .select('id, storage_path, org_id, result_id')
      .eq('id', params.photoId)
      .eq('org_id', profile.org_id)
      .single()

    if (fetchError || !photo) {
      return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
    }

    // Verify the photo's result row belongs to this opportunity (prevents within-org cross-delete).
    // maybeSingle: 0 rows => null without treating as an error (photo rows always have a result_id FK).
    const { data: resultRow, error: resultErr } = await admin
      .from('inspection_results')
      .select('id')
      .eq('id', photo.result_id)
      .eq('opportunity_id', params.id)
      .eq('org_id', profile.org_id)
      .maybeSingle()

    if (resultErr || !resultRow) {
      return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
    }

    // Remove from storage first
    const { error: storageError } = await admin.storage
      .from(BUCKET)
      .remove([photo.storage_path])

    if (storageError) {
      console.error('Storage delete error:', storageError)
      // Proceed to remove DB row anyway — orphaned storage objects cleaned by cron
    }

    const { error: deleteError } = await admin
      .from('inspection_result_photos')
      .delete()
      .eq('id', params.photoId)
      .eq('org_id', profile.org_id)

    if (deleteError) {
      return NextResponse.json({ error: 'Failed to delete photo record' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
