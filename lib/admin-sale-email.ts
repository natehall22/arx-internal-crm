import type { SupabaseClient } from '@supabase/supabase-js'
import { getOrgEmailBlastSettings, resolveEmailBlastRecipients } from '@/lib/admin-email-blasts'
import { getCrmEmailFrom, getMailTransport } from '@/lib/setter-email'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Build “what was sold” from order form contract scope fields. */
export function buildOrderFormContractSaleDescription(contract: {
  roofing_material?: string | null
  scope_roof_replacement?: boolean | null
  scope_roof_repair?: boolean | null
  scope_gutters?: boolean | null
  scope_siding?: boolean | null
  scope_other?: string | null
  additional_products?: string | null
}): string {
  const parts: string[] = []
  if (contract.roofing_material?.trim()) parts.push(contract.roofing_material.trim())
  const scopes: string[] = []
  if (contract.scope_roof_replacement) scopes.push('Roof replacement')
  if (contract.scope_roof_repair) scopes.push('Roof repair')
  if (contract.scope_gutters) scopes.push('Gutters')
  if (contract.scope_siding) scopes.push('Siding')
  if (contract.scope_other?.trim()) scopes.push(contract.scope_other.trim())
  if (scopes.length) parts.push(scopes.join(', '))
  if (contract.additional_products?.trim()) parts.push(contract.additional_products.trim())
  return parts.length ? parts.join(' — ') : 'Order form contract signed'
}

/**
 * Email active users in the sales org (reps, setters, canvassers, closers), management, and admin/owner
 * when a sale is recorded. Does not send to operations. No-op when SMTP is not configured.
 */
export async function notifyOrgAdminsOfSale(
  supabase: SupabaseClient,
  params: {
    orgId: string
    customerName: string
    /** Human-readable description of what was sold (scope, materials, etc.) */
    soldDescription: string
    totalAmount: number | null
    setterName?: string | null
    closerName?: string | null
    /** Preferred deep link (e.g. /projects/{id}); falls back to recordUrl */
    projectUrl?: string | null
    recordUrl?: string
  }
): Promise<void> {
  if (!process.env.SMTP_HOST) return

  const { data: orgRow, error: orgError } = await supabase
    .from('orgs')
    .select('settings')
    .eq('id', params.orgId)
    .maybeSingle()

  if (orgError) {
    console.error('notifyOrgAdminsOfSale: org settings query', orgError)
    return
  }

  const settings = getOrgEmailBlastSettings(orgRow?.settings)
  const { emails } = await resolveEmailBlastRecipients(supabase, {
    orgId: params.orgId,
    blastType: 'sale',
    settings,
  }).catch((error) => {
    console.error('notifyOrgAdminsOfSale: recipients query', error)
    return { emails: [], users: [] }
  })

  if (emails.length === 0) {
    console.warn('notifyOrgAdminsOfSale: no recipients (check email blast settings and active users)', {
      orgId: params.orgId,
    })
    return
  }

  const n = Number(params.totalAmount)
  const totalStr =
    params.totalAmount != null && Number.isFinite(n)
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
      : '—'

  const transporter = getMailTransport()
  const subject = `🚀 SALE! 🚀 ${params.customerName}`

  const setterRow = params.setterName
    ? `<tr><td style="padding: 8px 0; color: #6B7280; width: 180px;">Setter</td><td style="padding: 8px 0; color: #111827;">${escapeHtml(params.setterName)}</td></tr>`
    : ''
  const salesRepRow = params.closerName
    ? `<tr><td style="padding: 8px 0; color: #6B7280; width: 180px;">Sales rep</td><td style="padding: 8px 0; color: #111827;">${escapeHtml(params.closerName)}</td></tr>`
    : ''

  const linkLabel = params.projectUrl ? 'Open project' : 'Open in ARX CRM'
  const linkHref = params.projectUrl ?? params.recordUrl

  const html = `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px 0; color: #6B7280; width: 180px;">Customer</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${escapeHtml(params.customerName)}</td></tr>
          ${salesRepRow}
          ${setterRow}
          <tr><td style="padding: 8px 0; color: #6B7280; vertical-align: top;">What was sold</td><td style="padding: 8px 0; color: #111827;">${escapeHtml(params.soldDescription)}</td></tr>
          <tr><td style="padding: 8px 0; color: #6B7280;">Dollar amount</td><td style="padding: 8px 0; color: #111827; font-weight: 600; font-size: 16px;">${escapeHtml(totalStr)}</td></tr>
        </table>
        ${linkHref ? `<p style="margin-top: 16px;"><a href="${escapeHtml(linkHref)}" style="color: #4f46e5;">${escapeHtml(linkLabel)}</a></p>` : ''}
        <p style="color: #6B7280; font-size: 12px; margin-top: 16px;">This is an automated message to the sales org.</p>
      </div>
    `

  for (const to of emails) {
    try {
      await transporter.sendMail({
        from: getCrmEmailFrom(),
        to,
        subject,
        html,
      })
    } catch (e) {
      console.error('notifyOrgAdminsOfSale: send failed', to, e)
    }
  }
}
