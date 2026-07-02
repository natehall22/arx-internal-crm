import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { getMailTransport } from '@/lib/setter-email'
import { normalizeReportDoc, REPORT_BUCKET, REPORT_EDIT_ROLES, reportSlug } from '@/lib/inspection-report/types'
import { authErrorResponse, assertRepCanAccessReport, fetchReportForOrg, opportunityAccessResponse } from '@/lib/inspection-report/server'

// Attachments are base64-encoded over SMTP (+33%); most relays reject messages much past
// 25MB total, so attach only up to 15MB of PDF and fall back to the share link above that.
const MAX_ATTACH_BYTES = 15 * 1024 * 1024

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://arx-internal-crm.vercel.app').replace(/\/$/, '')
}

// POST — { to, message? } → email the report (attachment when small enough, share link always)
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { profile } = await requireAuthApi()
    if (!REPORT_EDIT_ROLES.has(profile.role)) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }
    if (!process.env.SMTP_HOST) {
      return NextResponse.json({ error: 'Email is not configured' }, { status: 503 })
    }
    const admin = createServiceClient()

    const report = await fetchReportForOrg(admin, params.id, profile.org_id)
    if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 })

    const access = await assertRepCanAccessReport(admin, profile, report)
    if (!access.ok) return opportunityAccessResponse(access)

    if (!report.pdf_storage_path) {
      return NextResponse.json({ error: 'Generate the PDF before sending' }, { status: 400 })
    }

    const body = await request.json().catch(() => null)
    const to = typeof body?.to === 'string' ? body.to.trim() : ''
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return NextResponse.json({ error: 'A valid recipient email is required' }, { status: 400 })
    }
    const personalMessage = typeof body?.message === 'string' ? body.message.trim().slice(0, 2000) : ''

    const doc = normalizeReportDoc(report.doc)
    const address = doc.propertyAddressHeader || 'your property'
    const shareUrl = `${appBaseUrl()}/r/${report.share_token}`

    // Attach the PDF when it's email-sized (size unknown → download and check for real;
    // the buf.length check below is the actual gate)
    const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = []
    let attached = false
    if ((report.pdf_size_bytes ?? 0) <= MAX_ATTACH_BYTES) {
      const { data: blob, error: dlErr } = await admin.storage
        .from(REPORT_BUCKET)
        .download(report.pdf_storage_path)
      if (!dlErr && blob) {
        const buf = Buffer.from(await blob.arrayBuffer())
        if (buf.length <= MAX_ATTACH_BYTES) {
          attachments.push({
            filename: `${reportSlug(doc)}.pdf`,
            content: buf,
            contentType: 'application/pdf',
          })
          attached = true
        }
      }
    }

    const { data: sender } = await admin.from('users').select('full_name, email').eq('id', profile.id).maybeSingle()
    const senderName = sender?.full_name || 'ARX Roofing & Exteriors'

    const messageHtml = personalMessage
      ? `<p style="color:#374151; white-space:pre-line;">${escapeHtml(personalMessage)}</p>`
      : ''

    await getMailTransport().sendMail({
      from: 'info@arxroofing.com',
      replyTo: sender?.email && sender.email.includes('@') ? sender.email : undefined,
      to,
      subject: `Roof Inspection Report — ${address}`,
      attachments,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; color:#2c2c2a;">
          <div style="background:#2B2A28; border-bottom:3px solid #B0904E; padding:18px 24px; border-radius:8px 8px 0 0;">
            <span style="color:#F4ECDC; font-size:18px; font-weight:bold; letter-spacing:1px;">ARX <span style="color:#B0904E;">Roofing &amp; Exteriors</span></span>
          </div>
          <div style="border:1px solid #e3ddcf; border-top:none; padding:24px; border-radius:0 0 8px 8px;">
            <h2 style="margin:0 0 12px; color:#2c2c2a;">Your roof inspection report is ready</h2>
            <p style="color:#374151;">${attached ? 'Attached is' : 'Here is'} the photo documentation from our inspection at <strong>${escapeHtml(address)}</strong>. It's yours to keep and to share with your insurance carrier if needed.</p>
            ${messageHtml}
            ${attached ? '' : `<p style="color:#374151;">The full report is available at the link below.</p>`}
            <p style="margin:24px 0;">
              <a href="${shareUrl}" style="background:#B0904E; color:#2B2A28; font-weight:bold; padding:12px 22px; border-radius:8px; text-decoration:none; display:inline-block;">View the report online</a>
            </p>
            <p style="color:#374151;">Questions about anything in the report? Just reply to this email — it goes straight to ${escapeHtml(senderName)}.</p>
            <p style="color:#8A8A8A; font-size:12px; margin-top:28px; border-top:1px solid #e3ddcf; padding-top:12px;">
              ARX Roofing &amp; Exteriors &nbsp;|&nbsp; Charlotte / Kannapolis, NC &nbsp;|&nbsp; (360) 485-9413 &nbsp;|&nbsp; arxroofing.com
            </p>
          </div>
        </div>
      `,
    })

    const sentAt = new Date().toISOString()
    await admin
      .from('inspection_reports')
      .update({ status: 'sent', last_sent_to: to, last_sent_at: sentAt, updated_at: sentAt })
      .eq('id', report.id)
      .eq('org_id', profile.org_id)

    await admin.from('activities').insert({
      org_id: profile.org_id,
      opportunity_id: report.opportunity_id,
      user_id: profile.id,
      type: 'note',
      body: `Inspection report emailed to ${to}${attached ? ' (PDF attached)' : ' (share link)'}.`,
    })

    return NextResponse.json({ ok: true, attached, shareUrl })
  } catch (err) {
    const auth = authErrorResponse(err)
    if (auth) return auth
    console.error('inspection-report send POST:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
