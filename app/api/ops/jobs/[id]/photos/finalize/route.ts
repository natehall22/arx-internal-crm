import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { FILES_BUCKET } from '@/lib/files/storage'
import { findStorageObjectByRecordPrefix } from '@/lib/files/direct-upload-utils'

export const runtime = 'nodejs'

export async function POST(
  request: Request,
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

    const body = await request.json().catch(() => null)
    const photoId = typeof body?.photo_id === 'string' ? body.photo_id : typeof body?.photoId === 'string' ? body.photoId : ''
    if (!photoId) {
      return NextResponse.json({ error: 'photoId is required' }, { status: 400 })
    }

    const photoTag = typeof body?.photo_tag === 'string' ? body.photo_tag : 'general'
    const mimeType =
      typeof body?.mime_type === 'string'
        ? body.mime_type
        : typeof body?.mimeType === 'string'
          ? body.mimeType
          : null
    const fileSize =
      typeof body?.file_size === 'number'
        ? body.file_size
        : typeof body?.fileSize === 'number'
          ? body.fileSize
          : null

    const folderPath = `${profile.org_id}/jobs/${jobId}/photos`
    const found = await findStorageObjectByRecordPrefix(supabase, FILES_BUCKET, folderPath, photoId)
    if (!found) {
      return NextResponse.json(
        { error: 'Upload not found in storage. Try uploading again.' },
        { status: 400 }
      )
    }

    const { data: photo, error: insertError } = await supabase
      .from('photos')
      .insert({
        id: photoId,
        org_id: profile.org_id,
        job_id: jobId,
        storage_path: found.storagePath,
        filename: found.displayFilename,
        file_size: found.size ?? fileSize,
        mime_type: mimeType || found.mimeType,
        photo_tag: photoTag || null,
        uploaded_by: profile.id,
      })
      .select('*')
      .single()

    if (insertError) {
      await supabase.storage.from(FILES_BUCKET).remove([found.storagePath])
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({ photo })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to finalize photo upload'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
