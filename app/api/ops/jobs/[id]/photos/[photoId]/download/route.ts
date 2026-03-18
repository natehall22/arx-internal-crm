import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { FILES_BUCKET } from '@/lib/files/storage'

export const runtime = 'nodejs'

export async function GET(
  _request: Request,
  { params }: { params: { id: string; photoId: string } }
) {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createServiceClient()

    const { data: photo } = await supabase
      .from('photos')
      .select('id, storage_path')
      .eq('id', params.photoId)
      .eq('job_id', params.id)
      .eq('org_id', profile.org_id)
      .is('deleted_at', null)
      .single()

    if (!photo?.storage_path) {
      return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
    }

    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from(FILES_BUCKET)
      .createSignedUrl(photo.storage_path, 60 * 10)

    if (signedUrlError || !signedUrlData?.signedUrl) {
      return NextResponse.json(
        { error: signedUrlError?.message || 'Could not create photo download link' },
        { status: 500 }
      )
    }

    return NextResponse.redirect(signedUrlData.signedUrl)
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to open photo' },
      { status: 500 }
    )
  }
}
