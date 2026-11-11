/**
 * The two emails a quote sends (server only): the quote link (staff taps Send) and the approval confirmation. Both are
 * one-off messages from the COMPANY (its own name + email, postal address in the footer) in the shared customer layout
 * (lib/customer-email-layout.ts) over the shared email channel — no second sender. A company with no name / email /
 * address on file gets a plain "fix this first" answer and nothing is sent (the staff screen still shows the link to copy).
 */
import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import { tryOrgAppUrl } from '@/lib/company-links'
import { renderCustomerEmail } from '@/lib/customer-email-layout'
import { emailChannel, normalizeEmail } from '@/lib/customer-message-channels'
import { BLOCK_REASON_TEXT, companyIdentity } from '@/lib/customer-messages-db'
import { formatCents } from '@/lib/format'
import type { ApprovalRow } from '@/lib/quotes/approve'

export type SendResult = { ok: true } | { ok: false; error: string }

async function send(admin: SupabaseClient, orgId: string, to: string, build: (company: ReturnType<typeof companyIdentity>['company']) => { subject: string; heading: string; paragraphs: string[]; rows?: Array<{ label: string; value: string }>; button?: { label: string; href: string } | null; footnote?: string }): Promise<SendResult> {
  const addr = normalizeEmail(to)
  if (!addr) return { ok: false, error: 'This customer has no usable email address.' }
  if (!emailChannel.available()) return { ok: false, error: 'Email is not set up on this server.' }
  const { data: org } = await admin.from('orgs').select('id, name, address, phone, email, settings, logo_url').eq('id', orgId).maybeSingle()
  if (!org) return { ok: false, error: 'Company not found.' }
  const appUrl = await tryOrgAppUrl(orgId, 'quote email')
  const id = companyIdentity(org as Parameters<typeof companyIdentity>[0], appUrl)
  if (id.missing.length > 0) return { ok: false, error: BLOCK_REASON_TEXT[id.missing[0]] }
  const m = build(id.company)
  const { html, text } = renderCustomerEmail({ company: id.company, heading: m.heading, paragraphs: m.paragraphs, rows: m.rows, button: m.button, footnote: m.footnote, preheader: m.paragraphs[0] })
  const domain = id.from.address.split('@')[1] ?? 'localhost'
  const out = await emailChannel.send(addr, { subject: m.subject, html, text, sms: '' }, { from: id.from, replyTo: id.company.email || null, messageId: `<quote-${randomUUID()}@${domain}>`, unsubscribeUrl: null, unsubscribePostUrl: null })
  return out.ok ? { ok: true } : { ok: false, error: out.error }
}

function hi(name: string | null | undefined): string {
  const first = (name ?? '').trim().split(/\s+/)[0]
  return first ? `Hi ${first},` : 'Hello,'
}

export async function sendQuoteLinkEmail(
  admin: SupabaseClient,
  orgId: string,
  a: { to: string; customerName: string | null; url: string; title: string; expiresAt: string; proposalWord: string }
): Promise<SendResult> {
  const exp = new Date(a.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  return send(admin, orgId, a.to, (c) => ({
    subject: `Your ${a.proposalWord.toLowerCase()} from ${c.name}`,
    heading: `Your ${a.proposalWord.toLowerCase()} is ready`,
    paragraphs: [`${hi(a.customerName)}`, `${a.title ? `${a.title}: ` : ''}your ${a.proposalWord.toLowerCase()} is ready to look over. You can pick any optional items, see your total, and approve it right from your phone.`],
    button: { label: `View and approve`, href: a.url },
    footnote: `This link works until ${exp}. Questions? Just reply to this email${c.phone ? ` or call ${c.phone}` : ''}.`,
  }))
}

export async function sendApprovalConfirmation(admin: SupabaseClient, orgId: string, approval: ApprovalRow, to: string, pageUrl: string | null): Promise<boolean> {
  const dep = approval.deposit_cents
  const chosen = approval.snapshot.lines.filter((l) => l.chosen).map((l) => l.name)
  const r = await send(admin, orgId, to, (c) => ({
    subject: `Approved: thank you, ${approval.typed_name.split(' ')[0]}`,
    heading: 'Your quote is approved',
    paragraphs: [
      `Thank you! ${c.name} has your approval and will be in touch to schedule the work.`,
      dep > 0 ? `A deposit of ${formatCents(dep)} is due. You can pay it by card from your quote page.` : 'No deposit is due now.',
    ],
    rows: [
      { label: 'Approved by', value: approval.typed_name },
      { label: 'Work included', value: chosen.join('\n') },
      { label: 'Total', value: formatCents(approval.total_cents) },
      ...(dep > 0 ? [{ label: 'Deposit', value: formatCents(dep) }] : []),
    ],
    button: pageUrl ? { label: 'Open your quote', href: pageUrl } : null,
  }))
  if (!r.ok) console.error('quote approval confirmation not sent:', r.error)
  return r.ok
}
