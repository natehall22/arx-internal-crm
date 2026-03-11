import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { FILES_BUCKET, buildJobPhotoStoragePath } from '@/lib/files/storage'

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

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const photoTag = String(formData.get('photo_tag') || 'general')

    if (!file) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 })
    }

    const photoId = crypto.randomUUID()
    const storagePath = buildJobPhotoStoragePath({
      orgId: profile.org_id,
      jobId,
      photoId,
      filename: file.name,
    })

    const fileBuffer = Buffer.from(await file.arrayBuffer())

    const { error: uploadError } = await supabase.storage
      .from(FILES_BUCKET)
      .upload(storagePath, fileBuffer, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      })

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 })
    }

    const { data: photo, error: insertError } = await supabase
      .from('photos')
      .insert({
        id: photoId,
        org_id: profile.org_id,
        job_id: jobId,
        storage_path: storagePath,
        filename: file.name,
        file_size: file.size,
        mime_type: file.type || null,
        photo_tag: photoTag || null,
        uploaded_by: profile.id,
      })
      .select('*')
      .single()

    if (insertError) {
      await supabase.storage.from(FILES_BUCKET).remove([storagePath])
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({ photo })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to upload photo' },
      { status: 500 }
    )
  }
}
