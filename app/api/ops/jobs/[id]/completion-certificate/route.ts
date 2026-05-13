import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import {
  generateCompletionCertificateDocument,
  getExistingCompletionCertificate,
} from '@/lib/completion-certificate'
import { pickValidEmail } from '@/lib/setter-email'

export const runtime = 'nodejs'

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createServiceClient()

    const { data: job } = await supabase
      .from('production_jobs')
      .select('id, status, customer:customers(email)')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const document = await getExistingCompletionCertificate(supabase, {
      orgId: profile.org_id,
      jobId: params.id,
    })
    const customer = Array.isArray((job as any).customer) ? (job as any).customer[0] : (job as any).customer

    return NextResponse.json({
      document,
      can_send: (job as any).status === 'complete' || (job as any).status === 'collected',
      default_email: pickValidEmail(customer?.email) ?? '',
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to load completion certificate' },
      { status: 500 }
    )
  }
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createServiceClient()
    const body = await request.json().catch(() => ({}))
    const result = await generateCompletionCertificateDocument(supabase, {
      orgId: profile.org_id,
      jobId: params.id,
      uploadedBy: profile.id,
      force: body?.force === true,
    })

    return NextResponse.json({ success: true, ...result })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to generate completion certificate' },
      { status: 500 }
    )
  }
}
