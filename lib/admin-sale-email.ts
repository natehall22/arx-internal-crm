import type { SupabaseClient } from '@supabase/supabase-js'
import { getMailTransport } from '@/lib/setter-email'

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
 * Email all active org admins and owners when a sale is recorded (contract signed is the primary trigger).
 * No-op when SMTP is not configured.
 */
export async function notifyOrgAdminsOfSale(
  supabase: SupabaseClient,
  params: {
    orgId: string
    customerName: string
    /** Human-readable description of what was sold (scope, materials, etc.) */
    soldDescription: string
    totalAmount: number | null
    recordUrl?: string
  }
): Promise<void> {
  if (!process.env.SMTP_HOST) return

  const { data: admins, error } = await supabase
    .from('users')
    .select('email')
    .eq('org_id', params.orgId)
    .in('role', ['admin', 'owner'])
    .eq('active', true)

  if (error) {
    console.error('notifyOrgAdminsOfSale: admins query', error)
    return
  }

  const emails = (admins || [])
    .map((a) => a.email?.trim())
    .filter((e): e is string => typeof e === 'string' && e.includes('@'))

  if (emails.length === 0) return

  const n = Number(params.totalAmount)
  const totalStr =
    params.totalAmount != null && Number.isFinite(n)
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
      : '—'

  const transporter = getMailTransport()
  const subject = `New sale: ${params.customerName} — ${totalStr}`

  const sourceLabel = 'Contract signed'

  const html = `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #111827;">New sale recorded</h2>
        <p style="color: #374151;">A sale was recorded in ARX CRM.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px 0; color: #6B7280; width: 180px;">Customer</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${escapeHtml(params.customerName)}</td></tr>
          <tr><td style="padding: 8px 0; color: #6B7280;">What was sold</td><td style="padding: 8px 0; color: #111827;">${escapeHtml(params.soldDescription)}</td></tr>
          <tr><td style="padding: 8px 0; color: #6B7280;">Total</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${escapeHtml(totalStr)}</td></tr>
          <tr><td style="padding: 8px 0; color: #6B7280;">Source</td><td style="padding: 8px 0; color: #111827;">${escapeHtml(sourceLabel)}</td></tr>
        </table>
        ${params.recordUrl ? `<p style="margin-top: 16px;"><a href="${escapeHtml(params.recordUrl)}" style="color: #4f46e5;">Open in ARX CRM</a></p>` : ''}
        <p style="color: #6B7280; font-size: 12px; margin-top: 16px;">This is an automated message to organization admins and owners.</p>
      </div>
    `

  for (const to of emails) {
    try {
      await transporter.sendMail({
        from: 'info@arxroofing.com',
        to,
        subject,
        html,
      })
    } catch (e) {
      console.error('notifyOrgAdminsOfSale: send failed', to, e)
    }
  }
}
