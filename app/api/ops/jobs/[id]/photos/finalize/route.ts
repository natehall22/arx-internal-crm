import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { finalizeJobPhotoUpload } from '@/lib/job-photo-upload'

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

    const workOrderId = await resolveJobWorkOrderId(supabase, profile.org_id, jobId, body?.work_order_id)
    if (workOrderId === false) {
      return NextResponse.json({ error: 'Trade not found on this job' }, { status: 400 })
    }

    const result = await finalizeJobPhotoUpload(supabase, {
      orgId: profile.org_id,
      jobId,
      photoId,
      photoTag,
      mimeType,
      fileSize,
      uploadedBy: profile.id,
      workOrderId,
    })
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ photo: result.photo })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to finalize photo upload'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/** null = no trade given; false = a trade was given that isn't on this job. */
async function resolveJobWorkOrderId(
  supabase: ReturnType<typeof createServiceClient>,
  orgId: string,
  jobId: string,
  raw: unknown
): Promise<string | null | false> {
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw !== 'string') return false
  const { data } = await supabase
    .from('work_orders')
    .select('id')
    .eq('id', raw)
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .maybeSingle()
  return data ? data.id : false
}
