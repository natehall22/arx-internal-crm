import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { registerJobPhotoUpload } from '@/lib/job-photo-upload'

export const runtime = 'nodejs'

/**
 * Start a direct-to-Supabase photo upload (avoids Vercel ~4.5MB request body limits).
 * Client uploads via signed URL token (no user JWT required), then calls …/finalize.
 */
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
    const result = await registerJobPhotoUpload(supabase, { orgId: profile.org_id, jobId, filename: rawName })
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to register photo upload'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
