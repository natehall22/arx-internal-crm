import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { FILES_BUCKET, buildCostAttachmentStoragePath, safeUploadFilename } from '@/lib/files/storage'

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
    const rawName = typeof body?.filename === 'string' ? body.filename : ''
    const jobCostLineId =
      typeof body?.job_cost_line_id === 'string'
        ? body.job_cost_line_id
        : typeof body?.jobCostLineId === 'string'
          ? body.jobCostLineId
          : ''

    if (!rawName.trim() || !jobCostLineId) {
      return NextResponse.json(
        { error: 'filename and job_cost_line_id are required' },
        { status: 400 }
      )
    }

    const { data: costLine } = await supabase
      .from('job_cost_lines')
      .select('id, job_id')
      .eq('id', jobCostLineId)
      .eq('org_id', profile.org_id)
      .eq('job_id', jobId)
      .single()

    if (!costLine) {
      return NextResponse.json({ error: 'Cost line not found' }, { status: 404 })
    }

    const attachmentId = crypto.randomUUID()
    const documentId = crypto.randomUUID()
    const safeName = safeUploadFilename(rawName, 'attachment')
    const storagePath = buildCostAttachmentStoragePath({
      orgId: profile.org_id,
      jobId,
      attachmentId,
      filename: safeName,
    })

    return NextResponse.json({
      attachmentId,
      documentId,
      storagePath,
      bucket: FILES_BUCKET,
      jobCostLineId,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to register cost attachment upload'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
