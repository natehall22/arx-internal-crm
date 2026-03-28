import { getMailTransport } from '@/lib/setter-email'

type InspectionResult = {
  outcome: string
  both_dms_present?: boolean | null
  absent_dm_name?: string | null
  damage_found?: string | null
  roof_slopes?: string | null
  photos_confirmed?: boolean | null
  homeowner_emotional_state?: string | null
  consequence_questions_asked?: boolean | null
  insurance_mentioned?: boolean | null
  urgency_level?: string | null
  notes?: string | null
}

const OUTCOME_LABELS: Record<string, string> = {
  approved: 'Approved — Ready to Close',
  denied:   'Denied',
  follow_up: 'Follow-Up Needed',
  not_home: 'Not Home',
  cancelled: 'Cancelled',
  other: 'Other',
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

/**
 * Builds a plain-text briefing string suitable for injection into Google Calendar notes.
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
    lines.push(`Photos Confirmed: ${boolLabel(result.photos_confirmed)}`)
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
  closerName: string | null
  customerName: string
  address: string
  inspectorName: string | null
  result: InspectionResult
}): Promise<void> {
  if (!process.env.SMTP_HOST || !params.to?.includes('@')) return

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
    briefingRows.push(row('Photos Confirmed', boolLabel(result.photos_confirmed)))
    if (result.homeowner_emotional_state) {
      briefingRows.push(row('Homeowner Mood', result.homeowner_emotional_state))
    }
    briefingRows.push(row('Consequence Qs Asked', boolLabel(result.consequence_questions_asked)))
    briefingRows.push(row('Insurance Mentioned', boolLabel(result.insurance_mentioned)))
    if (result.urgency_level) {
      briefingRows.push(row('Urgency', result.urgency_level.charAt(0).toUpperCase() + result.urgency_level.slice(1)))
    }
    if (result.notes) briefingRows.push(row('Notes', result.notes))
  }

  const transporter = getMailTransport()
  await transporter.sendMail({
    from: 'info@arxroofing.com',
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

        <p style="color:#6B7280;font-size:12px;margin-top:24px;">
          This is an automated briefing from ARX CRM. Do not reply to this email.
        </p>
      </div>
    `,
  })
}
