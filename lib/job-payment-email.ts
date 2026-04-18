import type { SupabaseClient } from '@supabase/supabase-js'
import { getMailTransport } from '@/lib/setter-email'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Email active admin + operations users when a payment is posted on a job.
 * No-op when SMTP is not configured. Non-blocking for callers.
 */
export async function notifyAdminOpsOfJobPayment(
  supabase: SupabaseClient,
  params: {
    orgId: string
    jobId: string
    jobNumber: string
    addressText: string
    amountCents: number
    payer: string
    method: string
    paidAt: string
    collectedCents: number
    remainingCents: number
    saleAmountCents: number
  }
): Promise<void> {
  if (!process.env.SMTP_HOST) return

  const { data: recipients, error } = await supabase
    .from('users')
    .select('email')
    .eq('org_id', params.orgId)
    .in('role', ['admin', 'operations'])
    .eq('active', true)

  if (error) {
    console.error('notifyAdminOpsOfJobPayment: recipients query', error)
    return
  }

  const emails = Array.from(
    new Set(
      (recipients || [])
        .map((a) => a.email?.trim().toLowerCase())
        .filter((e): e is string => typeof e === 'string' && e.includes('@'))
    )
  )

  if (emails.length === 0) {
    return
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
  const jobLink = `${appUrl || 'https://arx-internal-crm.vercel.app'}/ops/jobs/${params.jobId}`

  const saleStr =
    params.saleAmountCents > 0 ? formatMoney(params.saleAmountCents) : '—'
  const fullyPaid =
    params.saleAmountCents > 0 && params.collectedCents >= params.saleAmountCents

  const html = `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
        <h2 style="margin: 0 0 12px; color: #111827;">Payment recorded</h2>
        <p style="color: #374151; margin: 0 0 16px;">
          A payment was posted on job <strong>${escapeHtml(params.jobNumber)}</strong>.
        </p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px 0; color: #6B7280; width: 180px;">Job</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${escapeHtml(params.jobNumber)}</td></tr>
          <tr><td style="padding: 8px 0; color: #6B7280;">Address</td><td style="padding: 8px 0; color: #111827;">${escapeHtml(params.addressText || '—')}</td></tr>
          <tr><td style="padding: 8px 0; color: #6B7280;">This payment</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${escapeHtml(formatMoney(params.amountCents))}</td></tr>
          <tr><td style="padding: 8px 0; color: #6B7280;">Payer</td><td style="padding: 8px 0; color: #111827;">${escapeHtml(params.payer)}</td></tr>
          <tr><td style="padding: 8px 0; color: #6B7280;">Method</td><td style="padding: 8px 0; color: #111827;">${escapeHtml(params.method)}</td></tr>
          <tr><td style="padding: 8px 0; color: #6B7280;">Paid at</td><td style="padding: 8px 0; color: #111827;">${escapeHtml(params.paidAt)}</td></tr>
          <tr><td style="padding: 8px 0; color: #6B7280;">Total collected</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${escapeHtml(formatMoney(params.collectedCents))}</td></tr>
          <tr><td style="padding: 8px 0; color: #6B7280;">Remaining</td><td style="padding: 8px 0; color: #111827;">${escapeHtml(formatMoney(Math.max(0, params.remainingCents)))}</td></tr>
          <tr><td style="padding: 8px 0; color: #6B7280;">Contract / sale</td><td style="padding: 8px 0; color: #111827;">${escapeHtml(saleStr)}</td></tr>
          <tr><td style="padding: 8px 0; color: #6B7280;">Status</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${fullyPaid ? 'Paid in full' : 'Balance remaining'}</td></tr>
        </table>
        <p style="margin-top: 16px;"><a href="${escapeHtml(jobLink)}" style="color: #4f46e5;">Open job in CRM</a></p>
        <p style="color: #6B7280; font-size: 12px; margin-top: 16px;">This is an automated message to admin and operations.</p>
      </div>
    `

  const transporter = getMailTransport()
  const subject = `Payment posted: ${params.jobNumber} — ${formatMoney(params.amountCents)}`

  for (const to of emails) {
    try {
      await transporter.sendMail({
        from: 'info@arxroofing.com',
        to,
        subject,
        html,
      })
    } catch (e) {
      console.error('notifyAdminOpsOfJobPayment: send failed', to, e)
    }
  }
}
