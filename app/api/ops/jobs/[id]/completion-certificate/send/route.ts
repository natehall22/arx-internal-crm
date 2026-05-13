import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { FILES_BUCKET } from '@/lib/files/storage'
import { generateCompletionCertificateDocument } from '@/lib/completion-certificate'
import { getMailTransport } from '@/lib/setter-email'

export const runtime = 'nodejs'

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createServiceClient()
    const body = await request.json().catch(() => ({}))
    const email = typeof body?.email === 'string' ? body.email.trim() : ''

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
    }
    if (!process.env.SMTP_HOST) {
      return NextResponse.json({ error: 'SMTP is not configured' }, { status: 503 })
    }

    const { data: job } = await supabase
      .from('production_jobs')
      .select('id, status, job_number, address_text, customer:customers(name)')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    if ((job as any).status !== 'complete' && (job as any).status !== 'collected') {
      return NextResponse.json(
        { error: 'Certificate can only be emailed after the job is marked complete' },
        { status: 400 }
      )
    }

    const { document } = await generateCompletionCertificateDocument(supabase, {
      orgId: profile.org_id,
      jobId: params.id,
      uploadedBy: profile.id,
      force: body?.force === true,
    })

    const { data: fileData, error: downloadError } = await supabase.storage
      .from(FILES_BUCKET)
      .download(document.storage_path)

    if (downloadError || !fileData) {
      return NextResponse.json(
        { error: downloadError?.message || 'Could not load certificate PDF' },
        { status: 500 }
      )
    }

    const customer = Array.isArray((job as any).customer) ? (job as any).customer[0] : (job as any).customer
    const customerName = customer?.name || 'Customer'
    const jobNumber = (job as any).job_number || 'job'
    const address = (job as any).address_text || ''
    const buffer = Buffer.from(await fileData.arrayBuffer())

    await getMailTransport().sendMail({
      from: 'info@arxroofing.com',
      to: email,
      subject: `Certificate of Completion - ${jobNumber}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px; color: #111827;">
          <h2 style="margin: 0 0 16px;">Certificate of Completion</h2>
          <p>Please find attached the certificate of completion for ${escapeHtml(customerName)}.</p>
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr><td style="padding: 6px 0; color: #6b7280; width: 120px;">Job</td><td style="padding: 6px 0;">${escapeHtml(jobNumber)}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280;">Property</td><td style="padding: 6px 0;">${escapeHtml(address)}</td></tr>
          </table>
          <p style="font-size: 12px; color: #6b7280;">This is an automated message from ARX Roofing & Exteriors.</p>
        </div>
      `,
      attachments: [{ filename: document.filename, content: buffer, contentType: 'application/pdf' }],
    })

    return NextResponse.json({ success: true, document })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to email completion certificate' },
      { status: 500 }
    )
  }
}
