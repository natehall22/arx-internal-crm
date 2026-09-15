import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'

// Uploads go through ./register + ./finalize (direct to storage, no body-size limit).

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createServiceClient()
    const jobId = params.id

    const { data: job } = await supabase
      .from('production_jobs')
      .select('id')
      .eq('id', jobId)
      .eq('org_id', profile.org_id)
      .single()

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const { data: photos, error } = await supabase
      .from('photos')
      .select('id, photo_tag, filename, created_at, uploaded_by, work_order_id')
      .eq('org_id', profile.org_id)
      .eq('job_id', jobId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(200)

    if (error) {
      return NextResponse.json(
        { error: error.message, code: error.code || null },
        { status: 500 }
      )
    }

    const photoRows = photos || []
    const uploaderIds = Array.from(
      new Set(photoRows.map((photo) => photo.uploaded_by).filter(Boolean))
    ) as string[]

    let uploaderNameById: Record<string, string> = {}
    if (uploaderIds.length > 0) {
      const { data: uploaders } = await supabase
        .from('users')
        .select('id, full_name')
        .in('id', uploaderIds)
        .eq('org_id', profile.org_id)

      uploaderNameById = Object.fromEntries(
        (uploaders || []).map((user) => [user.id, user.full_name || 'Unknown'])
      )
    }

    const photosWithUploaderNames = photoRows.map((photo) => ({
      ...photo,
      uploaded_by_name: photo.uploaded_by ? uploaderNameById[photo.uploaded_by] || null : null,
    }))

    return NextResponse.json({ photos: photosWithUploaderNames })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to load photos' },
      { status: 500 }
    )
  }
}
