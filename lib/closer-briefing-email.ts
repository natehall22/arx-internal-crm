import { getCrmEmailFrom, getMailTransport } from '@/lib/setter-email'
import { createServiceClient } from '@/lib/supabase/service'
import { isUserActiveForTransactionalEmail } from '@/lib/user-email-eligibility'

type InspectionResult = {
  outcome: string
  both_dms_present?: boolean | null
  absent_dm_name?: string | null
  damage_found?: string | null
  roof_slopes?: string | null
  homeowner_emotional_state?: string | null
  consequence_questions_asked?: boolean | null
  insurance_mentioned?: boolean | null
  urgency_level?: string | null
  notes?: string | null
}

export type BriefingPhoto = {
  id: string
  filename: string
  url: string | null
}

const OUTCOME_LABELS: Record<string, string> = {
  approved:   'Approved — Ready to Close',
  denied:     'Denied',
  follow_up:  'Follow-Up Needed',
  not_home:   'Not Home',
  cancelled:  'Cancelled',
  other:      'Other',
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function boolLabel(v: boolean | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return v ? 'Yes' : 'No'
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:8px 12px 8px 0;color:#6B7280;white-space:nowrap;vertical-align:top;width:200px;">${escapeHtml(label)}</td>
    <td style="padding:8px 0;color:#111827;">${escapeHtml(value)}</td>
  </tr>`
}

function photoGrid(photos: BriefingPhoto[]): string {
  if (photos.length === 0) return ''

  const cells = photos
    .filter((p) => p.url)
    .map(
      (p) => `
        <td style="padding:4px;width:33%;">
          <img
            src="${escapeHtml(p.url!)}"
            alt="${escapeHtml(p.filename)}"
            style="width:100%;max-width:180px;height:130px;object-fit:cover;border-radius:6px;border:1px solid #E5E7EB;"
          />
        </td>`
    )

  // Group into rows of 3
  const tableRows: string[] = []
  for (let i = 0; i < cells.length; i += 3) {
    const slice = cells.slice(i, i + 3)
    // Pad to 3 cells so the grid stays aligned
    while (slice.length < 3) slice.push('<td style="padding:4px;width:33%;"></td>')
    tableRows.push(`<tr>${slice.join('')}</tr>`)
  }

  return `
    <div style="margin-top:20px;">
      <p style="font-size:13px;font-weight:600;color:#374151;margin-bottom:8px;">
        Inspection Photos (${photos.filter((p) => p.url).length})
      </p>
      <table style="width:100%;border-collapse:collapse;">
        ${tableRows.join('\n')}
      </table>
      <p style="font-size:11px;color:#9CA3AF;margin-top:6px;">
        Photo links expire in 7 days. Download any photos you need before your appointment.
      </p>
    </div>`
}

/**
 * Plain-text briefing for injection into Google Calendar event description.
 */
export function formatBriefingText(params: {
  customerName: string
  address: string
  inspectorName: string | null
  result: InspectionResult
}): string {
  const { result } = params
  const lines: string[] = [
    `Customer: ${params.customerName}`,
    params.address ? `Address: ${params.address}` : '',
    params.inspectorName ? `Inspector: ${params.inspectorName}` : '',
    `Outcome: ${OUTCOME_LABELS[result.outcome] ?? result.outcome}`,
  ]

  if (result.outcome === 'approved' || result.outcome === 'follow_up') {
    lines.push(`Both DMs Present: ${boolLabel(result.both_dms_present)}`)
    if (!result.both_dms_present && result.absent_dm_name) {
      lines.push(`Absent DM: ${result.absent_dm_name}`)
    }
    if (result.damage_found) lines.push(`Damage Found: ${result.damage_found}`)
    if (result.roof_slopes) lines.push(`Roof Slopes: ${result.roof_slopes}`)
    if (result.homeowner_emotional_state) lines.push(`Homeowner Mood: ${result.homeowner_emotional_state}`)
    lines.push(`Consequence Qs Asked: ${boolLabel(result.consequence_questions_asked)}`)
    lines.push(`Insurance Mentioned: ${boolLabel(result.insurance_mentioned)}`)
    if (result.urgency_level) lines.push(`Urgency: ${result.urgency_level.charAt(0).toUpperCase() + result.urgency_level.slice(1)}`)
    if (result.notes) lines.push(`Notes: ${result.notes}`)
  }

  return lines.filter(Boolean).join('\n')
}

export async function sendCloserBriefingEmail(params: {
  to: string
  /** When set, email is skipped if this CRM user is disabled. */
  recipientUserId?: string | null
  closerName: string | null
  customerName: string
  address: string
  inspectorName: string | null
  result: InspectionResult
  photos?: BriefingPhoto[]
}): Promise<void> {
  if (!process.env.SMTP_HOST || !params.to?.includes('@')) return
  if (params.recipientUserId) {
    const admin = createServiceClient()
    if (!(await isUserActiveForTransactionalEmail(admin, params.recipientUserId))) {
      console.warn('sendCloserBriefingEmail: skipped inactive recipient', params.recipientUserId)
      return
    }
  }

  const { result } = params
  const closerName = params.closerName || 'Closer'
  const outcomeLabel = OUTCOME_LABELS[result.outcome] ?? result.outcome
  const subject = `Inspection Briefing — ${params.customerName} (${outcomeLabel})`

  const briefingRows: string[] = []
  if (result.outcome === 'approved' || result.outcome === 'follow_up') {
    briefingRows.push(row('Both DMs Present', boolLabel(result.both_dms_present)))
    if (!result.both_dms_present && result.absent_dm_name) {
      briefingRows.push(row('Absent DM', result.absent_dm_name))
    }
    if (result.damage_found) briefingRows.push(row('Damage Found', result.damage_found))
    if (result.roof_slopes) briefingRows.push(row('Roof Slopes', result.roof_slopes))
    if (result.homeowner_emotional_state) briefingRows.push(row('Homeowner Mood', result.homeowner_emotional_state))
    briefingRows.push(row('Consequence Qs Asked', boolLabel(result.consequence_questions_asked)))
    briefingRows.push(row('Insurance Mentioned', boolLabel(result.insurance_mentioned)))
    if (result.urgency_level) {
      briefingRows.push(row('Urgency', result.urgency_level.charAt(0).toUpperCase() + result.urgency_level.slice(1)))
    }
    if (result.notes) briefingRows.push(row('Notes', result.notes))
  }

  const transporter = getMailTransport()
  await transporter.sendMail({
    from: getCrmEmailFrom(),
    to: params.to,
    subject,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px;">
        <h2 style="color:#111827;margin-bottom:4px;">${escapeHtml(subject)}</h2>
        <p style="color:#374151;margin-bottom:4px;">Hi ${escapeHtml(closerName)},</p>
        <p style="color:#374151;margin-top:0;">
          Your inspector has completed their visit. Here is the briefing for your upcoming close appointment.
        </p>

        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          ${row('Customer', params.customerName)}
          ${params.address ? row('Address', params.address) : ''}
          ${params.inspectorName ? row('Inspector', params.inspectorName) : ''}
          ${row('Outcome', outcomeLabel)}
          ${briefingRows.join('\n')}
        </table>

        ${photoGrid(params.photos ?? [])}

        <p style="color:#6B7280;font-size:12px;margin-top:24px;">
          This is an automated briefing from ARX CRM. Do not reply to this email.
        </p>
      </div>
    `,
  })
}
