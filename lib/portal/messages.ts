/** Tell the company a customer wrote to them (email to the company inbox; never throws — the message is already saved). */
import type { SupabaseClient } from '@supabase/supabase-js'

import { tryOrgAppUrl } from '@/lib/company-links'
import { resolveCompanyInboxEmail } from '@/lib/company-recipient'
import { escapeHtml } from '@/lib/html'
import { getCrmEmailFrom, getMailTransport } from '@/lib/setter-email'
import { orgDb } from '@/lib/supabase/org-db'

export async function notifyCompanyOfPortalMessage(admin: SupabaseClient, orgId: string, customerId: string, body: string): Promise<void> {
  try {
    if (!process.env.SMTP_HOST || !getCrmEmailFrom()) return
    const to = await resolveCompanyInboxEmail(admin, orgId, 'portal message')
    if (!to) return
    const { data } = await orgDb(admin, orgId).from('customers').select('name, phone, email').eq('id', customerId).maybeSingle()
    const c = (data ?? {}) as { name?: string | null; phone?: string | null; email?: string | null }
    const base = await tryOrgAppUrl(orgId, 'portal message notice')
    const link = base ? `${base}/c/${customerId}` : null
    const who = c.name || 'A customer'
    const lines = [`${who} sent a message from their customer account.`, body, [c.phone, c.email].filter(Boolean).join(' · ')].filter(Boolean)
    await getMailTransport().sendMail({
      from: getCrmEmailFrom(),
      to,
      ...(c.email ? { replyTo: c.email } : {}),
      subject: `Message from ${who}`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;color:#111827;">${lines.map((l) => `<p style="font-size:15px;margin:0 0 10px;white-space:pre-wrap;">${escapeHtml(l)}</p>`).join('')}${link ? `<p><a href="${escapeHtml(link)}">Open in the CRM</a></p>` : ''}</div>`,
      text: [...lines, link ?? ''].join('\n\n'),
    })
  } catch (e) {
    console.error('notifyCompanyOfPortalMessage failed', e)
  }
}
